"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  AlertTriangle,
  Wallet,
  Share2,
  ListFilter,
  Cpu,
  Settings,
  ShieldCheck,
  Search,
  Shield,
  Upload,
  FileText,
  X,
  ArrowRightLeft,
  Megaphone,
  BookOpen,
  Globe,
  Trash2,
  Plus,
  Save,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { ethers } from "ethers";
import { useWallet } from "@/lib/wallet";
import { truncateHex } from "@/lib/utils";
import {
  getRegistryMetadata,
  updateRegistryMetadata,
  getAnnouncements,
  postAnnouncement,
  deleteAnnouncement,
  getCaGuides,
  putCaGuide,
  type RegistryMetadata,
  type Announcement,
  type CaGuide,
} from "@/lib/platform";

import { parseCaDer, generateCaGuide, type CaMetadata } from "@/lib/x509";
import CaRegistrationModal from "./CaRegistrationModal";
import CopyButton from "./CopyButton";

const EMPTY_CA_GUIDE: CaGuide = { name: "", description: "", issue_url: "", instructions: "" };
const MAX_DER_SIZE = 10 * 1024; // 10KB — typical CA DER is 1-2KB

/** Block dangerous URL schemes during typing (blacklist approach).
 *  Allows partial input so users can type character-by-character. */
function sanitizeUrlInput(value: string): string | null {
  if (!value) return value;
  const lower = value.trimStart().toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    return null;
  }
  return value;
}

/** Validate a completed URL on blur/save: must be absolute http:// or https://.
 *  Returns the trimmed URL if valid, or empty string if not. */
function validateUrlOnCommit(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    const protocol = url.protocol.toLowerCase();
    if (protocol === "http:" || protocol === "https:") {
      return trimmed;
    }
    return "";
  } catch {
    return "";
  }
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TxStatus =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "confirming"; hash: string }
  | { kind: "success"; hash: string }
  | { kind: "error"; message: string };

const IDLE: TxStatus = { kind: "idle" };

type AdminTab = "status" | "management" | "security" | "service";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isZeroHash(h: string): boolean {
  return !h || h === ethers.ZeroHash;
}

const REASON_MAP: Record<string, string> = {
  "Key Compromise": ethers.id("KEY_COMPROMISE"),
  "CA Revocation": ethers.id("CA_REVOCATION"),
  "Malicious Activity": ethers.id("MALICIOUS_ACTIVITY"),
};

/** Run a write tx, handling user-rejection silently. */
async function execTx(
  setStatus: React.Dispatch<React.SetStateAction<TxStatus>>,
  fn: () => Promise<ethers.TransactionResponse>,
  refresh: () => void,
) {
  try {
    setStatus({ kind: "pending" });
    const tx = await fn();
    setStatus({ kind: "confirming", hash: tx.hash });
    await tx.wait();
    setStatus({ kind: "success", hash: tx.hash });
    refresh();
  } catch (err: unknown) {
    const e = err as { code?: string | number; message?: string };
    // user rejected in wallet — silently reset
    if (e?.code === "ACTION_REJECTED" || e?.code === 4001) {
      setStatus(IDLE);
      return;
    }
    setStatus({ kind: "error", message: e?.message ?? "Transaction failed" });
  }
}

/* ------------------------------------------------------------------ */
/*  SHA-256 helper                                                     */
/* ------------------------------------------------------------------ */

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(hash);
}

/* ------------------------------------------------------------------ */
/*  Extract SPKI (SubjectPublicKeyInfo) from X.509 DER certificate     */
/*                                                                     */
/*  The on-chain CA leaf = SHA-256(SPKI DER), NOT SHA-256(full cert).  */
/*  This must match the ZK circuit's CA membership verification.       */
/* ------------------------------------------------------------------ */

/** Read a DER tag+length and return [valueOffset, valueLength, totalLength]. */
function derReadTL(data: Uint8Array, offset: number): [number, number, number] {
  if (offset + 1 >= data.length) throw new Error("DER: unexpected end");
  let lenByte = data[offset + 1];
  let valueOffset: number;
  let valueLength: number;

  if (lenByte < 0x80) {
    // Short form
    valueOffset = offset + 2;
    valueLength = lenByte;
  } else {
    // Long form
    const numLenBytes = lenByte & 0x7f;
    if (offset + 2 + numLenBytes > data.length)
      throw new Error("DER: length bytes exceed data");
    valueOffset = offset + 2 + numLenBytes;
    valueLength = 0;
    for (let i = 0; i < numLenBytes; i++) {
      valueLength = (valueLength << 8) | data[offset + 2 + i];
    }
  }

  const totalLength = valueOffset - offset + valueLength;
  if (valueOffset + valueLength > data.length)
    throw new Error("DER: value exceeds data bounds");
  return [valueOffset, valueLength, totalLength];
}

/** Skip one DER TLV element, return offset of the next element. */
function derSkip(data: Uint8Array, offset: number): number {
  const [valueOffset, valueLength] = derReadTL(data, offset);
  return valueOffset + valueLength;
}

/**
 * Extract SubjectPublicKeyInfo (SPKI) DER from a full X.509 DER certificate.
 *
 * X.509 structure:
 *   SEQUENCE {
 *     SEQUENCE (tbsCertificate) {
 *       [0] version, serialNumber, signature, issuer, validity, subject,
 *       subjectPublicKeyInfo ← this is what we extract
 *       ...
 *     }
 *     ...
 *   }
 */
function extractSpkiDer(certDer: Uint8Array): Uint8Array {
  // Outer SEQUENCE
  let [off] = derReadTL(certDer, 0);

  // tbsCertificate SEQUENCE
  const [tbsOff] = derReadTL(certDer, off);
  let pos = tbsOff;

  // [0] version (optional, context tag 0xA0)
  if (certDer[pos] === 0xa0) {
    pos = derSkip(certDer, pos);
  }

  // serialNumber
  pos = derSkip(certDer, pos);
  // signature AlgorithmIdentifier
  pos = derSkip(certDer, pos);
  // issuer
  pos = derSkip(certDer, pos);
  // validity
  pos = derSkip(certDer, pos);
  // subject
  pos = derSkip(certDer, pos);

  // subjectPublicKeyInfo — this is what we need
  const [, , spkiTotalLen] = derReadTL(certDer, pos);
  return certDer.slice(pos, pos + spkiTotalLen);
}

/** Compute the on-chain CA leaf hash: SHA-256(SPKI DER from certificate). */
async function computeCaLeafHash(certDer: Uint8Array): Promise<Uint8Array> {
  const spki = extractSpkiDer(certDer);
  return sha256(spki);
}

/* ------------------------------------------------------------------ */
/*  Tx Status Badge                                                    */
/* ------------------------------------------------------------------ */


function TxBadge({ status }: { status: TxStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "pending")
    return (
      <span className="text-[10px] font-mono text-tertiary animate-pulse">
        Waiting for wallet...
      </span>
    );
  if (status.kind === "confirming")
    return (
      <span className="text-[10px] font-mono text-tertiary animate-pulse inline-flex items-center">
        Confirming {truncateHex(status.hash)}...
        <CopyButton text={status.hash} />
      </span>
    );
  if (status.kind === "success")
    return (
      <span className="text-[10px] font-mono text-secondary inline-flex items-center">
        Confirmed: {truncateHex(status.hash)}
        <CopyButton text={status.hash} />
      </span>
    );
  return (
    <span className="text-[10px] font-mono text-error truncate max-w-xs inline-block">
      Error: {status.message.slice(0, 120)}
    </span>
  );
}

function isBusy(s: TxStatus) {
  return s.kind === "pending" || s.kind === "confirming";
}

/* ------------------------------------------------------------------ */
/*  BentoCard                                                          */
/* ------------------------------------------------------------------ */

function BentoCard({
  title,
  value,
  color,
  mono = false,
  icon,
  children,
}: {
  title: string;
  value: string;
  color: "primary" | "secondary" | "tertiary" | "error";
  mono?: boolean;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const colorMap = {
    primary: "text-primary",
    secondary: "text-secondary",
    tertiary: "text-tertiary",
    error: "text-error",
  };

  return (
    <motion.div
      whileHover={{ y: -4 }}
      className="bg-surface p-6 rounded-3xl border border-outline-variant/10 relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 p-4 transition-transform group-hover:scale-110 duration-500">
        {icon}
      </div>
      <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest">
        {title}
      </p>
      <h3
        className={`text-2xl font-headline font-bold mt-2 ${colorMap[color]} ${mono ? "font-mono text-lg" : ""}`}
      >
        {value}
      </h3>
      {children}
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  CA File Entry type                                                 */
/* ------------------------------------------------------------------ */

interface CaFileEntry {
  name: string;
  hash: Uint8Array;
  hashHex: string;
  derBytes: Uint8Array;
  metadata: CaMetadata | null;
  guide: CaGuide;
}

/* ================================================================== */
/*  Admin Page                                                         */
/* ================================================================== */

export default function AdminContent({ serviceName }: { serviceName?: string } = {}) {
  const {
    account,
    isOwner,
    contractState,
    writeContract,
    readContract,
    registryAddr,
    chainId,
    chainName,
    refresh,
  } = useWallet();

  /* ---------- tab state ---------- */
  const [activeTab, setActiveTab] = useState<AdminTab>("status");

  /* ---------- local state ---------- */
  const [blockNumber, setBlockNumber] = useState<number | null>(null);

  // inputs
  const [crlRootInput, setCrlRootInput] = useState("");
  const [proofAgeInput, setProofAgeInput] = useState<number | null>(null);
  const [revokeNullifier, setRevokeNullifier] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const [caFiles, setCaFiles] = useState<CaFileEntry[]>([]);
  const [caFileProcessing, setCaFileProcessing] = useState(false);
  const [caFileWarning, setCaFileWarning] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const [onChainCaLeaves, setOnChainCaLeaves] = useState<string[]>([]);
  const [caListLoading, setCaListLoading] = useState(false);

  const [addCaTxMap, setAddCaTxMap] = useState<Record<string, TxStatus>>({});
  const [addAllTx, setAddAllTx] = useState<TxStatus>(IDLE);
  const [removeCaTxMap, setRemoveCaTxMap] = useState<Record<string, TxStatus>>({});
  const [removeAllTx, setRemoveAllTx] = useState<TxStatus>(IDLE);
  const [selectedCaLeaves, setSelectedCaLeaves] = useState<Set<string>>(new Set());

  // CA Registration Modal (shared for add/remove/edit)
  const [caModalOpen, setCaModalOpen] = useState(false);
  const [caModalEntry, setCaModalEntry] = useState<CaFileEntry | null>(null);
  const [caModalOp, setCaModalOp] = useState<"add-ca" | "remove-ca" | "update">("add-ca");
  const [caModalTxFn, setCaModalTxFn] = useState<(() => Promise<string | null>) | null>(null);
  const [caModalCerts, setCaModalCerts] = useState<Array<{ hashHex: string; derBase64: string; guide: CaGuide }>>([]);

  // Transfer ownership
  const [newOwnerInput, setNewOwnerInput] = useState("");
  const [transferTx, setTransferTx] = useState<TxStatus>(IDLE);

  // Service settings (platform backend)
  const [svcMetadata, setSvcMetadata] = useState<Partial<RegistryMetadata>>({
    description: "",
    category: "other",
    website: "",
  });
  const [svcMetaLoading, setSvcMetaLoading] = useState(false);
  const [svcMetaSaving, setSvcMetaSaving] = useState(false);
  const [svcMetaMsg, setSvcMetaMsg] = useState<string | null>(null);

  const [svcAnnouncements, setSvcAnnouncements] = useState<Announcement[]>([]);
  const [svcAnncLoading, setSvcAnncLoading] = useState(false);
  const [svcAnncTitle, setSvcAnncTitle] = useState("");
  const [svcAnncBody, setSvcAnncBody] = useState("");
  const [svcAnncPosting, setSvcAnncPosting] = useState(false);

  const [svcCaGuides, setSvcCaGuides] = useState<Record<string, CaGuide>>({});
  const [svcGuidesLoading, setSvcGuidesLoading] = useState(false);
  const [svcGuideEdits, setSvcGuideEdits] = useState<Record<string, CaGuide>>({});
  const [svcGuideSaving, setSvcGuideSaving] = useState<Record<string, boolean>>({});
  const [svcGuideMsg, setSvcGuideMsg] = useState<Record<string, string>>({});
  const [svcBackendDown, setSvcBackendDown] = useState(false);

  // tx statuses
  const [crlRootTx, setCrlRootTx] = useState<TxStatus>(IDLE);
  const [proofAgeTx, setProofAgeTx] = useState<TxStatus>(IDLE);
  const [revokeTx, setRevokeTx] = useState<TxStatus>(IDLE);
  const [pauseTx, setPauseTx] = useState<TxStatus>(IDLE);

  const paused = contractState?.paused ?? false;
  const disabled = !isOwner || !writeContract;

  /* ---------- sync proof age slider from contract ---------- */
  useEffect(() => {
    if (contractState && proofAgeInput === null) {
      setProofAgeInput(Number(contractState.maxProofAge));
    }
  }, [contractState, proofAgeInput]);

  /* ---------- block number polling ---------- */
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum!);
        const bn = await provider.getBlockNumber();
        if (!cancelled) setBlockNumber((prev) => (prev === bn ? prev : bn));
      } catch {
        /* ignore */
      }
    };
    poll();
    const id = setInterval(poll, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [account]);

  /* ---------- fetch on-chain CA list ---------- */
  const fetchCaLeaves = useCallback(async () => {
    if (!readContract) return;
    setCaListLoading(true);
    try {
      const leaves: string[] = await readContract.getCaLeaves();
      setOnChainCaLeaves(leaves);
    } catch {
      setOnChainCaLeaves([]);
    } finally {
      setCaListLoading(false);
      setSelectedCaLeaves(new Set());
    }
  }, [readContract]);

  useEffect(() => {
    fetchCaLeaves();
  }, [fetchCaLeaves]);

  /* ---------- search handler ---------- */
  const handleSearch = useCallback(async () => {
    if (!readContract || !searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchResult(null);
    try {
      const q = searchQuery.trim();
      if (q.length === 42 && q.startsWith("0x")) {
        // address lookup
        const [verified, until]: [boolean, bigint] = await Promise.all([
          readContract.isVerified(q),
          readContract.verifiedUntil(q),
        ]);
        const expiry =
          until > BigInt(0)
            ? new Date(Number(until) * 1000).toISOString().split("T")[0]
            : "N/A";
        setSearchResult(
          `Address ${truncateHex(q)}: verified=${verified}, expires=${expiry}`,
        );
      } else if (q.length === 66 && q.startsWith("0x")) {
        // nullifier lookup
        const [owner, revoked]: [string, boolean] = await Promise.all([
          readContract.nullifierOwner(q),
          readContract.revokedNullifiers(q),
        ]);
        const ownerStr =
          owner === ethers.ZeroAddress ? "unregistered" : truncateHex(owner);
        setSearchResult(
          `Nullifier ${truncateHex(q)}: owner=${ownerStr}, revoked=${revoked}`,
        );
      } else {
        setSearchResult(
          "Enter a 42-char address (0x...) or 66-char bytes32 hash (0x...)",
        );
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setSearchResult(
        `Query failed: ${e?.message?.slice(0, 80) ?? "unknown error"}`,
      );
    } finally {
      setSearchLoading(false);
    }
  }, [readContract, searchQuery]);

  /* ---------- CA file handlers ---------- */
  const processFiles = useCallback(async (files: FileList | File[]) => {
    setCaFileProcessing(true);
    setCaFileWarning("");
    try {
      const newEntries: CaFileEntry[] = [];
      const skipped: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.name.endsWith(".der")) continue;
        if (file.size > MAX_DER_SIZE) {
          skipped.push(`${file.name} (${(file.size / 1024).toFixed(1)}KB)`);
          continue;
        }
        const arrayBuffer = await file.arrayBuffer();
        const certDer = new Uint8Array(arrayBuffer);
        const hash = await computeCaLeafHash(certDer);
        const hashHex = ethers.hexlify(hash);
        // Parse X.509 metadata and auto-generate guide
        const metadata = parseCaDer(certDer);
        // Skip expired certificates
        if (metadata?.expires && new Date(metadata.expires) < new Date()) {
          skipped.push(`${file.name} (expired ${metadata.expires})`);
          continue;
        }
        const guide = metadata ? generateCaGuide(metadata) : EMPTY_CA_GUIDE;
        newEntries.push({ name: file.name, hash, hashHex, derBytes: certDer, metadata, guide });
      }
      if (skipped.length > 0) {
        setCaFileWarning(`Skipped ${skipped.length} file(s) exceeding ${MAX_DER_SIZE / 1024}KB: ${skipped.join(", ")}`);
      }
      setCaFiles((prev) => {
        const existing = new Set(prev.map((f) => f.hashHex));
        const deduped = newEntries.filter((e) => !existing.has(e.hashHex));
        return [...prev, ...deduped];
      });
    } finally {
      setCaFileProcessing(false);
    }
  }, []);

  const removeCaFile = useCallback((index: number) => {
    setCaFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleGuideChange = useCallback((index: number, field: keyof CaGuide, value: string) => {
    setCaFiles((prev) => {
      const updated = [...prev];
      const entry = updated[index];
      updated[index] = { ...entry, guide: { ...entry.guide, [field]: value } };
      return updated;
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  /* ---------- action handlers ---------- */

  const handleAddAllCas = () => {
    if (!writeContract || caFiles.length === 0) return;
    // Deduplicate by hash and exclude already-registered CAs
    const seen = new Set<string>(onChainCaLeaves);
    const uniqueFiles = caFiles.filter((f) => {
      if (seen.has(f.hashHex)) return false;
      seen.add(f.hashHex);
      return true;
    });
    if (uniqueFiles.length === 0) {
      setAddAllTx({ kind: "error", message: "All CAs are duplicates or already registered" });
      return;
    }
    const uniqueHashes = uniqueFiles.map((f) => f.hashHex);
    // Open modal with all CAs bundled
    setCaModalOp("add-ca");
    setCaModalTxFn(() => async () => {
      const tx = uniqueHashes.length === 1
        ? await writeContract.addCA(uniqueHashes[0])
        : await writeContract.addCAs(uniqueHashes);
      const receipt = await tx.wait();
      return receipt?.hash || tx.hash;
    });
    setCaModalCerts(uniqueFiles.map((f) => ({
      hashHex: f.hashHex,
      derBase64: btoa(Array.from(f.derBytes, (b) => String.fromCharCode(b)).join("")),
      guide: f.guide,
    })));
    setCaModalEntry(null);
    setCaModalOpen(true);
  };

  const handleAddCa = (entry: CaFileEntry) => {
    if (!writeContract) return;

    setCaModalEntry(entry);
    setCaModalOpen(true);
  };

  const handleRemoveCa = (index: number, leafHash: string) => {
    if (!writeContract) return;

    {
      setCaModalOp("remove-ca");
      setCaModalTxFn(() => async () => {
        const tx = await writeContract.removeCA(index);
        const receipt = await tx.wait();
        return receipt?.hash || tx.hash;
      });
      setCaModalCerts([{ hashHex: leafHash, derBase64: "", guide: svcCaGuides[leafHash] || EMPTY_CA_GUIDE }]);
      setCaModalEntry(null);
      setCaModalOpen(true);
    }
  };

  const handleRemoveSelected = () => {
    if (!writeContract || selectedCaLeaves.size === 0) return;
    // Indices sorted descending (required by removeCAs for swap-and-pop safety)
    const indices = onChainCaLeaves
      .map((leaf, idx) => ({ leaf, idx }))
      .filter(({ leaf }) => selectedCaLeaves.has(leaf))
      .map(({ idx }) => idx)
      .sort((a, b) => b - a);

    execTx(
      setRemoveAllTx,
      () => indices.length === 1
        ? writeContract.removeCA(indices[0])
        : writeContract.removeCAs(indices),
      () => {
        setSelectedCaLeaves(new Set());
        setRemoveCaTxMap({});
        refresh();
        fetchCaLeaves();
      },
    );
  };

  const toggleCaSelect = (leaf: string) => {
    setSelectedCaLeaves((prev) => {
      const next = new Set(prev);
      if (next.has(leaf)) next.delete(leaf); else next.add(leaf);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedCaLeaves.size === onChainCaLeaves.length) {
      setSelectedCaLeaves(new Set());
    } else {
      setSelectedCaLeaves(new Set(onChainCaLeaves));
    }
  };

  const handleUpdateCrlRoot = () => {
    if (!writeContract || !crlRootInput) return;
    execTx(
      setCrlRootTx,
      () => writeContract.updateCrlMerkleRoot(crlRootInput),
      refresh,
    );
  };

  const handleSetProofAge = () => {
    if (!writeContract || proofAgeInput === null) return;
    execTx(
      setProofAgeTx,
      () => writeContract.setMaxProofAge(proofAgeInput),
      refresh,
    );
  };

  const handleRevoke = () => {
    if (!writeContract || !revokeNullifier || !revokeReason) return;
    const reasonHash = REASON_MAP[revokeReason] ?? ethers.id(revokeReason);
    execTx(
      setRevokeTx,
      () => writeContract.revokeIdentity(revokeNullifier, reasonHash),
      refresh,
    );
  };

  const handlePauseToggle = () => {
    if (!writeContract) return;
    execTx(
      setPauseTx,
      () => (paused ? writeContract.unpause() : writeContract.pause()),
      refresh,
    );
  };

  const handleTransferOwnership = () => {
    if (!writeContract || !newOwnerInput) return;
    execTx(
      setTransferTx,
      () => writeContract.transferOwnership(newOwnerInput),
      refresh,
    );
  };

  /* ---------- load service settings when tab is active ---------- */
  useEffect(() => {
    if (activeTab !== "service" || !registryAddr) return;
    let cancelled = false;

    const load = async () => {
      setSvcMetaLoading(true);
      setSvcAnncLoading(true);
      setSvcGuidesLoading(true);

      try {
        const [meta, anncs, guides] = await Promise.all([
          getRegistryMetadata(registryAddr),
          getAnnouncements(registryAddr),
          getCaGuides(chainId || "31337", registryAddr),
        ]);
        if (cancelled) return;
        setSvcBackendDown(false);
        if (meta) {
          setSvcMetadata({
            description: meta.description || "",
            category: meta.category || "other",
            website: meta.website || "",
            listed: meta.listed !== false,
          });
        }
        setSvcAnnouncements(anncs);
        setSvcCaGuides(guides);

        // Initialize guide edits for all on-chain CAs
        const edits: Record<string, CaGuide> = {};
        for (const leaf of onChainCaLeaves) {
          edits[leaf] = guides[leaf] || EMPTY_CA_GUIDE;
        }
        setSvcGuideEdits(edits);
      } catch {
        if (!cancelled) setSvcBackendDown(true);
      } finally {
        if (!cancelled) {
          setSvcMetaLoading(false);
          setSvcAnncLoading(false);
          setSvcGuidesLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [activeTab, registryAddr, chainId, onChainCaLeaves]);

  /* ---------- service settings handlers ---------- */
  const handleSaveMetadata = async () => {
    if (!registryAddr) return;
    setSvcMetaSaving(true);
    setSvcMetaMsg(null);
    const ok = await updateRegistryMetadata(registryAddr, svcMetadata);
    setSvcMetaSaving(false);
    setSvcMetaMsg(ok ? "Metadata saved" : "Failed to save. Backend unavailable?");
  };

  const handlePostAnnouncement = async () => {
    if (!registryAddr || !svcAnncTitle.trim() || !svcAnncBody.trim()) return;
    setSvcAnncPosting(true);
    const result = await postAnnouncement(registryAddr, svcAnncTitle.trim(), svcAnncBody.trim());
    if (result) {
      setSvcAnnouncements((prev) => [result, ...prev]);
      setSvcAnncTitle("");
      setSvcAnncBody("");
    }
    setSvcAnncPosting(false);
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!registryAddr) return;
    const ok = await deleteAnnouncement(registryAddr, id);
    if (ok) {
      setSvcAnnouncements((prev) => prev.filter((a) => a.id !== id));
    }
  };

  const handleSaveCaGuide = async (caHash: string) => {
    if (!registryAddr) return;
    const guide = svcGuideEdits[caHash] || EMPTY_CA_GUIDE;
    setSvcGuideSaving((prev) => ({ ...prev, [caHash]: true }));
    setSvcGuideMsg((prev) => ({ ...prev, [caHash]: "" }));
    const ok = await putCaGuide(registryAddr, caHash, guide);
    setSvcGuideSaving((prev) => ({ ...prev, [caHash]: false }));
    setSvcGuideMsg((prev) => ({ ...prev, [caHash]: ok ? "Saved" : "Failed" }));
    if (ok) {
      setSvcCaGuides((prev) => ({ ...prev, [caHash]: guide }));
    }
  };

  const updateGuideField = (caHash: string, field: keyof CaGuide, value: string) => {
    setSvcGuideEdits((prev) => ({
      ...prev,
      [caHash]: { ...(prev[caHash] || EMPTY_CA_GUIDE), [field]: value },
    }));
  };

  /* ---------------------------------------------------------------- */
  /*  Not connected                                                    */
  /* ---------------------------------------------------------------- */
  if (!account) {
    return (
      <main className="max-w-6xl mx-auto pt-4 px-8 pb-12 flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-12 text-center max-w-md"
        >
          <Shield className="w-12 h-12 text-on-surface-variant mx-auto mb-4" />
          <h2 className="text-2xl font-headline font-bold text-on-surface mb-2">
            Admin Console
          </h2>
          <p className="text-on-surface-variant">
            Connect wallet to access admin console
          </p>
        </motion.div>
      </main>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Derived display values                                           */
  /* ---------------------------------------------------------------- */
  const statusLabel = paused ? "PAUSED" : "ACTIVE";
  const statusColor: "error" | "secondary" = paused ? "error" : "secondary";

  const caRoot = contractState?.caMerkleRoot ?? "";
  const crlRoot = contractState?.crlMerkleRoot ?? "";
  const crlDisplay = isZeroHash(crlRoot) ? "Disabled" : truncateHex(crlRoot);

  const maxProofAge = contractState ? Number(contractState.maxProofAge) : 0;
  const maxWallets = contractState?.MAX_WALLETS_PER_CERT ?? 0;

  const blockDisplay = blockNumber
    ? `BLOCK #${blockNumber.toLocaleString()}`
    : "SYNCING...";

  /* ---------------------------------------------------------------- */
  /*  Tab definitions                                                  */
  /* ---------------------------------------------------------------- */
  const tabs: { key: AdminTab; label: string }[] = [
    { key: "status", label: "Status" },
    { key: "management", label: "Management" },
    { key: "security", label: "Security" },
    { key: "service", label: "Service Settings" },
  ];

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */
  return (
    <>
    <main className="max-w-6xl mx-auto pt-4 px-8 min-h-screen">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Alert Section — non-owner */}
        {!isOwner && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-4 p-4 rounded-xl border border-error/20 bg-error/5 backdrop-blur-sm"
          >
            <AlertTriangle className="text-error w-5 h-5" />
            <div className="flex-1">
              <p className="text-sm font-headline font-bold text-error">
                READ-ONLY ACCESS RESTRICTED
              </p>
              <p className="text-xs text-on-surface-variant">
                Your connected wallet ({truncateHex(account)}) is not the
                protocol owner. Transaction signing is disabled.
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-1 rounded bg-error/20 text-error font-bold border border-error/30">
              AUDIT_MODE
            </span>
          </motion.div>
        )}

        {/* Header Section */}
        <div className="flex justify-between items-end">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-4xl font-headline font-bold tracking-tight text-primary">
                Admin Console
              </h1>
              <p className="text-on-surface-variant mt-2 max-w-lg">
                Cryptographic root management and protocol safety parameters for
                the ZK-X509 network.
              </p>
            </div>
            {isOwner && (
              <span className="px-3 py-1 bg-secondary/20 rounded-full text-secondary text-[10px] font-mono font-bold border border-secondary/30 self-start mt-1">
                OWNER
              </span>
            )}
          </div>
          <div className="flex gap-2 text-xs font-mono">
            <span className="px-3 py-1 bg-surface-highest/50 rounded-full text-tertiary border border-tertiary/20">
              {blockDisplay}
            </span>
            <span className="px-3 py-1 bg-surface-highest/50 rounded-full text-secondary border border-secondary/20">
              {chainName || "UNKNOWN"}
            </span>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex bg-surface-container-low rounded-full p-1 border border-outline-variant/20 self-start">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-6 py-2 font-headline text-sm rounded-full transition-all ${
                activeTab === tab.key
                  ? "bg-surface-container-highest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          {/* ==================== STATUS TAB ==================== */}
          {activeTab === "status" && (
            <motion.div
              key="status"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* 4 BentoCards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {/* Contract Status */}
                <BentoCard
                  title="Contract Status"
                  value={statusLabel}
                  color={statusColor}
                  icon={<Wallet className="w-12 h-12 opacity-10" />}
                >
                  <p className="text-[10px] font-mono mt-4 text-on-surface-variant truncate">
                    {registryAddr
                      ? truncateHex(registryAddr, 8, 6)
                      : "Not deployed"}
                  </p>
                  <div className="mt-6 flex items-center gap-2">
                    <div className="h-1 flex-1 bg-secondary/10 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: paused ? "0%" : "100%" }}
                        transition={{ duration: 1.5, ease: "easeOut" }}
                        className={`h-full ${paused ? "bg-error" : "bg-secondary shadow-[0_0_8px_rgba(107,255,143,0.5)]"}`}
                      />
                    </div>
                    <span
                      className={`text-[10px] font-mono ${paused ? "text-error" : "text-secondary"}`}
                    >
                      {paused ? "HALTED" : "100%"}
                    </span>
                  </div>
                </BentoCard>

                {/* CA Merkle Root */}
                <BentoCard
                  title="CA Merkle Root"
                  value={caRoot ? truncateHex(caRoot) : "Loading..."}
                  color="primary"
                  mono
                  icon={<Share2 className="w-12 h-12 opacity-10" />}
                >
                  <p className="text-[10px] font-label text-on-surface-variant mt-4">
                    {isZeroHash(caRoot) ? "NOT SET" : "ACTIVE ROOT"}
                  </p>
                  <div className="mt-4 flex items-end gap-1.5 h-8">
                    {[0.4, 1, 0.6, 0.8, 0.5, 0.9, 0.7].map((h, i) => (
                      <motion.div
                        key={i}
                        initial={{ height: 0 }}
                        animate={{ height: `${h * 100}%` }}
                        transition={{ delay: i * 0.1, duration: 0.5 }}
                        className="w-1.5 bg-tertiary/60 rounded-full"
                      />
                    ))}
                  </div>
                </BentoCard>

                {/* CRL Merkle Root */}
                <BentoCard
                  title="CRL Merkle Root"
                  value={crlDisplay}
                  color="primary"
                  mono
                  icon={<ListFilter className="w-12 h-12 opacity-10" />}
                >
                  <p className="text-[10px] font-label text-on-surface-variant mt-4 uppercase tracking-wider">
                    {isZeroHash(crlRoot)
                      ? "CRL checking disabled"
                      : "CRL checking enabled"}
                  </p>
                  <div className="mt-4 flex -space-x-2">
                    {["M", "P", "V", "S"].map((l, i) => (
                      <div
                        key={i}
                        className="w-6 h-6 rounded-full border-2 border-surface bg-surface-highest flex items-center justify-center text-[8px] font-bold text-on-surface-variant"
                      >
                        {l}
                      </div>
                    ))}
                  </div>
                </BentoCard>

                {/* Global Config */}
                <BentoCard
                  title="Global Config"
                  value={contractState ? "On-Chain" : "Loading..."}
                  color="primary"
                  icon={<Cpu className="w-12 h-12 opacity-10" />}
                >
                  <div className="grid grid-cols-2 gap-4 mt-4">
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-tighter">
                        Max Proof Age
                      </p>
                      <p className="text-sm font-headline font-bold">
                        {maxProofAge}s
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-tighter">
                        Wallets/Cert
                      </p>
                      <p className="text-sm font-headline font-bold">
                        {maxWallets}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 p-2 bg-surface-low rounded-lg border border-outline-variant/10">
                    <p className="text-[10px] font-mono text-tertiary">
                      SP1 ZKVM: verified
                    </p>
                  </div>
                </BentoCard>
              </div>

              {/* Contract Addresses */}
              <div className="bg-surface p-5 rounded-2xl border border-outline-variant/10 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex items-center justify-between bg-surface-container-low/50 rounded-xl p-3">
                  <div>
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">Registry Address</p>
                    <p className="font-mono text-sm text-tertiary">{registryAddr || "—"}</p>
                  </div>
                  {registryAddr && (
                    <CopyButton text={registryAddr} />
                  )}
                </div>
                <div className="flex items-center justify-between bg-surface-container-low/50 rounded-xl p-3">
                  <div>
                    <p className="text-[10px] text-on-surface-variant uppercase tracking-widest mb-1">SP1 Verifier</p>
                    <p className="font-mono text-sm text-tertiary">{process.env.NEXT_PUBLIC_SP1_VERIFIER_ADDRESS || "—"}</p>
                  </div>
                  {process.env.NEXT_PUBLIC_SP1_VERIFIER_ADDRESS && (
                    <CopyButton text={process.env.NEXT_PUBLIC_SP1_VERIFIER_ADDRESS} />
                  )}
                </div>
              </div>

              {/* Search Bar */}
              <div className="bg-surface p-4 rounded-2xl border border-outline-variant/10">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant/40" />
                    <input
                      className="w-full bg-surface-highest border-none rounded-xl pl-10 pr-4 py-3 text-sm font-mono focus:ring-1 focus:ring-tertiary transition-all outline-none text-primary placeholder:text-on-surface-variant/30"
                      placeholder="Search address (0x...42 chars) or nullifier hash (0x...66 chars)"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                  </div>
                  <button
                    onClick={handleSearch}
                    disabled={searchLoading || !readContract}
                    className="bg-primary text-background px-6 rounded-xl font-label font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-all"
                  >
                    {searchLoading ? "Searching..." : "SEARCH"}
                  </button>
                </div>
                {searchResult && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-3 text-xs font-mono text-on-surface-variant px-2"
                  >
                    {searchResult}
                  </motion.p>
                )}
              </div>
            </motion.div>
          )}

          {/* ==================== MANAGEMENT TAB ==================== */}
          {activeTab === "management" && (
            <motion.div
              key="ca"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Add CA — File Upload Section */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center gap-3 mb-6">
                  <Upload className="text-primary w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-primary">
                    Add CA Certificate
                  </h2>
                </div>
                <p className="text-sm text-on-surface-variant mb-6">
                  Upload CA certificate <code>.der</code> files. Each file is
                  SHA-256 hashed in-browser, then registered on-chain via{" "}
                  <code>addCA()</code>. The Merkle root is auto-computed by the
                  contract.
                </p>

                {/* Drop zone */}
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                    dragOver
                      ? "border-primary bg-primary/5"
                      : "border-outline-variant/30 hover:border-primary/50 hover:bg-surface-highest/30"
                  }`}
                >
                  <Upload
                    className={`w-8 h-8 mx-auto mb-3 ${dragOver ? "text-primary" : "text-on-surface-variant/40"}`}
                  />
                  <p className="text-sm text-on-surface-variant">
                    {caFileProcessing
                      ? "Processing files..."
                      : "Drag & drop .der files here, or click to browse"}
                  </p>
                  <p className="text-[10px] text-on-surface-variant/50 mt-1">
                    Multiple files allowed
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".der"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files) processFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {/* File size warning */}
                {caFileWarning && (
                  <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-3 flex items-start gap-2">
                    <span className="text-yellow-400 text-xs shrink-0">⚠</span>
                    <p className="text-xs text-yellow-300/80">{caFileWarning}</p>
                    <button type="button" aria-label="Dismiss file warning" onClick={() => setCaFileWarning("")} className="text-yellow-400/60 hover:text-yellow-400 ml-auto shrink-0 text-xs">✕</button>
                  </div>
                )}

                {/* Pending files — ready to add on-chain */}
                {caFiles.length > 0 && (
                  <div className="mt-6 space-y-2">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-label text-on-surface-variant uppercase tracking-widest">
                        Pending CA Certificates ({caFiles.length})
                      </p>
                      <button
                        onClick={handleAddAllCas}
                        disabled={disabled}
                        className="bg-tertiary text-background px-4 py-1.5 rounded-lg font-label font-bold text-[10px] hover:opacity-90 disabled:opacity-50 transition-all"
                      >
                        {`ADD ${caFiles.length > 1 ? `ALL (${caFiles.length}) ` : ""}TO REGISTRY`}
                      </button>
                    </div>
                    {caFiles.map((entry, idx) => {
                      const txStatus = addCaTxMap[entry.hashHex] ?? IDLE;
                      const meta = entry.metadata;
                      return (
                        <div
                          key={entry.hashHex}
                          className="bg-surface-highest rounded-xl px-4 py-3 space-y-2"
                        >
                          {/* Header: filename + hash + actions */}
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-tertiary shrink-0" />
                            <span className="text-sm font-headline font-medium text-primary truncate">
                              {meta?.subjectCn || meta?.subjectOrg || entry.name}
                            </span>
                            <span className="text-[10px] font-mono text-on-surface-variant truncate flex-1">
                              {truncateHex(entry.hashHex, 10, 8)}
                            </span>
                            <button
                              onClick={() => removeCaFile(idx)}
                              className="text-on-surface-variant/50 hover:text-error transition-colors shrink-0"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          {/* Auto-extracted metadata */}
                          {meta && (
                            <div className="flex flex-wrap gap-2 text-[10px] text-on-surface-variant pl-7">
                              <span className="bg-surface px-2 py-0.5 rounded">{meta.algorithm}</span>
                              <span className="bg-surface px-2 py-0.5 rounded">Expires: {meta.expires}</span>
                              {meta.country && (
                                <span className="bg-surface px-2 py-0.5 rounded">Country: {meta.country}</span>
                              )}
                              {meta.issuerCn && (
                                <span className="bg-surface px-2 py-0.5 rounded">Issuer: {meta.issuerCn}</span>
                              )}
                            </div>
                          )}
                          {/* Auto-generated guide (editable) */}
                          <div className="pl-7 space-y-1">
                            <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wider">
                              CA Guide (auto-generated)
                            </p>
                            <input
                              type="text"
                              placeholder="CA Name"
                              value={entry.guide.name}
                              onChange={(e) => handleGuideChange(idx, "name", e.target.value)}
                              className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-1.5 text-xs text-on-surface"
                            />
                            <input
                              type="text"
                              placeholder="Description"
                              value={entry.guide.description || ""}
                              onChange={(e) => handleGuideChange(idx, "description", e.target.value)}
                              className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-1.5 text-xs text-on-surface"
                            />
                            <input
                              type="url"
                              placeholder="Issue URL (e.g., https://www.yessign.or.kr)"
                              value={entry.guide.issue_url || ""}
                              onChange={(e) => {
                                const safe = sanitizeUrlInput(e.target.value);
                                if (safe === null) {
                                  e.target.setCustomValidity("Dangerous URL scheme blocked.");
                                  e.target.reportValidity();
                                  handleGuideChange(idx, "issue_url", "");
                                } else {
                                  e.target.setCustomValidity("");
                                  handleGuideChange(idx, "issue_url", safe);
                                }
                              }}
                              onBlur={(e) => {
                                const validated = validateUrlOnCommit(e.target.value);
                                if (e.target.value && !validated) {
                                  e.target.setCustomValidity("Please enter a URL starting with http:// or https://.");
                                  e.target.reportValidity();
                                }
                                handleGuideChange(idx, "issue_url", validated);
                              }}
                              className="w-full bg-surface border border-outline-variant rounded-lg px-3 py-1.5 text-xs text-on-surface"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* CA Merkle Root display */}
              {!isZeroHash(caRoot) && (
                <div className="bg-surface p-6 rounded-3xl border border-outline-variant/10 flex items-center gap-4">
                  <ShieldCheck className="text-primary w-5 h-5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest mb-1">
                      CA Merkle Root
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-mono text-tertiary break-all">
                        {caRoot}
                      </code>
                      <CopyButton text={caRoot} title="Copy CA Root" />
                    </div>
                  </div>
                </div>
              )}

              {/* Registered CAs — On-chain list */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <Share2 className="text-primary w-5 h-5" />
                    <h2 className="text-xl font-headline font-bold text-primary">
                      Registered CAs
                    </h2>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                      {onChainCaLeaves.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {selectedCaLeaves.size > 0 && (
                      <div className="flex items-center gap-2">
                        <TxBadge status={removeAllTx} />
                        <button
                          onClick={handleRemoveSelected}
                          disabled={disabled || isBusy(removeAllTx)}
                          className="px-3 py-1.5 border border-error/30 text-error rounded-lg font-label font-bold text-[10px] hover:bg-error/10 disabled:opacity-50 transition-all"
                        >
                          {isBusy(removeAllTx) ? "..." : `REMOVE SELECTED (${selectedCaLeaves.size})`}
                        </button>
                      </div>
                    )}
                    <button
                      onClick={fetchCaLeaves}
                      disabled={caListLoading}
                      className="text-xs font-label text-tertiary hover:text-primary transition-colors disabled:opacity-50"
                    >
                      {caListLoading ? "Loading..." : "Refresh"}
                    </button>
                  </div>
                </div>

                {onChainCaLeaves.length === 0 ? (
                  <p className="text-sm text-on-surface-variant/60 text-center py-8">
                    {caListLoading
                      ? "Loading on-chain CA list..."
                      : "No CA certificates registered on-chain."}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {onChainCaLeaves.length > 1 && (
                      <label className="flex items-center gap-2 px-4 py-1 cursor-pointer text-[10px] text-on-surface-variant">
                        <input
                          type="checkbox"
                          checked={selectedCaLeaves.size === onChainCaLeaves.length}
                          onChange={toggleSelectAll}
                          className="accent-primary"
                        />
                        Select All
                      </label>
                    )}
                    {onChainCaLeaves.map((leaf, idx) => {
                      const txStatus = removeCaTxMap[leaf] ?? IDLE;
                      return (
                        <div
                          key={leaf}
                          className="flex items-center gap-3 bg-surface-highest rounded-xl px-4 py-3"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCaLeaves.has(leaf)}
                            onChange={() => toggleCaSelect(leaf)}
                            className="accent-primary shrink-0"
                          />
                          <span className="text-[10px] font-mono text-on-surface-variant/60 w-8 text-right shrink-0">
                            #{idx}
                          </span>
                          <span className="text-sm font-mono text-primary truncate flex-1">
                            {truncateHex(leaf, 10, 8)}
                          </span>
                          <CopyButton text={leaf} />
                          <TxBadge status={txStatus} />
                          <button
                            onClick={() => handleRemoveCa(idx, leaf)}
                            disabled={disabled || isBusy(txStatus)}
                            className="px-3 py-1.5 border border-error/30 text-error rounded-lg font-label font-bold text-[10px] hover:bg-error/10 disabled:opacity-50 transition-all shrink-0"
                          >
                            {isBusy(txStatus) ? "..." : "REMOVE"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-[10px] text-on-surface-variant italic mt-4">
                  The on-chain Merkle root is auto-computed when CAs are added or
                  removed.
                </p>
              </div>

              {/* CRL Merkle Root */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center gap-3 mb-6">
                  <ListFilter className="text-primary w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-primary">
                    Update CRL Merkle Root
                  </h2>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-label text-on-surface-variant">
                    CRL Merkle Root (Hex)
                  </label>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 bg-surface-highest border-none rounded-xl px-4 py-3 text-sm font-mono focus:ring-1 focus:ring-tertiary transition-all outline-none text-primary placeholder:text-on-surface-variant/30"
                      placeholder="New CRL Root (0x...) or 0x00..00 to disable"
                      type="text"
                      value={crlRootInput}
                      onChange={(e) => setCrlRootInput(e.target.value)}
                      disabled={disabled}
                    />
                    <button
                      className="bg-primary text-background px-6 rounded-xl font-label font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-all"
                      disabled={disabled || isBusy(crlRootTx) || !crlRootInput}
                      onClick={handleUpdateCrlRoot}
                    >
                      {isBusy(crlRootTx) ? "Processing..." : "UPDATE"}
                    </button>
                  </div>
                  <TxBadge status={crlRootTx} />
                  <p className="text-[10px] text-on-surface-variant italic">
                    Set to zero hash to disable CRL checking.
                  </p>
                </div>
              </div>

              {/* Max Proof Age */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center gap-3 mb-6">
                  <Settings className="text-primary w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-primary">
                    Max Proof Age
                  </h2>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-label text-on-surface-variant">
                    Max Proof Age (Seconds)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      className="flex-1 accent-tertiary h-1 bg-surface-highest rounded-full appearance-none cursor-pointer"
                      max="3600"
                      min="60"
                      type="range"
                      value={proofAgeInput ?? maxProofAge}
                      onChange={(e) =>
                        setProofAgeInput(Number(e.target.value))
                      }
                      disabled={disabled}
                    />
                    <span className="text-sm font-mono font-bold w-16 text-center text-primary">
                      {proofAgeInput ?? maxProofAge}s
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-on-surface-variant font-label">
                    <span>1 Min</span>
                    <span>1 Hour</span>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      className="bg-primary text-background px-4 py-2 rounded-xl font-label font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-all"
                      disabled={
                        disabled ||
                        isBusy(proofAgeTx) ||
                        proofAgeInput === null ||
                        proofAgeInput === maxProofAge
                      }
                      onClick={handleSetProofAge}
                    >
                      {isBusy(proofAgeTx) ? "Processing..." : "SET AGE"}
                    </button>
                    <TxBadge status={proofAgeTx} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* ==================== SECURITY TAB ==================== */}
          {activeTab === "security" && (
            <motion.div
              key="security"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {/* Revoke Identity */}
              <div className="bg-surface p-8 rounded-3xl border border-error/10 bg-gradient-to-b from-error/5 to-transparent">
                <div className="flex items-center gap-3 mb-6">
                  <AlertTriangle className="text-error w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-error">
                    Revoke Identity
                  </h2>
                </div>
                <p className="text-xs text-on-surface-variant mb-4">
                  Permanently blacklist a nullifier from the protocol.
                </p>
                <div className="space-y-3 max-w-full">
                  <input
                    className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm font-mono outline-none text-primary placeholder:text-on-surface-variant/30"
                    placeholder="Identity Nullifier Hash (0x...)"
                    type="text"
                    value={revokeNullifier}
                    onChange={(e) => setRevokeNullifier(e.target.value)}
                    disabled={disabled}
                  />
                  <select
                    className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm font-label outline-none text-on-surface-variant appearance-none cursor-pointer"
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    disabled={disabled}
                  >
                    <option value="">Select Reason</option>
                    <option>Key Compromise</option>
                    <option>CA Revocation</option>
                    <option>Malicious Activity</option>
                  </select>
                  <button
                    className="w-full py-3 border border-error/40 text-error hover:bg-error/10 transition-all font-bold text-xs rounded-xl uppercase tracking-widest disabled:opacity-50"
                    disabled={
                      disabled ||
                      isBusy(revokeTx) ||
                      !revokeNullifier ||
                      !revokeReason
                    }
                    onClick={handleRevoke}
                  >
                    {isBusy(revokeTx)
                      ? "Processing..."
                      : "Commit Revocation"}
                  </button>
                  <TxBadge status={revokeTx} />
                </div>
              </div>

              {/* Emergency Pause */}
              <div className="bg-surface p-8 rounded-3xl border border-error/10 bg-gradient-to-b from-error/5 to-transparent">
                <div className="flex items-center gap-3 mb-6">
                  <Shield className="text-error w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-error">
                    Emergency Pause
                  </h2>
                </div>
                <div className="flex items-center justify-between max-w-full">
                  <div>
                    <p className="text-sm font-headline font-bold text-primary">
                      Protocol Status
                    </p>
                    <p className="text-xs text-on-surface-variant mt-1">
                      Halt all verification proofs.
                    </p>
                  </div>
                  <button
                    onClick={handlePauseToggle}
                    disabled={disabled || isBusy(pauseTx)}
                    className={`relative inline-flex items-center h-6 w-11 rounded-full transition-colors focus:outline-none disabled:opacity-50 ${paused ? "bg-error" : "bg-surface-highest"}`}
                  >
                    <span
                      className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform ${paused ? "translate-x-6" : "translate-x-1"}`}
                    />
                  </button>
                </div>
                <div className="mt-3">
                  <TxBadge status={pauseTx} />
                </div>
                <div className="p-4 bg-error/10 rounded-2xl border border-error/20 mt-4 max-w-full">
                  <p className="text-[10px] text-error leading-relaxed font-medium">
                    <strong>ATTENTION:</strong> Pausing the contract will freeze
                    all user activities immediately. Only the DAO or emergency
                    multi-sig can resume operations.
                  </p>
                </div>
              </div>

              {/* Transfer Ownership */}
              <div className="bg-surface p-8 rounded-3xl border border-error/10 bg-gradient-to-b from-error/5 to-transparent">
                <div className="flex items-center gap-3 mb-6">
                  <ArrowRightLeft className="text-error w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-error">
                    Transfer Ownership
                  </h2>
                </div>
                <p className="text-xs text-on-surface-variant mb-4">
                  Transfer protocol ownership to a new address. This action is
                  irreversible.
                </p>
                <div className="space-y-3 max-w-full">
                  <input
                    className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm font-mono outline-none text-primary placeholder:text-on-surface-variant/30"
                    placeholder="New Owner Address (0x...)"
                    type="text"
                    value={newOwnerInput}
                    onChange={(e) => setNewOwnerInput(e.target.value)}
                    disabled={disabled}
                  />
                  <button
                    className="w-full py-3 border border-error/40 text-error hover:bg-error/10 transition-all font-bold text-xs rounded-xl uppercase tracking-widest disabled:opacity-50"
                    disabled={
                      disabled ||
                      isBusy(transferTx) ||
                      !newOwnerInput ||
                      !newOwnerInput.startsWith("0x") ||
                      newOwnerInput.length !== 42
                    }
                    onClick={handleTransferOwnership}
                  >
                    {isBusy(transferTx)
                      ? "Processing..."
                      : "Transfer Ownership"}
                  </button>
                  <TxBadge status={transferTx} />
                </div>
              </div>
            </motion.div>
          )}
          {/* ==================== SERVICE SETTINGS TAB ==================== */}
          {activeTab === "service" && (
            <motion.div
              key="service"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
              className="space-y-6"
            >
              {svcBackendDown && (
                <div className="flex items-center gap-3 p-4 rounded-xl border border-error/20 bg-error/5">
                  <AlertTriangle className="text-error w-4 h-4 shrink-0" />
                  <p className="text-sm text-error">
                    Backend unavailable. Service settings cannot be loaded or saved.
                  </p>
                </div>
              )}

              {/* Metadata Editing */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center gap-3 mb-6">
                  <Globe className="text-primary w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-primary">
                    Service Metadata
                  </h2>
                </div>

                {svcMetaLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 text-tertiary animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-label text-on-surface-variant mb-1 block">
                        Description
                      </label>
                      <textarea
                        className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm outline-none text-primary placeholder:text-on-surface-variant/30 resize-y min-h-[80px]"
                        placeholder="Describe this service..."
                        value={svcMetadata.description || ""}
                        onChange={(e) => setSvcMetadata((p) => ({ ...p, description: e.target.value }))}
                        disabled={disabled}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-label text-on-surface-variant mb-1 block">
                          Category
                        </label>
                        <select
                          className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm font-label outline-none text-on-surface-variant appearance-none cursor-pointer"
                          value={svcMetadata.category || "other"}
                          onChange={(e) => setSvcMetadata((p) => ({ ...p, category: e.target.value as RegistryMetadata["category"] }))}
                          disabled={disabled}
                        >
                          <option value="dao">DAO</option>
                          <option value="defi">DeFi</option>
                          <option value="corporate">Corporate</option>
                          <option value="other">Other</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-label text-on-surface-variant mb-1 block">
                          Website URL
                        </label>
                        <input
                          className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm font-mono outline-none text-primary placeholder:text-on-surface-variant/30"
                          placeholder="https://..."
                          type="url"
                          value={svcMetadata.website || ""}
                          onChange={(e) => setSvcMetadata((p) => ({ ...p, website: e.target.value }))}
                          disabled={disabled}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-surface-highest rounded-xl px-4 py-3">
                      <div>
                        <p className="text-sm font-label text-primary">List on Explorer</p>
                        <p className="text-[10px] text-on-surface-variant">
                          {svcMetadata.listed !== false
                            ? "This registry is visible on the public dashboard"
                            : "This registry is hidden from the public dashboard"}
                        </p>
                      </div>
                      <button
                        onClick={() => setSvcMetadata((p) => ({ ...p, listed: !(p.listed ?? true) }))}
                        disabled={disabled}
                        role="switch"
                        aria-checked={svcMetadata.listed !== false}
                        aria-label="List on Explorer"
                        className={`relative w-10 h-5 rounded-full transition-colors ${svcMetadata.listed !== false ? "bg-primary" : "bg-outline-variant/30"}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${svcMetadata.listed !== false ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleSaveMetadata}
                        disabled={disabled || svcMetaSaving}
                        className="bg-primary text-background px-6 py-2 rounded-xl font-label font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
                      >
                        {svcMetaSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        {svcMetaSaving ? "Saving..." : "Save Metadata"}
                      </button>
                      {svcMetaMsg && (
                        <span className={`text-[10px] font-mono ${svcMetaMsg.includes("Failed") ? "text-error" : "text-secondary"}`}>
                          {svcMetaMsg}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Announcements Management */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center gap-3 mb-6">
                  <Megaphone className="text-primary w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-primary">
                    Announcements
                  </h2>
                </div>

                {/* Post new announcement */}
                <div className="space-y-3 mb-6">
                  <input
                    className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm outline-none text-primary placeholder:text-on-surface-variant/30"
                    placeholder="Announcement title"
                    value={svcAnncTitle}
                    onChange={(e) => setSvcAnncTitle(e.target.value)}
                    disabled={disabled}
                  />
                  <textarea
                    className="w-full bg-surface-highest border-none rounded-xl px-4 py-3 text-sm outline-none text-primary placeholder:text-on-surface-variant/30 resize-y min-h-[60px]"
                    placeholder="Announcement body..."
                    value={svcAnncBody}
                    onChange={(e) => setSvcAnncBody(e.target.value)}
                    disabled={disabled}
                  />
                  <button
                    onClick={handlePostAnnouncement}
                    disabled={disabled || svcAnncPosting || !svcAnncTitle.trim() || !svcAnncBody.trim()}
                    className="bg-tertiary text-background px-6 py-2 rounded-xl font-label font-bold text-xs hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-2"
                  >
                    {svcAnncPosting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    {svcAnncPosting ? "Posting..." : "Post Announcement"}
                  </button>
                </div>

                {/* Existing announcements */}
                {svcAnncLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-5 h-5 text-tertiary animate-spin" />
                  </div>
                ) : svcAnnouncements.length === 0 ? (
                  <p className="text-sm text-on-surface-variant/60 text-center py-4">
                    No announcements yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {svcAnnouncements.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-start gap-3 bg-surface-highest rounded-xl px-4 py-3"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-headline font-bold text-primary truncate">{a.title}</h4>
                            <span className="text-[10px] font-mono text-on-surface-variant shrink-0">
                              {new Date(a.createdAt).toLocaleDateString("en-US")}
                            </span>
                          </div>
                          <p className="text-xs text-on-surface-variant truncate">{a.body}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteAnnouncement(a.id)}
                          disabled={disabled}
                          className="text-on-surface-variant/50 hover:text-error transition-colors shrink-0 disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* CA Guides Management */}
              <div className="bg-surface p-8 rounded-3xl border border-outline-variant/10">
                <div className="flex items-center gap-3 mb-6">
                  <BookOpen className="text-primary w-5 h-5" />
                  <h2 className="text-xl font-headline font-bold text-primary">
                    CA Guides
                  </h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {onChainCaLeaves.length}
                  </span>
                </div>

                {svcGuidesLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="w-5 h-5 text-tertiary animate-spin" />
                  </div>
                ) : onChainCaLeaves.length === 0 ? (
                  <p className="text-sm text-on-surface-variant/60 text-center py-4">
                    No CAs registered on-chain. Add CAs in the Management tab first.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {onChainCaLeaves.map((leaf) => {
                      const edit = svcGuideEdits[leaf] || EMPTY_CA_GUIDE;
                      const saving = svcGuideSaving[leaf] || false;
                      const msg = svcGuideMsg[leaf] || "";
                      const hasGuide = !!svcCaGuides[leaf];

                      return (
                        <div
                          key={leaf}
                          className="bg-surface-highest rounded-xl p-5 border border-outline-variant/10"
                        >
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-[10px] font-mono text-on-surface-variant truncate">
                              {truncateHex(leaf, 10, 8)}
                            </span>
                            <CopyButton text={leaf} />
                            {hasGuide ? (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-label bg-secondary/10 text-secondary border border-secondary/20">
                                Guide set
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[9px] font-label bg-tertiary/10 text-tertiary border border-tertiary/20">
                                No guide
                              </span>
                            )}
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="text-[10px] font-label text-on-surface-variant mb-0.5 block">Name</label>
                              <input
                                className="w-full bg-surface border-none rounded-lg px-3 py-2 text-sm outline-none text-primary placeholder:text-on-surface-variant/30"
                                placeholder="CA Name (e.g. DigiCert)"
                                value={edit.name}
                                onChange={(e) => updateGuideField(leaf, "name", e.target.value)}
                                disabled={disabled}
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-label text-on-surface-variant mb-0.5 block">Issue URL</label>
                              <input
                                type="url"
                                className="w-full bg-surface border-none rounded-lg px-3 py-2 text-sm font-mono outline-none text-primary placeholder:text-on-surface-variant/30"
                                placeholder="https://ca-provider.com/issue"
                                value={edit.issue_url}
                                onChange={(e) => {
                                  const safe = sanitizeUrlInput(e.target.value);
                                  if (safe === null) {
                                    e.target.setCustomValidity("Dangerous URL scheme blocked.");
                                    e.target.reportValidity();
                                    updateGuideField(leaf, "issue_url", "");
                                  } else {
                                    e.target.setCustomValidity("");
                                    updateGuideField(leaf, "issue_url", safe);
                                  }
                                }}
                                onBlur={(e) => {
                                  const validated = validateUrlOnCommit(e.target.value);
                                  if (e.target.value && !validated) {
                                    e.target.setCustomValidity("Please enter a URL starting with http:// or https://.");
                                    e.target.reportValidity();
                                  }
                                  updateGuideField(leaf, "issue_url", validated);
                                }}
                                disabled={disabled}
                              />
                            </div>
                          </div>

                          <div className="mb-3">
                            <label className="text-[10px] font-label text-on-surface-variant mb-0.5 block">Description</label>
                            <input
                              className="w-full bg-surface border-none rounded-lg px-3 py-2 text-sm outline-none text-primary placeholder:text-on-surface-variant/30"
                              placeholder="Short description of this CA"
                              value={edit.description}
                              onChange={(e) => updateGuideField(leaf, "description", e.target.value)}
                              disabled={disabled}
                            />
                          </div>

                          <div className="mb-3">
                            <label className="text-[10px] font-label text-on-surface-variant mb-0.5 block">Instructions</label>
                            <textarea
                              className="w-full bg-surface border-none rounded-lg px-3 py-2 text-sm outline-none text-primary placeholder:text-on-surface-variant/30 resize-y min-h-[50px]"
                              placeholder="Step-by-step instructions to get a certificate from this CA..."
                              value={edit.instructions}
                              onChange={(e) => updateGuideField(leaf, "instructions", e.target.value)}
                              disabled={disabled}
                            />
                          </div>

                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => handleSaveCaGuide(leaf)}
                              disabled={disabled || saving}
                              className="bg-primary text-background px-4 py-1.5 rounded-lg font-label font-bold text-[10px] hover:opacity-90 disabled:opacity-50 transition-all flex items-center gap-1.5"
                            >
                              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              {saving ? "Saving..." : "Save Guide"}
                            </button>
                            {msg && (
                              <span className={`text-[10px] font-mono ${msg === "Failed" ? "text-error" : "text-secondary"}`}>
                                {msg}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <footer className="mt-12 p-8 border-t border-outline-variant/10 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] font-label text-on-surface-variant">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-3 h-3" />
          <span>Developed by Tokamak Network</span>
        </div>
        <div className="flex gap-8">
          <a href="#" className="hover:text-primary transition-colors">
            PRIVACY POLICY
          </a>
          <a href="#" className="hover:text-primary transition-colors">
            TERMS OF SERVICE
          </a>
          <a href="#" className="hover:text-primary transition-colors">
            GITHUB SOURCE
          </a>
        </div>
      </footer>
    </main>

    {/* CA Registration Modal (on-chain + Git) — shared for add/remove/edit */}
    <CaRegistrationModal
      open={caModalOpen}
      onClose={() => {
        const entry = caModalEntry;
        const certs = caModalCerts;
        const op = caModalOp;
        setCaModalOpen(false);
        setCaModalEntry(null);
        setCaModalTxFn(null);
        setCaModalCerts([]);
        refresh();
        fetchCaLeaves();
        if (entry) {
          setCaFiles((prev) => prev.filter((f) => f.hashHex !== entry.hashHex));
        } else if (certs.length > 0 && op === "add-ca") {
          const hashes = new Set(certs.map((c) => c.hashHex));
          setCaFiles((prev) => prev.filter((f) => !hashes.has(f.hashHex)));
        }
        if (op === "remove-ca") {
          setRemoveCaTxMap({});
        }
        // Save CA guides to backend DB
        if (registryAddr && (op === "add-ca" || op === "update")) {
          const allCerts = entry ? [{ hashHex: entry.hashHex, guide: entry.guide }] : certs;
          for (const c of allCerts) {
            if (c.guide?.name) {
              putCaGuide(registryAddr, c.hashHex, c.guide).catch(console.error);
            }
          }
        }
      }}
      operation={caModalOp}
      chainId={chainId || "31337"}
      registryAddress={registryAddr}
      adminAddress={account || ""}
      serviceName={serviceName || registryAddr}
      executeTx={caModalEntry && writeContract ? async () => {
        const tx = await writeContract.addCA(caModalEntry.hashHex);
        const receipt = await tx.wait();
        return receipt?.hash || tx.hash;
      } : caModalTxFn}
      certs={caModalEntry ? [{
        hashHex: caModalEntry.hashHex,
        derBase64: btoa(Array.from(caModalEntry.derBytes, (b) => String.fromCharCode(b)).join("")),
        guide: caModalEntry.guide,
      }] : caModalCerts}
      existingCas={svcCaGuides}
      signer={writeContract?.runner as ethers.Signer || null}
    />
    </>
  );
}
