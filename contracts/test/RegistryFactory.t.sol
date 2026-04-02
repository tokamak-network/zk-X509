// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {RegistryFactory} from "../src/RegistryFactory.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal mock SP1 verifier that accepts all proofs.
contract MockSP1Verifier {
    function verifyProof(bytes32, bytes calldata, bytes calldata) external pure {}
}

/// @dev Mock ERC-20 token for fee testing.
contract MockTON is ERC20 {
    constructor() ERC20("Mock TON", "TON") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract RegistryFactoryTest is Test {
    RegistryFactory public factory;
    MockSP1Verifier public mockVerifier;
    bytes32 constant PROGRAM_V_KEY = bytes32(uint256(0x1234));

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        mockVerifier = new MockSP1Verifier();
        // Deploy with no fee (free mode)
        factory = new RegistryFactory(address(mockVerifier), PROGRAM_V_KEY, address(0), 0, address(0));
    }

    function test_CreateRegistry() public {
        vm.prank(alice);
        address reg = factory.createRegistry("Test", 1, 0, 3600);

        assertTrue(factory.isRegistry(reg));
        assertEq(factory.getRegistryCount(), 1);

        IdentityRegistry registry = IdentityRegistry(reg);
        assertEq(registry.owner(), alice);
        assertEq(registry.MAX_WALLETS_PER_CERT(), 1);
        assertEq(registry.MIN_DISCLOSURE_MASK(), 0);
    }

    function test_CreateRegistryWithDisclosure() public {
        vm.prank(alice);
        address reg = factory.createRegistry("DeFi KYC", 3, 0x01, 3600);

        IdentityRegistry registry = IdentityRegistry(reg);
        assertEq(registry.MAX_WALLETS_PER_CERT(), 3);
        assertEq(registry.MIN_DISCLOSURE_MASK(), 0x01);
    }

    function test_CreateMultipleRegistries() public {
        vm.prank(alice);
        factory.createRegistry("Test", 1, 0, 3600);

        vm.prank(bob);
        factory.createRegistry("Registry B", 3, 0x03, 3600);

        assertEq(factory.getRegistryCount(), 2);

        address[] memory all = factory.getRegistries();
        assertEq(all.length, 2);
        assertTrue(factory.isRegistry(all[0]));
        assertTrue(factory.isRegistry(all[1]));

        // Different owners
        assertEq(IdentityRegistry(all[0]).owner(), alice);
        assertEq(IdentityRegistry(all[1]).owner(), bob);
    }

    function test_RegistryInfo() public {
        vm.prank(alice);
        address reg = factory.createRegistry("My Service", 2, 0x01, 3600);

        (address creator, string memory name, uint32 maxWallets, uint8 mask, uint256 proofAge, uint256 createdAt, uint256 vKeyVer) =
            factory.registryInfo(reg);

        assertEq(creator, alice);
        assertEq(name, "My Service");
        assertEq(maxWallets, 2);
        assertEq(mask, 0x01);
        assertEq(proofAge, 3600);
        assertGt(createdAt, 0);
        assertEq(vKeyVer, 0);
    }

    function test_OwnerCanManageCA() public {
        vm.prank(alice);
        address reg = factory.createRegistry("Test", 1, 0, 3600);

        IdentityRegistry registry = IdentityRegistry(reg);

        // Alice (owner) can add CA
        bytes32 caHash = bytes32(uint256(0xCAFE));
        vm.prank(alice);
        registry.addCA(caHash);
        assertEq(registry.getCaCount(), 1);
    }

    function test_FactoryCannotManageRegistry() public {
        vm.prank(alice);
        address reg = factory.createRegistry("Test", 1, 0, 3600);

        IdentityRegistry registry = IdentityRegistry(reg);

        // Factory is NOT the owner — should revert
        bytes32 caHash = bytes32(uint256(0xCAFE));
        vm.prank(address(factory));
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.addCA(caHash);
    }

    function test_RevertVerifierNotContract() public {
        // EOA address (no code) should revert
        vm.expectRevert(RegistryFactory.VerifierNotContract.selector);
        new RegistryFactory(address(0xDEAD), PROGRAM_V_KEY, address(0), 0, address(0));
    }

    function test_RevertZeroMaxWallets() public {
        vm.expectRevert(RegistryFactory.ZeroMaxWallets.selector);
        factory.createRegistry("Test", 0, 0, 3600);
    }

    function test_RevertInvalidDisclosureMask() public {
        vm.expectRevert(RegistryFactory.InvalidDisclosureMask.selector);
        factory.createRegistry("Bad", 1, 0x10, 3600);
    }

    function test_RegistriesAreIndependent() public {
        vm.prank(alice);
        address regA = factory.createRegistry("Test", 1, 0, 3600);

        vm.prank(bob);
        address regB = factory.createRegistry("B", 3, 0x01, 3600);

        // Add CA to registry A only
        bytes32 caHash = bytes32(uint256(0xCAFE));
        vm.prank(alice);
        IdentityRegistry(regA).addCA(caHash);

        // Registry A has 1 CA, Registry B has 0
        assertEq(IdentityRegistry(regA).getCaCount(), 1);
        assertEq(IdentityRegistry(regB).getCaCount(), 0);
    }

    function test_BeaconExists() public view {
        // Beacon should be deployed by the factory
        assertTrue(address(factory.beacon()) != address(0));
    }

    function test_UpgradeImplementation() public {
        // Deploy a new implementation
        IdentityRegistry newImpl = new IdentityRegistry();

        // Only factory owner can upgrade
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.OnlyOwner.selector);
        factory.upgradeImplementation(address(newImpl));

        // Factory owner (this contract) can upgrade
        factory.upgradeImplementation(address(newImpl));
    }

    function test_UpgradedRegistryStillWorks() public {
        // Create a registry and configure it
        vm.prank(alice);
        address reg = factory.createRegistry("Test", 1, 0, 3600);

        IdentityRegistry registry = IdentityRegistry(reg);
        bytes32 caHash = bytes32(uint256(0xCAFE));
        vm.prank(alice);
        registry.addCA(caHash);
        assertEq(registry.getCaCount(), 1);

        // Upgrade implementation
        IdentityRegistry newImpl = new IdentityRegistry();
        factory.upgradeImplementation(address(newImpl));

        // State should be preserved after upgrade
        assertEq(registry.getCaCount(), 1);
        assertEq(registry.owner(), alice);
        assertEq(registry.MAX_WALLETS_PER_CERT(), 1);
    }

    function test_InitialVKeyVersion() public view {
        assertEq(factory.currentProgramVKey(), PROGRAM_V_KEY);
        assertEq(factory.vKeyVersionCount(), 1);
        assertEq(factory.vKeyVersions(0), PROGRAM_V_KEY);
    }

    function test_UpdateProgramVKey() public {
        bytes32 newVKey = bytes32(uint256(0x5678));

        factory.updateProgramVKey(newVKey);

        assertEq(factory.currentProgramVKey(), newVKey);
        assertEq(factory.vKeyVersionCount(), 2);
        assertEq(factory.vKeyVersions(0), PROGRAM_V_KEY);
        assertEq(factory.vKeyVersions(1), newVKey);
    }

    function test_UpdateVKeyOnlyOwner() public {
        bytes32 newVKey = bytes32(uint256(0x5678));

        vm.prank(alice);
        vm.expectRevert(RegistryFactory.OnlyOwner.selector);
        factory.updateProgramVKey(newVKey);
    }

    function test_UpdateVKeyRevertZero() public {
        vm.expectRevert(RegistryFactory.ZeroVKey.selector);
        factory.updateProgramVKey(bytes32(0));
    }

    function test_UpdateVKeyRevertDuplicate() public {
        // Current VKey rejected
        vm.expectRevert(RegistryFactory.DuplicateVKey.selector);
        factory.updateProgramVKey(PROGRAM_V_KEY);
    }

    function test_UpdateVKeyRevertHistoricalDuplicate() public {
        // Update to v1
        bytes32 v1 = bytes32(uint256(0x5678));
        factory.updateProgramVKey(v1);

        // Try to re-introduce v0 (deprecated) — should fail
        vm.expectRevert(RegistryFactory.DuplicateVKey.selector);
        factory.updateProgramVKey(PROGRAM_V_KEY);
    }

    function test_NewRegistryUsesLatestVKey() public {
        // Create registry with initial VKey
        vm.prank(alice);
        address reg1 = factory.createRegistry("V1", 1, 0, 3600);

        // Update VKey
        bytes32 newVKey = bytes32(uint256(0x5678));
        factory.updateProgramVKey(newVKey);

        // Create registry with new VKey
        vm.prank(bob);
        address reg2 = factory.createRegistry("V2", 1, 0, 3600);

        // Factory-created registries don't store vkey locally (PROGRAM_V_KEY == 0).
        // They read the effective vkey from the factory at verification time.
        assertEq(IdentityRegistry(reg1).PROGRAM_V_KEY(), bytes32(0));
        assertEq(IdentityRegistry(reg2).PROGRAM_V_KEY(), bytes32(0));
        // effectiveProgramVKey() returns the factory's current vkey for both
        assertEq(IdentityRegistry(reg1).effectiveProgramVKey(), newVKey);
        assertEq(IdentityRegistry(reg2).effectiveProgramVKey(), newVKey);

        // RegistryInfo tracks version numbers
        (,,,,,,uint256 v1) = factory.registryInfo(reg1);
        (,,,,,,uint256 v2) = factory.registryInfo(reg2);
        assertEq(v1, 0);
        assertEq(v2, 1);
    }

    // ============ Fee Tests ============

    function test_FreeModeNoFeeRequired() public {
        // Default factory has no fee — should work without msg.value
        vm.prank(alice);
        address reg = factory.createRegistry("Free", 1, 0, 3600);
        assertTrue(factory.isRegistry(reg));
    }

    function test_NativeFeeCollection() public {
        address recipient = address(0xFEE);
        // Create factory with native fee
        RegistryFactory feeFactory = new RegistryFactory(
            address(mockVerifier), PROGRAM_V_KEY, address(0), 1 ether, recipient
        );

        vm.deal(alice, 10 ether);
        vm.prank(alice);
        address reg = feeFactory.createRegistry{value: 1 ether}("Paid", 1, 0, 3600);
        assertTrue(feeFactory.isRegistry(reg));
        assertEq(recipient.balance, 1 ether);
    }

    function test_NativeFeeRefundsExcess() public {
        address recipient = address(0xFEE);
        RegistryFactory feeFactory = new RegistryFactory(
            address(mockVerifier), PROGRAM_V_KEY, address(0), 1 ether, recipient
        );

        vm.deal(alice, 10 ether);
        uint256 balanceBefore = alice.balance;
        vm.prank(alice);
        feeFactory.createRegistry{value: 3 ether}("Paid", 1, 0, 3600);
        // Alice should get 2 ether refund (sent 3, fee is 1)
        assertEq(alice.balance, balanceBefore - 1 ether);
        assertEq(recipient.balance, 1 ether);
    }

    function test_NativeFeeInsufficientReverts() public {
        RegistryFactory feeFactory = new RegistryFactory(
            address(mockVerifier), PROGRAM_V_KEY, address(0), 1 ether, address(0xFEE)
        );

        vm.deal(alice, 0.5 ether);
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.InsufficientFee.selector);
        feeFactory.createRegistry{value: 0.5 ether}("Cheap", 1, 0, 3600);
    }

    function test_ERC20FeeCollection() public {
        MockTON ton = new MockTON();
        address recipient = address(0xFEE);
        uint256 fee = 10 ether;

        RegistryFactory feeFactory = new RegistryFactory(
            address(mockVerifier), PROGRAM_V_KEY, address(ton), fee, recipient
        );

        // Give alice some TON and approve
        ton.mint(alice, 100 ether);
        vm.prank(alice);
        ton.approve(address(feeFactory), fee);

        vm.prank(alice);
        address reg = feeFactory.createRegistry("TON Paid", 1, 0, 3600);
        assertTrue(feeFactory.isRegistry(reg));
        assertEq(ton.balanceOf(recipient), fee);
        assertEq(ton.balanceOf(alice), 90 ether);
    }

    function test_ERC20FeeNoApprovalReverts() public {
        MockTON ton = new MockTON();
        RegistryFactory feeFactory = new RegistryFactory(
            address(mockVerifier), PROGRAM_V_KEY, address(ton), 10 ether, address(0xFEE)
        );

        ton.mint(alice, 100 ether);
        // No approve — should revert
        vm.prank(alice);
        vm.expectRevert();
        feeFactory.createRegistry("No Approve", 1, 0, 3600);
    }

    function test_SetFeeConfig() public {
        MockTON ton = new MockTON();
        factory.setFeeConfig(address(ton), 5 ether, address(0xFEE));
        assertEq(factory.feeToken(), address(ton));
        assertEq(factory.registryCreationFee(), 5 ether);
        assertEq(factory.feeRecipient(), address(0xFEE));
    }

    function test_SetFeeConfigOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.OnlyOwner.selector);
        factory.setFeeConfig(address(0), 1 ether, address(0xFEE));
    }

    function test_SetFeeConfigZeroRecipientReverts() public {
        vm.expectRevert(RegistryFactory.ZeroFeeRecipient.selector);
        factory.setFeeConfig(address(0), 1 ether, address(0));
    }

    function test_FreeModeRejectsValue() public {
        // Free mode factory — sending ETH should revert
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.UnexpectedValue.selector);
        factory.createRegistry{value: 0.1 ether}("Free", 1, 0, 3600);
    }

    // ============ Ownership Transfer Tests ============

    function test_TransferOwnership_HappyPath() public {
        // Step 1: Owner starts transfer to alice
        factory.transferOwnership(alice);
        assertEq(factory.pendingOwner(), alice);

        // Step 2: Alice accepts ownership
        vm.prank(alice);
        factory.acceptOwnership();
        assertEq(factory.owner(), alice);
        assertEq(factory.pendingOwner(), address(0));
    }

    function test_TransferOwnership_RevertZeroAddress() public {
        vm.expectRevert(RegistryFactory.ZeroAddress.selector);
        factory.transferOwnership(address(0));
    }

    function test_TransferOwnership_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.OnlyOwner.selector);
        factory.transferOwnership(bob);
    }

    function test_AcceptOwnership_RevertNotPendingOwner() public {
        factory.transferOwnership(alice);

        // Bob (not pending owner) tries to accept
        vm.prank(bob);
        vm.expectRevert(RegistryFactory.NotPendingOwner.selector);
        factory.acceptOwnership();
    }

    function test_TransferOwnership_CanBeOverwritten() public {
        factory.transferOwnership(alice);
        assertEq(factory.pendingOwner(), alice);

        // Overwrite with a new pending owner
        factory.transferOwnership(bob);
        assertEq(factory.pendingOwner(), bob);

        // Old pending owner (alice) cannot accept anymore
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.NotPendingOwner.selector);
        factory.acceptOwnership();

        // New pending owner (bob) can accept
        vm.prank(bob);
        factory.acceptOwnership();
        assertEq(factory.owner(), bob);
    }

    function test_AcceptOwnership_RevertWhenNoPendingOwner() public {
        // No transfer initiated — pendingOwner is address(0)
        assertEq(factory.pendingOwner(), address(0));

        vm.prank(alice);
        vm.expectRevert(RegistryFactory.NotPendingOwner.selector);
        factory.acceptOwnership();
    }

    function test_ERC20ModeRejectsValue() public {
        MockTON ton = new MockTON();
        RegistryFactory feeFactory = new RegistryFactory(
            address(mockVerifier), PROGRAM_V_KEY, address(ton), 10 ether, address(0xFEE)
        );
        ton.mint(alice, 100 ether);
        vm.prank(alice);
        ton.approve(address(feeFactory), 10 ether);

        // ERC-20 mode — sending ETH alongside should revert
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(RegistryFactory.UnexpectedValue.selector);
        feeFactory.createRegistry{value: 0.1 ether}("Bad", 1, 0, 3600);
    }
}
