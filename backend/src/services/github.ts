/**
 * GitHub API client for creating PRs to zk-x509-ca-registry.
 * Uses platform-owned token from CA_REGISTRY_GITHUB_TOKEN env var.
 */

const UPSTREAM_OWNER = "tokamak-network";
const UPSTREAM_REPO = "zk-x509-ca-registry";
const API_BASE = "https://api.github.com";

export interface GitHubPrResult {
  prUrl: string;
  prNumber: number;
}

export interface CaRegistryFiles {
  chainId: string;
  registryAddress: string;
  operation: "add-ca" | "remove-ca" | "update";
  certs: Record<string, string>; // hash -> base64 DER
  serviceJson: string;
  signatureJson: string;
}

function getToken(): string {
  const token = process.env.CA_REGISTRY_GITHUB_TOKEN;
  if (!token) throw new Error("CA_REGISTRY_GITHUB_TOKEN not configured");
  return token;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function getGitHubUser(token: string): Promise<string> {
  const res = await fetch(`${API_BASE}/user`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`GitHub auth failed: ${res.status}`);
  const data = await res.json();
  return data.login;
}

async function ensureFork(token: string, user: string): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${user}/${UPSTREAM_REPO}`, {
    headers: authHeaders(token),
  });
  if (res.ok) return;

  const forkRes = await fetch(`${API_BASE}/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
  });
  if (!forkRes.ok) {
    throw new Error(`Failed to fork: ${forkRes.status} ${await forkRes.text()}`);
  }

  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** i, 5000)));
    const check = await fetch(`${API_BASE}/repos/${user}/${UPSTREAM_REPO}`, {
      headers: authHeaders(token),
    });
    if (check.ok) return;
  }
  throw new Error("Fork creation timed out");
}

async function getRef(token: string, owner: string, repo: string, ref: string): Promise<string> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/git/ref/${ref}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) throw new Error(`Failed to get ref: ${res.status}`);
  const data = await res.json();
  if (!data?.object?.sha) throw new Error("Invalid ref response: missing SHA");
  return data.object.sha;
}

async function createRef(token: string, owner: string, repo: string, branch: string, sha: string): Promise<void> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/git/refs`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }),
  });
  if (!res.ok) throw new Error(`Failed to create branch: ${res.status} ${await res.text()}`);
}

async function getFileSha(
  token: string, owner: string, repo: string, branch: string, path: string,
): Promise<string | undefined> {
  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${path}?ref=${branch}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) return undefined;
  const data = await res.json();
  return data.sha;
}

async function createOrUpdateFile(
  token: string, owner: string, repo: string, branch: string,
  path: string, contentBase64: string, message: string, sha?: string,
): Promise<void> {
  const body: Record<string, unknown> = { message, content: contentBase64, branch };
  if (sha) body.sha = sha;

  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to commit ${path}: ${res.status} ${await res.text()}`);
}

async function deleteFile(
  token: string, owner: string, repo: string, branch: string,
  path: string, message: string,
): Promise<void> {
  const sha = await getFileSha(token, owner, repo, branch, path);
  if (!sha) return;

  const res = await fetch(`${API_BASE}/repos/${owner}/${repo}/contents/${path}`, {
    method: "DELETE",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch }),
  });
  if (!res.ok) throw new Error(`Failed to delete ${path}: ${res.status} ${await res.text()}`);
}

async function createPullRequest(
  token: string, user: string, branch: string, title: string, body: string,
): Promise<GitHubPrResult> {
  const res = await fetch(`${API_BASE}/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head: `${user}:${branch}`, base: "main" }),
  });
  if (!res.ok) throw new Error(`Failed to create PR: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data?.html_url || !data?.number) throw new Error("Invalid PR response");
  return { prUrl: data.html_url, prNumber: data.number };
}

/** Fetch existing service.json content from upstream main (returns null if not found) */
async function getExistingServiceJson(
  token: string, chainId: string, registryAddress: string,
): Promise<Record<string, unknown> | null> {
  const path = `services/${chainId}/${registryAddress.toLowerCase()}/service.json`;
  const res = await fetch(`${API_BASE}/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/contents/${path}?ref=main`, {
    headers: authHeaders(token),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to check upstream service.json: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return JSON.parse(content);
}

export interface CaRegistryPrResult extends GitHubPrResult {
  isNew: boolean;
}

export async function createCaRegistryPr(
  files: CaRegistryFiles,
  buildTitle: (isNew: boolean) => string,
  buildBody: (isNew: boolean) => string,
): Promise<CaRegistryPrResult> {
  const token = getToken();
  const user = await getGitHubUser(token);

  // Check upstream and prepare fork in parallel
  const [existingService] = await Promise.all([
    getExistingServiceJson(token, files.chainId, files.registryAddress),
    ensureFork(token, user),
  ]);
  const isNew = existingService === null;

  // Preserve created_at from existing service.json on updates
  if (!isNew && existingService?.created_at) {
    const serviceObj = JSON.parse(files.serviceJson);
    serviceObj.created_at = existingService.created_at;
    files.serviceJson = JSON.stringify(serviceObj, null, 2);
  }

  const mainSha = await getRef(token, UPSTREAM_OWNER, UPSTREAM_REPO, "heads/main");

  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9-_.]/g, "-");
  const branchName = `ca-update/${sanitize(files.chainId)}/${sanitize(files.registryAddress.slice(0, 10))}/${Date.now()}`;
  await createRef(token, user, UPSTREAM_REPO, branchName, mainSha);

  const serviceDir = `services/${files.chainId}/${files.registryAddress.toLowerCase()}`;

  for (const [hash, base64Der] of Object.entries(files.certs)) {
    const certPath = `${serviceDir}/certs/${hash}.der`;
    if (files.operation === "remove-ca") {
      await deleteFile(token, user, UPSTREAM_REPO, branchName, certPath, `Remove CA cert: ${hash.slice(0, 16)}...`);
    } else {
      const certSha = await getFileSha(token, user, UPSTREAM_REPO, branchName, certPath);
      await createOrUpdateFile(token, user, UPSTREAM_REPO, branchName, certPath, base64Der, `Add CA cert: ${hash.slice(0, 16)}...`, certSha);
    }
  }

  const existingSha = await getFileSha(token, user, UPSTREAM_REPO, branchName, `${serviceDir}/service.json`);
  await createOrUpdateFile(
    token, user, UPSTREAM_REPO, branchName,
    `${serviceDir}/service.json`,
    Buffer.from(files.serviceJson).toString("base64"),
    "Update service.json with CA guide",
    existingSha,
  );

  const sigSha = await getFileSha(token, user, UPSTREAM_REPO, branchName, `${serviceDir}/signature.json`);
  await createOrUpdateFile(
    token, user, UPSTREAM_REPO, branchName,
    `${serviceDir}/signature.json`,
    Buffer.from(files.signatureJson).toString("base64"),
    "Add admin signature",
    sigSha,
  );

  const title = buildTitle(isNew);
  const body = buildBody(isNew);
  const pr = await createPullRequest(token, user, branchName, title, body);
  return { ...pr, isNew };
}
