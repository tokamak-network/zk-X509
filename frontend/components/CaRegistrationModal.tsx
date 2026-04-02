"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Check, X, ExternalLink } from "lucide-react";
import { ethers } from "ethers";
import { createCaRegistryPrViaServer, type CaGuide } from "@/lib/platform";

type Step = "tx" | "sign" | "git" | "done" | "error" | "partial";

interface Props {
  open: boolean;
  onClose: (txSuccess: boolean) => void;
  operation: "add-ca" | "remove-ca" | "update";
  chainId: string;
  registryAddress: string;
  adminAddress: string;
  serviceName: string;
  executeTx: (() => Promise<string | null>) | null;
  certs: Array<{ hashHex: string; derBase64: string; guide: CaGuide }>;
  existingCas: Record<string, CaGuide>;
  signer: ethers.Signer | null;
}

export default function CaRegistrationModal({
  open, onClose, operation, chainId, registryAddress,
  adminAddress, serviceName, executeTx, certs, existingCas,
  signer,
}: Props) {
  const [step, setStep] = useState<Step>("tx");
  const [txHash, setTxHash] = useState("");
  const [signature, setSignature] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep(executeTx ? "tx" : "sign");
      setTxHash("");
      setSignature("");
      setPrUrl("");
      setErrorMsg("");
    }
  }, [open, executeTx]);

  // Auto-execute TX on mount
  useEffect(() => {
    if (!open || step !== "tx" || !executeTx) return;
    let cancelled = false;

    (async () => {
      try {
        const hash = await executeTx();
        if (cancelled) return;
        setTxHash(hash || "");
        setStep("sign");
      } catch (e: unknown) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Transaction failed");
        setStep("error");
      }
    })();

    return () => { cancelled = true; };
  }, [open, step, executeTx]);

  const handleSign = async () => {
    if (!signer) {
      setErrorMsg("Wallet not connected");
      setStep("error");
      return;
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = [
        "zk-x509-ca-registry",
        `Chain ID: ${chainId}`,
        `Registry: ${registryAddress.toLowerCase()}`,
        `Admin: ${adminAddress.toLowerCase()}`,
        `Operation: ${operation}`,
        `Timestamp: ${timestamp}`,
      ].join("\n");

      const sig = await signer.signMessage(message);
      setSignature(sig);
      setStep("git");

      // Create PR — separate error handling so TX success is preserved
      try {
        await createPr(sig, timestamp);
      } catch (prError: unknown) {
        setErrorMsg(prError instanceof Error ? prError.message : "Failed to create PR");
        setStep(txHash ? "partial" : "error");
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Signature rejected");
      setStep("error");
    }
  };

  const createPr = async (sig: string, timestamp: number) => {
    try {
      const result = await createCaRegistryPrViaServer({
        chainId,
        registryAddress,
        adminAddress,
        serviceName,
        operation,
        certs,
        existingCas,
        signature: sig,
        signatureTimestamp: timestamp,
      });
      setPrUrl(result.prUrl);
      setStep("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to create PR");
      setStep(txHash ? "partial" : "error");
    }
  };

  if (!open) return null;

  const canClose = step === "done" || step === "error" || step === "partial";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-surface-container rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4">
        {/* Title */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-headline font-bold text-on-surface">
            {operation === "add-ca" ? "Register CA" : operation === "remove-ca" ? "Remove CA" : "Update Guide"}
            {certs.length > 1 && (
              <span className="ml-2 text-sm text-on-surface-variant font-normal">({certs.length} CAs)</span>
            )}
          </h3>
          {canClose && (
            <button onClick={() => onClose(!!txHash)} className="text-on-surface-variant hover:text-on-surface">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* CA list */}
        <div className="bg-surface-highest/50 rounded-xl p-3 space-y-1 max-h-32 overflow-y-auto">
          {certs.map((c) => (
            <div key={c.hashHex} className="flex items-center gap-2 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary shrink-0" />
              <span className="text-on-surface font-medium truncate">{c.guide?.name || "Unknown"}</span>
              <span className="text-on-surface-variant/50 font-mono text-[10px] truncate">{c.hashHex.slice(0, 14)}...</span>
            </div>
          ))}
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {/* Step 1: On-chain TX */}
          {executeTx && (
            <StepRow
              label={`On-chain ${operation === "add-ca" ? "registration" : "removal"}`}
              status={step === "tx" ? "pending" : step === "error" && !txHash ? "error" : "done"}
              detail={
                txHash ? `TX: ${txHash.slice(0, 16)}...`
                : step === "tx" ? `Please confirm ${certs.length > 1 ? `${certs.length} CAs` : "CA"} in your wallet`
                : ""
              }
            />
          )}

          {/* Step 2: Signature */}
          <StepRow
            label="Sign for Git repository"
            status={
              step === "sign" ? "active" :
              ["git", "done"].includes(step) ? "done" :
              step === "error" && !signature ? "error" : "pending"
            }
            detail={
              step === "sign"
                ? "This signature proves your admin identity"
                : signature ? `Signed ✓` : ""
            }
          />
          {step === "sign" && (
            <button
              onClick={handleSign}
              className="w-full bg-tertiary text-background py-2.5 rounded-xl font-label font-bold text-sm hover:opacity-90 transition-all"
            >
              Sign with Wallet
            </button>
          )}

          {/* Step 3: Git PR */}
          <StepRow
            label="Creating Git PR"
            status={step === "git" ? "pending" : step === "done" ? "done" : "pending"}
            detail={step === "git" ? "Uploading files..." : prUrl ? "PR created!" : ""}
          />
        </div>

        {/* Result */}
        {step === "done" && prUrl && (
          <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-4 space-y-2">
            <p className="text-sm text-green-400 font-medium">All steps completed successfully!</p>
            <a
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary text-sm hover:underline"
            >
              View PR <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {/* Partial success: TX ok, PR failed */}
        {step === "partial" && (
          <div className="bg-yellow-900/20 border border-yellow-700/30 rounded-xl p-4 space-y-2">
            <p className="text-sm text-yellow-400 font-medium">On-chain TX succeeded, but PR creation failed</p>
            <p className="text-xs text-yellow-300/80">{errorMsg}</p>
            <p className="text-xs text-on-surface-variant">You can create the PR manually later.</p>
            <button
              onClick={() => onClose(true)}
              className="bg-surface-highest text-on-surface px-4 py-1.5 rounded-lg text-xs font-bold"
            >
              Close
            </button>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 space-y-2">
            <p className="text-sm text-red-400 font-medium">Error</p>
            <p className="text-xs text-red-300/80">{errorMsg}</p>
            <button
              onClick={() => onClose(false)}
              className="bg-surface-highest text-on-surface px-4 py-1.5 rounded-lg text-xs font-bold"
            >
              Close
            </button>
          </div>
        )}

        {/* Warning */}
        {!canClose && (
          <p className="text-[10px] text-on-surface-variant/60 text-center">
            Please do not close this dialog until all steps complete.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Step Row ──────────────────────────────────

function StepRow({ label, status, detail }: {
  label: string;
  status: "pending" | "active" | "done" | "error";
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5">
        {status === "pending" && <div className="w-5 h-5 rounded-full border-2 border-outline-variant" />}
        {status === "active" && <Loader2 className="w-5 h-5 text-primary animate-spin" />}
        {status === "done" && <Check className="w-5 h-5 text-green-400" />}
        {status === "error" && <X className="w-5 h-5 text-red-400" />}
      </div>
      <div>
        <p className={`text-sm font-medium ${status === "done" ? "text-green-400" : status === "error" ? "text-red-400" : "text-on-surface"}`}>
          {label}
        </p>
        {detail && <p className="text-[10px] text-on-surface-variant">{detail}</p>}
      </div>
    </div>
  );
}
