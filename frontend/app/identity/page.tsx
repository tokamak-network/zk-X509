"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import Link from "next/link";
import {
  Wallet,
  Loader2,
  ArrowRight,
  Shield,
  ShieldCheck,
  Copy,
  Check,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import {
  REGISTRY_FACTORY_ABI,
  IDENTITY_REGISTRY_ABI,
  getFactoryAddress,
} from "@/lib/contract";
import { getRegistryMetadata, type RegistryMetadata } from "@/lib/platform";
import { truncateHex } from "@/lib/utils";
import { useReadProvider } from "@/lib/useReadProvider";

/* ------------------------------------------------------------------ */
/*  Trust Badge                                                        */
/* ------------------------------------------------------------------ */

function getTrustBadge(count: number): { emoji: string; label: string; color: string } {
  if (count >= 10) return { emoji: "💎", label: "Diamond", color: "bg-purple-500/20 text-purple-300" };
  if (count >= 5) return { emoji: "🥇", label: "Gold", color: "bg-yellow-500/20 text-yellow-300" };
  if (count >= 3) return { emoji: "🥈", label: "Silver", color: "bg-slate-400/20 text-slate-300" };
  if (count >= 1) return { emoji: "🥉", label: "Bronze", color: "bg-orange-500/20 text-orange-300" };
  return { emoji: "🔒", label: "Unverified", color: "bg-surface-container text-on-surface-variant" };
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface VerifiedRegistry {
  address: string;
  name: string;
  maxWallets: number;
  minDisclosureMask: number;
  metadata: RegistryMetadata | null;
  verifiedUntil: Date | null;
}

const DISCLOSURE_FIELDS = [
  { bit: 0, label: "C" },
  { bit: 1, label: "O" },
  { bit: 2, label: "OU" },
  { bit: 3, label: "CN" },
] as const;

function maskToLabels(mask: number): string {
  const labels = DISCLOSURE_FIELDS.filter((f) => mask & (1 << f.bit)).map(
    (f) => f.label,
  );
  return labels.length > 0 ? labels.join(", ") : "None";
}

const CATEGORY_BADGES: Record<string, { label: string; color: string }> = {
  dao: { label: "DAO", color: "text-tertiary bg-tertiary/10" },
  defi: { label: "DeFi", color: "text-secondary bg-secondary/10" },
  corporate: { label: "Corporate", color: "text-primary bg-primary/10" },
  other: {
    label: "Other",
    color: "text-on-surface-variant bg-surface-container",
  },
};

/* ------------------------------------------------------------------ */
/*  Copyable Address                                                    */
/* ------------------------------------------------------------------ */

function CopyableAddress({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 font-mono text-xs text-on-surface-variant hover:text-tertiary transition-colors ${className ?? ""}`}
      title="Copy address"
    >
      {truncateHex(address, 8, 6)}
      {copied ? (
        <Check className="w-3 h-3 text-secondary" />
      ) : (
        <Copy className="w-3 h-3 opacity-50" />
      )}
    </button>
  );
}

/* ================================================================== */
/*  My Identity Page                                                    */
/* ================================================================== */

export default function IdentityPage() {
  const { account, chainId, connect } = useWallet();

  const [verified, setVerified] = useState<VerifiedRegistry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const provider = useReadProvider();

  /* ---------- load all registries, filter to verified ---------- */
  useEffect(() => {
    if (!account || !chainId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const factoryAddr = getFactoryAddress(chainId);
        if (!factoryAddr) {
          setError("Factory address not configured for this network.");
          setLoading(false);
          return;
        }

        const factory = new ethers.Contract(
          factoryAddr,
          REGISTRY_FACTORY_ABI,
          provider,
        );

        const allAddresses: string[] = await factory.getRegistries();

        const results: VerifiedRegistry[] = [];

        await Promise.all(
          allAddresses.map(async (addr) => {
            try {
              const registry = new ethers.Contract(
                addr,
                IDENTITY_REGISTRY_ABI,
                provider,
              );

              const [isV, until] = await Promise.all([
                registry.isVerified(account),
                registry.verifiedUntil(account),
              ]);

              if (!Boolean(isV)) return;

              const info = await factory.registryInfo(addr);
              const name: string = info.name ?? info[1];
              const maxWallets: number = Number(info.maxWallets ?? info[2]);
              const minDisclosureMask: number = Number(
                info.minDisclosureMask ?? info[3],
              );

              const ts = Number(until);
              const verifiedUntil = ts > 0 ? new Date(ts * 1000) : null;

              let metadata: RegistryMetadata | null = null;
              try {
                metadata = await getRegistryMetadata(addr);
              } catch {
                // metadata is optional
              }

              results.push({
                address: addr,
                name,
                maxWallets,
                minDisclosureMask,
                metadata,
                verifiedUntil,
              });
            } catch (e) {
              console.error(`Failed to check registry ${addr}:`, e);
            }
          }),
        );

        if (!cancelled) {
          setVerified(results);
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to load services:", e);
        if (!cancelled) {
          setError("Failed to load services from factory contract.");
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [account, chainId, provider]);

  /* ---------- not connected ---------- */
  if (!account) {
    return (
      <main className="max-w-6xl mx-auto pt-24 px-8 pb-12 flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-12 text-center max-w-md"
        >
          <Wallet className="w-12 h-12 text-on-surface-variant mx-auto mb-4" />
          <h2 className="text-2xl font-headline font-bold text-on-surface mb-2">
            Connect Wallet
          </h2>
          <p className="text-on-surface-variant mb-6">
            Connect your wallet to view your verification status.
          </p>
          <button
            onClick={connect}
            className="px-8 py-3 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all"
          >
            Connect
          </button>
        </motion.div>
      </main>
    );
  }

  /* ================================================================ */
  /*  Connected — Render                                               */
  /* ================================================================ */
  return (
    <main className="max-w-6xl mx-auto pt-24 px-8 pb-12">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-secondary/10 rounded-xl">
            <ShieldCheck className="w-6 h-6 text-secondary" />
          </div>
          <h1 className="text-3xl font-headline font-bold tracking-tight text-primary">
            My Verifications
          </h1>
        </div>
        <p className="text-on-surface-variant text-sm">
          Your on-chain identity verification status across services.
        </p>
      </motion.header>

      {/* Identity Card */}
      {!loading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel rounded-2xl p-6 mb-8"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-4xl">{getTrustBadge(verified.length).emoji}</span>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${getTrustBadge(verified.length).color}`}>
                    {getTrustBadge(verified.length).label}
                  </span>
                </div>
                <p className="font-mono text-sm text-tertiary">{truncateHex(account, 10, 8)}</p>
              </div>
            </div>
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-2xl font-headline font-bold text-primary">{verified.length}</p>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">Total</p>
              </div>
              <div>
                <p className="text-2xl font-headline font-bold text-on-surface-variant">
                  {verified.filter(r => r.verifiedUntil && r.verifiedUntil > new Date()).length}
                </p>
                <p className="text-[10px] text-on-surface-variant uppercase tracking-widest">Valid</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Loading */}
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center py-24"
        >
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
          <span className="ml-3 text-on-surface-variant font-headline">
            Checking verifications...
          </span>
        </motion.div>
      )}

      {/* Error */}
      {error && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-2xl p-6 text-center"
        >
          <p className="text-red-400 font-headline">{error}</p>
        </motion.div>
      )}

      {/* Empty — not verified anywhere */}
      {!loading && !error && verified.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-12 text-center max-w-lg mx-auto"
        >
          <Shield className="w-12 h-12 text-on-surface-variant mx-auto mb-4" />
          <h2 className="text-xl font-headline font-bold text-on-surface mb-2">
            No verifications yet
          </h2>
          <p className="text-on-surface-variant mb-6">
            You haven&apos;t verified your identity on any service yet.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all"
          >
            Explore Services
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      )}

      {/* Verified service cards */}
      {!loading && !error && verified.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
          {verified.map((reg, i) => {
            const badge =
              CATEGORY_BADGES[reg.metadata?.category ?? "other"] ??
              CATEGORY_BADGES.other;

            return (
              <motion.div
                key={reg.address}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="glass-panel rounded-2xl p-6 hover:ring-2 hover:ring-tertiary/30 transition-all group flex flex-col"
              >
                {/* Top row: name + verified badge */}
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-headline font-bold uppercase tracking-widest shrink-0 ${badge.color}`}
                    >
                      {badge.label}
                    </span>
                    <h3 className="text-lg font-headline font-bold text-on-surface truncate">
                      {reg.name}
                    </h3>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-secondary text-xs font-headline font-bold shrink-0 mt-1">
                    <ShieldCheck className="w-4 h-4" />
                    VERIFIED
                  </span>
                </div>

                {/* Address (copyable) */}
                <div className="mb-4">
                  <CopyableAddress address={reg.address} />
                </div>

                {/* Expiry + stats row */}
                <div className="flex items-center gap-6 text-sm mb-4">
                  <div>
                    <span className="text-on-surface-variant text-xs">
                      Expires
                    </span>
                    <p className="text-on-surface font-headline font-bold text-sm">
                      {reg.verifiedUntil
                        ? reg.verifiedUntil.toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                          })
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-on-surface-variant text-xs">
                      Wallets
                    </span>
                    <p className="text-on-surface font-headline font-bold">
                      {reg.maxWallets}
                    </p>
                  </div>
                  <div>
                    <span className="text-on-surface-variant text-xs">
                      Disclosure
                    </span>
                    <p className="text-on-surface font-mono text-xs font-bold">
                      {maskToLabels(reg.minDisclosureMask)}
                    </p>
                  </div>
                </div>

                {/* Action row */}
                <div className="flex items-center justify-end mt-auto pt-2">
                  <Link
                    href={`/registry/${reg.address}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary/10 text-primary font-headline font-bold text-xs rounded-full hover:bg-primary hover:text-surface transition-all group/btn"
                  >
                    View Details
                    <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </main>
  );
}
