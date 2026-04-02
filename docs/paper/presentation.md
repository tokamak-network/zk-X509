# zk-X509: Privacy-Preserving On-Chain Identity from Legacy PKI

**Bak Yeong Ju — March 2026**

---

## 1. Problem: 블록체인 신원 인증의 딜레마

> 퍼블릭 블록체인의 투명성 ↔ 개인정보 보호 — 근본적 충돌

### 기존 접근법의 한계

| 접근법 | 문제점 |
|--------|--------|
| **중앙 KYC 인증** | 단일 장애점, 메타데이터 유출 |
| **하드웨어 의존** (zkPassport, Worldcoin) | NFC 리더기, Orb 등 전용 장비 필요 |
| **DID/VC** (Polygon ID 등) | 새 인프라 구축 필요, 3~5년 소요, 규제 불확실 |
| **SBT** | 신뢰 발급자 필요, 프라이버시 없음 |

**어떤 접근법도 검증가능성 + 프라이버시 + 탈중앙 + 접근성 + 즉시 배포를 동시에 달성하지 못함**

---

## 2. Key Insight: 기존 인프라를 브릿지하라

- 전 세계 **40억+** X.509 인증서가 이미 활성화
- 한국 NPKI만 **~2,000만** 공인인증서 사용 중
- 에스토니아 eID ~130만, 독일 eID ~4,600만
- **정부 수준 신뢰**가 이미 확립됨 (전자서명법)

> "새로 만들지 말고, 이미 있는 것을 연결하라"

---

## 3. zk-X509 Overview

### 아키텍처 (4-Layer)

```
┌─────────────────────────────────────────────┐
│          Frontend (Next.js + Wallet)         │
└──────────────────┬──────────────────────────┘
                   │ cert + password + address
┌──────────────────▼──────────────────────────┐
│        Prover Server (Rust/Axum)             │
│   NPKI 스캔 → 키 복호화 → OS 키체인 서명     │
└──────────────────┬──────────────────────────┘
                   │ 서명 + 인증서 (개인키 제외!)
┌──────────────────▼──────────────────────────┐
│          SP1 zkVM Guest (Rust/RISC-V)        │
│   인증서 체인 검증 · CRL 확인 · 소유 증명     │
└──────────────────┬──────────────────────────┘
                   │ ZK Proof + 13 Public Values
┌──────────────────▼──────────────────────────┐
│      IdentityRegistry (Solidity)             │
│   proof 검증 → nullifier 등록 → 자동 만료     │
└─────────────────────────────────────────────┘
```

### ZK Circuit이 증명하는 6가지

1. **인증서 체인 유효성** — Root CA까지 전체 서명 체인 검증
2. **시간 유효성** — 인증서 만료 여부
3. **개인키 소유 증명** — 서명 기반 (개인키는 zkVM에 들어가지 않음)
4. **폐지(CRL) 확인** — CA 서명 검증까지 zkVM 내부에서 trustless 수행
5. **지갑 바인딩** — front-running 방어 (msg.sender == registrant)
6. **Nullifier 생성** — Sybil resistance (1인 1계정)

---

## 4. 핵심 설계 결정

### 4.1 개인키 격리 (Private Key Never Enters zkVM)

```
[OS 키체인] ──서명──▶ [Prover Server] ──서명 바이트만──▶ [zkVM]
                         ↑ 개인키 즉시 삭제
```

- 개인키는 OS Secure Enclave / TPM에서만 처리
- zkVM에는 **서명 결과만** 전달 → 위탁 증명(Delegated Proving) 가능
- 다른 ZK 시스템(zk-email, Semaphore)은 개인키/비밀이 회로에 직접 입력됨

### 4.2 Delegated Proving

| 단계 | 주체 | 수행 |
|------|------|------|
| 서명 생성 | 사용자 (로컬) | OS 키체인으로 ~1초 |
| ZK 증명 | 클라우드 (비신뢰) | GPU 가속 ~1-2분 |
| 온체인 등록 | 사용자 | register() TX 제출 |

- 클라우드가 악의적이어도 개인키 없음 → 위조 불가
- CRL 강제 적용 가능 (클라우드가 최신 CRL 다운로드)

### 4.3 CA-Anonymous Verification (Merkle Tree)

- 직접 `caRootHash` 공개 → 어느 나라 CA인지 노출
- **Merkle membership proof** 사용 → "N개 CA 중 하나"만 공개
- 한국+에스토니아+독일 whitelisting 시 anonymity set: ~6,700만

### 4.4 서명 기반 Nullifier

$$\text{nullifier} = \text{SHA256}(\text{Sign}(sk, \text{domain}) \| \text{wallet\_index})$$

- 공개키 기반 nullifier의 문제: 인증서 보유자 누구나 nullifier 계산 가능 → 추적
- 서명 기반: **개인키 없이는 nullifier 예측 불가**
- `registry_address` + `chain_id` 포함 → 크로스 서비스/체인 unlinkability

### 4.5 Selective Disclosure

| Bit | Field | 예시 |
|-----|-------|------|
| 0 | Country (C) | "KR", "EE", "DE" |
| 1 | Organization (O) | "금융결제원" |
| 2 | Org Unit (OU) | "개인" |
| 3 | Common Name (CN) | (이름 — 보통 비공개) |

- 사용자가 `disclosure_mask`로 선택 → **User sovereignty**
- plaintext right-padded to bytes32로 온체인 직접 비교 가능

### 4.6 Configurable Registration Policy

| `maxWalletsPerCert` | 정책 | 사용 사례 |
|---------------------|------|-----------|
| `= 1` | 1인 1지갑 | DAO 투표, 에어드랍 |
| `= 3` | 소수 허용 | DeFi (거래/보관/콜드) |
| `= N` | 다수 허용 | DEX, 멀티 계정 |

---

## 5. On-Chain: 13 Public Values

```solidity
struct PublicValuesStruct {
    bytes32 nullifier;        // Sybil resistance
    bytes32 caMerkleRoot;     // CA 익명성 (which CA? 숨김)
    uint64  timestamp;        // 증명 생성 시각
    address registrant;       // 바인딩된 지갑 주소
    uint32  walletIndex;      // 멀티월렛 슬롯
    uint64  notAfter;         // 인증서 만료일 → 자동 만료
    uint64  chainId;          // EIP-155 크로스체인 방어
    address registryAddress;  // 크로스 DApp unlinkability
    bytes32 crlMerkleRoot;    // CRL 검증 상태
    bytes32 country;          // 선택적 공개
    bytes32 org;              // 선택적 공개
    bytes32 orgUnit;          // 선택적 공개
    bytes32 commonName;       // 선택적 공개
}
```

**자동 만료**: `verifiedUntil[address] = notAfter` → 인증서 만료 시 온체인 신원도 자동 만료

---

## 6. Security: 6가지 증명된 속성

| 속성 | 의미 | 방어 기법 |
|------|------|-----------|
| **Unforgeability** | 유효 인증서 없이 등록 불가 | EUF-CMA + ZK soundness |
| **Unlinkability** | nullifier로 인증서 추적 불가 | 서명 기반 nullifier + ZK |
| **Double-Reg Resistance** | 1인증서 = 제한된 등록 수 | 결정적 nullifier |
| **Front-Running Immunity** | mempool에서 증명 도용 불가 | registrant == msg.sender |
| **CA Anonymity** | 어느 CA인지 비공개 | Merkle membership proof |
| **Non-Transferability** | 타인 인증서 도용 불가 | 소유 증명 서명 |

적대자 모델: **Dolev-Yao** (블록체인 관찰, mempool 감시, 임의 TX 제출 가능)

---

## 7. Performance

### Off-Chain (ZK Proving)

| 구성 | SP1 Cycles |
|------|-----------|
| ECDSA P-256 (single-level) | **11.8M** |
| RSA-2048 (single-level) | **17.4M** |
| RSA-2048 + CRL 검증 | 23.2M (+33%) |
| ECDSA P-384 | 47.8M (비추천) |

> 서명 검증이 전체 비용의 **99%** 차지

### On-Chain (Gas)

| 연산 | Gas |
|------|-----|
| `register()` (Groth16) | ~300K |
| `addCA()` | ~26K |
| `isVerified()` | ~2.6K |

### End-to-End Latency

| 단계 | 시간 |
|------|------|
| NPKI 키 복호화 | < 1초 |
| SP1 prove (CPU) | ~10분 |
| SP1 prove (GPU, 예상) | ~1-2분 |
| 온체인 확인 | 1 블록 |

---

## 8. Comparison

| | zk-X509 | DID/VC | zkPassport | Worldcoin | zk-email |
|--|---------|--------|------------|-----------|----------|
| **하드웨어** | 불필요 | 불필요 | NFC 필요 | Orb 필요 | 불필요 |
| **신뢰 기반** | 정부 CA | 새 발급자 | 정부 | 재단 | 이메일 |
| **기존 인프라** | 40억+ 인증서 | 구축 필요 | 여권 | 없음 | DKIM |
| **CRL** | Trustless ZK | 발급자 의존 | N/A | N/A | N/A |
| **프라이버시** | Full ZK | 다양 | Full ZK | 부분 | Full ZK |
| **위탁 증명** | O (유일) | X | X | X | X |
| **법적 효력** | O (전자서명법) | 불확실 | O | X | X |
| **배포 기간** | 3-6개월 | 3-5년 | 수개월 | 수개월 | 수개월 |
| **Cross-DApp Unlinkability** | O | O | X | X | X |

---

## 9. Limitations & Future Work

1. **Client-Side Proving** — 브라우저 WASM 증명 (SP1 WASM 지원 대기)
2. **On-Chain CRL Oracle** — DAO 기반 탈중앙 CRL 업데이트
3. **Multi-Sig Governance** — CA 관리 Gnosis Safe + Timelock

---

## 10. Conclusion

> **"새로 만들지 말고, 이미 있는 것을 연결하라"**

- 40억+ X.509 인증서 → 즉시 블록체인 신원 인증
- 개인키는 zkVM에 **절대 진입하지 않음** (서명 기반 소유 증명)
- 6가지 보안 속성 형식 증명 (Dolev-Yao 모델)
- P-256 기준 11.8M cycles, 온체인 ~300K gas
- DID가 "새 인프라 구축"이라면, zk-X509는 **"기존 신뢰의 브릿지"**

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| ZK Prover | SP1 zkVM v6.0.1 |
| Guest | Rust → RISC-V |
| Contracts | Solidity + Foundry |
| Server | Rust + Axum |
| Frontend | Next.js + ethers.js |
| Crypto | rsa 0.9, p256/p384 0.13, x509-parser 0.16 |
