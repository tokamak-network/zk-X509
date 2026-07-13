# zk-X509

**Privacy-preserving on-chain identity from X.509 certificates via zero-knowledge proofs.**

Users prove ownership of a valid X.509 certificate (Korean NPKI, government eID, corporate CA, etc.) without revealing personal data. The proof is verified on-chain, enabling Sybil-resistant identity for DAOs, DeFi, and compliance — with no hardware requirements and no new credential infrastructure.

📖 **Read the story:** [Stop Building New Identity Systems: Bridging 4 Billion Existing IDs to Web3](https://medium.com/@zena_tokamak/68712efaa09e) (English) · [한국어](https://medium.com/@zena_tokamak/727143a942f1)

## Key Features

- **Any X.509 CA** — Korean NPKI (yessign, KICA), Estonian eID, corporate CAs, TLS CAs
- **Zero personal data on-chain** — only nullifier, Merkle root, and hashes
- **Private key never enters zkVM** — ownership proven via signature, key stays in OS keychain
- **CA anonymity** — Merkle tree hides which CA issued the certificate
- **Cross-DApp unlinkability** — different contracts get different nullifiers
- **Cross-chain replay defense** — chain_id bound into proof
- **CRL revocation checking** — Sorted Merkle Tree non-inclusion proof
- **Selective disclosure** — reveal country, org, etc. individually with private salt
- **Automatic expiry** — on-chain identity expires when certificate does

## Quick Start

### Prerequisites

```bash
# Rust + SP1 zkVM
curl -L https://sp1.succinct.xyz | bash && sp1up

# Foundry (Forge + Anvil)
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

### Generate test certificates

```bash
cd certs && bash generate-test-certs.sh && cd ..
```

### Run tests

```bash
# Rust unit tests (51 tests)
cargo test -p zk-x509-script --lib

# Solidity tests (124 tests)
cd contracts && forge test && cd ..
```

### Local environment (Anvil + contracts + server + frontend)

```bash
bash script/run-local.sh
# → Anvil on :8545, Server on :8080, Frontend on :3000
```

### Execute mode (fast, no proof)

```bash
cargo run --release --bin zk-x509 -- --execute \
  --cert certs/signCert.der --key certs/signPri.key --ca-cert certs/ca_pub.der \
  --registrant 0x0000000000000000000000000000000000000001
```

### Generate ZK proof (~2 min)

```bash
cargo run --release --bin zk-x509 -- --prove \
  --cert certs/signCert.der --key certs/signPri.key --ca-cert certs/ca_pub.der \
  --registrant 0xYOUR_WALLET --chain-id 31337 --registry-address 0xREGISTRY
```

## Testing on Sepolia

A live deployment is available on the **Sepolia** testnet (chain ID `11155111`).
The authoritative address list is committed at
[`deployments/11155111.json`](deployments/11155111.json):

| Contract | Address |
|----------|---------|
| RegistryFactory | `0x9e937dF6ac0E85979622519068412A518fa085d9` |
| Registry (`users`, maxWallets 10) | `0x3cF6A96f1970053ffDf957074F988aD53D13ada3` |
| Registry (`relayers`, maxWallets 2) | `0x9fDE6182B1fd10F2eDfE15b704FE95787C170914` |
| SP1 Verifier (Groth16 v6.0.0) | `0x261a1619cC63273de7c64872B769305732761888` |
| Program VKey | `0x0048b091078fa9045ab90a788483ed51c0ec315eea7ca0d8fe118d1ae17b7e13` |

> **vkey must match.** A Groth16 proof verifies on-chain only if your prover's
> ELF produces the `programVKey` above. The released desktop app is built in CI
> against this exact vkey — local builds may differ. Check yours with
> `cargo run --release --bin vkey`.

### Option A — Desktop app / web frontend (recommended)

The interactive desktop app and the web frontend handle cert selection, proof
generation, and on-chain submission for you.

```bash
# Interactive desktop prover (cert from OS keychain → proof → submit)
make run
```

Point it at Sepolia in the connect step:

- **RPC URL**: any Sepolia endpoint, e.g. `https://ethereum-sepolia.publicnode.com`
- **Chain ID**: `11155111`
- **Registry address**: `0x3cF6A96f1970053ffDf957074F988aD53D13ada3` (the `users` registry)

### Run the web frontend locally (Sepolia contracts + hosted backend)

No local node, contract deploy, or backend is needed — point the frontend at the
live Sepolia contracts above and the deployed `zk-x509` backend. Create
`frontend/.env.local` (it is git-ignored, so it is not committed):

```bash
# frontend/.env.local
# any Sepolia RPC
NEXT_PUBLIC_RPC_URL="https://ethereum-sepolia.publicnode.com"
NEXT_PUBLIC_CHAIN_ID=11155111
NEXT_PUBLIC_FACTORY_ADDRESS="0x9e937dF6ac0E85979622519068412A518fa085d9"
NEXT_PUBLIC_SP1_VERIFIER_ADDRESS="0x261a1619cC63273de7c64872B769305732761888"
# users registry
NEXT_PUBLIC_REGISTRY_ADDRESS="0x3cF6A96f1970053ffDf957074F988aD53D13ada3"
# deployed backend (announcements + registry metadata)
NEXT_PUBLIC_BACKEND_URL="https://zk-x509.web.app"
# Optional — CA guides source; defaults to the public zk-x509-ca-registry repo:
# NEXT_PUBLIC_CA_REGISTRY_URL="https://raw.githubusercontent.com/tokamak-network/zk-x509-ca-registry/main"
```

Then install and run the dev server:

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000 (Next.js), talking to Sepolia + the zk-x509 backend
```

> The addresses match [`deployments/11155111.json`](deployments/11155111.json).
> To target your own deployment instead, swap in your factory/registry addresses
> and point `NEXT_PUBLIC_BACKEND_URL` at your own backend.

### Option B — CLI prover

Generate a proof bound to the Sepolia chain ID and registry. Passing `--rpc-url`
makes the prover fetch the registry's on-chain CA list (`getCaLeaves()`)
automatically, so the CA Merkle tree matches the deployed contract:

```bash
cargo run --release --bin zk-x509 -- --prove \
  --cert certs/signCert.der --key certs/signPri.key --ca-cert certs/ca_pub.der \
  --registrant 0xYOUR_WALLET \
  --chain-id 11155111 \
  --registry-address 0x3cF6A96f1970053ffDf957074F988aD53D13ada3 \
  --rpc-url https://ethereum-sepolia.publicnode.com
```

Then wrap the proof for the EVM verifier (`evm` binary) and submit with `cast`.
See the [Deployment Guide](docs/development/deployment-guide.md) and
[E2E Test Guide](docs/development/e2e-test-guide.md) for the full submit flow.

### Deploy your own Sepolia instance

To stand up a fresh deployment instead of using the shared one, follow
[Deployment Guide §2 (Testnet)](docs/development/deployment-guide.md#2-testnet-sepolia--holesky)
— it uses the same `RegistryFactory` + `BeaconProxy` flow as the live deployment.

## Project Structure

```
zk-X509/
├── program/          # SP1 zkVM guest program (Rust)
│   └── src/main.rs   # ZK circuit: cert chain, ownership, nullifier, CRL, Merkle
├── contracts/        # Solidity smart contracts
│   ├── src/IdentityRegistry.sol  # Per-service identity registry (BeaconProxy)
│   ├── src/RegistryFactory.sol   # Deploys/manages registries + global vkey
│   └── test/                     # IdentityRegistry.t.sol, RegistryFactory.t.sol
├── script/           # Host scripts (prover, server, CLI tools)
│   ├── src/bin/main.rs          # CLI prover (zk-x509)
│   ├── src/bin/server.rs        # HTTP prover server
│   ├── src/bin/prover-server.rs # Delegated-proving server
│   ├── src/bin/interactive.rs   # Interactive cert-selection CLI
│   ├── src/bin/evm.rs           # Groth16/PLONK proof generation
│   ├── src/bin/vkey.rs          # Extract program verification key from ELF
│   ├── src/ownership.rs         # Signature generation
│   ├── src/merkle.rs            # CA Merkle tree
│   ├── src/smt.rs               # CRL Sorted Merkle Tree
│   ├── src/keychain.rs          # OS keychain cert/identity access
│   ├── src/ca.rs / ca_repo.rs   # CA registry + remote CA repository
│   └── src/onchain.rs           # On-chain reads (getCaLeaves, etc.)
├── lib/              # Shared types (PublicValuesStruct)
├── frontend/         # Next.js web frontend
├── desktop/          # Tauri desktop app
├── backend/          # Firebase backend (CA registry CMS)
├── certs/            # Test certificates + generation scripts
├── deployments/      # On-chain deployment ledgers (e.g. 11155111.json = Sepolia)
├── docs/
│   ├── development/  # Architecture, testing, deployment, design docs
│   └── paper/        # Research paper + benchmark methodology
└── BENCHMARKS.md     # Performance measurements
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/development/architecture.md) | System design and data flow |
| [Testing Guide](docs/development/testing-guide.md) | Unit tests, E2E, interactive mode |
| [E2E Test Guide](docs/development/e2e-test-guide.md) | End-to-end proof + on-chain submit |
| [Deployment Guide](docs/development/deployment-guide.md) | Local, testnet, mainnet, L2 |
| [Prover-Server Guide](docs/development/prover-server-guide.md) | Delegated proving operator setup |
| [Benchmarks](BENCHMARKS.md) | Cycle counts and gas costs |
| [Paper](docs/paper/paper.md) | Research paper (IEEE Blockchain target) |

## Performance

| Configuration | SP1 Cycles | Proof Time |
|--------------|--------:|----------:|
| ECDSA P-256 (single-level) | 11.8M | ~102s CPU |
| RSA-2048 (single-level) | 17.4M | ~102s CPU |
| ECDSA P-384 (single-level) | 47.8M | — |
| RSA-2048 + CRL | 23.2M | — |

On-chain gas: ~300K (Groth16), ~77K (mock verifier)

## Security

See [SECURITY_TODO.md](SECURITY_TODO.md) for the full security tracker.

Key protections:
- **Signature-based nullifier** — private key required, public key insufficient
- **Timestamp-bound ownership** — replay window limited by maxProofAge
- **Domain separation** — contract address + chain ID in nullifier domain
- **CRL Merkle Oracle** — non-inclusion proof for revocation checking
- **Disclosure salt** — deterministic private salt prevents brute-force

## License

[MIT](LICENSE)
