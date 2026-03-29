"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { ethers } from "ethers";
import Link from "next/link";
import {
  Wallet,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Plus,
  Coins,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { REGISTRY_FACTORY_ABI, getFactoryAddress, getRpcUrl } from "@/lib/contract";
import { useReadProvider } from "@/lib/useReadProvider";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type TxStatus = "idle" | "pending" | "confirming" | "success" | "error";

const DISCLOSURE_FIELDS = [
  { bit: 0, label: "Country", description: "C" },
  { bit: 1, label: "Organization", description: "O" },
  { bit: 2, label: "Org Unit", description: "OU" },
  { bit: 3, label: "Common Name", description: "CN" },
] as const;

/* ================================================================== */
/*  Create Registry Page                                               */
/* ================================================================== */

export default function CreateRegistryPage() {
  const { account, chainId } = useWallet();
  const provider = useReadProvider();

  /* ---------- fee state ---------- */
  const [feeToken, setFeeToken] = useState<string>("0x0000000000000000000000000000000000000000");
  const [creationFee, setCreationFee] = useState<bigint>(0n);
  const [feeLoading, setFeeLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setFeeLoading(true);
      try {
        const cid = chainId || "31337";
        const factoryAddr = getFactoryAddress(cid);
        if (!factoryAddr) return;
        const factory = new ethers.Contract(factoryAddr, REGISTRY_FACTORY_ABI, provider);
        const [token, fee] = await Promise.all([
          factory.feeToken(),
          factory.registryCreationFee(),
        ]);
        setFeeToken(token);
        setCreationFee(BigInt(fee));
      } catch (e) {
        console.error("Failed to load fee config:", e);
      } finally {
        setFeeLoading(false);
      }
    })();
  }, [chainId, provider]);

  const isNativeFee = feeToken === "0x0000000000000000000000000000000000000000" || feeToken === ethers.ZeroAddress;
  const feeDisplay = creationFee > 0n
    ? `${ethers.formatEther(creationFee)} ${isNativeFee ? "ETH" : "Token"}`
    : "Free";

  /* ---------- form state ---------- */
  const [name, setName] = useState("");
  const [maxWalletsOption, setMaxWalletsOption] = useState<"1" | "3" | "custom">("1");
  const [customMaxWallets, setCustomMaxWallets] = useState("");
  const [disclosureBits, setDisclosureBits] = useState<boolean[]>([false, false, false, false]);

  /* ---------- tx state ---------- */
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [newRegistryAddress, setNewRegistryAddress] = useState<string | null>(null);

  /* ---------- derived ---------- */
  const maxWallets =
    maxWalletsOption === "custom"
      ? parseInt(customMaxWallets, 10) || 0
      : parseInt(maxWalletsOption, 10);

  const minDisclosureMask = disclosureBits.reduce(
    (mask, checked, i) => (checked ? mask | (1 << i) : mask),
    0,
  );

  const canDeploy =
    name.trim().length > 0 &&
    maxWallets > 0 &&
    maxWallets <= 4294967295 &&
    txStatus !== "pending" &&
    txStatus !== "confirming";

  /* ---------- deploy ---------- */
  async function handleDeploy() {
    if (!window.ethereum || !chainId || !canDeploy) return;

    setTxStatus("pending");
    setTxHash(null);
    setTxError(null);
    setNewRegistryAddress(null);

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const factoryAddr = getFactoryAddress(chainId);

      if (!factoryAddr) {
        setTxStatus("error");
        setTxError("Factory address not configured for this network.");
        return;
      }

      const factory = new ethers.Contract(factoryAddr, REGISTRY_FACTORY_ABI, signer);
      const maxProofAge = 3600; // 1 hour — fixed at deployment
      const txOptions: { value?: bigint } = {};
      if (creationFee > 0n && isNativeFee) {
        txOptions.value = creationFee;
      }
      const tx = await factory.createRegistry(name.trim(), maxWallets, minDisclosureMask, maxProofAge, txOptions);

      setTxStatus("confirming");
      setTxHash(tx.hash);

      const receipt = await tx.wait();

      // Parse RegistryCreated event to get the new registry address
      const iface = new ethers.Interface(REGISTRY_FACTORY_ABI);
      let registryAddress: string | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === "RegistryCreated") {
            registryAddress = parsed.args.registry;
            break;
          }
        } catch {
          // not our event, skip
        }
      }

      setNewRegistryAddress(registryAddress);
      setTxStatus("success");
    } catch (err: unknown) {
      const e = err as { code?: string | number; message?: string };
      if (e?.code === "ACTION_REJECTED" || e?.code === 4001) {
        setTxStatus("idle");
        return;
      }
      setTxStatus("error");
      setTxError(e?.message ?? "Transaction failed");
    }
  }

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
          <p className="text-on-surface-variant">
            Connect your wallet to create a verification policy.
          </p>
        </motion.div>
      </main>
    );
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <main className="max-w-3xl mx-auto pt-24 px-8 pb-12">
      <motion.header
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-tertiary/10 rounded-xl">
            <Plus className="w-6 h-6 text-tertiary" />
          </div>
          <h1 className="text-3xl font-headline font-bold tracking-tight text-primary">
            Create Auth Policy
          </h1>
        </div>
        <p className="text-on-surface-variant text-sm">
          Define which certificates your service accepts and how users authenticate on-chain.
        </p>
      </motion.header>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass-panel rounded-2xl p-6 space-y-6"
      >
        {/* Service Name */}
        <div className="space-y-2">
          <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest px-1">
            Service Name
          </label>
          <input
            type="text"
            className="w-full bg-surface-container-low border border-outline-variant/20 rounded-xl p-4 font-body text-sm text-on-surface focus:ring-2 focus:ring-tertiary/20 focus:border-tertiary/40 transition-all outline-none"
            placeholder="e.g., My Company Identity"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Max Wallets */}
        <div className="space-y-3">
          <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest px-1">
            Max Wallets per Certificate
          </label>
          <div className="flex flex-wrap gap-3">
            {(["1", "3", "custom"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setMaxWalletsOption(option)}
                className={`px-6 py-3 rounded-xl font-headline text-sm transition-all ${
                  maxWalletsOption === option
                    ? "bg-tertiary/15 text-tertiary border border-tertiary/30"
                    : "bg-surface-container-low border border-outline-variant/20 text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {option === "custom" ? "Custom" : option}
              </button>
            ))}
          </div>
          {maxWalletsOption === "custom" && (
            <input
              type="number"
              min="1"
              className="w-40 bg-surface-container-low border border-outline-variant/20 rounded-xl p-3 font-mono text-sm text-on-surface focus:ring-2 focus:ring-tertiary/20 focus:border-tertiary/40 transition-all outline-none"
              placeholder="Enter number"
              value={customMaxWallets}
              onChange={(e) => setCustomMaxWallets(e.target.value)}
            />
          )}
        </div>

        {/* Required Disclosure */}
        <div className="space-y-3">
          <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest px-1">
            Required Disclosure Fields
          </label>
          <p className="text-on-surface-variant text-xs px-1">
            Users must reveal these certificate fields when registering.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {DISCLOSURE_FIELDS.map((field, i) => (
              <button
                key={field.bit}
                onClick={() => {
                  const next = [...disclosureBits];
                  next[i] = !next[i];
                  setDisclosureBits(next);
                }}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  disclosureBits[i]
                    ? "bg-secondary/10 border border-secondary/30 text-secondary"
                    : "bg-surface-container-low border border-outline-variant/20 text-on-surface-variant hover:text-on-surface"
                }`}
              >
                <div
                  className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                    disclosureBits[i]
                      ? "bg-secondary border-secondary"
                      : "border-outline-variant/40"
                  }`}
                >
                  {disclosureBits[i] && (
                    <svg className="w-3 h-3 text-surface" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
                <div className="text-left">
                  <span className="text-sm font-headline">{field.label}</span>
                  <span className="text-xs text-on-surface-variant ml-2 font-mono">({field.description})</span>
                </div>
              </button>
            ))}
          </div>
          <p className="text-on-surface-variant text-xs px-1 font-mono">
            Disclosure mask: 0x{minDisclosureMask.toString(16).padStart(2, "0")} ({minDisclosureMask.toString(2).padStart(4, "0")}b)
          </p>
        </div>

        {/* Summary */}
        <div className="bg-surface-container-low/50 rounded-xl p-4 space-y-2 border border-outline-variant/10">
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-label">Deploy Summary</p>
          {creationFee > 0n && (
            <div className="flex items-center gap-2 p-3 bg-tertiary/5 border border-tertiary/20 rounded-lg mb-2">
              <Coins className="w-4 h-4 text-tertiary shrink-0" />
              <p className="text-sm text-tertiary font-headline font-bold">
                Creation Fee: {feeDisplay}
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-on-surface-variant text-xs">Name</p>
              <p className="text-on-surface text-sm font-headline font-bold truncate">{name || "--"}</p>
            </div>
            <div>
              <p className="text-on-surface-variant text-xs">Max Wallets</p>
              <p className="text-on-surface text-sm font-headline font-bold">{maxWallets || "--"}</p>
            </div>
            <div>
              <p className="text-on-surface-variant text-xs">Disclosure</p>
              <p className="text-on-surface text-sm font-mono">
                {disclosureBits.some(Boolean)
                  ? DISCLOSURE_FIELDS.filter((_, i) => disclosureBits[i]).map((f) => f.description).join(", ")
                  : "None"}
              </p>
            </div>
          </div>
        </div>

        {/* Transaction status */}
        {txStatus !== "idle" && (
          <div
            className={`rounded-xl p-4 flex items-start gap-3 ${
              txStatus === "success"
                ? "bg-secondary/10 text-secondary"
                : txStatus === "error"
                ? "bg-red-500/10 text-red-400"
                : "bg-tertiary/10 text-tertiary"
            }`}
          >
            {(txStatus === "pending" || txStatus === "confirming") && (
              <Loader2 className="w-5 h-5 animate-spin shrink-0 mt-0.5" />
            )}
            {txStatus === "success" && (
              <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            {txStatus === "error" && (
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="font-headline font-bold text-sm">
                {txStatus === "pending" && "Waiting for wallet confirmation..."}
                {txStatus === "confirming" && "Transaction submitted. Waiting for confirmation..."}
                {txStatus === "success" && "Service deployed successfully!"}
                {txStatus === "error" && "Transaction failed"}
              </p>
              {txHash && (
                <p className="font-mono text-xs mt-1 break-all opacity-80">
                  TX: {txHash}
                </p>
              )}
              {txError && (
                <p className="text-xs mt-1 break-all opacity-80">{txError}</p>
              )}
              {txStatus === "success" && newRegistryAddress && (
                <div className="mt-3">
                  <p className="font-mono text-xs break-all">
                    Address: {newRegistryAddress}
                  </p>
                  <Link
                    href={`/registry/${newRegistryAddress}`}
                    className="inline-flex items-center gap-2 mt-2 px-4 py-2 bg-secondary/20 text-secondary font-headline text-sm rounded-full hover:bg-secondary/30 transition-all"
                  >
                    View Service <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Deploy button */}
        <div className="flex items-center justify-end gap-4 pt-2">
          <Link
            href="/"
            className="px-6 py-3 text-on-surface-variant font-headline text-sm hover:text-on-surface transition-colors"
          >
            Cancel
          </Link>
          <button
            disabled={!canDeploy}
            onClick={handleDeploy}
            className="px-10 py-4 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
          >
            {txStatus === "pending" || txStatus === "confirming" ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Deploying...
              </>
            ) : (
              <>
                Deploy Auth Policy <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </motion.div>
    </main>
  );
}
