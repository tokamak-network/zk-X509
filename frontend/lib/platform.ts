/// Platform data client.
///
/// CA guides: read from zk-x509-ca-registry Git repository (GitHub raw).
///            Write operations require a Git PR — frontend provides links.
/// Announcements & registry metadata: still backend server (Firebase/local).

const CA_REGISTRY_BASE =
  process.env.NEXT_PUBLIC_CA_REGISTRY_URL ||
  "https://raw.githubusercontent.com/tokamak-network/zk-x509-ca-registry/main";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

// ── Types ────────────────────────────────────────

export interface ServiceJson {
  name: string;
  description: string;
  admin: string;
  website?: string;
  created_at: string;
  updated_at: string;
  cas: Record<string, CaGuide>;
}

export interface CaGuide {
  name: string;
  description?: string;
  issue_url?: string;
  instructions?: string;
}

export interface RegistryMetadata {
  description: string;
  logoUrl: string;
  category: "dao" | "defi" | "corporate" | "other";
  website: string;
  tags: string[];
  listed?: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  createdAt: string;
}

// ── Input Validation ─────────────────────────────

/** Validate chainId is numeric and address is 0x-prefixed hex. Prevents path traversal. */
function validatePathParams(chainId: string, address: string): void {
  if (!/^\d+$/.test(chainId)) throw new Error(`Invalid chainId: ${chainId}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address: ${address}`);
}

function validateAddress(address: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address: ${address}`);
}

// ── CA Registry (Git repository) ────────────────

/// Build the service.json URL for a given chain + registry address.
function serviceJsonUrl(chainId: string, registryAddr: string): string {
  validatePathParams(chainId, registryAddr);
  return `${CA_REGISTRY_BASE}/services/${chainId}/${registryAddr.toLowerCase()}/service.json`;
}

/// Fetch CA guides: backend DB first, then Git repo fallback, merged.
export async function getCaGuides(
  chainId: string,
  registryAddr: string,
): Promise<Record<string, CaGuide>> {
  const [backendGuides, gitGuides] = await Promise.all([
    (async () => {
      try {
        validateAddress(registryAddr);
        const res = await fetch(`${BACKEND_URL}/api/registries/${registryAddr.toLowerCase()}/ca-guides`);
        if (!res.ok) return {};
        return await res.json() as Record<string, CaGuide>;
      } catch { return {}; }
    })(),
    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const url = serviceJsonUrl(chainId, registryAddr);
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) return {};
        const svc = await res.json();
        return svc?.cas ?? {};
      } catch { return {}; } finally { clearTimeout(timeout); }
    })(),
  ]);
  // Git repo as base, backend DB overrides
  return { ...gitGuides, ...backendGuides };
}

/// Get the ca-registry repo URL for admins to submit PRs.
export function getCaRegistryRepoUrl(): string {
  return "https://github.com/tokamak-network/zk-x509-ca-registry/pulls";
}

// ── Registry Listing ──────────────────────────────

/// Fetch listed registry addresses from backend. Returns null if backend is unreachable.
export async function getListedRegistries(): Promise<string[] | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/registries`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Backend Server (announcements, metadata not in Git) ─────────

export async function getRegistryMetadata(address: string): Promise<RegistryMetadata | null> {
  try {
    validateAddress(address);
    const res = await fetch(`${BACKEND_URL}/api/registries/${address.toLowerCase()}`);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function updateRegistryMetadata(
  address: string,
  data: Partial<RegistryMetadata>,
): Promise<boolean> {
  try {
    validateAddress(address);
    const res = await fetch(`${BACKEND_URL}/api/registries/${address.toLowerCase()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Announcements (still backend-based) ─────────

export async function getAnnouncements(address: string): Promise<Announcement[]> {
  try {
    validateAddress(address);
    const res = await fetch(`${BACKEND_URL}/api/registries/${address.toLowerCase()}/announcements`);
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function postAnnouncement(
  address: string,
  title: string,
  body: string,
): Promise<Announcement | null> {
  try {
    validateAddress(address);
    const res = await fetch(`${BACKEND_URL}/api/registries/${address.toLowerCase()}/announcements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── CA Guides (backend-based) ─────────────────

export async function putCaGuide(
  address: string,
  caHash: string,
  guide: { name: string; description?: string; issueUrl?: string; instructions?: string },
): Promise<boolean> {
  try {
    validateAddress(address);
    const res = await fetch(
      `${BACKEND_URL}/api/registries/${address.toLowerCase()}/ca-guides/${encodeURIComponent(caHash)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(guide),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function deleteAnnouncement(address: string, id: string): Promise<boolean> {
  try {
    validateAddress(address);
    const res = await fetch(`${BACKEND_URL}/api/registries/${address.toLowerCase()}/announcements/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── CA Registry PR (server-side GitHub) ───────

export async function createCaRegistryPrViaServer(params: {
  chainId: string;
  registryAddress: string;
  adminAddress: string;
  serviceName: string;
  operation: "add-ca" | "remove-ca" | "update";
  certs: Array<{ hashHex: string; derBase64: string; guide: CaGuide }>;
  existingCas: Record<string, CaGuide>;
  signature: string;
  signatureTimestamp: number;
  signatureMessage: string;
}): Promise<{ prUrl: string; prNumber: number }> {
  const res = await fetch(`${BACKEND_URL}/api/ca-registry/pr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "PR creation failed" }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return res.json();
}
