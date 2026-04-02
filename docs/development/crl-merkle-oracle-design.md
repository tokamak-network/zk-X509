# CRL Merkle Oracle Design (#50)

## 1. Problem

현재 zkVM 내부에서 전체 CRL DER을 파싱하는 방식은 대규모 CRL에 비현실적:
- 테스트 CRL (453 bytes, 1건): +5.8M cycles ✅
- 실제 NPKI CRL (수십 MB, 수백만 건): 수십억 cycles ❌

사용자가 로컬에서 증명할 때 CRL을 안 넣으면 폐지된 인증서로 등록 가능.

## 2. Solution: Sparse Merkle Tree

```
CRL (50MB, 수백만 시리얼)
  ↓ off-chain 변환 (오라클)
Sparse Merkle Tree
  ↓ root만 on-chain (32 bytes)
crlMerkleRoot

사용자:
  "내 시리얼 1234는 이 트리에 없다"
  → Non-inclusion Proof 생성
  → zkVM에서 검증 (해시 수십 회 = 수만 cycles)
```

## 3. Architecture

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│  CA Server  │         │   Relayer    │         │  Contract    │
│  (공개 CRL)  │────────>│  (오라클 봇)   │────────>│ (on-chain)   │
└─────────────┘  HTTP   └──────────────┘  tx     └──────┬───────┘
                         CRL → SMT 변환            crlMerkleRoot
                         root 계산                       │
                                                         │
┌─────────────┐         ┌──────────────┐                 │
│    User     │         │    zkVM      │                 │
│  (로컬 PC)   │────────>│  (SP1 회로)   │─── proof ──────>│
└─────────────┘         └──────────────┘                 │
  cert + sig +            Non-inclusion                  │
  SMT proof               proof 검증                verify proof
```

### 역할

| 참여자 | 역할 | 신뢰 필요? |
|--------|------|-----------|
| **CA** | CRL 발행 (공개 데이터) | 기존 PKI 신뢰 |
| **Relayer** | CRL → SMT 변환, root on-chain 업데이트 | 불필요 (가짜 root → proof 실패뿐) |
| **User** | 서명 생성 + SMT proof 계산 + ZK proof 생성 | 자기 자신 |
| **Contract** | crlMerkleRoot 저장 + ZK proof 검증 | 코드 신뢰 |

## 4. Sparse Merkle Tree (SMT)

### 일반 Merkle Tree vs SMT

```
일반 Merkle Tree:
  - Membership proof: "이 값이 트리에 있다" ✅
  - Non-membership: 지원 안 함 ❌

Sparse Merkle Tree:
  - Membership proof: "이 값이 트리에 있다" ✅
  - Non-membership proof: "이 값이 트리에 없다" ✅
  - 모든 가능한 key에 대해 빈 값(empty)이 기본
```

### SMT 구조

```
Key space: 256-bit (SHA-256 해시 공간)
Key: H(serial_number)
Value: 1 (revoked) or empty (not revoked)

폐지 목록 [serial_A, serial_B, serial_C]:
  SMT[H(serial_A)] = 1
  SMT[H(serial_B)] = 1
  SMT[H(serial_C)] = 1
  SMT[다른 모든 키] = empty (기본값)
```

### Non-inclusion Proof

```
"serial_X는 폐지되지 않았다" 증명:
  1. H(serial_X) 위치의 SMT 경로를 따라감
  2. 해당 위치가 empty임을 증명 (이웃 노드 해시 제공)
  3. root까지 재계산 → on-chain root와 일치 확인

Proof 크기: ~256 해시 (SMT depth) → 실제로는 압축 가능 (~20-30 해시)
```

## 5. 구현 범위

### Phase 1: SMT 라이브러리 (script/src/smt.rs)

```rust
/// Sparse Merkle Tree for CRL revocation checking
pub struct SparseMerkleTree {
    // key: H(serial), value: revoked (true/false)
    nodes: HashMap<[u8; 32], [u8; 32]>,
    root: [u8; 32],
    depth: usize,  // 256 for SHA-256 key space
}

impl SparseMerkleTree {
    /// Build SMT from list of revoked serial numbers
    pub fn from_revoked_serials(serials: &[Vec<u8>]) -> Self;

    /// Generate non-inclusion proof for a serial number
    pub fn prove_non_inclusion(&self, serial: &[u8]) -> NonInclusionProof;

    /// Get the root hash
    pub fn root(&self) -> [u8; 32];
}

pub struct NonInclusionProof {
    pub siblings: Vec<[u8; 32]>,  // path from leaf to root
    pub key: [u8; 32],            // H(serial)
}
```

### Phase 2: CRL → SMT 변환 도구 (script/src/bin/crl-oracle.rs)

```rust
/// CLI tool: download CRL, build SMT, output root
/// Usage: cargo run --bin crl-oracle -- --crl-url <url> --output-root
fn main() {
    // 1. Download CRL from URL (or read from file)
    // 2. Parse DER, extract revoked serial numbers
    // 3. Build Sparse Merkle Tree
    // 4. Output root hash (for on-chain update)
    // 5. Save SMT to file (for user proof generation)
}
```

### Phase 3: zkVM 검증 (program/src/main.rs)

```rust
// 새 입력
let crl_non_inclusion_proof: Vec<[u8; 32]> = sp1_zkvm::io::read();
let crl_merkle_root: [u8; 32] = sp1_zkvm::io::read();

// Step 4 변경: CRL DER 파싱 대신 SMT non-inclusion 검증
let serial_hash: [u8; 32] = Sha256::digest(&user_serial).into();
let computed_root = verify_smt_non_inclusion(
    &serial_hash,
    &crl_non_inclusion_proof,
    &crl_merkle_root
);
assert!(computed_root == crl_merkle_root, "CRL non-inclusion proof invalid");
```

### Phase 4: 컨트랙트 (contracts/src/IdentityRegistry.sol)

```solidity
bytes32 public crlMerkleRoot;

function updateCrlMerkleRoot(bytes32 newRoot) external onlyOwner {
    crlMerkleRoot = newRoot;
    emit CrlMerkleRootUpdated(newRoot);
}

// _validateProof에서:
// PublicValuesStruct에 crlMerkleRoot 추가
// require(proofCrlRoot == crlMerkleRoot || crlMerkleRoot == bytes32(0))
// bytes32(0) = CRL 검증 비활성화 (선택적)
```

### Phase 5: Host scripts 연동

```
사용자 등록 흐름:
  1. Relayer가 업데이트한 SMT 파일 다운로드 (또는 API 호출)
  2. 자기 인증서의 시리얼로 non-inclusion proof 생성
  3. proof + crlMerkleRoot를 zkVM stdin에 전달
  4. ZK proof 생성
  5. 블록체인에 제출
```

## 6. 보안 분석

### Relayer가 악의적인 경우

| 공격 | 결과 | 위험 |
|------|------|------|
| 가짜 root 업로드 | 사용자 proof 실패 (root 불일치) | Liveness ❌, Safety ✅ |
| 업데이트 안 함 | 옛날 CRL로 동작 (최대 24h 지연) | CRL 갱신 주기만큼 지연 |
| 올바른 CRL에서 특정 시리얼 제거 | 폐지된 인증서 통과 | Safety ❌ → multi-sig로 방어 |

### 방어

```
- Multi-sig: 3/5 서명으로 root 업데이트 (단일 키 탈취 방어)
- 검증 가능: 누구든 CRL 다운로드 → SMT 구성 → root 비교 가능
- Optimistic Oracle: root 제출 후 challenge period (의심 시 이의 제기)
```

## 7. PublicValuesStruct 변경

```solidity
struct PublicValuesStruct {
    bytes32 nullifier;
    bytes32 caMerkleRoot;
    uint64 timestamp;
    address registrant;
    uint32 walletIndex;
    uint64 notAfter;
    uint64 chainId;
    address registryAddress;
    bytes32 crlMerkleRoot;    // 🆕 CRL SMT root (bytes32(0) = CRL 미사용)
    bytes32 country;
    bytes32 org;
    bytes32 orgUnit;
    bytes32 commonName;
}
```

## 8. 기존 CRL DER 방식과의 호환

```
crlMerkleRoot == bytes32(0): CRL 검증 비활성화 (기존 동작)
crlMerkleRoot != bytes32(0): SMT non-inclusion proof 필수
crl_der (기존): 소규모 CRL용으로 유지 가능 (하위 호환)
```

## 9. 논문 반영

Section 3에 CRL Oracle 아키텍처를 메인으로:
- "대용량 CRL은 Sparse Merkle Tree로 on-chain 압축"
- "Non-inclusion proof로 수만 cycles 내 검증"
- "Relayer는 공개 데이터 중계만 — Safety 보장"

Section 6 (Alternative Approaches):
- Option A (로컬 CRL 파싱): "소규모 CRL에만 적용 가능, 사용자 우회 가능"
- Option C (클라우드 프루버): "중앙화 이슈"
