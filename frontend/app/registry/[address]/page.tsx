"use client";

import { useState, useEffect, Suspense, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { ethers } from "ethers";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  ShieldCheck,
  Settings,
  Users,
  ArrowLeft,
  Loader2,
  Lock,
  Unlock,
  Database,
  Fingerprint,
  Globe,
  Megaphone,
  BookOpen,
  ExternalLink,
  Tag,
  Info,
} from "lucide-react";
import { IDENTITY_REGISTRY_ABI, REGISTRY_FACTORY_ABI, getRpcUrl, getFactoryAddress } from "@/lib/contract";
import { truncateHex } from "@/lib/utils";
import {
  getRegistryMetadata,
  getAnnouncements,
  getCaGuides,
  type RegistryMetadata,
  type Announcement,
  type CaGuide,
} from "@/lib/platform";
import { useWallet } from "@/lib/wallet";
import DashboardContent from "@/components/DashboardContent";
import AdminContent from "@/components/AdminContent";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface RegistryInfo {
  name: string;
  owner: string;
  maxWallets: number;
  minDisclosureMask: number;
  caCount: number;
  paused: boolean;
}

type PageTab = "register" | "manage" | "info";

const DISCLOSURE_LABELS = ["Country", "Organization", "Org Unit", "Common Name"] as const;

function decodeMask(mask: number): string[] {
  const fields: string[] = [];
  for (let i = 0; i < DISCLOSURE_LABELS.length; i++) {
    if (mask & (1 << i)) fields.push(DISCLOSURE_LABELS[i]);
  }
  return fields;
}

/* ================================================================== */
/*  Registry Detail Page                                               */
/* ================================================================== */

export default function RegistryDetailPage() {
  return (
    <Suspense fallback={
      <main className="max-w-6xl mx-auto pt-24 px-8 pb-12 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
          <p className="text-on-surface-variant text-sm">Loading service...</p>
        </div>
      </main>
    }>
      <RegistryDetailContent />
    </Suspense>
  );
}

function RegistryDetailContent() {
  const params = useParams<{ address: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const address = params.address;
  const { isOwner } = useWallet();

  const validTabs: PageTab[] = ["register", "manage", "info"];
  const raw = searchParams.get("tab");
  const activeTab: PageTab = raw && validTabs.includes(raw as PageTab) ? (raw as PageTab) : "register";

  const setActiveTab = useCallback(
    (tab: PageTab) => {
      router.replace(`/registry/${address}?tab=${tab}`, { scroll: false });
    },
    [router, address],
  );

  const [info, setInfo] = useState<RegistryInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Platform backend data
  const [metadata, setMetadata] = useState<RegistryMetadata | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [caGuides, setCaGuides] = useState<Record<string, CaGuide>>({});
  const [caLeaves, setCaLeaves] = useState<string[]>([]);

  useEffect(() => {
    if (!address || !ethers.isAddress(address)) {
      setError("Invalid service address.");
      setLoading(false);
      return;
    }

    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(getRpcUrl());
        const contract = new ethers.Contract(address, IDENTITY_REGISTRY_ABI, provider);

        const [owner, maxWallets, caCount, paused] = await Promise.all([
          contract.owner(),
          contract.MAX_WALLETS_PER_CERT(),
          contract.getCaCount(),
          contract.paused(),
        ]);

        // Fetch chain ID and service name from factory
        let serviceName = "";
        const { chainId: cid } = await provider.getNetwork();
        const detectedChainId = cid.toString();
        try {
          const factoryAddr = getFactoryAddress(detectedChainId);
          if (factoryAddr) {
            const factory = new ethers.Contract(factoryAddr, REGISTRY_FACTORY_ABI, provider);
            const fInfo = await factory.registryInfo(address);
            serviceName = fInfo.name ?? fInfo[1] ?? "";
          }
        } catch {
          // factory may not be available
        }

        // Try to read MIN_DISCLOSURE_MASK (may not exist on older contracts)
        let minDisclosureMask = 0;
        try {
          minDisclosureMask = Number(await contract.MIN_DISCLOSURE_MASK());
        } catch {
          // not available on this contract version
        }

        // Fetch on-chain CA leaves
        try {
          const leaves: string[] = await contract.getCaLeaves();
          setCaLeaves(leaves);
        } catch {
          // getCaLeaves may not be available
        }

        setInfo({
          name: serviceName,
          owner,
          maxWallets: Number(maxWallets),
          minDisclosureMask,
          caCount: Number(caCount),
          paused,
        });

        // Load off-chain platform data (non-blocking)
        const [meta, anncs, guides] = await Promise.all([
          getRegistryMetadata(address),
          getAnnouncements(address),
          getCaGuides(detectedChainId, address),
        ]);
        if (meta) setMetadata(meta);
        setAnnouncements(anncs);
        setCaGuides(guides);
      } catch (e) {
        console.error("Failed to load service:", e);
        setError("Failed to load service data. Check that the address is valid and the RPC is reachable.");
      } finally {
        setLoading(false);
      }
    })();
  }, [address]);

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <main className="max-w-6xl mx-auto pt-24 px-8 pb-12 flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
        >
          <Loader2 className="w-8 h-8 text-tertiary animate-spin" />
          <p className="text-on-surface-variant text-sm">Loading service...</p>
        </motion.div>
      </main>
    );
  }

  /* ---------- Error ---------- */
  if (error || !info) {
    return (
      <main className="max-w-6xl mx-auto pt-24 px-8 pb-12 flex items-center justify-center min-h-[60vh]">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel rounded-3xl p-12 text-center max-w-md"
        >
          <ShieldCheck className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-headline font-bold text-on-surface mb-2">
            Service Not Found
          </h2>
          <p className="text-on-surface-variant mb-6">{error || "Unknown error"}</p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-tertiary hover:text-primary transition-colors font-headline text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Explore
          </Link>
        </motion.div>
      </main>
    );
  }

  const disclosureFields = decodeMask(info.minDisclosureMask);

  /* ---------- Tab definitions ---------- */
  const tabs: { key: PageTab; label: string; icon: React.ReactNode; ownerOnly?: boolean }[] = [
    { key: "register", label: "Register", icon: <Users className="w-4 h-4" /> },
    { key: "manage", label: "Manage", icon: <Settings className="w-4 h-4" />, ownerOnly: true },
    { key: "info", label: "Info", icon: <Info className="w-4 h-4" /> },
  ];

  const visibleTabs = tabs.filter((t) => !t.ownerOnly || isOwner);

  // If active tab is "manage" but user is not owner, fall back to "register"
  const effectiveTab = activeTab === "manage" && !isOwner ? "register" : activeTab;

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <main className="max-w-6xl mx-auto pt-24 px-8 pb-12">
      {/* Compact Header */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="mb-4"
      >
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-on-surface-variant hover:text-on-surface transition-colors font-headline text-sm mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Explore
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-headline font-bold tracking-tight text-primary">
            {info.name || "Service"}
          </h1>
          {metadata?.category && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-label font-bold uppercase tracking-widest bg-tertiary/10 text-tertiary">
              {metadata.category}
            </span>
          )}
          {info.paused && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/20 text-red-400">
              PAUSED
            </span>
          )}
        </div>
      </motion.div>

      {/* Tab Bar */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-6"
      >
        <div className="flex bg-surface-container-low rounded-full p-1 border border-outline-variant/20 self-start w-fit">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-6 py-2 font-headline text-sm rounded-full transition-all ${
                effectiveTab === tab.key
                  ? "bg-surface-container-highest text-primary shadow-sm"
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </motion.div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* ==================== REGISTER TAB ==================== */}
        {effectiveTab === "register" && (
          <motion.div
            key="register"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <DashboardContent />
          </motion.div>
        )}

        {/* ==================== MANAGE TAB ==================== */}
        {effectiveTab === "manage" && isOwner && (
          <motion.div
            key="manage"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            <AdminContent />
          </motion.div>
        )}

        {/* ==================== INFO TAB ==================== */}
        {effectiveTab === "info" && (
          <motion.div
            key="info"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
          >
            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="glass-panel rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-tertiary" />
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label">Max Wallets</p>
                </div>
                <p className="text-2xl font-headline font-bold text-primary">{info.maxWallets}</p>
              </div>

              <div className="glass-panel rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Fingerprint className="w-4 h-4 text-tertiary" />
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label">Disclosure</p>
                </div>
                <p className="text-sm font-headline font-bold text-primary">
                  {disclosureFields.length > 0 ? disclosureFields.join(", ") : "None required"}
                </p>
                <p className="text-xs font-mono text-on-surface-variant mt-1">
                  mask: 0x{info.minDisclosureMask.toString(16).padStart(2, "0")}
                </p>
              </div>

              <div className="glass-panel rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Database className="w-4 h-4 text-tertiary" />
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label">Trusted CAs</p>
                </div>
                <p className="text-2xl font-headline font-bold text-primary">{info.caCount}</p>
              </div>

              <div className="glass-panel rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  {info.paused ? (
                    <Lock className="w-4 h-4 text-red-400" />
                  ) : (
                    <Unlock className="w-4 h-4 text-secondary" />
                  )}
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label">Status</p>
                </div>
                <p className={`text-lg font-headline font-bold ${info.paused ? "text-red-400" : "text-secondary"}`}>
                  {info.paused ? "Paused" : "Active"}
                </p>
              </div>
            </div>

            {/* Owner */}
            <div className="glass-panel rounded-2xl p-5 mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label mb-1">Owner</p>
                  <p className="font-mono text-sm text-tertiary">{info.owner}</p>
                </div>
              </div>
            </div>

            {/* Announcements */}
            {announcements.length > 0 && (
              <div className="glass-panel rounded-2xl p-5 mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <Megaphone className="w-4 h-4 text-tertiary" />
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label">
                    Announcements
                  </p>
                </div>
                <div className="space-y-3">
                  {announcements.map((a) => (
                    <div
                      key={a.id}
                      className="bg-surface-container rounded-xl p-4 border border-white/5"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="text-sm font-headline font-bold text-primary">{a.title}</h4>
                        <span className="text-[10px] font-mono text-on-surface-variant">
                          {new Date(a.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-sm text-on-surface-variant leading-relaxed">{a.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CA Guides */}
            {caLeaves.length > 0 && (
              <div className="glass-panel rounded-2xl p-5 mb-8">
                <div className="flex items-center gap-2 mb-4">
                  <BookOpen className="w-4 h-4 text-tertiary" />
                  <p className="text-on-surface-variant text-[10px] uppercase tracking-widest font-label">
                    Trusted CA Certificates
                  </p>
                </div>
                <div className="space-y-3">
                  {caLeaves.map((hash) => {
                    const guide = caGuides[hash];
                    return (
                      <div
                        key={hash}
                        className="bg-surface-container rounded-xl p-4 border border-white/5"
                      >
                        {guide ? (
                          <>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="text-sm font-headline font-bold text-primary">
                                {guide.name}
                              </h4>
                              <Tag className="w-3 h-3 text-on-surface-variant" />
                              <span className="text-[10px] font-mono text-on-surface-variant truncate">
                                {hash.slice(0, 10)}...{hash.slice(-6)}
                              </span>
                            </div>
                            {guide.description && (
                              <p className="text-sm text-on-surface-variant mb-2">{guide.description}</p>
                            )}
                            {guide.instructions && (
                              <p className="text-xs text-on-surface-variant/80 leading-relaxed mb-2">
                                {guide.instructions}
                              </p>
                            )}
                            {guide.issue_url && (
                              <a
                                href={guide.issue_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-tertiary text-xs hover:text-primary transition-colors"
                              >
                                Get certificate <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </>
                        ) : (
                          <div>
                            <p className="text-sm font-headline font-bold text-on-surface-variant mb-1">
                              Unknown CA
                            </p>
                            <span className="text-[10px] font-mono text-on-surface-variant/60 truncate block">
                              {hash}
                            </span>
                            <p className="text-xs text-on-surface-variant/50 mt-1">
                              Contact the service admin to add CA details.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
