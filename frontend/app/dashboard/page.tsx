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
  LayoutGrid,
  AlertTriangle,
} from "lucide-react";
import { useWallet, getChainName } from "@/lib/wallet";
import {
  REGISTRY_FACTORY_ABI,
  IDENTITY_REGISTRY_ABI,
  getFactoryAddress,
  getRpcUrl,
} from "@/lib/contract";
import { getRegistryMetadata, getListedRegistries, type RegistryMetadata } from "@/lib/platform";
import { useReadProvider } from "@/lib/useReadProvider";

/* ------------------------------------------------------------------ */
/*  Trust Badge                                                        */
/* ------------------------------------------------------------------ */

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
  verified: boolean;
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
  return labels.length > 0 ? labels.join(", ") : "Full";
}


function DeployedOnInfo({ chainName, chainId, rpcUrl, walletChainId }: { chainName: string; chainId: string; rpcUrl: string; walletChainId?: string }) {
  const mismatch = walletChainId && walletChainId !== chainId;
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-3 text-xs text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-container-low/50 rounded-full border border-outline-variant/10">
          Deployed on <span className="font-bold text-on-surface">{chainName} ({chainId})</span>
        </span>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-container-low/50 rounded-full border border-outline-variant/10 font-mono truncate max-w-xs">
          {rpcUrl}
        </span>
      </div>
      {mismatch && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-error/20 bg-error/5 text-sm text-error">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Your wallet is on Chain {walletChainId}. Please switch to <span className="font-bold">{chainName} ({chainId})</span>.
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Dashboard — Registry Directory                                     */
/* ================================================================== */

export default function DashboardPage() {
  const { account, chainId, connect } = useWallet();

  const [registries, setRegistries] = useState<RegistryCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const provider = useReadProvider();

  /* ---------- load all registries + verification status ---------- */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const cid = chainId || "31337";
        const factoryAddr = getFactoryAddress(cid);
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

        const [allAddresses, listedAddresses]: [string[], string[] | null] = await Promise.all([
          factory.getRegistries(),
          getListedRegistries(),
        ]);

        // null  = backend unreachable → show all on-chain registries
        // []    = backend ok, nothing listed → show none
        // [...] = filter to only listed
        let visibleAddresses = allAddresses;
        if (listedAddresses !== null) {
          const listedSet = new Set(listedAddresses.map((l: string) => l.toLowerCase()));
          visibleAddresses = allAddresses.filter((a: string) => listedSet.has(a.toLowerCase()));
        }

        const cards: RegistryCard[] = [];

        await Promise.all(
          visibleAddresses.map(async (addr) => {
            try {
              const info = await factory.registryInfo(addr);

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

              // Check verification status if wallet is connected
              let verified = false;
              let verifiedUntil: Date | null = null;
              if (account) {
                try {
                  const [isV, until] = await Promise.all([
                    registry.isVerified(account),
                    registry.verifiedUntil(account),
                  ]);
                  verified = Boolean(isV);
                  const ts = Number(until);
                  verifiedUntil = ts > 0 ? new Date(ts * 1000) : null;
                } catch {
                  // verification check failed, treat as not verified
                }
              }

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
                verified,
                verifiedUntil,
              });
            } catch (e) {
              console.error(`Failed to load service ${addr}:`, e);
            }
          }),
        );

        if (!cancelled) {
          cards.sort((a, b) => a.name.localeCompare(b.name));
          setRegistries(cards);
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to load services from factory contract:", e);
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

  const verifiedRegistries = registries.filter((r) => r.verified);
  const availableRegistries = registries.filter((r) => !r.verified);
  const rpcUrl = getRpcUrl();
  const serviceChainId = process.env.NEXT_PUBLIC_CHAIN_ID || "31337";
  const currentChainName = getChainName(serviceChainId);

  /* ---------- not connected ---------- */
  if (!account) {
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
              <LayoutGrid className="w-6 h-6 text-secondary" />
            </div>
            <h1 className="text-3xl font-headline font-bold tracking-tight text-primary">
              Explore Services
            </h1>
          </div>
          <p className="text-on-surface-variant text-sm max-w-2xl">
            Grant your wallet the trust that services require. Each service defines its own trust level
            — from basic identity verification to full regulatory compliance. Choose a service and prove your qualifications with zero privacy exposure.
          </p>
          <DeployedOnInfo chainName={currentChainName} chainId={serviceChainId} rpcUrl={rpcUrl} walletChainId={chainId || undefined} />
        </motion.header>

        {/* Connect prompt */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-panel rounded-2xl p-6 mb-8 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <Wallet className="w-5 h-5 text-on-surface-variant" />
            <p className="text-on-surface-variant text-sm">
              Connect your wallet to see your verification status for each
              service.
            </p>
          </div>
          <button
            onClick={connect}
            className="px-6 py-2 bg-primary text-surface font-headline font-bold text-sm rounded-full hover:scale-105 active:scale-95 transition-all shrink-0"
          >
            Connect
          </button>
        </motion.div>

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

        {/* Empty */}
        {!loading && !error && registries.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel rounded-3xl p-12 text-center max-w-lg mx-auto"
          >
            <Shield className="w-12 h-12 text-on-surface-variant mx-auto mb-4" />
            <h2 className="text-xl font-headline font-bold text-on-surface mb-2">
              No services available
            </h2>
            <p className="text-on-surface-variant">
              No services have been deployed on this network yet.
            </p>
          </motion.div>
        )}

        {/* All as "Available Services" */}
        {!loading && !error && registries.length > 0 && (
          <RegistrySection
            title="Available Services"
            registries={registries}
            walletConnected={false}
          />
        )}
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
            <LayoutGrid className="w-6 h-6 text-secondary" />
          </div>
          <h1 className="text-3xl font-headline font-bold tracking-tight text-primary">
            Explore Services
          </h1>
        </div>
        <p className="text-on-surface-variant text-sm max-w-2xl">
          Grant your wallet the trust that services require. Each service defines its own trust level
          — from basic identity verification to full regulatory compliance.
        </p>
        <DeployedOnInfo chainName={currentChainName} chainId={serviceChainId} rpcUrl={rpcUrl} walletChainId={chainId || undefined} />
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

      {/* Empty */}
      {!loading && !error && registries.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-12 text-center max-w-lg mx-auto"
        >
          <Shield className="w-12 h-12 text-on-surface-variant mx-auto mb-4" />
          <h2 className="text-xl font-headline font-bold text-on-surface mb-2">
            No services available
          </h2>
          <p className="text-on-surface-variant">
            No services have been deployed on this network yet.
          </p>
        </motion.div>
      )}

      {/* Service cards — verified first */}
      {!loading && !error && registries.length > 0 && (
        <>
          {verifiedRegistries.length > 0 && (
            <RegistrySection
              title="✓ Trusted — Your Wallet is Verified"
              registries={verifiedRegistries}
              walletConnected={true}
            />
          )}

          {availableRegistries.length > 0 && (
            <RegistrySection
              title="Available Services"
              registries={availableRegistries}
              walletConnected={true}
              className={verifiedRegistries.length > 0 ? "mt-10" : ""}
            />
          )}
        </>
      )}
    </main>
  );
}

/* ================================================================== */
/*  Registry Section                                                    */
/* ================================================================== */

function RegistrySection({
  title,
  registries,
  walletConnected,
  className,
}: {
  title: string;
  registries: RegistryCard[];
  walletConnected: boolean;
  className?: string;
}) {
  return (
    <section className={className}>
      <motion.h2
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className="text-sm font-headline font-bold text-on-surface-variant uppercase tracking-widest mb-4"
      >
        {title}
        <span className="ml-2 text-on-surface-variant/50">
          ({registries.length})
        </span>
      </motion.h2>

      <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
        {registries.map((reg, i) => {
          return (
            <motion.div
              key={reg.address}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i }}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className={`relative rounded-2xl p-5 transition-all group flex flex-col overflow-hidden shadow-lg hover:shadow-2xl border ${
                reg.verified
                  ? "bg-[#0e1f1a] border-secondary/25"
                  : "bg-surface-container border-outline-variant/15"
              }`}
            >
              {/* Background glow — verified only */}
              {reg.verified && (
                <div className="absolute -top-12 -right-12 w-40 h-40 bg-secondary/10 rounded-full blur-3xl group-hover:scale-150 transition-transform duration-500" />
              )}

              {/* Header: name */}
              <div className="relative flex items-center gap-2.5 mb-2">
                <h3 className="text-lg font-headline font-bold text-on-surface truncate">
                  {reg.name}
                </h3>
              </div>

              {/* Description */}
              {reg.metadata?.description && (
                <p className="relative text-on-surface-variant text-xs mb-3 line-clamp-2">
                  {reg.metadata.description}
                </p>
              )}

              {/* Stats row — card style */}
              <div className="relative grid grid-cols-3 gap-2 mb-4">
                <div className="bg-surface-container-low/60 backdrop-blur-sm rounded-xl p-2.5 text-center border border-outline-variant/5">
                  <p className="text-on-surface-variant text-[9px] uppercase tracking-wider mb-0.5">Wallets / Cert</p>
                  <p className="text-lg font-headline font-bold text-on-surface">{reg.maxWallets}</p>
                </div>
                <div className="bg-surface-container-low/60 backdrop-blur-sm rounded-xl p-2.5 text-center border border-outline-variant/5">
                  <p className="text-on-surface-variant text-[9px] uppercase tracking-wider mb-0.5">Privacy</p>
                  <p className="text-xs font-bold text-on-surface font-mono mt-1">{maskToLabels(reg.minDisclosureMask)}</p>
                </div>
                <div className="bg-surface-container-low/60 backdrop-blur-sm rounded-xl p-2.5 text-center border border-outline-variant/5">
                  <p className="text-on-surface-variant text-[9px] uppercase tracking-wider mb-0.5">Trusted CAs</p>
                  <p className="text-lg font-headline font-bold text-on-surface">{reg.caCount}</p>
                </div>
              </div>

              {/* Status + Actions */}
              <div className="relative flex items-center justify-between mt-auto pt-3 border-t border-outline-variant/10">
                {walletConnected ? (
                  reg.verified ? (
                    <span className="inline-flex items-center gap-1.5 text-secondary text-xs font-headline font-bold">
                      <ShieldCheck className="w-4 h-4" />
                      You: Verified
                      {reg.verifiedUntil && (
                        <span className="text-on-surface-variant font-normal">
                          &middot; {reg.verifiedUntil.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-on-surface-variant text-xs font-headline">
                      <Shield className="w-4 h-4" />
                      You: Not Verified
                    </span>
                  )
                ) : (
                  <span className="text-on-surface-variant text-xs">
                    Connect wallet
                  </span>
                )}

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/registry/${reg.address}?tab=info`}
                    className="px-3.5 py-1.5 text-on-surface-variant font-headline font-bold text-xs rounded-full border border-outline-variant/20 hover:bg-surface-container-highest hover:text-tertiary hover:border-tertiary/30 transition-all"
                  >
                    Info
                  </Link>
                  <Link
                    href={`/registry/${reg.address}?tab=register`}
                    className="inline-flex items-center gap-1.5 px-5 py-1.5 bg-primary text-surface font-headline font-bold text-xs rounded-full hover:scale-105 active:scale-95 transition-all shadow-md hover:shadow-lg group/btn"
                  >
                    {reg.verified ? "Details" : "Register"}
                    <ArrowRight className="w-3 h-3 group-hover/btn:translate-x-0.5 transition-transform" />
                  </Link>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}
