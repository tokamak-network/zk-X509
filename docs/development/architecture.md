# zk-X509 System Architecture

## Overview

```
User (browser/CLI)          Cloud/Local Prover           Blockchain
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│ 1. Select cert   │        │ 4. Build stdin   │        │ 8. Verify proof  │
│ 2. Enter password│        │ 5. Download CRL  │        │ 9. Check chainId │
│ 3. Generate sigs │───────>│ 6. Run SP1 zkVM  │───────>│10. Check registry│
│    (ownership,   │  sigs  │ 7. Output proof  │ proof  │11. Store nullifier│
│     nullifier)   │        │    + pub values  │        │12. Set verifiedUntil│
└─────────────────┘        └─────────────────┘        └─────────────────┘
   Private key stays           Never sees key             Only sees hashes
   on user's device            Only signatures             No personal data
```

## Data Flow

### Step 1-3: User (Local)

```
Input:  signCert.der (X.509 certificate)
        signPri.key  (encrypted private key)
        password     (user's certificate password)

Process:
  1. Decrypt private key: PBES2/PBKDF2 + SEED-CBC/AES-256-CBC/ARIA-256-CBC
  2. Sign ownership challenge:
     ownership_sig = Sign(sk, H(serial ‖ addr ‖ walletIdx ‖ timestamp ‖ chainId))
  3. Sign nullifier domain:
     nullifier_sig = Sign(sk, H("zk-X509-Nullifier-v2" ‖ registryAddress ‖ chainId))
  4. Drop private key from memory

Output: ownership_sig, nullifier_sig (sent to prover)
```

### Step 4-7: Prover (zkVM)

```
Inputs to SP1 zkVM:
  cert_der, ownership_sig, nullifier_sig, cert_chain,
  timestamp, crl_der, registrant, wallet_index, max_wallets,
  disclosure_mask, ca_merkle_proof, ca_merkle_root,
  registry_address, chain_id,
  crl_merkle_root, crl_left_leaf, crl_right_leaf,
  crl_left_proof, crl_left_dirs, crl_right_proof, crl_right_dirs,
  crl_left_index, crl_right_index

Verification inside zkVM:
  Step 1: Parse X.509 certificate
  Step 2: Check temporal validity (notBefore ≤ t ≤ notAfter)
  Step 3: Verify certificate chain (RSA/ECDSA signatures)
  Step 4a: CRL DER verification (legacy, small CRLs)
  Step 4b: CRL Merkle non-inclusion proof (large-scale CRLs)
  Step 5: Verify ownership signature
  Step 6: Verify nullifier signature + compute nullifier
  Step 7: Verify CA Merkle membership
  Step 8: Commit public values
  Step 9: Selective disclosure (plaintext in bytes32)

Output (public values):
  nullifier, caMerkleRoot, timestamp, registrant, walletIndex,
  notAfter, chainId, registryAddress, crlMerkleRoot,
  country, org, orgUnit, commonName
```

### Step 8-12: Smart Contract

```solidity
function register(bytes proof, bytes publicValues) {
  // Decode public values
  // Check: registrant == msg.sender
  // Check: chainId == block.chainid
  // Check: registryAddress == address(this)
  // Check: timestamp within maxProofAge
  // Check: caMerkleRoot matches stored root
  // Check: crlMerkleRoot matches stored root (if enabled)
  // Check: notAfter >= block.timestamp (cert not expired)
  // Check: nullifier not already used
  // Verify SP1 ZK proof
  // Store: nullifierOwner[nullifier] = msg.sender
  // Store: verifiedUntil[msg.sender] = notAfter
}
```

## Key Components

### PublicValuesStruct

```
bytes32 nullifier       — H(nullifier_sig ‖ walletIndex), unique per cert+app+chain
bytes32 caMerkleRoot    — Merkle root of allowed CA set
uint64  timestamp       — Proof generation time
address registrant      — Wallet bound to proof
uint32  walletIndex     — Multi-wallet slot (0-based)
uint64  notAfter        — Certificate expiry (auto-expire on-chain)
uint64  chainId         — EIP-155 chain ID (cross-chain replay defense)
address registryAddress  — Target registry (cross-DApp unlinkability)
bytes32 crlMerkleRoot   — CRL sorted Merkle root (bytes32(0) = disabled)
bytes32 country         — UTF-8 plaintext right-padded, e.g. "KR" or bytes32(0)
bytes32 org             — UTF-8 plaintext right-padded, e.g. "yessign" or bytes32(0)
bytes32 orgUnit         — UTF-8 plaintext right-padded, e.g. "personal4IB" or bytes32(0)
bytes32 commonName      — UTF-8 plaintext right-padded, e.g. "Hong Gildong" or bytes32(0)
```

### Nullifier Design

```
Domain:  H("zk-X509-Nullifier-v2" ‖ registry_address ‖ chain_id)
Sig:     Sign(sk, domain)  — deterministic (RSA PKCS#1v1.5 / ECDSA RFC 6979)
Null:    H(sig ‖ wallet_index)

Properties:
  - Same cert + same app + same chain = same nullifier (Sybil defense)
  - Different app or chain = different nullifier (unlinkability)
  - Without private key, nullifier cannot be computed (privacy)
```

### CA Merkle Tree

```
Leaves: [H(ca_pub_1), H(ca_pub_2), ..., H(ca_pub_n)]
Hash:   Sorted pair — H(min(a,b) ‖ max(a,b))
Root:   Stored on-chain as caMerkleRoot

Proof: log(n) sibling hashes → verified inside zkVM
Effect: On-chain sees only "one of the approved CAs" — not which one
```

### CRL Sorted Merkle Tree

```
Leaves: [sentinel_min, H(serial_1), H(serial_2), ..., sentinel_max]
         Sorted in ascending order
Hash:   Position-aware — H(left ‖ right) with direction bits (NOT sorted-pair)
Root:   Stored on-chain as crlMerkleRoot

Non-inclusion proof:
  "My serial falls between two adjacent leaves"
  → left_leaf < H(my_serial) < right_leaf
  → Both leaves verified against root
  → Proves my serial is NOT in the revoked set
```

### Supported Key Formats

| Format | OID | KDF | Cipher | Status |
|--------|-----|-----|--------|:------:|
| PBES2 + AES-256-CBC | 1.2.840.113549.1.5.13 | PBKDF2-HMAC-SHA256 | AES-256-CBC | ✅ |
| PBES2 + SEED-CBC | 1.2.840.113549.1.5.13 | PBKDF2-HMAC-SHA1 | SEED-CBC | ✅ |
| Legacy NPKI | 1.2.410.200004.1.15 | PBKDF1-SHA1 | SEED-CBC | ✅ |
| PBES2 + ARIA-256-CBC | 1.2.410.200004.1.34 | PBKDF2-HMAC-SHA256 | ARIA-256-CBC | ✅ |

### Signature Algorithms

| Algorithm | Cert Verification | Ownership Signing | Status |
|-----------|:-:|:-:|:------:|
| RSA-2048 (SHA-256) | ✅ | ✅ | 11.8M–17.4M cycles |
| RSA-2048 (SHA-1) | ✅ | — | Legacy support |
| ECDSA P-256 (SHA-256) | ✅ | ✅ | 11.8M cycles |
| ECDSA P-384 (SHA-384) | ✅ | ✅ | 47.8M cycles |

## Security Model

| Property | Mechanism |
|----------|-----------|
| **Unforgeability** | SP1 ZK soundness — can't fake a proof without valid cert |
| **Unlinkability** | Signature-based nullifier — public key insufficient |
| **CA Anonymity** | Merkle tree — only root revealed, not which CA |
| **Cross-DApp Unlinkability** | Registry address in nullifier domain |
| **Cross-Chain Replay** | chain_id in ownership challenge + public values |
| **Front-running** | registrant == msg.sender binding |
| **Double Registration** | Nullifier uniqueness check |
| **Auto Expiry** | verifiedUntil = cert notAfter |
| **CRL Revocation** | Sorted Merkle Tree non-inclusion proof |
