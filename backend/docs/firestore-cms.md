# zk-X509 CMS — Firestore backend (operations runbook)

The backend's **CMS metadata** layer (registry descriptions, explorer settings,
announcements, CA guides) can run on either of two stores behind one interface
(`src/stores/RegistryStore.ts`):

| `REGISTRY_STORE` | Store | Use |
|------------------|-------|-----|
| `file` (default) | `db/registries.json` | local dev, zero setup, self-host |
| `firestore`      | Cloud Firestore `registries/{address}` | serverless production |

The REST API (`/api/registries/**`) is identical for both — the frontend is
unchanged. **Out of scope / untouched:** `ca-registry.ts` + `services/github.ts`
(GitHub PR flow), the CA registry itself (GitHub `zk-x509-ca-registry` + on-chain),
and zk-X509 core (circuits/contracts/lib).

## Local development

Default (file store, no Firebase needed):

```bash
cd backend
npm run dev          # REGISTRY_STORE defaults to "file"
```

Against the Firestore emulator:

```bash
# 1) start emulators (Firestore on :8080, Functions :5001, Hosting :5000)
firebase emulators:start

# 2) point the backend at the emulator + Firestore store
cd backend
REGISTRY_STORE=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 npm run dev

# 3) (optional) seed the emulator from the existing JSON
REGISTRY_STORE=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 npm run seed
```

The Admin SDK auto-detects `FIRESTORE_EMULATOR_HOST`, so no credentials are
needed locally.

## One-time migration (file → Firestore)

`npm run seed` reads `db/registries.json` and writes each entry to
`registries/{lowercased-address}`. It is **idempotent** (full-document
overwrite), so it can be re-run safely.

```bash
# emulator
REGISTRY_STORE=firestore FIRESTORE_EMULATOR_HOST=localhost:8080 npm run seed
# real project (Application Default Credentials)
GOOGLE_CLOUD_PROJECT=<project-id> npm run seed
```

## Prerequisites — one-time project setup (account owner)

These steps require Firebase **account/billing permissions**, so they are done
**by the account owner**, not in CI/automation:

1. **Select the Firebase project.** The committed default id is `zk-x509`
   (`.firebaserc` → `projects.default`) — this project's own dedicated backend,
   deployed to its **default hosting site** (`zk-x509.web.app`) plus Functions +
   Firestore. It previously lived in the shared `zkscatter` project (which also
   hosts the scatter-dex frontends); that deployment is kept alive for now but is
   no longer the canonical backend. To use a different project, update
   `.firebaserc` (`projects.default`) or run `firebase use <project-id>`.
   ```bash
   # Run these from the repo root (where firebase.json / .firebaserc live).
   firebase login
   # Use the project (already created):
   firebase use zk-x509
   # Or, to create a brand-new project instead — then select it so the
   # subsequent commands target it (otherwise they stay on the active project):
   firebase projects:create <project-id>
   firebase use <project-id>
   ```
2. **Enable Cloud Firestore** in **Native mode** (Firebase console → Firestore
   → Create database).
3. **Upgrade to the Blaze plan.** Blaze is required to *deploy* 2nd-gen Cloud
   Functions at all (and for their outbound calls — ethers RPC, GitHub),
   independent of usage. Within Blaze, the actual metered usage at this traffic
   is effectively ~$0 and Firestore reads/writes stay within free-tier quotas
   (see *Cost*). The Spark (free) plan only runs the **local emulator** — it
   cannot host a deployed function.
4. **Set the GitHub secret** for the CA-registry PR flow:
   ```bash
   firebase functions:secrets:set CA_REGISTRY_GITHUB_TOKEN
   ```

Everything below (config, code, migration, emulator verification) is already in
the repo; only the four account-owner steps above are external.

## Deploy (Firebase)

Hosting rewrites `/api/**` and `/health` to a single 2nd-gen HTTPS function
(`api`) that serves the whole Express app (`src/firebase.ts` → `createApp()`).

After the one-time prerequisites above (project selected, Firestore + Blaze
enabled, secret set). **Run these from the repo root** (where `firebase.json` /
`.firebaserc` live) — not from `backend/`, or `firebase deploy` fails with
"Not in a Firebase project directory":

```bash
# (first run only, if not already migrated) seed Firestore from the JSON
GOOGLE_CLOUD_PROJECT=<project-id> npm --prefix backend run seed

# deploy rules + function + hosting
firebase deploy --only firestore:rules,functions,hosting
```

The deployed function defaults to `REGISTRY_STORE=firestore` (the file store has
no durable disk on Functions). `CORS_ORIGIN` and `CA_REGISTRY_GITHUB_REPO` are
set as function env/config; `CA_REGISTRY_GITHUB_TOKEN` comes from Secret Manager
(`defineSecret`, injected into `process.env` at runtime — `ca-registry.ts` reads
it unchanged).

## Security rules

`firestore.rules`: `registries` is **read: public, write: false**. The CMS is
public content, so reads are open; the only writer is the backend via the Admin
SDK, which bypasses rules.

> ⚠️ The rule blocks tampering through the Firestore **client SDK** only. It does
> **not** authenticate the backend's own REST write endpoints
> (`PUT`/`POST`/`DELETE` on `/api/registries/**`), which remain unauthenticated
> exactly as before this migration (see the `TODO` at the top of
> `routes/registries.ts`). Adding wallet-signature auth on those endpoints is a
> separate follow-up.

## Caching

GET responses send `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
With Firebase Hosting/CDN in front of the function this collapses most repeat
reads to cache hits, cutting Firestore read ops (and cost) substantially while
keeping edits visibly fresh within ~1 minute.

## Cost

- **Blaze (pay-as-you-go) is required to deploy the backend** — 2nd-gen Cloud
  Functions and their outbound networking only run on Blaze (the Spark free
  plan is emulator-only; see Prerequisites). Enabling Blaze does not by itself
  cost anything.
- **Metered usage is effectively ~$0/month at this traffic.** The CMS is tiny
  (one small doc per registry, ~18 today) and low-traffic; the `Cache-Control`
  headers keep Firestore read ops (the main cost driver) near zero, and reads/
  writes/invocations stay within the always-free quotas. Spark's free tier is
  enough only for local emulator development, not a deployed function.
