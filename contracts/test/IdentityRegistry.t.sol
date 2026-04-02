// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ISP1Verifier} from "sp1-contracts/ISP1Verifier.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Mock SP1 verifier that always passes (for unit testing).
contract MockSP1Verifier is ISP1Verifier {
    function verifyProof(bytes32, bytes calldata, bytes calldata) external pure {}
}

/// @notice Mock factory that returns a configurable vkey.
contract MockRegistryFactory {
    bytes32 public currentProgramVKey;
    constructor(bytes32 _vkey) { currentProgramVKey = _vkey; }
    function setVKey(bytes32 _vkey) external { currentProgramVKey = _vkey; }
}

contract IdentityRegistryTest is Test {
    IdentityRegistry public registry;
    MockSP1Verifier public mockVerifier;

    bytes32 constant PROGRAM_V_KEY = bytes32(uint256(0x1234));
    bytes32 constant CA_MERKLE_ROOT = bytes32(uint256(0xCAFE));
    bytes32 constant NULLIFIER = bytes32(uint256(0xDEAD));

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    // Default: expires 1 year from now
    uint64 constant DEFAULT_NOT_AFTER = uint64(365 days);

    function _pv(bytes32 nullifier, bytes32 caHash, address sender) internal view returns (bytes memory) {
        return abi.encode(nullifier, caHash, uint64(block.timestamp), sender, uint32(0),
            uint64(block.timestamp) + DEFAULT_NOT_AFTER, uint64(block.chainid), address(registry), bytes32(0),
            bytes32(0), bytes32(0), bytes32(0), bytes32(0));
    }

    function _pvIdx(bytes32 nullifier, bytes32 caHash, address sender, uint32 idx) internal view returns (bytes memory) {
        return _pvIdxFor(nullifier, caHash, sender, idx, address(registry));
    }

    function _pvIdxFor(bytes32 nullifier, bytes32 caHash, address sender, uint32 idx, address target) internal view returns (bytes memory) {
        return abi.encode(nullifier, caHash, uint64(block.timestamp), sender, idx,
            uint64(block.timestamp) + DEFAULT_NOT_AFTER, uint64(block.chainid), target, bytes32(0),
            bytes32(0), bytes32(0), bytes32(0), bytes32(0));
    }

    /// @dev Deploy an IdentityRegistry behind a minimal proxy and initialize it.
    function _deployRegistry(address verifier, bytes32 vkey, uint32 maxWallets, uint8 mask, address _owner)
        internal
        returns (IdentityRegistry)
    {
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (verifier, vkey, maxWallets, mask, 3600, _owner, address(0))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        return IdentityRegistry(address(proxy));
    }

    function setUp() public {
        mockVerifier = new MockSP1Verifier();
        registry = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 1, 0, address(this));
        registry.updateCaMerkleRoot(CA_MERKLE_ROOT);
    }

    function test_Register() public {
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        assertTrue(registry.isVerified(alice));
        assertTrue(registry.nullifierOwner(NULLIFIER) == alice);
    }

    function test_RevertRegistrantMismatch() public {
        // Proof bound to alice, but bob tries to submit it (front-running)
        bytes memory publicValues = _pv(NULLIFIER, CA_MERKLE_ROOT, alice);
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.RegistrantMismatch.selector, alice, bob)
        );
        registry.register(hex"1234", publicValues);
    }

    function test_RevertRegistrantMismatchReverse() public {
        // Proof bound to bob, but alice tries to submit it
        bytes memory publicValues = _pv(NULLIFIER, CA_MERKLE_ROOT, bob);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.RegistrantMismatch.selector, bob, alice)
        );
        registry.register(hex"1234", publicValues);
    }

    function test_RevertDoubleRegistration() public {
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));

        // Bob tries with same nullifier but his own address
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.AlreadyRegistered.selector, NULLIFIER)
        );
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, bob));
    }

    function test_RevertUserAlreadyVerified() public {
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));

        bytes32 nullifier2 = bytes32(uint256(0xBEEF));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.UserAlreadyVerified.selector, alice)
        );
        registry.register(hex"1234", _pv(nullifier2, CA_MERKLE_ROOT, alice));
    }

    function test_RevertInvalidCaMerkleRoot() public {
        bytes32 wrongRoot = bytes32(uint256(0xBAD));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.InvalidCaMerkleRoot.selector, wrongRoot, CA_MERKLE_ROOT)
        );
        registry.register(hex"1234", _pv(NULLIFIER, wrongRoot, alice));
    }

    function test_RevertProofTooOld() public {
        vm.warp(1700000000);
        uint64 oldTimestamp = uint64(block.timestamp - 2 hours);
        bytes memory publicValues = abi.encode(NULLIFIER, CA_MERKLE_ROOT, oldTimestamp, alice, uint32(0), uint64(block.timestamp) + DEFAULT_NOT_AFTER, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.ProofTooOld.selector, oldTimestamp, block.timestamp
            )
        );
        registry.register(hex"1234", publicValues);
    }

    function test_RevertProofInFuture() public {
        uint64 futureTimestamp = uint64(block.timestamp + 1 hours);
        bytes memory publicValues = abi.encode(NULLIFIER, CA_MERKLE_ROOT, futureTimestamp, alice, uint32(0), uint64(block.timestamp) + DEFAULT_NOT_AFTER, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.ProofInFuture.selector, futureTimestamp, block.timestamp
            )
        );
        registry.register(hex"1234", publicValues);
    }

    function test_UpdateCaMerkleRoot() public {
        bytes32 newRoot = bytes32(uint256(0xFACE));
        registry.updateCaMerkleRoot(newRoot);
        assertEq(registry.caMerkleRoot(), newRoot);
    }

    function test_RevertZeroMerkleRoot() public {
        vm.expectRevert(IdentityRegistry.ZeroMerkleRoot.selector);
        registry.updateCaMerkleRoot(bytes32(0));
    }

    function test_OnlyOwnerCanManageCA() public {
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.updateCaMerkleRoot(bytes32(uint256(0xFACE)));
    }

    function test_TwoStepOwnershipTransfer() public {
        registry.transferOwnership(alice);
        assertEq(registry.owner(), address(this));
        assertEq(registry.pendingOwner(), alice);

        vm.prank(bob);
        vm.expectRevert(IdentityRegistry.NotPendingOwner.selector);
        registry.acceptOwnership();

        vm.prank(alice);
        registry.acceptOwnership();
        assertEq(registry.owner(), alice);
        assertEq(registry.pendingOwner(), address(0));

        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.updateCaMerkleRoot(bytes32(uint256(0xFACE)));

        vm.prank(alice);
        registry.updateCaMerkleRoot(bytes32(uint256(0xFACE)));
    }

    function test_PauseBlocksRegistration() public {
        registry.pause();
        assertTrue(registry.paused());
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.ContractPaused.selector);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
    }

    function test_UnpauseAllowsRegistration() public {
        registry.pause();
        registry.unpause();
        assertFalse(registry.paused());
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        assertTrue(registry.isVerified(alice));
    }

    function test_OnlyOwnerCanPause() public {
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.pause();
    }

    function test_UpdateProgramVKey() public {
        bytes32 newVKey = bytes32(uint256(0xBEEF));
        registry.updateProgramVKey(newVKey);
        assertEq(registry.PROGRAM_V_KEY(), newVKey);
    }

    function test_RevertUpdateProgramVKeyZero() public {
        vm.expectRevert(IdentityRegistry.ZeroProgramVKey.selector);
        registry.updateProgramVKey(bytes32(0));
    }

    function test_RevertUpdateProgramVKeyNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.updateProgramVKey(bytes32(uint256(0xBEEF)));
    }

    function test_RevertUpdateProgramVKeyWhenFactoryMode() public {
        // Deploy with factory set (simulating factory-created registry)
        MockRegistryFactory mockFactory = new MockRegistryFactory(PROGRAM_V_KEY);
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), bytes32(0), 1, 0, 3600, address(this), address(mockFactory))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        IdentityRegistry factoryRegistry = IdentityRegistry(address(proxy));

        vm.expectRevert(IdentityRegistry.VKeyManagedByFactory.selector);
        factoryRegistry.updateProgramVKey(bytes32(uint256(0xBEEF)));
    }

    function test_RevokeIdentity() public {
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        assertTrue(registry.isVerified(alice));

        registry.revokeIdentity(NULLIFIER, keccak256("CERT_REVOKED"));
        assertFalse(registry.isVerified(alice));
        assertTrue(registry.revokedNullifiers(NULLIFIER));
    }

    function test_RevertRevokeUnregisteredNullifier() public {
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.NullifierNotRegistered.selector, NULLIFIER)
        );
        registry.revokeIdentity(NULLIFIER, keccak256("TEST"));
    }

    function test_RevokedNullifierCannotReRegister() public {
        // Register then revoke
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        registry.revokeIdentity(NULLIFIER, keccak256("CERT_REVOKED"));

        // Attempt to reRegister the revoked nullifier → should fail
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.NullifierRevoked.selector, NULLIFIER)
        );
        registry.reRegister(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, bob));
    }

    function test_RevokedNullifierCannotRegister() public {
        // Register, revoke, then try to register same nullifier again
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        registry.revokeIdentity(NULLIFIER, keccak256("CERT_REVOKED"));

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.NullifierRevoked.selector, NULLIFIER)
        );
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, bob));
    }

    function test_RevokedUserCanRegisterWithNewCert() public {
        // Alice registers with NULLIFIER, gets revoked
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        registry.revokeIdentity(NULLIFIER, keccak256("RE_ISSUE"));

        // Alice can register with a different cert (different nullifier)
        bytes32 nullifier2 = bytes32(uint256(0xBEEF));
        vm.prank(alice);
        registry.register(hex"1234", _pv(nullifier2, CA_MERKLE_ROOT, alice));
        assertTrue(registry.isVerified(alice));
    }

    // ============ reRegister tests ============

    function test_ReRegister() public {
        // Alice registers
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        assertTrue(registry.isVerified(alice));

        // Alice re-registers to bob's wallet (same cert/nullifier, new wallet)
        vm.prank(bob);
        registry.reRegister(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, bob));

        // Alice unverified, bob verified
        assertFalse(registry.isVerified(alice));
        assertTrue(registry.isVerified(bob));
        assertEq(registry.nullifierOwner(NULLIFIER), bob);
    }

    function test_RevertReRegisterUnregisteredNullifier() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.NullifierNotRegistered.selector, NULLIFIER)
        );
        registry.reRegister(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
    }

    function test_RevertReRegisterToAlreadyVerifiedWallet() public {
        // Register alice with NULLIFIER
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));

        // Register bob with different nullifier
        bytes32 nullifier2 = bytes32(uint256(0xBEEF));
        vm.prank(bob);
        registry.register(hex"1234", _pv(nullifier2, CA_MERKLE_ROOT, bob));

        // Try to re-register NULLIFIER to bob (already verified)
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.UserAlreadyVerified.selector, bob)
        );
        registry.reRegister(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, bob));
    }

    // ============ Multi-wallet tests ============

    function test_MultiWallet_TwoSlots() public {
        // Deploy a multi-wallet registry (MAX_WALLETS_PER_CERT = 3)
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 3, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Alice registers wallet index 0
        bytes32 null0 = bytes32(uint256(0xA000));
        vm.prank(alice);
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, alice, 0, address(multiReg)));
        assertTrue(multiReg.isVerified(alice));

        // Bob registers wallet index 1 (same cert, different wallet)
        bytes32 null1 = bytes32(uint256(0xA001));
        vm.prank(bob);
        multiReg.register(hex"1234", _pvIdxFor(null1, CA_MERKLE_ROOT, bob, 1, address(multiReg)));
        assertTrue(multiReg.isVerified(bob));

        // Both verified
        assertTrue(multiReg.isVerified(alice));
        assertTrue(multiReg.isVerified(bob));
    }

    function test_MultiWallet_RevertIndexOutOfRange() public {
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 2, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Index 2 is out of range for max=2 (valid: 0, 1)
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.WalletIndexOutOfRange.selector, uint32(2), uint32(2))
        );
        multiReg.register(hex"1234", _pvIdxFor(NULLIFIER, CA_MERKLE_ROOT, alice, 2, address(multiReg)));
    }

    function test_MultiWallet_SameAddressTwoSlots_Reverts() public {
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 3, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Alice registers slot 0
        bytes32 null0 = bytes32(uint256(0xB000));
        vm.prank(alice);
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, alice, 0, address(multiReg)));

        // Alice tries slot 1 with same address → UserAlreadyVerified
        bytes32 null1 = bytes32(uint256(0xB001));
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.UserAlreadyVerified.selector, alice)
        );
        multiReg.register(hex"1234", _pvIdxFor(null1, CA_MERKLE_ROOT, alice, 1, address(multiReg)));
    }

    function test_MultiWallet_SameNullifierTwice_Reverts() public {
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 3, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        bytes32 null0 = bytes32(uint256(0xC000));
        vm.prank(alice);
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, alice, 0, address(multiReg)));

        // Same nullifier again → AlreadyRegistered
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.AlreadyRegistered.selector, null0)
        );
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, bob, 0, address(multiReg)));
    }

    function test_MultiWallet_ReRegister() public {
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 3, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        bytes32 null0 = bytes32(uint256(0xD000));
        vm.prank(alice);
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, alice, 0, address(multiReg)));

        // Re-register slot 0 from alice to bob
        vm.prank(bob);
        multiReg.reRegister(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, bob, 0, address(multiReg)));
        assertFalse(multiReg.isVerified(alice));
        assertTrue(multiReg.isVerified(bob));
    }

    function test_MultiWallet_RevokeOneSlot_OtherUnaffected() public {
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 3, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        bytes32 null0 = bytes32(uint256(0xE000));
        bytes32 null1 = bytes32(uint256(0xE001));

        vm.prank(alice);
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, alice, 0, address(multiReg)));
        vm.prank(bob);
        multiReg.register(hex"1234", _pvIdxFor(null1, CA_MERKLE_ROOT, bob, 1, address(multiReg)));

        // Revoke slot 0 only
        multiReg.revokeIdentity(null0, keccak256("REVOKED"));
        assertFalse(multiReg.isVerified(alice));
        assertTrue(multiReg.isVerified(bob)); // slot 1 unaffected
        assertTrue(multiReg.revokedNullifiers(null0));
        assertFalse(multiReg.revokedNullifiers(null1));
    }

    function test_MultiWallet_BoundaryIndices() public {
        IdentityRegistry multiReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 3, 0, address(this));
        multiReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Index 0 (first)
        bytes32 null0 = bytes32(uint256(0xF000));
        vm.prank(alice);
        multiReg.register(hex"1234", _pvIdxFor(null0, CA_MERKLE_ROOT, alice, 0, address(multiReg)));
        assertTrue(multiReg.isVerified(alice));

        // Index 2 (last valid for max=3)
        bytes32 null2 = bytes32(uint256(0xF002));
        vm.prank(bob);
        multiReg.register(hex"1234", _pvIdxFor(null2, CA_MERKLE_ROOT, bob, 2, address(multiReg)));
        assertTrue(multiReg.isVerified(bob));
    }

    function test_MultiWallet_MaxZero_InitializeReverts() public {
        // maxWallets=0 should revert at initialization (fail-fast)
        // Revert happens inside ERC1967Proxy constructor delegatecall
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), PROGRAM_V_KEY, 0, 0, 3600, address(this), address(0))
        );
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.ZeroMaxWallets.selector));
        new ERC1967Proxy(address(impl), initData);
    }

    function test_Initialize_RevertVerifierNotContract() public {
        // EOA (no code) as verifier should revert
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(0xDEAD), PROGRAM_V_KEY, 1, 0, 3600, address(this), address(0))
        );
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.VerifierNotContract.selector));
        new ERC1967Proxy(address(impl), initData);
    }

    function test_Initialize_RevertZeroProgramVKey() public {
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), bytes32(0), 1, 0, 3600, address(this), address(0))
        );
        vm.expectRevert(abi.encodeWithSelector(IdentityRegistry.ZeroProgramVKey.selector));
        new ERC1967Proxy(address(impl), initData);
    }

    // ============ Certificate expiry tests ============

    function test_CertExpiry_VerifiedBeforeExpiry() public {
        vm.warp(1700000000);
        // Cert expires in 1 year
        uint64 notAfter = uint64(block.timestamp) + DEFAULT_NOT_AFTER;
        bytes memory pv = abi.encode(NULLIFIER, CA_MERKLE_ROOT, uint64(block.timestamp), alice, uint32(0), notAfter, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));

        vm.prank(alice);
        registry.register(hex"1234", pv);
        assertTrue(registry.isVerified(alice));
        assertEq(registry.verifiedUntil(alice), notAfter);
    }

    function test_CertExpiry_NotVerifiedAfterExpiry() public {
        vm.warp(1700000000);
        uint64 notAfter = uint64(block.timestamp + 1 hours);
        bytes memory pv = abi.encode(NULLIFIER, CA_MERKLE_ROOT, uint64(block.timestamp), alice, uint32(0), notAfter, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));

        vm.prank(alice);
        registry.register(hex"1234", pv);
        assertTrue(registry.isVerified(alice));

        // Fast-forward past expiry
        vm.warp(block.timestamp + 2 hours);
        assertFalse(registry.isVerified(alice));
    }

    function test_CertExpiry_CanReRegisterAfterExpiry() public {
        vm.warp(1700000000);
        uint64 notAfter = uint64(block.timestamp + 1 hours);
        bytes memory pv = abi.encode(NULLIFIER, CA_MERKLE_ROOT, uint64(block.timestamp), alice, uint32(0), notAfter, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));

        vm.prank(alice);
        registry.register(hex"1234", pv);

        // Fast-forward past expiry
        vm.warp(block.timestamp + 2 hours);
        assertFalse(registry.isVerified(alice));

        // Alice can register with a new cert (different nullifier)
        bytes32 nullifier2 = bytes32(uint256(0xFEED));
        uint64 newNotAfter = uint64(block.timestamp) + DEFAULT_NOT_AFTER;
        bytes memory pv2 = abi.encode(nullifier2, CA_MERKLE_ROOT, uint64(block.timestamp), alice, uint32(0), newNotAfter, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));

        vm.prank(alice);
        registry.register(hex"1234", pv2);
        assertTrue(registry.isVerified(alice));
    }

    function test_RevertCertAlreadyExpired() public {
        vm.warp(1700000000);
        // Certificate expired 1 hour ago
        uint64 expiredNotAfter = uint64(block.timestamp - 1 hours);
        bytes memory pv = abi.encode(NULLIFIER, CA_MERKLE_ROOT, uint64(block.timestamp), alice, uint32(0), expiredNotAfter, uint64(block.chainid), address(registry), bytes32(0), bytes32(0), bytes32(0), bytes32(0), bytes32(0));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.CertAlreadyExpired.selector, expiredNotAfter, block.timestamp)
        );
        registry.register(hex"1234", pv);
    }

    // ============ Proof age tests (set at deployment) ============

    function test_MaxProofAgeSetAtDeployment() public view {
        assertEq(registry.maxProofAge(), 3600); // 1 hour, set in _deployRegistry
    }

    function test_CustomMaxProofAge() public {
        // Deploy with 5 minutes max proof age (manually, since helper uses 3600)
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), PROGRAM_V_KEY, 1, 0, 5 minutes, address(this), address(0))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        IdentityRegistry customReg = IdentityRegistry(address(proxy));
        assertEq(customReg.maxProofAge(), 5 minutes);
    }

    function test_ShorterProofAge_RejectsOldProof() public {
        // Deploy with 5 minutes max proof age
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), PROGRAM_V_KEY, 1, 0, 5 minutes, address(this), address(0))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        IdentityRegistry shortAgeRegistry = IdentityRegistry(address(proxy));

        vm.warp(1700000000);
        // Proof generated 10 minutes ago (exceeds 5 min maxProofAge)
        uint64 oldTimestamp = uint64(block.timestamp - 10 minutes);
        bytes memory pv = abi.encode(NULLIFIER, CA_MERKLE_ROOT, oldTimestamp, alice, uint32(0),
            uint64(block.timestamp) + DEFAULT_NOT_AFTER, uint64(block.chainid), address(shortAgeRegistry), bytes32(0),
            bytes32(0), bytes32(0), bytes32(0), bytes32(0));

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.ProofTooOld.selector, oldTimestamp, block.timestamp)
        );
        shortAgeRegistry.register(hex"1234", pv);
    }

    // ============ CA List Management Tests ============

    function test_AddCA() public {
        bytes32 caHash = bytes32(uint256(0xAA));
        registry.addCA(caHash);
        assertEq(registry.getCaCount(), 1);
        assertEq(registry.caLeaves(0), caHash);
        assertTrue(registry.caMerkleRoot() != bytes32(0));
    }

    function test_AddMultipleCAs() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        bytes32 ca2 = bytes32(uint256(0xBB));
        bytes32 ca3 = bytes32(uint256(0xCC));

        registry.addCA(ca1);
        registry.addCA(ca2);
        registry.addCA(ca3);

        assertEq(registry.getCaCount(), 3);
        bytes32[] memory leaves = registry.getCaLeaves();
        assertEq(leaves.length, 3);
        assertEq(leaves[0], ca1);
        assertEq(leaves[1], ca2);
        assertEq(leaves[2], ca3);
    }

    function test_RemoveCA() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        bytes32 ca2 = bytes32(uint256(0xBB));
        bytes32 ca3 = bytes32(uint256(0xCC));

        registry.addCA(ca1);
        registry.addCA(ca2);
        registry.addCA(ca3);

        bytes32 rootBefore = registry.caMerkleRoot();

        // Remove middle element (index 1) — ca3 swaps into index 1
        registry.removeCA(1);

        assertEq(registry.getCaCount(), 2);
        assertEq(registry.caLeaves(0), ca1);
        assertEq(registry.caLeaves(1), ca3); // swapped
        assertTrue(registry.caMerkleRoot() != rootBefore);
    }

    function test_RemoveLastCA() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        registry.addCA(ca1);
        registry.removeCA(0);

        assertEq(registry.getCaCount(), 0);
        assertEq(registry.caMerkleRoot(), bytes32(0));
    }

    function test_SingleCARootIsLeafItself() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        registry.addCA(ca1);

        // Single leaf: root = leaf itself (no hashing needed, consistent with Rust merkle.rs)
        assertEq(registry.caMerkleRoot(), ca1);
    }

    function test_TwoCARootMatchesManual() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        bytes32 ca2 = bytes32(uint256(0xBB));

        registry.addCA(ca1);
        registry.addCA(ca2);

        // Two leaves: root = sha256(min(ca1,ca2) || max(ca1,ca2))
        bytes32 expectedRoot;
        if (ca1 <= ca2) {
            expectedRoot = sha256(abi.encodePacked(ca1, ca2));
        } else {
            expectedRoot = sha256(abi.encodePacked(ca2, ca1));
        }
        assertEq(registry.caMerkleRoot(), expectedRoot);
    }

    function test_RegisterWithAddedCA() public {
        // Add CA via addCA, then register with matching root
        bytes32 caHash = bytes32(uint256(0xAA));
        registry.addCA(caHash);

        bytes32 root = registry.caMerkleRoot();
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, root, alice));
        assertTrue(registry.isVerified(alice));
    }

    function test_RevertAddCAZeroHash() public {
        vm.expectRevert(IdentityRegistry.ZeroCaHash.selector);
        registry.addCA(bytes32(0));
    }

    function test_RevertAddCANotOwner() public {
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.addCA(bytes32(uint256(0xAA)));
    }

    function test_RevertRemoveCAOutOfBounds() public {
        registry.addCA(bytes32(uint256(0xAA)));
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.CaIndexOutOfBounds.selector, 5, 1)
        );
        registry.removeCA(5);
    }

    function test_RevertRemoveCANotOwner() public {
        registry.addCA(bytes32(uint256(0xAA)));
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.removeCA(0);
    }

    function test_AddCAs_Batch() public {
        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = bytes32(uint256(0xAA));
        hashes[1] = bytes32(uint256(0xBB));
        hashes[2] = bytes32(uint256(0xCC));

        registry.addCAs(hashes);

        assertEq(registry.getCaCount(), 3);
        assertEq(registry.caLeaves(0), hashes[0]);
        assertEq(registry.caLeaves(1), hashes[1]);
        assertEq(registry.caLeaves(2), hashes[2]);
        assertTrue(registry.caMerkleRoot() != bytes32(0));
    }

    function test_AddCAs_BatchRootMatchesSingleAdds() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        bytes32 ca2 = bytes32(uint256(0xBB));
        bytes32 ca3 = bytes32(uint256(0xCC));

        // Batch add
        bytes32[] memory hashes = new bytes32[](3);
        hashes[0] = ca1;
        hashes[1] = ca2;
        hashes[2] = ca3;
        registry.addCAs(hashes);
        bytes32 batchRoot = registry.caMerkleRoot();

        // Compare: deploy fresh and add one-by-one
        IdentityRegistry fresh = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 1, 0, address(this));
        fresh.addCA(ca1);
        fresh.addCA(ca2);
        fresh.addCA(ca3);

        assertEq(batchRoot, fresh.caMerkleRoot());
    }

    function test_RevertDuplicateCA() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        registry.addCA(ca1);

        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.DuplicateCaHash.selector, ca1)
        );
        registry.addCA(ca1);
    }

    function test_RevertDuplicateCAInBatch() public {
        bytes32[] memory hashes = new bytes32[](2);
        hashes[0] = bytes32(uint256(0xAA));
        hashes[1] = bytes32(uint256(0xAA)); // duplicate

        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.DuplicateCaHash.selector, hashes[1])
        );
        registry.addCAs(hashes);
    }

    function test_RemoveThenReaddCA() public {
        bytes32 ca1 = bytes32(uint256(0xAA));
        registry.addCA(ca1);
        registry.removeCA(0);

        // Should be able to re-add after removal
        registry.addCA(ca1);
        assertEq(registry.getCaCount(), 1);
        assertEq(registry.caLeaves(0), ca1);
    }

    // ============ CA Root Grace Period Tests ============

    function test_GracePeriod_OldRootAcceptedDuringGrace() public {
        bytes32 oldRoot = CA_MERKLE_ROOT;
        bytes32 newRoot = bytes32(uint256(0xBEEF));

        // Update root → oldRoot becomes previousCaMerkleRoot
        registry.updateCaMerkleRoot(newRoot);
        assertEq(registry.previousCaMerkleRoot(), oldRoot);

        // Proof with old root should still work within grace period
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, oldRoot, alice));
        assertTrue(registry.isVerified(alice));
    }

    function test_GracePeriod_OldRootRejectedAfterExpiry() public {
        bytes32 oldRoot = CA_MERKLE_ROOT;
        bytes32 newRoot = bytes32(uint256(0xBEEF));

        registry.updateCaMerkleRoot(newRoot);

        // Fast-forward past grace period (default 24h)
        vm.warp(block.timestamp + 24 hours + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.InvalidCaMerkleRoot.selector, oldRoot, newRoot)
        );
        registry.register(hex"1234", _pv(NULLIFIER, oldRoot, alice));
    }

    function test_GracePeriod_NewRootAlwaysWorks() public {
        bytes32 newRoot = bytes32(uint256(0xBEEF));
        registry.updateCaMerkleRoot(newRoot);

        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, newRoot, alice));
        assertTrue(registry.isVerified(alice));
    }

    function test_GracePeriod_AddCAPreservesPreviousRoot() public {
        bytes32 rootBefore = registry.caMerkleRoot();
        bytes32 ca1 = bytes32(uint256(0xAA));
        registry.addCA(ca1);

        assertEq(registry.previousCaMerkleRoot(), rootBefore);
        assertTrue(registry.caMerkleRoot() != rootBefore);
    }

    function test_SetCaRootGracePeriod() public {
        uint256 newPeriod = 12 hours;
        registry.setCaRootGracePeriod(newPeriod);
        assertEq(registry.caRootGracePeriod(), newPeriod);
    }

    function test_RevertSetCaRootGracePeriodOutOfRange() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.GracePeriodOutOfRange.selector,
                30 minutes, 1 hours, 7 days
            )
        );
        registry.setCaRootGracePeriod(30 minutes);

        vm.expectRevert(
            abi.encodeWithSelector(
                IdentityRegistry.GracePeriodOutOfRange.selector,
                8 days, 1 hours, 7 days
            )
        );
        registry.setCaRootGracePeriod(8 days);
    }

    function test_GracePeriod_ShortenedGracePeriodExpires() public {
        bytes32 oldRoot = CA_MERKLE_ROOT;
        bytes32 newRoot = bytes32(uint256(0xBEEF));

        // Shorten grace period to 1 hour
        registry.setCaRootGracePeriod(1 hours);
        registry.updateCaMerkleRoot(newRoot);

        // After 1h+1s, old root should be rejected
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.InvalidCaMerkleRoot.selector, oldRoot, newRoot)
        );
        registry.register(hex"1234", _pv(NULLIFIER, oldRoot, alice));
    }

    function test_RevertSetCaRootGracePeriodNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(IdentityRegistry.OnlyOwner.selector);
        registry.setCaRootGracePeriod(12 hours);
    }

    // ============ MIN_DISCLOSURE_MASK Tests ============

    function _pvWithDisclosure(
        bytes32 nullifier, bytes32 caRoot, address sender,
        bytes32 countryHash, bytes32 orgHash, bytes32 orgUnitHash, bytes32 cnHash,
        address target
    ) internal view returns (bytes memory) {
        return abi.encode(nullifier, caRoot, uint64(block.timestamp), sender, uint32(0),
            uint64(block.timestamp) + DEFAULT_NOT_AFTER, uint64(block.chainid), target, bytes32(0),
            countryHash, orgHash, orgUnitHash, cnHash);
    }

    function test_DisclosureMask_RevertWhenRequiredHashZero() public {
        // Deploy registry requiring country disclosure (bit 0 = 0x01)
        IdentityRegistry discReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 1, 0x01, address(this));
        discReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Public values with countryHash = 0 (not disclosed)
        bytes memory pv = _pvWithDisclosure(
            NULLIFIER, CA_MERKLE_ROOT, alice,
            bytes32(0), bytes32(0), bytes32(0), bytes32(0),
            address(discReg)
        );

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.InsufficientDisclosure.selector, uint8(0x00), uint8(0x01))
        );
        discReg.register(hex"1234", pv);
    }

    function test_DisclosureMask_SucceedsWhenHashProvided() public {
        // Deploy registry requiring country disclosure (bit 0 = 0x01)
        IdentityRegistry discReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 1, 0x01, address(this));
        discReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Public values with countryHash set (disclosed)
        bytes memory pv = _pvWithDisclosure(
            NULLIFIER, CA_MERKLE_ROOT, alice,
            bytes32(uint256(0x1234)), bytes32(0), bytes32(0), bytes32(0),
            address(discReg)
        );

        vm.prank(alice);
        discReg.register(hex"1234", pv);
        assertTrue(discReg.isVerified(alice));
    }

    function test_DisclosureMask_MultipleFieldsRequired() public {
        // Deploy registry requiring country + org disclosure (0x03)
        IdentityRegistry discReg = _deployRegistry(address(mockVerifier), PROGRAM_V_KEY, 1, 0x03, address(this));
        discReg.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Only country provided, org missing → should revert
        bytes memory pv = _pvWithDisclosure(
            NULLIFIER, CA_MERKLE_ROOT, alice,
            bytes32(uint256(0x1234)), bytes32(0), bytes32(0), bytes32(0),
            address(discReg)
        );

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.InsufficientDisclosure.selector, uint8(0x01), uint8(0x03))
        );
        discReg.register(hex"1234", pv);

        // Both country + org provided → should succeed
        bytes32 nullifier2 = bytes32(uint256(0xBEEF));
        bytes memory pv2 = _pvWithDisclosure(
            nullifier2, CA_MERKLE_ROOT, alice,
            bytes32(uint256(0x1234)), bytes32(uint256(0x5678)), bytes32(0), bytes32(0),
            address(discReg)
        );

        vm.prank(alice);
        discReg.register(hex"1234", pv2);
        assertTrue(discReg.isVerified(alice));
    }

    function test_DisclosureMask_ZeroMaskAcceptsAnything() public {
        // Default registry has mask=0, should accept all-zero hashes
        vm.prank(alice);
        registry.register(hex"1234", _pv(NULLIFIER, CA_MERKLE_ROOT, alice));
        assertTrue(registry.isVerified(alice));
    }

    function test_RevertInitializeInvalidDisclosureMask() public {
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), PROGRAM_V_KEY, 1, 0x10, 3600, address(this), address(0))
        );
        vm.expectRevert(
            abi.encodeWithSelector(IdentityRegistry.InvalidDisclosureMask.selector, uint8(0x10))
        );
        new ERC1967Proxy(address(impl), initData);
    }

    function test_GracePeriod_SameRootDoesNotResetGrace() public {
        bytes32 oldRoot = CA_MERKLE_ROOT;
        bytes32 newRoot = bytes32(uint256(0xBEEF));

        registry.updateCaMerkleRoot(newRoot);
        assertEq(registry.previousCaMerkleRoot(), oldRoot);
        uint256 updatedAt = registry.caMerkleRootUpdatedAt();

        // Calling with same root should be a no-op (not reset grace period)
        vm.warp(block.timestamp + 1 hours);
        registry.updateCaMerkleRoot(newRoot);
        assertEq(registry.previousCaMerkleRoot(), oldRoot); // still oldRoot
        assertEq(registry.caMerkleRootUpdatedAt(), updatedAt); // timestamp unchanged
    }

    function test_FactoryModeUsesFactoryVKey() public {
        bytes32 factoryVKey = bytes32(uint256(0xF00D));

        // Deploy mock factory with a known vkey
        MockRegistryFactory mockFactory = new MockRegistryFactory(factoryVKey);

        // Deploy registry in factory mode (using standard mock verifier)
        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (address(mockVerifier), bytes32(0), 1, 0, 3600, address(this), address(mockFactory))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        IdentityRegistry factoryRegistry = IdentityRegistry(address(proxy));
        factoryRegistry.updateCaMerkleRoot(CA_MERKLE_ROOT);

        // Expect verifyProof to be called with the factory's vkey (not a stored one)
        bytes memory publicValues = _pvIdxFor(NULLIFIER, CA_MERKLE_ROOT, alice, 0, address(factoryRegistry));
        vm.expectCall(
            address(mockVerifier),
            abi.encodeCall(ISP1Verifier.verifyProof, (factoryVKey, publicValues, hex"1234"))
        );

        // Register via factory-mode registry
        vm.prank(alice);
        factoryRegistry.register(hex"1234", publicValues);

        // effectiveProgramVKey() should return factory's vkey
        assertEq(factoryRegistry.effectiveProgramVKey(), factoryVKey);

        // PROGRAM_V_KEY should be bytes32(0) (not storing factory's vkey)
        assertEq(factoryRegistry.PROGRAM_V_KEY(), bytes32(0));

        // Update factory vkey and verify it's reflected
        bytes32 newVKey = bytes32(uint256(0xBEEF));
        mockFactory.setVKey(newVKey);
        assertEq(factoryRegistry.effectiveProgramVKey(), newVKey);
    }

    function test_StandaloneModeEffectiveProgramVKey() public {
        // In standalone mode, effectiveProgramVKey() == PROGRAM_V_KEY
        assertEq(registry.effectiveProgramVKey(), PROGRAM_V_KEY);

        // After update, effectiveProgramVKey() reflects the new value
        bytes32 newVKey = bytes32(uint256(0xBEEF));
        registry.updateProgramVKey(newVKey);
        assertEq(registry.effectiveProgramVKey(), newVKey);
    }

    function test_RevertInitializeFactoryNotContract() public {
        IdentityRegistry impl = new IdentityRegistry();
        // address(0xFACE) is an EOA, not a contract
        vm.expectRevert(IdentityRegistry.FactoryNotContract.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeCall(
                IdentityRegistry.initialize,
                (address(mockVerifier), bytes32(0), 1, 0, 3600, address(this), address(0xFACE))
            )
        );
    }
}
