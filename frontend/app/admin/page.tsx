"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import Link from "next/link";
import {
  Wallet,
  Loader2,
  Plus,
  ArrowRight,
  Shield,
  Pause,
  Play,
  LayoutGrid,
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
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RegistryCard {
  address: string;
  name: string;
  maxWallets: number;
  minDisclosureMask: number;
  caCount: number;
  paused: boolean;
  metadata: RegistryMetadata | null;
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
  other: { label: "Other", color: "text-on-surface-variant bg-surface-container" },
};

/* ================================================================== */
/*  Admin Dashboard — "My Services"                                    */
/* ================================================================== */

export default function AdminPage() {
  const { account, chainId, connect } = useWallet();

  const [registries, setRegistries] = useState<RegistryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const provider = useReadProvider();

  /* ---------- load registries owned by connected wallet ---------- */
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

        // For each registry, fetch info from factory + on-chain state
        const cards: RegistryCard[] = [];

        await Promise.all(
          allAddresses.map(async (addr) => {
            try {
              const info = await factory.registryInfo(addr);
              const creator: string = info.creator ?? info[0];
              if (creator.toLowerCase() !== account.toLowerCase()) return;

              const registry = new ethers.Contract(
                addr,
                IDENTITY_REGISTRY_ABI,
                provider,
              );

              const [caCount, paused] = await Promise.all([
                registry.getCaCount(),
                registry.paused(),
              ]);

              const name: string = info.name ?? info[1];
              const maxWallets: number = Number(info.maxWallets ?? info[2]);
              const minDisclosureMask: number = Number(
                info.minDisclosureMask ?? info[3],
              );

              let metadata: RegistryMetadata | null = null;
              try {
                metadata = await getRegistryMetadata(addr);
              } catch {
                // metadata is optional
              }

              cards.push({
                address: addr,
                name,
                maxWallets,
                minDisclosureMask,
                caCount: Number(caCount),
                paused: Boolean(paused),
                metadata,
              });
            } catch (e) {
              console.error(`Failed to load service ${addr}:`, e);
            }
          }),
        );

        if (!cancelled) {
          setRegistries(cards);
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
            Connect your wallet to view your services.
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
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <main className="max-w-6xl mx-auto pt-24 px-8 pb-12">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 flex items-end justify-between"
      >
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-tertiary/10 rounded-xl">
              <LayoutGrid className="w-6 h-6 text-tertiary" />
            </div>
            <h1 className="text-3xl font-headline font-bold tracking-tight text-primary">
              Service Auth Policies
            </h1>
          </div>
          <p className="text-on-surface-variant text-sm">
            Manage your auth policies. Configure accepted certificates and authentication rules.
          </p>
        </div>
        <Link
          href="/create"
          className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-surface font-headline font-bold text-sm rounded-full hover:scale-105 active:scale-95 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          Create New Auth Policy
        </Link>
      </motion.header>

      {/* Loading */}
      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center py-24"
        >
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
          <span className="ml-3 text-on-surface-variant font-headline">
            Loading services...
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

      {/* Empty state */}
      {!loading && !error && registries.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-12 text-center max-w-lg mx-auto"
        >
          <Shield className="w-12 h-12 text-on-surface-variant mx-auto mb-4" />
          <h2 className="text-xl font-headline font-bold text-on-surface mb-2">
            No auth policies yet
          </h2>
          <p className="text-on-surface-variant mb-6">
            You haven&apos;t created any auth policies yet. Create one to define which certificates your service accepts.
          </p>
          <Link
            href="/create"
            className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all"
          >
            <Plus className="w-4 h-4" />
            Create Auth Policy
          </Link>
        </motion.div>
      )}

      {/* Service cards */}
      {!loading && !error && registries.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
          {registries.map((reg, i) => {
            const badge =
              CATEGORY_BADGES[reg.metadata?.category ?? "other"] ??
              CATEGORY_BADGES.other;

            return (
              <motion.div
                key={reg.address}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
              >
                <Link
                  href={`/registry/${reg.address}/admin`}
                  className="block glass-panel rounded-2xl p-6 hover:ring-2 hover:ring-tertiary/30 transition-all group"
                >
                  {/* Top row: badge + name */}
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-headline font-bold uppercase tracking-widest ${badge.color}`}
                      >
                        {badge.label}
                      </span>
                      <h3 className="text-lg font-headline font-bold text-on-surface truncate">
                        {reg.name}
                      </h3>
                    </div>
                    <ArrowRight className="w-4 h-4 text-on-surface-variant opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-1" />
                  </div>

                  {/* Address */}
                  <p className="font-mono text-xs text-on-surface-variant mb-4">
                    {truncateHex(reg.address, 8, 6)}
                  </p>

                  {/* Stats row */}
                  <div className="flex items-center gap-6 text-sm">
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
                    <div>
                      <span className="text-on-surface-variant text-xs">
                        CAs
                      </span>
                      <p className="text-on-surface font-headline font-bold">
                        {reg.caCount}
                      </p>
                    </div>
                    <div className="ml-auto">
                      {reg.paused ? (
                        <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-headline">
                          <Pause className="w-3 h-3" /> Paused
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-secondary text-xs font-headline">
                          <Play className="w-3 h-3" /> Active
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </main>
  );
}
