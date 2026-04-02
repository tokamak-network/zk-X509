// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IdentityRegistry} from "./IdentityRegistry.sol";
import {ISP1Verifier} from "sp1-contracts/ISP1Verifier.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title RegistryFactory
/// @notice Factory for deploying independent IdentityRegistry instances as Beacon Proxies.
/// @dev Each deployed registry is fully independent with its own owner,
///      CA list, and configuration. The factory shares the SP1 verifier
///      across all registries, with versioned ZK program verification keys.
///      All proxies share a single implementation via UpgradeableBeacon,
///      allowing the factory owner to upgrade all registries at once.
///      Registry creation fee can be paid in native token or ERC-20 (TON).
contract RegistryFactory {
    /// @notice Factory owner (can upgrade implementation and update settings).
    address public owner;

    /// @notice Pending owner for 2-step ownership transfer.
    address public pendingOwner;

    /// @notice The shared SP1 verifier contract.
    ISP1Verifier public immutable SP1_VERIFIER;

    /// @notice The current ZK program verification key (used for new registries).
    bytes32 public currentProgramVKey;

    /// @notice VKey version history: version number → VKey.
    mapping(uint256 => bytes32) public vKeyVersions;

    /// @notice Total number of VKey versions published.
    uint256 public vKeyVersionCount;

    /// @notice Track all VKeys ever published (prevents re-introduction of deprecated keys).
    mapping(bytes32 => bool) public usedVKeys;

    /// @notice The beacon that all registry proxies point to.
    UpgradeableBeacon public beacon;

    /// @notice All deployed registries (for enumeration).
    address[] public registries;

    /// @notice Quick lookup: is this address a registry deployed by this factory?
    mapping(address => bool) public isRegistry;

    // ============ Fee Configuration ============

    /// @notice Fee token address. address(0) = native token (ETH/TON), else ERC-20.
    address public feeToken;

    /// @notice Registry creation fee amount. 0 = free.
    uint256 public registryCreationFee;

    /// @notice Address that receives platform fees.
    address public feeRecipient;

    /// @notice Metadata for each registry (immutable config snapshot at creation time).
    /// @dev `owner` reflects the initial creator. For current owner, call registry.owner() directly.
    struct RegistryInfo {
        address creator;
        string name;
        uint32 maxWallets;
        uint8 minDisclosureMask;
        uint256 maxProofAge;
        uint256 createdAt;
        uint256 vKeyVersion;
    }

    /// @notice Registry address → metadata.
    mapping(address => RegistryInfo) public registryInfo;

    // ============ Events ============

    event RegistryCreated(
        address indexed registry,
        address indexed owner,
        string name,
        uint32 maxWallets,
        uint8 minDisclosureMask,
        uint256 vKeyVersion
    );

    event ImplementationUpgraded(address indexed newImplementation);

    event ProgramVKeyUpdated(bytes32 indexed newVKey, uint256 version);

    event FeeConfigUpdated(address feeToken, uint256 fee, address recipient);

    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ============ Errors ============

    error ZeroMaxWallets();
    error ZeroMaxProofAge();
    error InvalidDisclosureMask();
    error OnlyOwner();
    error ZeroVKey();
    error ZeroVerifier();
    error VerifierNotContract();
    error DuplicateVKey();
    error InsufficientFee();
    error UnexpectedValue();
    error FeeTransferFailed();
    error RefundFailed();
    error ZeroFeeRecipient();
    error ZeroAddress();
    error NotPendingOwner();

    // ============ Modifiers ============

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    // ============ Constructor ============

    /// @param _sp1Verifier Address of the shared SP1 verifier contract.
    /// @param _programVKey The initial ZK program verification key.
    /// @param _feeToken Fee token: address(0) = native token, else ERC-20 (e.g., TON).
    /// @param _creationFee Registry creation fee amount. 0 = free.
    /// @param _feeRecipient Address that receives fees. Required if fee > 0.
    constructor(
        address _sp1Verifier,
        bytes32 _programVKey,
        address _feeToken,
        uint256 _creationFee,
        address _feeRecipient
    ) {
        if (_sp1Verifier == address(0)) revert ZeroVerifier();
        if (_sp1Verifier.code.length == 0) revert VerifierNotContract();
        if (_programVKey == bytes32(0)) revert ZeroVKey();
        if (_creationFee > 0 && _feeRecipient == address(0)) revert ZeroFeeRecipient();

        owner = msg.sender;
        SP1_VERIFIER = ISP1Verifier(_sp1Verifier);
        currentProgramVKey = _programVKey;
        vKeyVersions[0] = _programVKey;
        usedVKeys[_programVKey] = true;
        vKeyVersionCount = 1;

        feeToken = _feeToken;
        registryCreationFee = _creationFee;
        feeRecipient = _feeRecipient;

        // Deploy implementation + beacon (factory is beacon admin)
        address implementation = address(new IdentityRegistry());
        beacon = new UpgradeableBeacon(implementation, address(this));

        emit ProgramVKeyUpdated(_programVKey, 0);
    }

    // ============ External Functions ============

    /// @notice Deploy a new IdentityRegistry as a Beacon Proxy with the given configuration.
    /// @dev If a creation fee is configured, the caller must either:
    ///      - Send sufficient msg.value (if feeToken == address(0)), or
    ///      - Have approved sufficient ERC-20 allowance (if feeToken != address(0)).
    /// @param name Human-readable name for the registry (e.g., "DAO Voting").
    /// @param maxWallets Max wallets per certificate (1 = strict, N = multi-wallet).
    /// @param minDisclosureMask Minimum disclosure bitmask (0x00 = none required).
    /// @param maxProofAge Maximum proof age in seconds (e.g., 3600 = 1 hour). Cannot be changed after deployment.
    /// @return registry The address of the newly deployed registry proxy.
    function createRegistry(
        string calldata name,
        uint32 maxWallets,
        uint8 minDisclosureMask,
        uint256 maxProofAge
    ) external payable returns (address registry) {
        if (maxWallets == 0) revert ZeroMaxWallets();
        if (minDisclosureMask > 0x0F) revert InvalidDisclosureMask();
        if (maxProofAge < 5 minutes || maxProofAge > 24 hours) revert ZeroMaxProofAge();

        _collectFee();

        // Encode the initialize call for the proxy (uses latest VKey)
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(SP1_VERIFIER), bytes32(0), maxWallets, minDisclosureMask, maxProofAge, msg.sender, address(this))
        );

        BeaconProxy proxy = new BeaconProxy(address(beacon), initData);
        registry = address(proxy);

        registries.push(registry);
        isRegistry[registry] = true;
        uint256 latestVersion = vKeyVersionCount - 1;
        registryInfo[registry] = RegistryInfo({
            creator: msg.sender,
            name: name,
            maxWallets: maxWallets,
            minDisclosureMask: minDisclosureMask,
            maxProofAge: maxProofAge,
            createdAt: block.timestamp,
            vKeyVersion: latestVersion
        });

        emit RegistryCreated(registry, msg.sender, name, maxWallets, minDisclosureMask, latestVersion);
    }

    /// @notice Update the ZK program verification key.
    /// @dev New registries will use the updated VKey. Existing registries keep
    ///      their deployment-time VKey (set during initialize, immutable per registry).
    /// @param newVKey The new verification key.
    function updateProgramVKey(bytes32 newVKey) external onlyOwner {
        if (newVKey == bytes32(0)) revert ZeroVKey();
        if (usedVKeys[newVKey]) revert DuplicateVKey();
        uint256 version = vKeyVersionCount++;
        vKeyVersions[version] = newVKey;
        usedVKeys[newVKey] = true;
        currentProgramVKey = newVKey;
        emit ProgramVKeyUpdated(newVKey, version);
    }

    /// @notice Upgrade all registries to a new implementation.
    /// @param newImplementation Address of the new IdentityRegistry implementation.
    function upgradeImplementation(address newImplementation) external onlyOwner {
        beacon.upgradeTo(newImplementation);
        emit ImplementationUpgraded(newImplementation);
    }

    /// @notice Update fee configuration.
    /// @param _feeToken Fee token: address(0) = native, else ERC-20.
    /// @param _fee Fee amount. 0 = free.
    /// @param _recipient Fee recipient. Required if fee > 0.
    function setFeeConfig(address _feeToken, uint256 _fee, address _recipient) external onlyOwner {
        if (_fee > 0 && _recipient == address(0)) revert ZeroFeeRecipient();
        feeToken = _feeToken;
        registryCreationFee = _fee;
        feeRecipient = _recipient;
        emit FeeConfigUpdated(_feeToken, _fee, _recipient);
    }

    // ============ Ownership Transfer ============

    /// @notice Start 2-step ownership transfer. New owner must call acceptOwnership().
    /// @param newOwner The address to transfer ownership to.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Accept ownership transfer. Must be called by the pending owner.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ============ Internal Functions ============

    /// @dev Collect platform fee for registry creation.
    function _collectFee() internal {
        if (registryCreationFee == 0) {
            // No fee — reject accidental ETH sends
            if (msg.value > 0) revert UnexpectedValue();
            return;
        }

        if (feeToken == address(0)) {
            // Native token (ETH on L1, TON on L2)
            if (msg.value < registryCreationFee) revert InsufficientFee();
            (bool sent,) = feeRecipient.call{value: registryCreationFee}("");
            if (!sent) revert FeeTransferFailed();
            // Refund excess
            uint256 excess = msg.value - registryCreationFee;
            if (excess > 0) {
                (bool refunded,) = msg.sender.call{value: excess}("");
                if (!refunded) revert RefundFailed();
            }
        } else {
            // ERC-20 token (TON on L1) — reject native token sends
            if (msg.value > 0) revert UnexpectedValue();
            SafeERC20.safeTransferFrom(IERC20(feeToken), msg.sender, feeRecipient, registryCreationFee);
        }
    }

    // ============ View Functions ============

    /// @notice Get the total number of deployed registries.
    function getRegistryCount() external view returns (uint256) {
        return registries.length;
    }

    /// @notice Get all deployed registry addresses.
    /// @dev For large lists, use getRegistriesPaginated() to avoid gas limits.
    function getRegistries() external view returns (address[] memory) {
        return registries;
    }

    /// @notice Get a paginated slice of deployed registry addresses.
    /// @param offset Starting index.
    /// @param limit Maximum number of registries to return.
    function getRegistriesPaginated(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = registries.length;
        if (offset >= total) return new address[](0);
        uint256 remaining = total - offset;
        uint256 count = remaining < limit ? remaining : limit;
        address[] memory result = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            result[i] = registries[offset + i];
        }
        return result;
    }
}
