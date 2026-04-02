// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISP1Verifier} from "sp1-contracts/ISP1Verifier.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @dev Struct for decoding ZK proof public values in a single abi.decode call.
struct PublicValues {
    bytes32 nullifier;
    bytes32 caMerkleRoot;
    uint64 proofTimestamp;
    address registrant;
    uint32 walletIndex;
    uint64 notAfter;
    uint64 chainId;
    address registryAddress;
    bytes32 crlMerkleRoot;
    bytes32 country;
    bytes32 org;
    bytes32 orgUnit;
    bytes32 commonName;
}

/// @dev Minimal interface for reading vkey from RegistryFactory (avoids circular import).
interface IRegistryFactory {
    function currentProgramVKey() external view returns (bytes32);
}

/// @title IdentityRegistry
/// @notice On-chain registry for ZK-verified X.509 certificate identities.
/// @dev Users prove they hold a valid certificate (signed by a trusted CA)
///      without revealing any personal data. A nullifier prevents double registration.
contract IdentityRegistry is Initializable {
    // ============ State ============

    /// @notice The SP1 on-chain verifier contract.
    ISP1Verifier public SP1_VERIFIER;

    /// @notice The verification key for the ZK X.509 program (used in standalone mode).
    bytes32 public PROGRAM_V_KEY;

    /// @notice Merkle root of allowed CA set (hides which specific CA issued the cert).
    ///         Auto-computed from caLeaves[] when using addCA/removeCA.
    bytes32 public caMerkleRoot;

    /// @notice On-chain list of trusted CA hashes (SHA-256 of CA public key SPKI DER).
    ///         Anyone can read this to compute Merkle proofs for proof generation.
    bytes32[] public caLeaves;

    /// @notice Tracks whether a CA hash is already in caLeaves (prevents duplicates).
    mapping(bytes32 => bool) public caExists;

    /// @notice Previous CA Merkle root (valid during grace period after root change).
    bytes32 public previousCaMerkleRoot;

    /// @notice Timestamp when the current caMerkleRoot was set.
    uint256 public caMerkleRootUpdatedAt;

    /// @notice Grace period for the previous CA Merkle root (default 24 hours).
    uint256 public caRootGracePeriod = 24 hours;

    uint256 public constant MIN_CA_GRACE_PERIOD = 1 hours;
    uint256 public constant MAX_CA_GRACE_PERIOD = 7 days;

    /// @notice CRL Merkle root (bytes32(0) = CRL checking disabled).
    bytes32 public crlMerkleRoot;

    /// @notice Nullifier → registered wallet address (address(0) = unused).
    mapping(bytes32 => address) public nullifierOwner;

    /// @notice Nullifiers that have been permanently revoked by admin.
    mapping(bytes32 => bool) public revokedNullifiers;

    /// @notice Verified wallet addresses → certificate expiry timestamp (0 = unverified).
    mapping(address => uint64) public verifiedUntil;

    /// @notice Contract owner (for CA management).
    address public owner;

    /// @notice Pending owner for 2-step transfer.
    address public pendingOwner;

    /// @notice Whether the contract is paused.
    bool public paused;

    /// @notice Maximum allowed age of a proof (set at deployment, immutable).
    uint256 public maxProofAge;

    /// @notice Max wallets per certificate (1 = strict 1:1, N = multi-wallet).
    uint32 public MAX_WALLETS_PER_CERT;

    /// @notice Minimum disclosure mask required for registration.
    ///         Bits: 0=Country, 1=Org, 2=OrgUnit, 3=CN.
    ///         0x00 = no disclosure required, 0x01 = country required, etc.
    uint8 public MIN_DISCLOSURE_MASK;

    /// @notice Factory address. If set, vkey is read from factory (centrally managed).
    address public factory;

    /// @dev Reserved storage gap for future upgradeable state variables.
    uint256[49] private __gap;

    // ============ Events ============

    event UserRegistered(address indexed user, bytes32 nullifier);
    event UserReRegistered(address indexed oldUser, address indexed newUser, bytes32 nullifier);
    event CaMerkleRootUpdated(bytes32 indexed newRoot);
    event CaAdded(bytes32 indexed caHash, uint256 index);
    event CaRemoved(bytes32 indexed caHash, uint256 index);
    event CrlMerkleRootUpdated(bytes32 indexed newRoot);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event IdentityRevoked(address indexed user, bytes32 indexed nullifier, bytes32 reason);
    event CaRootGracePeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event ProgramVKeyUpdated(bytes32 indexed newVKey);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ============ Errors ============

    error InvalidCaMerkleRoot(bytes32 proofRoot, bytes32 expectedRoot);
    error ZeroMerkleRoot();
    error ZeroProgramVKey();
    error AlreadyRegistered(bytes32 nullifier);
    error UserAlreadyVerified(address user);
    error ProofTooOld(uint64 proofTimestamp, uint256 blockTimestamp);
    error ProofInFuture(uint64 proofTimestamp, uint256 blockTimestamp);
    error RegistrantMismatch(address proofRegistrant, address actualSender);
    error OnlyOwner();
    error ZeroAddress();
    error VerifierNotContract();
    error ContractPaused();
    error NotPendingOwner();
    error NullifierNotRegistered(bytes32 nullifier);
    error NullifierRevoked(bytes32 nullifier);
    error ZeroMaxWallets();
    error WalletIndexOutOfRange(uint32 walletIndex, uint32 maxAllowed);
    error CertAlreadyExpired(uint64 notAfter, uint256 blockTimestamp);
    error ChainIdMismatch(uint64 proofChainId, uint256 expectedChainId);
    error RegistryAddressMismatch(address proofRegistry, address expectedRegistry);
    error InvalidCrlMerkleRoot(bytes32 proofRoot, bytes32 expectedRoot);
    error ProofAgeOutOfRange(uint256 age, uint256 min, uint256 max);
    error GracePeriodOutOfRange(uint256 period, uint256 min, uint256 max);
    error ZeroCaHash();
    error DuplicateCaHash(bytes32 caHash);
    error CaIndexOutOfBounds(uint256 index, uint256 length);
    error CaIndicesNotDescending(uint256 current, uint256 previous);
    error InsufficientDisclosure(uint8 proofMask, uint8 requiredMask);
    error InvalidDisclosureMask(uint8 mask);
    error VKeyManagedByFactory();
    error FactoryNotContract();

    // ============ Modifiers ============

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert OnlyOwner();
    }

    modifier whenNotPaused() {
        _whenNotPaused();
        _;
    }

    function _whenNotPaused() internal view {
        if (paused) revert ContractPaused();
    }

    // ============ Constructor / Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initialize the registry (called once via proxy).
    /// @param _sp1Verifier Address of the SP1 verifier contract.
    /// @param _programVKey The verification key for the ZK X.509 SP1 program (ignored if _factory is set).
    /// @param _maxWallets Max wallets per certificate (1 for DAO/voting, N for DeFi).
    /// @param _minDisclosureMask Minimum disclosure bitmask required (0x00 = none required).
    /// @param _maxProofAge Maximum allowed age of a proof in seconds (e.g., 3600 = 1 hour).
    /// @param _owner The initial owner of this registry.
    /// @param _factory Factory address. If non-zero, vkey is read from factory (centrally managed).
    function initialize(
        address _sp1Verifier,
        bytes32 _programVKey,
        uint32 _maxWallets,
        uint8 _minDisclosureMask,
        uint256 _maxProofAge,
        address _owner,
        address _factory
    ) external initializer {
        if (_sp1Verifier == address(0)) revert ZeroAddress();
        if (_sp1Verifier.code.length == 0) revert VerifierNotContract();
        if (_owner == address(0)) revert ZeroAddress();
        if (_maxWallets == 0) revert ZeroMaxWallets();
        if (_minDisclosureMask > 0x0F) revert InvalidDisclosureMask(_minDisclosureMask);
        if (_maxProofAge < 5 minutes || _maxProofAge > 24 hours) revert ProofAgeOutOfRange(_maxProofAge, 5 minutes, 24 hours);

        if (_factory != address(0)) {
            // Factory mode: vkey is managed by the factory contract
            if (_factory.code.length == 0) revert FactoryNotContract();
            factory = _factory;
        } else {
            // Standalone mode: vkey must be provided and stored locally
            if (_programVKey == bytes32(0)) revert ZeroProgramVKey();
            PROGRAM_V_KEY = _programVKey;
        }

        SP1_VERIFIER = ISP1Verifier(_sp1Verifier);
        MAX_WALLETS_PER_CERT = _maxWallets;
        MIN_DISCLOSURE_MASK = _minDisclosureMask;
        maxProofAge = _maxProofAge;
        owner = _owner;
    }

    // ============ Internal ============

    /// @dev Shared validation: decode, check registrant, timestamp, CA, walletIndex, and verify proof.
    function _validateProof(
        bytes calldata proof,
        bytes calldata publicValues
    ) internal view returns (bytes32 nullifier, uint64 notAfter) {
        PublicValues memory pv = abi.decode(publicValues, (PublicValues));

        if (pv.registrant != msg.sender) revert RegistrantMismatch(pv.registrant, msg.sender);
        if (pv.proofTimestamp > block.timestamp) revert ProofInFuture(pv.proofTimestamp, block.timestamp);
        if (block.timestamp - pv.proofTimestamp > maxProofAge) revert ProofTooOld(pv.proofTimestamp, block.timestamp);
        if (pv.caMerkleRoot != caMerkleRoot) {
            bool inGrace = previousCaMerkleRoot != bytes32(0)
                && pv.caMerkleRoot == previousCaMerkleRoot
                && block.timestamp <= caMerkleRootUpdatedAt + caRootGracePeriod;
            if (!inGrace) revert InvalidCaMerkleRoot(pv.caMerkleRoot, caMerkleRoot);
        }
        if (pv.walletIndex >= MAX_WALLETS_PER_CERT) revert WalletIndexOutOfRange(pv.walletIndex, MAX_WALLETS_PER_CERT);
        if (pv.notAfter < block.timestamp) revert CertAlreadyExpired(pv.notAfter, block.timestamp);
        if (pv.chainId != uint64(block.chainid)) revert ChainIdMismatch(pv.chainId, block.chainid);
        if (pv.registryAddress != address(this)) revert RegistryAddressMismatch(pv.registryAddress, address(this));

        if (crlMerkleRoot != bytes32(0)) {
            if (pv.crlMerkleRoot != crlMerkleRoot) revert InvalidCrlMerkleRoot(pv.crlMerkleRoot, crlMerkleRoot);
        }

        // Check minimum disclosure mask: each required bit must have a non-zero hash
        if (MIN_DISCLOSURE_MASK != 0) {
            uint8 actualMask = 0;
            if (pv.country != bytes32(0)) actualMask |= 0x01;
            if (pv.org != bytes32(0)) actualMask |= 0x02;
            if (pv.orgUnit != bytes32(0)) actualMask |= 0x04;
            if (pv.commonName != bytes32(0)) actualMask |= 0x08;
            if ((actualMask & MIN_DISCLOSURE_MASK) != MIN_DISCLOSURE_MASK) {
                revert InsufficientDisclosure(actualMask, MIN_DISCLOSURE_MASK);
            }
        }

        nullifier = pv.nullifier;
        notAfter = pv.notAfter;

        SP1_VERIFIER.verifyProof(_getVKey(), publicValues, proof);
    }

    /// @dev Resolve the effective vkey: from factory (if set) or local storage.
    function _getVKey() internal view returns (bytes32) {
        if (factory != address(0)) {
            return IRegistryFactory(factory).currentProgramVKey();
        }
        return PROGRAM_V_KEY;
    }

    /// @notice Returns the vkey actually used for proof verification.
    /// @dev In factory mode, reads from factory.currentProgramVKey().
    ///      In standalone mode, returns the locally stored PROGRAM_V_KEY.
    function effectiveProgramVKey() external view returns (bytes32) {
        return _getVKey();
    }

    // ============ External Functions ============

    /// @notice Register a verified identity using a ZK proof of X.509 certificate ownership.
    function register(bytes calldata proof, bytes calldata publicValues) external whenNotPaused {
        // Check sender not already verified first (cheapest common revert, avoids proof verification gas)
        if (verifiedUntil[msg.sender] >= block.timestamp) revert UserAlreadyVerified(msg.sender);

        (bytes32 nullifier, uint64 notAfter) = _validateProof(proof, publicValues);

        if (revokedNullifiers[nullifier]) revert NullifierRevoked(nullifier);
        if (nullifierOwner[nullifier] != address(0)) revert AlreadyRegistered(nullifier);

        nullifierOwner[nullifier] = msg.sender;
        verifiedUntil[msg.sender] = notAfter;

        emit UserRegistered(msg.sender, nullifier);
    }

    /// @notice Re-register: move an existing nullifier slot to a new wallet address.
    /// @dev No admin required. User proves ownership of the same certificate with a new wallet.
    ///      The old wallet's verification is cleared and the new wallet takes over.
    ///      WARNING: If certificate files are compromised, an attacker could re-register
    ///      to their own wallet. This is by design — the certificate is the identity anchor.
    function reRegister(bytes calldata proof, bytes calldata publicValues) external whenNotPaused {
        // Early revert before expensive proof verification (same pattern as register)
        if (verifiedUntil[msg.sender] >= block.timestamp) revert UserAlreadyVerified(msg.sender);

        (bytes32 nullifier, uint64 notAfter) = _validateProof(proof, publicValues);

        if (revokedNullifiers[nullifier]) revert NullifierRevoked(nullifier);
        address oldOwner = nullifierOwner[nullifier];
        if (oldOwner == address(0)) revert NullifierNotRegistered(nullifier);

        if (oldOwner != msg.sender) {
            verifiedUntil[oldOwner] = 0;
            nullifierOwner[nullifier] = msg.sender;
        }
        verifiedUntil[msg.sender] = notAfter;

        emit UserReRegistered(oldOwner, msg.sender, nullifier);
    }

    /// @notice Check if a wallet address is currently verified (not expired).
    /// @param user The wallet address to check.
    /// @return True if the user is verified and certificate has not expired.
    function isVerified(address user) external view returns (bool) {
        return verifiedUntil[user] >= block.timestamp;
    }

    // ============ Admin Functions ============

    /// @notice Update the Merkle root of the allowed CA set.
    /// @dev The previous root remains valid during caRootGracePeriod (default 24h).
    /// @param newRoot The new Merkle root of the allowed CA hashes.
    function updateCaMerkleRoot(bytes32 newRoot) external onlyOwner {
        if (newRoot == bytes32(0)) revert ZeroMerkleRoot();
        _rotateCaMerkleRoot(newRoot);
    }

    /// @notice Add a trusted CA to the on-chain list. Automatically recomputes caMerkleRoot.
    /// @param caHash SHA-256 hash of the CA's public key (SPKI DER format).
    function addCA(bytes32 caHash) external onlyOwner {
        _addSingleCA(caHash);
        _recomputeCaMerkleRoot();
    }

    /// @notice Add multiple trusted CAs in a single transaction. Recomputes root once.
    /// @param caHashes Array of SHA-256 hashes of CA public keys.
    function addCAs(bytes32[] calldata caHashes) external onlyOwner {
        for (uint256 i = 0; i < caHashes.length; i++) {
            _addSingleCA(caHashes[i]);
        }
        _recomputeCaMerkleRoot();
    }

    function _addSingleCA(bytes32 caHash) internal {
        if (caHash == bytes32(0)) revert ZeroCaHash();
        if (caExists[caHash]) revert DuplicateCaHash(caHash);
        caLeaves.push(caHash);
        caExists[caHash] = true;
        emit CaAdded(caHash, caLeaves.length - 1);
    }

    /// @notice Remove a trusted CA by index. Swaps with last element and pops.
    ///         Automatically recomputes caMerkleRoot.
    /// @param index Index of the CA to remove in caLeaves array.
    function removeCA(uint256 index) external onlyOwner {
        _removeSingleCA(index);
        _recomputeCaMerkleRoot();
    }

    /// @notice Remove multiple CAs in a single transaction. Indices must be sorted descending.
    /// @param indices Indices to remove, sorted largest-first (required for swap-and-pop safety).
    function removeCAs(uint256[] calldata indices) external onlyOwner {
        for (uint256 i = 0; i < indices.length; i++) {
            if (i > 0 && indices[i] >= indices[i - 1]) {
                revert CaIndicesNotDescending(indices[i], indices[i - 1]);
            }
            _removeSingleCA(indices[i]);
        }
        _recomputeCaMerkleRoot();
    }

    function _removeSingleCA(uint256 index) internal {
        uint256 len = caLeaves.length;
        if (index >= len) revert CaIndexOutOfBounds(index, len);
        bytes32 removed = caLeaves[index];
        caExists[removed] = false;
        caLeaves[index] = caLeaves[len - 1];
        caLeaves.pop();
        emit CaRemoved(removed, index);
    }

    /// @notice Get the number of trusted CAs.
    function getCaCount() external view returns (uint256) {
        return caLeaves.length;
    }

    /// @notice Get all trusted CA hashes. Useful for off-chain Merkle proof generation.
    function getCaLeaves() external view returns (bytes32[] memory) {
        return caLeaves;
    }

    /// @notice Update the program verification key (standalone mode only).
    /// @dev Reverts if this registry was created via a factory (vkey is managed by factory).
    /// @param newVKey The new verification key.
    function updateProgramVKey(bytes32 newVKey) external onlyOwner {
        if (factory != address(0)) revert VKeyManagedByFactory();
        if (newVKey == bytes32(0)) revert ZeroProgramVKey();
        PROGRAM_V_KEY = newVKey;
        emit ProgramVKeyUpdated(newVKey);
    }

    /// @notice Update the CRL Merkle root. Set bytes32(0) to disable CRL checking.
    /// @param newRoot The new CRL SMT root (from off-chain Relayer).
    function updateCrlMerkleRoot(bytes32 newRoot) external onlyOwner {
        crlMerkleRoot = newRoot;
        emit CrlMerkleRootUpdated(newRoot);
    }

    /// @notice Adjust the grace period for the previous CA Merkle root.
    /// @param newPeriod New grace period in seconds (1 hour to 7 days).
    function setCaRootGracePeriod(uint256 newPeriod) external onlyOwner {
        if (newPeriod < MIN_CA_GRACE_PERIOD || newPeriod > MAX_CA_GRACE_PERIOD) {
            revert GracePeriodOutOfRange(newPeriod, MIN_CA_GRACE_PERIOD, MAX_CA_GRACE_PERIOD);
        }
        uint256 oldPeriod = caRootGracePeriod;
        caRootGracePeriod = newPeriod;
        emit CaRootGracePeriodUpdated(oldPeriod, newPeriod);
    }

    /// @notice Revoke an identity by nullifier. Permanently disables the nullifier
    ///         and unverifies the associated wallet. Cannot be undone.
    /// @param nullifier The nullifier to revoke.
    /// @param reason Reason code (e.g., keccak256("CERT_REVOKED")).
    function revokeIdentity(bytes32 nullifier, bytes32 reason) external onlyOwner {
        address user = nullifierOwner[nullifier];
        if (user == address(0)) revert NullifierNotRegistered(nullifier);
        verifiedUntil[user] = 0;
        revokedNullifiers[nullifier] = true;
        emit IdentityRevoked(user, nullifier, reason);
    }

    /// @notice Pause the contract (emergency stop).
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /// @notice Initiate ownership transfer (2-step: propose then accept).
    /// @param newOwner The proposed new owner address.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
    }

    /// @notice Accept ownership transfer (must be called by pendingOwner).
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ============ Internal ============

    /// @dev Save current root as previous, set new root, and record update time.
    ///      Skip rotation if the root hasn't actually changed (prevents grace period reset).
    function _rotateCaMerkleRoot(bytes32 newRoot) internal {
        if (newRoot == caMerkleRoot) return;
        previousCaMerkleRoot = caMerkleRoot;
        caMerkleRootUpdatedAt = block.timestamp;
        caMerkleRoot = newRoot;
        emit CaMerkleRootUpdated(newRoot);
    }

    /// @dev Recompute caMerkleRoot from caLeaves[] using SHA-256 sorted-pair Merkle tree.
    ///      Same algorithm as zkVM (program/src/main.rs verify_merkle_membership).
    ///      In-place computation to minimize memory allocation.
    function _recomputeCaMerkleRoot() internal {
        uint256 len = caLeaves.length;
        if (len == 0) {
            _rotateCaMerkleRoot(bytes32(0));
            return;
        }
        if (len == 1) {
            _rotateCaMerkleRoot(caLeaves[0]);
            return;
        }

        // Copy leaves to memory (single allocation, reused in-place)
        bytes32[] memory layer = new bytes32[](len);
        for (uint256 i = 0; i < len; i++) {
            layer[i] = caLeaves[i];
        }

        // Build tree bottom-up, in-place
        uint256 size = len;
        while (size > 1) {
            uint256 newSize = (size + 1) / 2;
            for (uint256 i = 0; i < newSize; i++) {
                bytes32 left = layer[i * 2];
                bytes32 right = (i * 2 + 1 < size) ? layer[i * 2 + 1] : left;
                // Sorted-pair hash: H(min(a,b) || max(a,b))
                if (left <= right) {
                    layer[i] = sha256(abi.encodePacked(left, right));
                } else {
                    layer[i] = sha256(abi.encodePacked(right, left));
                }
            }
            size = newSize;
        }

        _rotateCaMerkleRoot(layer[0]);
    }
}
