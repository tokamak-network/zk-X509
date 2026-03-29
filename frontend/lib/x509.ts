/**
 * X.509 DER parsing utilities for browser-side CA metadata extraction.
 *
 * Uses @peculiar/x509 to parse DER-encoded CA certificates and extract
 * human-readable metadata for auto-generating CA guides.
 */

import "reflect-metadata";
import * as x509 from "@peculiar/x509";
import type { CaGuide } from "./platform";

/** Extracted metadata from a CA certificate DER file. */
export interface CaMetadata {
  /** Full subject string (RFC 4514) */
  subject: string;
  /** Subject Common Name (CN) */
  subjectCn: string;
  /** Subject Organization (O) */
  subjectOrg: string;
  /** Country code (C) */
  country: string;
  /** Issuer Common Name */
  issuerCn: string;
  /** Full issuer string */
  issuer: string;
  /** Key algorithm description (e.g., "RSA-2048", "ECDSA-P256") */
  algorithm: string;
  /** Certificate expiry date (YYYY-MM-DD) */
  expires: string;
}

/**
 * Parse a DER-encoded X.509 certificate and extract metadata.
 * Returns null if parsing fails.
 */
export function parseCaDer(der: Uint8Array): CaMetadata | null {
  try {
    const buf = new ArrayBuffer(der.byteLength);
    new Uint8Array(buf).set(der);
    const cert = new x509.X509Certificate(buf);

    // Subject fields
    const subjectCn = getField(cert.subjectName, "CN");
    const subjectOrg = getField(cert.subjectName, "O");
    const country = getField(cert.subjectName, "C");

    // Issuer fields
    const issuerCn = getField(cert.issuerName, "CN");

    // Algorithm + key size
    const algorithm = detectAlgorithm(cert);

    // Expiry
    const expires = cert.notAfter.toISOString().split("T")[0];

    return {
      subject: cert.subject,
      subjectCn,
      subjectOrg,
      country,
      issuerCn,
      issuer: cert.issuer,
      algorithm,
      expires,
    };
  } catch {
    return null;
  }
}

/**
 * Auto-generate a CA guide from extracted certificate metadata.
 */
export function generateCaGuide(meta: CaMetadata): CaGuide {
  const name = meta.subjectCn || meta.subjectOrg || meta.subject;
  const parts: string[] = [];
  if (meta.algorithm) parts.push(meta.algorithm);
  parts.push("CA certificate");
  if (meta.country) parts.push(`from ${meta.country}`);
  if (meta.issuerCn && meta.issuerCn !== name) parts.push(`(issuer: ${meta.issuerCn})`);

  return {
    name,
    description: parts.join(" "),
    issue_url: "",
    instructions: "",
  };
}

// ── Helpers ──────────────────────────────────────

function getField(name: x509.Name, oid: string): string {
  try {
    const entries = name.getField(oid);
    return entries?.[0] || "";
  } catch {
    return "";
  }
}

function detectAlgorithm(cert: x509.X509Certificate): string {
  try {
    const algo = cert.publicKey.algorithm;
    const name = algo.name || "";

    if (name.includes("RSA") || name === "RSASSA-PKCS1-v1_5") {
      // Use modulusLength if available (set by @peculiar/x509)
      const modLen = (algo as RsaHashedKeyAlgorithm).modulusLength;
      if (modLen) return `RSA-${modLen}`;
      // Fallback: approximate from SPKI DER length
      const rawKey = cert.publicKey.rawData;
      if (rawKey.byteLength > 400) return "RSA-4096";
      if (rawKey.byteLength > 250) return "RSA-2048";
      return "RSA";
    }

    if (name === "ECDSA" || name.includes("EC")) {
      const namedCurve = (algo as EcKeyAlgorithm).namedCurve || "";
      if (namedCurve === "P-384") return "ECDSA-P384";
      if (namedCurve === "P-256") return "ECDSA-P256";
      return `ECDSA-${namedCurve || "unknown"}`;
    }

    return name || "Unknown";
  } catch {
    return "Unknown";
  }
}
