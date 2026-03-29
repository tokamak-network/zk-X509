"use client";

import React, { useState, useEffect } from "react";
import { Loader2, Check, X, ExternalLink } from "lucide-react";
import { ethers } from "ethers";
import { createCaRegistryPr, getGitHubUser, type CaRegistryFiles } from "@/lib/github";
import { type CaGuide } from "@/lib/platform";

type Step = "tx" | "tx-done" | "sign" | "git" | "done" | "error" | "partial";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Operation type */
  operation: "add-ca" | "remove-ca" | "update";
  /** Chain ID */
  chainId: string;
  /** Registry address */
  registryAddress: string;
  /** Admin address */
  adminAddress: string;
  /** Service name */
  serviceName: string;
  /** Execute the on-chain transaction. Return TX hash. Null if no on-chain TX needed. */
  executeTx: (() => Promise<string | null>) | null;
  /** CA entries to commit to Git */
  certs: Array<{ hashHex: string; derBase64: string; guide: CaGuide }>;
  /** Existing service.json cas (for merging) */
  existingCas: Record<string, CaGuide>;
  /** GitHub PAT token */
  githubToken: string;
  /** Wallet signer for message signing */
  signer: ethers.Signer | null;
}

export default function CaRegistrationModal({
  open, onClose, operation, chainId, registryAddress,
  adminAddress, serviceName, executeTx, certs, existingCas,
  githubToken, signer,
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
        setStep("tx-done");
        // Auto-advance to sign after 1s
        setTimeout(() => { if (!cancelled) setStep("sign"); }, 1000);
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
        `Service Address: ${registryAddress.toLowerCase()}`,
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
      // Merge existing CAs with new ones (or delete for remove-ca)
      const allCas: Record<string, CaGuide> = { ...existingCas };
      if (operation === "add-ca" || operation === "update") {
        for (const cert of certs) {
          allCas[cert.hashHex] = cert.guide;
        }
      } else if (operation === "remove-ca") {
        for (const cert of certs) {
          delete allCas[cert.hashHex];
        }
      }

      // Build service.json — preserve existing metadata on update
      const today = new Date().toISOString().split("T")[0];
      const isNew = Object.keys(existingCas).length === 0;
      const serviceJson = JSON.stringify({
        name: serviceName || "Unnamed Service",
        description: "",
        admin: adminAddress.toLowerCase(),
        created_at: isNew ? today : undefined, // omit on update (keeps existing)
        updated_at: today,
        cas: allCas,
      }, null, 2);

      // Build signature.json
      const signatureJson = JSON.stringify({
        admin: adminAddress.toLowerCase(),
        operation,
        timestamp,
        signature: sig,
        chain_id: chainId,
        registry: registryAddress.toLowerCase(),
      }, null, 2);

      // Build cert map
      const certMap: Record<string, string> = {};
      for (const cert of certs) {
        certMap[cert.hashHex] = cert.derBase64;
      }

      const files: CaRegistryFiles = {
        chainId,
        registryAddress: registryAddress.toLowerCase(),
        operation,
        certs: certMap,
        serviceJson,
        signatureJson,
      };

      const caNames = certs.map((c) => c.guide.name || c.hashHex.slice(0, 16)).join(", ");
      const prTitle = operation === "add-ca"
        ? `Add CA: ${caNames} for ${serviceName || registryAddress.slice(0, 10)}`
        : operation === "remove-ca"
          ? `Remove CA: ${caNames}`
          : `Update CA guide: ${caNames}`;

      const prBody = [
        `## ${operation === "add-ca" ? "Add" : operation === "remove-ca" ? "Remove" : "Update"} CA`,
        "",
        `- **Service**: \`${registryAddress}\``,
        `- **Chain ID**: ${chainId}`,
        `- **Admin**: \`${adminAddress}\``,
        "",
        "### CA Certificates",
        ...certs.map((c) => `- \`${c.hashHex.slice(0, 20)}...\` — ${c.guide.name}`),
        "",
        `Signed by admin at timestamp ${timestamp}.`,
      ].join("\n");

      const result = await createCaRegistryPr(githubToken, files, prTitle, prBody);
      setPrUrl(result.prUrl);
      setStep("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to create PR");
      setStep("error");
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
          </h3>
          {canClose && (
            <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Steps */}
        <div className="space-y-3">
          {/* Step 1: On-chain TX */}
          {executeTx && (
            <StepRow
              label="On-chain transaction"
              status={step === "tx" ? "pending" : step === "error" && !txHash ? "error" : "done"}
              detail={txHash ? `TX: ${txHash.slice(0, 16)}...` : step === "tx" ? "Please confirm in your wallet" : ""}
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
              className="w-full bg-primary text-on-primary py-2.5 rounded-xl font-label font-bold text-sm hover:opacity-90 transition-all"
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
              onClick={onClose}
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
              onClick={onClose}
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
