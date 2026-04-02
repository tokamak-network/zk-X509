// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IdentityRegistry} from "../src/IdentityRegistry.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Deployment script for the IdentityRegistry contract (proxy pattern).
/// @dev Usage:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $PRIVATE_KEY
///
/// Environment variables:
///   SP1_VERIFIER_ADDRESS - Address of the deployed SP1 verifier contract
///   PROGRAM_V_KEY        - Verification key from `cargo run --bin vkey`
///   CA_ROOT_HASH         - SHA-256 hash of the trusted CA public key
contract DeployScript is Script {
    function run() external {
        // Read configuration from environment
        address SP1_VERIFIER = vm.envAddress("SP1_VERIFIER_ADDRESS");
        bytes32 PROGRAM_VKEY = vm.envBytes32("PROGRAM_V_KEY");

        console.log("SP1 Verifier:", SP1_VERIFIER);
        console.log("Program VKey:");
        console.logBytes32(PROGRAM_VKEY);

        vm.startBroadcast();

        // Deploy IdentityRegistry implementation + proxy
        uint32 maxWallets = uint32(vm.envOr("MAX_WALLETS_PER_CERT", uint256(1)));
        uint256 rawMask = vm.envOr("MIN_DISCLOSURE_MASK", uint256(0));
        require(rawMask <= 0x0F, "MIN_DISCLOSURE_MASK must be <= 0x0F");
        // casting to 'uint8' is safe because rawMask is validated <= 0x0F above
        // forge-lint: disable-next-line(unsafe-typecast)
        uint8 minDisclosureMask = uint8(rawMask);

        IdentityRegistry impl = new IdentityRegistry();
        bytes memory initData = abi.encodeCall(
            IdentityRegistry.initialize,
            (SP1_VERIFIER, PROGRAM_VKEY, maxWallets, minDisclosureMask, vm.envOr("MAX_PROOF_AGE", uint256(3600)), msg.sender, address(0))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        IdentityRegistry registry = IdentityRegistry(address(proxy));

        console.log("Max wallets per cert:", maxWallets);
        console.log("Min disclosure mask:", minDisclosureMask);
        console.log("IdentityRegistry implementation:", address(impl));
        console.log("IdentityRegistry proxy:", address(registry));

        // Set CA Merkle root (if provided)
        try vm.envBytes32("CA_MERKLE_ROOT") returns (bytes32 merkleRoot) {
            registry.updateCaMerkleRoot(merkleRoot);
            console.log("Set CA Merkle root:");
            console.logBytes32(merkleRoot);
        } catch {
            console.log("WARNING: No CA_MERKLE_ROOT provided. register() will revert until set.");
        }

        vm.stopBroadcast();
    }
}
