"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Wallet, Send, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { truncateHex, isValidHex, parseContractError } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type TxStatus = "idle" | "pending" | "confirming" | "success" | "error";

/* ================================================================== */
/*  Dashboard Page                                                     */
/* ================================================================== */
export default function DashboardContent() {
  const { account, readContract, writeContract, isOwner, refresh, chainName, chainId, registryAddr, contractState } =
    useWallet();

  /* ---------- identity state ---------- */
  const [verified, setVerified] = useState<boolean | null>(null);
  const [expiryDate, setExpiryDate] = useState<Date | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);

  /* ---------- form state ---------- */
  const [mode, setMode] = useState<"register" | "reRegister">("register");
  const [proof, setProof] = useState("");
  const [publicValues, setPublicValues] = useState("");

  /* ---------- tx state ---------- */
  const [txStatus, setTxStatus] = useState<TxStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  /* ---------- fetch identity ---------- */
  const fetchIdentity = useCallback(async () => {
    if (!readContract || !account) return;
    setIdentityLoading(true);
    try {
      const [isV, until] = await Promise.all([
        readContract.isVerified(account),
        readContract.verifiedUntil(account),
      ]);
      setVerified(isV);
      const ts = Number(until);
      setExpiryDate(ts > 0 ? new Date(ts * 1000) : null);
    } catch (e) {
      console.error("Failed to fetch identity:", e);
      setVerified(null);
      setExpiryDate(null);
    } finally {
      setIdentityLoading(false);
    }
  }, [readContract, account]);

  useEffect(() => {
    fetchIdentity();
  }, [fetchIdentity]);

  /* ---------- submit proof ---------- */
  const proofValid = isValidHex(proof);
  const pubValid = isValidHex(publicValues);
  const canSubmit = proofValid && pubValid && txStatus !== "pending" && txStatus !== "confirming";

  async function handleSubmit() {
    if (!writeContract || !canSubmit) return;
    setTxStatus("pending");
    setTxHash(null);
    setTxError(null);
    try {
      const fn = writeContract.getFunction(mode);
      const tx = await fn(proof, publicValues);
      setTxStatus("confirming");
      setTxHash(tx.hash);
      await tx.wait();
      setTxStatus("success");
      refresh();
      fetchIdentity();
    } catch (e) {
      console.error("Submit failed:", e);
      setTxStatus("error");
      setTxError(parseContractError(e));
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
            Connect wallet to view dashboard
          </p>
        </motion.div>
      </main>
    );
  }

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */
  return (
    <main className="max-w-6xl mx-auto pt-0 px-8 pb-12">

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* ============================================================ */}
        {/*  Identity Card                                                */}
        {/* ============================================================ */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="md:col-span-4 glass-panel rounded-2xl p-4 flex flex-col justify-between group overflow-hidden relative"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-secondary/5 rounded-full blur-3xl -mr-12 -mt-12 group-hover:bg-secondary/10 transition-colors" />

          <div className="flex justify-between items-start mb-2">
            <div className={`p-1.5 rounded-lg ${verified ? "bg-secondary/10" : "bg-outline-variant/10"}`}>
              <ShieldCheck className={`w-5 h-5 ${verified ? "text-secondary" : "text-on-surface-variant"}`} />
            </div>
            {identityLoading ? (
              <span className="text-on-surface-variant font-label text-xs font-bold tracking-widest uppercase bg-outline-variant/10 px-3 py-1 rounded-full">
                Loading...
              </span>
            ) : verified ? (
              <span className="text-secondary font-label text-xs font-bold tracking-widest uppercase bg-secondary/10 px-3 py-1 rounded-full">
                Verified
              </span>
            ) : (
              <span className="text-on-surface-variant font-label text-xs font-bold tracking-widest uppercase bg-outline-variant/10 px-3 py-1 rounded-full">
                Not Verified
              </span>
            )}
          </div>

          <div>
            <h2 className="text-base font-headline font-bold text-on-surface mb-0.5">
              {verified ? "Identity Verified" : "Not Verified"}
            </h2>
            {verified && expiryDate ? (
              <p className="text-on-surface-variant text-xs">
                Expires:{" "}
                {expiryDate.toLocaleString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </p>
            ) : (
              <p className="text-on-surface-variant text-xs">
                Submit a proof to verify your identity.
              </p>
            )}
          </div>
        </motion.div>

        {/* ============================================================ */}
        {/*  Account Metadata Card                                        */}
        {/* ============================================================ */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2 }}
          className="md:col-span-8 glass-panel rounded-2xl p-4 flex flex-col justify-between"
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-headline font-bold text-on-surface">
              Account Metadata
            </h2>
            <Wallet className="w-4 h-4 text-on-surface-variant" />
          </div>
          <div className="space-y-2">
            {/* Wallet */}
            <div className="bg-surface-container-low/50 rounded-lg p-2.5 flex items-center justify-between">
              <span className="text-on-surface-variant text-xs">Wallet</span>
              <code className="font-mono text-tertiary bg-tertiary/5 px-3 py-1 rounded border border-tertiary/10">
                {truncateHex(account)}
              </code>
            </div>
            {/* Chain / Address / Owner */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="bg-surface-container-low/50 rounded-xl p-2.5">
                <p className="text-on-surface-variant text-[10px] uppercase tracking-tighter mb-0.5">
                  Chain
                </p>
                <p className="text-base font-headline font-bold text-primary">
                  {chainName || "--"}
                </p>
              </div>
              <div className="bg-surface-container-low/50 rounded-xl p-2.5">
                <p className="text-on-surface-variant text-[10px] uppercase tracking-tighter mb-0.5">
                  Address
                </p>
                <p className="font-mono text-xs text-tertiary break-all">
                  {registryAddr ? truncateHex(registryAddr) : "--"}
                </p>
              </div>
              <div className="bg-surface-container-low/50 rounded-xl p-2.5">
                <p className="text-on-surface-variant text-[10px] uppercase tracking-tighter mb-0.5">
                  Role
                </p>
                <p className="text-base font-headline font-bold">
                  {isOwner ? (
                    <span className="text-secondary">Owner</span>
                  ) : (
                    <span className="text-on-surface-variant">User</span>
                  )}
                </p>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ============================================================ */}
        {/*  Submit New Proof                                             */}
        {/* ============================================================ */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="md:col-span-12 glass-panel rounded-2xl p-5 space-y-3"
        >
          {/* How to generate proof */}
          <details className="bg-surface-container-low/50 rounded-xl border border-outline-variant/10">
            <summary className="px-4 py-3 text-sm font-headline font-medium text-tertiary cursor-pointer hover:text-primary transition-colors">
              How to generate a proof?
            </summary>
            <div className="px-4 pb-4 text-on-surface-variant space-y-4">
              <div>
                <p className="text-sm font-headline font-medium text-primary mb-2">Step 1: Clone & Build</p>
                <pre className="bg-surface-container p-3 rounded-lg overflow-x-auto text-xs font-mono text-tertiary leading-relaxed">
{`git clone https://github.com/tokamak-network/zk-X509.git
cd zk-X509
cargo build --release --workspace`}</pre>
              </div>

              <div>
                <p className="text-sm font-headline font-medium text-primary mb-2">Step 2: Generate Groth16 Proof</p>
                <pre className="bg-surface-container p-3 rounded-lg overflow-x-auto text-xs font-mono text-tertiary leading-relaxed">
{`cargo run --release --bin evm -- --system groth16 \\
  --cert <your_cert.der> \\
  --key <your_key.key> \\
  --ca-cert <ca_pub.der> \\
  --registrant ${account} \\
  --wallet-index 0 \\
  --max-wallets ${contractState?.MAX_WALLETS_PER_CERT ?? 1} \\
  --chain-id ${chainId ?? 31337} \\
  --registry-address ${registryAddr}`}</pre>
                <p className="text-xs text-on-surface-variant mt-2 space-y-1">
                  <span className="block"><span className="text-secondary">--registrant</span> — Your MetaMask wallet address (<span className="font-mono text-tertiary">{account}</span>). The proof is bound to this address.</span>
                  <span className="block"><span className="text-secondary">--wallet-index</span> — Slot number (0–{(contractState?.MAX_WALLETS_PER_CERT ?? 1) - 1}). Use a different index to register additional wallets with the same certificate.</span>
                </p>
              </div>

              <div>
                <p className="text-sm font-headline font-medium text-primary mb-2">Step 3: Submit</p>
                <p className="text-sm">
                  Copy the <span className="text-secondary font-mono font-bold">Proof</span> and <span className="text-secondary font-mono font-bold">Public Values</span> from the output and paste into the fields below.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <a
                  href="https://github.com/tokamak-network/zk-X509/blob/main/docs/local-setup.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-headline text-tertiary hover:text-primary transition-colors flex items-center gap-1"
                >
                  Full Setup Guide &rarr;
                </a>
                <a
                  href="https://github.com/tokamak-network/zk-X509/blob/main/docs/testing-guide.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-headline text-tertiary hover:text-primary transition-colors flex items-center gap-1"
                >
                  Testing Guide &rarr;
                </a>
              </div>

              <div className="bg-tertiary/5 border border-tertiary/20 rounded-lg p-3">
                <p className="text-xs font-headline font-medium text-tertiary mb-1">Prerequisites</p>
                <p className="text-xs text-on-surface-variant">Docker must be running for Groth16 proof generation.</p>
                <p className="text-xs text-on-surface-variant mt-1">Apple Silicon (M1/M2/M3) — run this first:</p>
                <pre className="bg-surface-container p-2 rounded mt-1 text-[10px] font-mono text-tertiary overflow-x-auto">docker pull --platform linux/amd64 ghcr.io/succinctlabs/sp1-gnark:v6.0.0</pre>
              </div>
            </div>
          </details>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-headline font-bold text-on-surface">
                Submit New Proof
              </h2>
              <p className="text-on-surface-variant text-sm">
                Paste the proof and public values generated above.
              </p>
            </div>
            {/* Mode toggle */}
            <div className="flex bg-surface-container-low rounded-full p-1 border border-outline-variant/20 self-start">
              <button
                onClick={() => setMode("register")}
                className={`px-6 py-2 font-headline text-sm rounded-full transition-all ${
                  mode === "register"
                    ? "bg-surface-container-highest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-primary"
                }`}
              >
                Register
              </button>
              <button
                onClick={() => setMode("reRegister")}
                className={`px-6 py-2 font-headline text-sm rounded-full transition-all ${
                  mode === "reRegister"
                    ? "bg-surface-container-highest text-primary shadow-sm"
                    : "text-on-surface-variant hover:text-primary"
                }`}
              >
                Re-Register
              </button>
            </div>
          </div>

          {/* Inputs */}
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest px-1">
                Proof Hex Data
              </label>
              <textarea
                className={`w-full h-12 bg-surface-container-low border rounded-xl p-3 font-mono text-sm text-tertiary focus:ring-2 focus:ring-tertiary/20 focus:border-tertiary/40 transition-all outline-none resize-none ${
                  proof && !proofValid ? "border-red-500/50" : "border-outline-variant/20"
                }`}
                placeholder="0x..."
                value={proof}
                onChange={(e) => setProof(e.target.value)}
              />
              {proof && !proofValid && (
                <p className="text-red-400 text-xs px-1">
                  Must start with 0x, even hex length, minimum 4 characters.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="font-label text-[10px] text-on-surface-variant uppercase tracking-widest px-1">
                Public Values
              </label>
              <textarea
                className={`w-full h-12 bg-surface-container-low border rounded-xl p-3 font-mono text-sm text-tertiary focus:ring-2 focus:ring-tertiary/20 focus:border-tertiary/40 transition-all outline-none resize-none ${
                  publicValues && !pubValid ? "border-red-500/50" : "border-outline-variant/20"
                }`}
                placeholder="0x..."
                value={publicValues}
                onChange={(e) => setPublicValues(e.target.value)}
              />
              {publicValues && !pubValid && (
                <p className="text-red-400 text-xs px-1">
                  Must start with 0x, even hex length, minimum 4 characters.
                </p>
              )}
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
                  {txStatus === "success" && "Transaction confirmed!"}
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
              </div>
            </div>
          )}

          {/* Submit button */}
          <div className="flex items-center justify-end gap-4 pt-1">
            <button
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="px-8 py-3 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-40 disabled:pointer-events-none"
            >
              {txStatus === "pending" || txStatus === "confirming" ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  Submit Proof <Send className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="mt-20 pt-8 border-t border-outline-variant/10 flex flex-col md:flex-row justify-between items-center gap-4 text-on-surface-variant">
        <p className="text-sm font-label">Developed by Tokamak Network</p>
      </footer>
    </main>
  );
}
