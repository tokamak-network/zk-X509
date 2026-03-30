# Docker Local Setup

Docker Compose를 사용해 로컬 개발 환경을 한 번에 구축합니다.

## 사전 요구사항

- Docker Desktop (또는 Docker Engine + Compose v2)

## 빠른 시작

```bash
docker compose up --build
```

완료되면 다음 서비스에 접근할 수 있습니다:

| 서비스 | URL | 설명 |
|--------|-----|------|
| Frontend | http://localhost:3000 | Next.js 개발 서버 |
| Backend | http://localhost:4000 | Express API 서버 |
| Anvil | http://localhost:8545 | 로컬 이더리움 노드 |

## 아키텍처

```
anvil (local chain)
  ↓ healthcheck 통과
deployer (forge script)
  ↓ 컨트랙트 배포 + 주소를 /shared/addresses.json에 저장
backend (Express, 포트 4000)
  ↓
frontend (Next.js, 포트 3000)
  └── addresses.json에서 NEXT_PUBLIC_FACTORY_ADDRESS 자동 주입
```

### 서비스 기동 순서

1. **anvil** — Foundry 로컬 체인 (포트 8545), healthcheck로 준비 확인
2. **deployer** — `DeployLocal.s.sol` → 주소 파싱 → `SeedLocal.s.sol` 실행, 완료 후 종료
3. **backend** — deployer 완료 후 기동
4. **frontend** — backend 기동 후 시작, 배포된 컨트랙트 주소 자동 로드

### 배포된 컨트랙트 주소 전달

deployer가 `scripts/deploy-local.sh`에서 forge 출력을 파싱해 공유 볼륨(`deployer-output`)에 `addresses.json`을 생성합니다:

```json
{
  "factory": "0x...",
  "verifier": "0x..."
}
```

frontend는 `scripts/frontend-entrypoint.sh`에서 이 파일을 읽어 `NEXT_PUBLIC_FACTORY_ADDRESS`와 `NEXT_PUBLIC_SP1_VERIFIER_ADDRESS` 환경변수를 설정합니다.

호스트에서도 프로젝트 루트의 `.docker-addresses.json`으로 확인할 수 있습니다:

```bash
cat .docker-addresses.json
# 또는
make addresses
```

## 명령어

Makefile로 자주 쓰는 명령어를 제공합니다.

| 명령어 | 설명 |
|--------|------|
| `make up` | 빌드 + 배포 + 실행 (배포 주소 자동 출력) |
| `make down` | 중지 (체인 상태는 초기화됨 — 다음 up 시 재배포) |
| `make clean` | 중지 + 볼륨/주소 파일 삭제 (완전 초기화) |
| `make status` | 서비스 상태 확인 |
| `make logs` | 전체 로그 tail (`make logs s=frontend`로 개별 서비스) |
| `make addresses` | 배포된 컨트랙트 주소 확인 |
| `make help` | 명령어 목록 |

직접 docker compose를 사용할 수도 있습니다:

```bash
docker compose up --build       # 포그라운드 실행
docker compose up --build -d    # 백그라운드 실행
docker compose down             # 중지
docker compose down -v          # 중지 + 볼륨 삭제
docker compose logs -f frontend # 개별 로그
```

## 환경변수

### Backend
| 변수 | 기본값 | 설명 |
|------|--------|------|
| `PORT` | `4000` | 서버 포트 |
| `CORS_ORIGIN` | `http://localhost:3000` | CORS 허용 origin |
| `RPC_URL` | `http://anvil:8545` | RPC 엔드포인트 (Docker 내부 네트워크) |

### Frontend
| 변수 | 기본값 | 설명 |
|------|--------|------|
| `NEXT_PUBLIC_RPC_URL` | `http://localhost:8545` | 브라우저에서 접근하는 RPC (호스트 포트) |
| `NEXT_PUBLIC_BACKEND_URL` | `http://localhost:4000` | 백엔드 API URL |
| `NEXT_PUBLIC_CHAIN_ID` | `31337` | 체인 ID |
| `NEXT_PUBLIC_FACTORY_ADDRESS` | (자동) | RegistryFactory 주소 (deployer에서 주입) |
| `NEXT_PUBLIC_SP1_VERIFIER_ADDRESS` | (자동) | SP1 Verifier 주소 (deployer에서 주입) |

## 트러블슈팅

**deployer 실패 시**: `docker compose down -v`로 볼륨 정리 후 재시작

**포트 충돌**: 이미 8545, 3000, 4000 포트를 사용 중이면 해당 프로세스를 중지하거나 `docker-compose.yml`에서 호스트 포트를 변경

**컨트랙트 변경 후 재배포**: `docker compose down -v && docker compose up --build`
