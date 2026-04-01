"use client";

import { motion } from "framer-motion";
import { Monitor, Apple, ArrowDownToLine, Clock, ExternalLink } from "lucide-react";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6 },
};

const stagger = (delay: number) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.5, delay },
});

const MACOS_DOWNLOAD_URL =
  "https://github.com/tokamak-network/zk-X509/releases/latest";

export default function DownloadPage() {
  return (
    <main className="min-h-screen pt-28 pb-20 px-6">
      <div className="max-w-4xl mx-auto">
        {/* Hero */}
        <motion.div {...fadeUp} className="text-center mb-16">
          <h1 className="text-4xl md:text-5xl font-headline font-bold tracking-tight text-on-surface mb-4">
            Download ZK-X509 Prover
          </h1>
          <p className="text-on-surface-variant text-lg max-w-2xl mx-auto">
            Generate zero-knowledge proofs from your X.509 certificates locally.
            Your private key never leaves your device.
          </p>
        </motion.div>

        {/* Platform Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {/* macOS */}
          <motion.div
            {...stagger(0)}
            className="relative rounded-2xl border border-outline-variant/20 bg-surface-container p-8 flex flex-col items-center text-center"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
              <Apple className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-headline font-semibold text-on-surface mb-2">
              macOS
            </h2>
            <p className="text-on-surface-variant text-sm mb-1">
              Apple Silicon & Intel
            </p>
            <p className="text-on-surface-variant/60 text-xs mb-6">
              macOS 12 Monterey or later
            </p>
            <a
              href={MACOS_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-surface font-headline text-sm font-bold rounded-full transition-transform active:scale-95 hover:shadow-lg hover:shadow-primary/20"
            >
              <ArrowDownToLine className="w-4 h-4" />
              Download for macOS
            </a>
          </motion.div>

          {/* Windows */}
          <motion.div
            {...stagger(0.1)}
            className="relative rounded-2xl border border-outline-variant/20 bg-surface-container p-8 flex flex-col items-center text-center opacity-60"
          >
            <div className="absolute top-4 right-4 flex items-center gap-1.5 px-3 py-1 bg-tertiary/10 rounded-full">
              <Clock className="w-3 h-3 text-tertiary" />
              <span className="text-xs font-label text-tertiary">Coming Soon</span>
            </div>
            <div className="w-16 h-16 rounded-2xl bg-on-surface/5 flex items-center justify-center mb-6">
              <Monitor className="w-8 h-8 text-on-surface-variant" />
            </div>
            <h2 className="text-xl font-headline font-semibold text-on-surface mb-2">
              Windows
            </h2>
            <p className="text-on-surface-variant text-sm mb-1">
              x86_64
            </p>
            <p className="text-on-surface-variant/60 text-xs mb-6">
              Windows 10 or later
            </p>
            <span className="inline-flex items-center gap-2 px-6 py-3 bg-on-surface/10 text-on-surface-variant font-headline text-sm font-bold rounded-full cursor-not-allowed">
              <ArrowDownToLine className="w-4 h-4" />
              Not Available Yet
            </span>
          </motion.div>
        </div>

        {/* Info Section */}
        <motion.div
          {...stagger(0.2)}
          className="rounded-2xl border border-outline-variant/20 bg-surface-container p-8"
        >
          <h3 className="text-lg font-headline font-semibold text-on-surface mb-4">
            How it works
          </h3>
          <div className="space-y-4 text-sm text-on-surface-variant">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">1</span>
              </div>
              <p>
                The prover app reads your X.509 certificate from the{" "}
                <strong className="text-on-surface">macOS Keychain</strong> via Security.framework.
              </p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">2</span>
              </div>
              <p>
                A <strong className="text-on-surface">zero-knowledge proof</strong> is generated
                locally, proving certificate validity without revealing private data.
              </p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-primary">3</span>
              </div>
              <p>
                Submit the proof on-chain to{" "}
                <strong className="text-on-surface">verify your identity</strong> without exposing
                your certificate or keys.
              </p>
            </div>
          </div>
        </motion.div>

        {/* GitHub link */}
        <motion.div {...stagger(0.3)} className="text-center mt-8">
          <a
            href="https://github.com/tokamak-network/zk-X509"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View source on GitHub
          </a>
        </motion.div>
      </div>
    </main>
  );
}
