import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Truncate a hex string (address or hash) for display. */
export function truncateHex(h: string, head = 6, tail = 4): string {
  if (!h) return "";
  const truncated = `${h.slice(0, head)}...${h.slice(-tail)}`;
  return truncated.length < h.length ? truncated : h;
}

/** Validate a hex-encoded bytes string (0x-prefixed, even length). */
export function isValidHex(v: string): boolean {
  if (!v.startsWith("0x")) return false;
  const body = v.slice(2);
  if (body.length === 0 || body.length % 2 !== 0) return false;
  return /^[0-9a-fA-F]+$/.test(body);
}

/** Known contract error names → human-readable messages. */
const ERROR_MESSAGES: Record<string, string> = {
  AlreadyRegistered: "This nullifier is already registered to another wallet.",
  UserAlreadyVerified: "This wallet is already verified.",
  RegistrantMismatch: "The proof was generated for a different wallet address.",
  ProofTooOld: "The proof timestamp is too old. Please generate a fresh proof.",
  InvalidCaMerkleRoot: "The CA Merkle root in the proof does not match the on-chain root.",
  NullifierRevoked: "This certificate nullifier has been revoked.",
  CertAlreadyExpired: "The X.509 certificate has already expired.",
  ContractPaused: "The service contract is currently paused.",
};

/** Parse a contract revert into a human-readable message. */
export function parseContractError(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  for (const [name, human] of Object.entries(ERROR_MESSAGES)) {
    if (msg.includes(name)) return human;
  }
  if (msg.includes("user rejected") || msg.includes("ACTION_REJECTED")) {
    return "Transaction was rejected by the user.";
  }
  return msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
}
