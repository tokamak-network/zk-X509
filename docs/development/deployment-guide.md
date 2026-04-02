# zk-X509 Deployment Guide

## 1. Local Development (Anvil)

### One-command setup
```bash
bash script/run-local.sh
```

This starts Anvil + deploys contracts + prints test commands.

### Manual setup
```bash
# Terminal 1: Start Anvil
anvil

# Terminal 2: Deploy
cd contracts
forge script script/DeployLocal.s.sol --tc DeployLocalScript \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Environment
| Item | Value |
|------|-------|
| Chain ID | 31337 |
| RPC | http://localhost:8545 |
| Verifier | SP1VerifierGroth16 (production) |
| CA Merkle Root | From test certs |
| Test ETH | 10,000 per account |

---

## 2. Testnet (Sepolia / Holesky)

### Prerequisites
- ETH on testnet (faucet: https://sepoliafaucet.com)
- SP1 Verifier contract address (deployed by Succinct)
- Program verification key (`vkey`)

### Step 1: Generate vkey
```bash
cargo run --release --bin vkey
# Output: Program Verification Key: 0x00abc...
```

### Step 2: Set environment
```bash
cp .env.example .env
# Edit .env:
#   RPC_URL=https://sepolia.infura.io/v3/YOUR_KEY
#   PRIVATE_KEY=0xYOUR_DEPLOYER_KEY
#   SP1_VERIFIER=0x3B6041173B80E77f038f3F2C0f9744f04837185e  # Sepolia SP1 verifier
#   PROGRAM_VKEY=0x00abc...  # from step 1
#   MAX_WALLETS_PER_CERT=1
#   CA_MERKLE_ROOT=0x...  # compute from allowed CA list
```

### Step 3: Deploy
```bash
cd contracts
source ../.env
forge script script/Deploy.s.sol --tc DeployScript \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --private-key $PRIVATE_KEY
```

### Step 4: Verify contract on Etherscan
```bash
forge verify-contract <DEPLOYED_ADDRESS> IdentityRegistry \
  --chain sepolia \
  --constructor-args $(cast abi-encode "constructor(address,bytes32,uint32)" $SP1_VERIFIER $PROGRAM_VKEY 1)
```

---

## 3. Production (Mainnet / L2)

### Pre-deployment checklist
- [ ] All tests pass (`cargo test && forge test`)
- [ ] Security audit completed
- [ ] Multi-sig wallet for owner (Gnosis Safe recommended)
- [ ] CA Merkle root computed from production CA list
- [ ] CRL Merkle root updated (if CRL oracle enabled)
- [ ] maxProofAge configured (default: 1 hour)
- [ ] maxWalletsPerCert configured (1 for DAO, N for DeFi)

### Step 1: Compute CA Merkle Root
```bash
# List of allowed CA public keys (SPKI DER)
# Example: Korean NPKI CAs
cargo run --release --bin zk-x509 -- --execute \
  --cert certs/production_ca1.der ...
# TODO: dedicated CA root computation tool
```

### Step 2: Deploy with real SP1 verifier
```bash
# Mainnet SP1 verifier: check https://docs.succinct.xyz for latest address
SP1_VERIFIER=0x...  # mainnet SP1 Groth16 verifier
PROGRAM_VKEY=0x...  # from `cargo run --bin vkey`

cd contracts
forge script script/Deploy.s.sol --tc DeployScript \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY \
  --slow  # wait for confirmations
```

### Step 3: Transfer ownership to multi-sig
```bash
cast send <REGISTRY_ADDRESS> \
  "transferOwnership(address)" <GNOSIS_SAFE_ADDRESS> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# Then accept from Gnosis Safe:
# registry.acceptOwnership()
```

### Step 4: Register Trusted CAs

CA를 on-chain에 개별 등록하면 Merkle root가 자동 계산됩니다:
```bash
# 단일 CA 등록
cast send <REGISTRY_ADDRESS> \
  "addCA(bytes32)" <CA_HASH> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY

# 복수 CA 일괄 등록
cast send <REGISTRY_ADDRESS> \
  "addCAs(bytes32[])" "[<HASH1>,<HASH2>,<HASH3>]" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

> CA 해시: `SHA-256(CA_public_key_SPKI_DER)`
>
> `updateCaMerkleRoot(bytes32)`도 사용 가능하지만, `addCA()`/`removeCA()`를 사용하면
> CA 목록이 on-chain에 저장되어 사용자가 `getCaLeaves()`로 조회할 수 있습니다.

### Step 5: Set CRL Merkle Root (optional)
```bash
cast send <REGISTRY_ADDRESS> \
  "updateCrlMerkleRoot(bytes32)" <CRL_MERKLE_ROOT> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

---

## 4. L2 Deployment (Polygon, Arbitrum, etc.)

Same process as mainnet but with L2-specific settings:

```bash
# Polygon
RPC_URL=https://polygon-rpc.com
CHAIN_ID=137

# Arbitrum
RPC_URL=https://arb1.arbitrum.io/rpc
CHAIN_ID=42161

# Proof generation must use matching chain_id:
cargo run --release --bin zk-x509 -- --prove \
  --chain-id 137 \
  --registry-address <POLYGON_REGISTRY> \
  ...
```

### L2 considerations
- **Gas**: much cheaper than L1 (~0.01x)
- **Proof age**: may need shorter maxProofAge on fast L2s
- **Chain ID**: must match between proof and contract (cross-chain replay defense)
- **SP1 verifier**: check if deployed on the target L2

---

## 5. Environment Variables

| Variable | Description | Required |
|----------|-------------|:--------:|
| `RPC_URL` | Ethereum RPC endpoint | ✅ |
| `PRIVATE_KEY` | Deployer private key | ✅ |
| `SP1_VERIFIER` | SP1 on-chain verifier address | ✅ |
| `PROGRAM_VKEY` | ZK program verification key | ✅ |
| `MAX_WALLETS_PER_CERT` | Max wallets per certificate | ✅ |
| `CA_MERKLE_ROOT` | Merkle root of allowed CAs | Deploy time |
| `CRL_MERKLE_ROOT` | CRL sorted Merkle root | Optional |
| `CHAIN_ID` | Target chain ID | Proof gen |
| `REGISTRY_ADDRESS` | IdentityRegistry address | Proof gen |

---

## 6. Release-based Deployment Workflow

When releasing a new version of the desktop app via GitHub Actions, follow this order to ensure the on-chain vkey matches the release binary.

### Why this matters

The SP1 program's ELF binary determines the vkey. The GitHub Actions macOS release runner environment may produce a different ELF than your local machine, resulting in a different vkey. If the on-chain vkey doesn't match the release binary's vkey, users will get `ProofInvalid()` errors.

### Step 1: Tag and push to trigger CI build

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `release.yml` workflow will:
1. Build the desktop app for macOS (ARM64 + x64)
2. Extract the vkey from the CI-built binary
3. Include the vkey in the GitHub Release notes

### Step 2: Deploy (or update) the on-chain contract with the CI vkey

**New deployment:**
```bash
# Copy the vkey from the GitHub Release notes
export PROGRAM_V_KEY=0x...  # from CI release

cd contracts
forge script script/Deploy.s.sol --tc DeployScript \
  --rpc-url $RPC_URL \
  --broadcast \
  --private-key $PRIVATE_KEY
```

**Existing deployment — update vkey on RegistryFactory:**
```bash
# Factory manages vkey for ALL registries (existing + new).
# A single call updates vkey globally — no per-registry updates needed.
cast send <FACTORY_ADDRESS> \
  "updateProgramVKey(bytes32)" <NEW_VKEY> \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Step 3: Users download the release

Users download the app from the GitHub Release page. The binary's vkey is guaranteed to match the on-chain vkey because both originate from the same CI build.

### Summary

```
CI Build (source of truth)
  ├─ Desktop App binary  →  GitHub Release  →  Users download
  └─ vkey extraction     →  Release notes   →  Admin deploys/updates on-chain
```

> **Rule:** Never deploy a contract vkey from a local build if the release binary comes from CI. Always use the CI-extracted vkey.

---

## 7. Post-deployment Monitoring

```bash
# Check if a user is verified
cast call <REGISTRY> "isVerified(address)(bool)" <USER_ADDRESS> --rpc-url $RPC_URL

# Check CA Merkle root
cast call <REGISTRY> "caMerkleRoot()(bytes32)" --rpc-url $RPC_URL

# Check current maxProofAge
cast call <REGISTRY> "maxProofAge()(uint256)" --rpc-url $RPC_URL

# Listen for registration events
cast logs --address <REGISTRY> "UserRegistered(address,bytes32)" --rpc-url $RPC_URL
```
