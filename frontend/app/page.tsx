"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import {
  Shield,
  Users,
  Building,
  Lock,
  Zap,
  Eye,
  EyeOff,
  ArrowRight,
  ShieldCheck,
  Fingerprint,
  Timer,
  FileCheck,
  Server,
  Globe,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Animation helpers                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Trust Animation Section – Step Cards                                */
/* ------------------------------------------------------------------ */

function TrustAnimationSection() {
  const steps = [
    {
      label: "Step 1",
      title: "Plain Wallet",
      content: (
        <div className="flex items-center justify-center h-24">
          <span className="font-mono text-lg md:text-xl text-tertiary bg-tertiary/10 px-4 py-2 rounded-xl border border-tertiary/20">
            0x1234...ABCD
          </span>
        </div>
      ),
    },
    {
      label: "Step 2",
      title: "Service Requirements",
      content: (
        <div className="space-y-2 py-3">
          <p className="text-xs text-on-surface-variant font-label uppercase tracking-widest mb-2">
            Requirements
          </p>
          <div className="flex items-center gap-2 text-sm text-on-surface">
            <ShieldCheck className="w-4 h-4 text-secondary shrink-0" />
            <span>1. Unique Human (Sybil)</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-on-surface">
            <Globe className="w-4 h-4 text-secondary shrink-0" />
            <span>2. Korean Citizen</span>
          </div>
        </div>
      ),
    },
    {
      label: "Step 3",
      title: "ZK Proof Generation",
      content: (
        <div className="flex flex-col items-center justify-center h-24 gap-2">
          <div className="flex items-center gap-3">
            <FileCheck className="w-5 h-5 text-tertiary" />
            <span className="text-sm text-on-surface">NPKI Certificate</span>
          </div>
          <motion.div
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="text-xs font-mono text-secondary"
          >
            Generating ZK proof...
          </motion.div>
        </div>
      ),
    },
    {
      label: "Step 4",
      title: "Trust Badges Attached",
      content: (
        <div className="space-y-3 py-2">
          <div className="font-mono text-sm text-tertiary text-center mb-2">
            0x1234...ABCD
          </div>
          <div className="flex flex-col gap-2">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-secondary/10 border border-secondary/20 rounded-full text-xs text-secondary w-fit mx-auto">
              <ShieldCheck className="w-3.5 h-3.5" />
              Unique Human verified by CA
            </span>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 bg-tertiary/10 border border-tertiary/20 rounded-full text-xs text-tertiary w-fit mx-auto">
              <Globe className="w-3.5 h-3.5" />
              KR Citizen
            </span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section className="max-w-6xl mx-auto px-8 py-24">
      <motion.div {...fadeUp} className="text-center mb-16">
        <h2 className="text-3xl md:text-4xl font-headline font-bold text-primary mb-4">
          How a Wallet Earns Trust
        </h2>
        <p className="text-on-surface-variant max-w-xl mx-auto">
          From bare address to verified participant — in four steps.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {steps.map((step, i) => (
          <motion.div
            key={i}
            {...stagger(i * 0.15)}
            className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 relative"
          >
            <span className="text-[10px] font-label font-bold uppercase tracking-widest text-tertiary mb-3 block">
              {step.label}
            </span>
            <h3 className="text-base font-headline font-bold text-primary mb-3">
              {step.title}
            </h3>
            {step.content}
          </motion.div>
        ))}
      </div>

      <motion.p
        {...stagger(0.7)}
        className="text-center text-on-surface-variant text-sm mt-10 max-w-md mx-auto"
      >
        No personal data on blockchain. Only qualifications are proven.
      </motion.p>
    </section>
  );
}

/* ================================================================== */
/*  Landing Page                                                        */
/* ================================================================== */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-surface text-on-surface font-body">
      {/* ------------------------------------------------------------ */}
      {/*  Hero Section                                                  */}
      {/* ------------------------------------------------------------ */}
      <section className="relative overflow-hidden min-h-screen flex items-center">
        {/* Animated gradient background */}
        <div className="absolute inset-0 bg-gradient-to-b from-tertiary/3 via-secondary/2 to-transparent" />
        <motion.div
          animate={{ x: [0, 60, 0], y: [0, -40, 0], scale: [1, 1.2, 1] }}
          transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-10 left-1/4 w-[500px] h-[500px] bg-tertiary/5 rounded-full blur-[150px]"
        />
        <motion.div
          animate={{ x: [0, -50, 0], y: [0, 50, 0], scale: [1, 1.3, 1] }}
          transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
          className="absolute top-40 right-1/5 w-[400px] h-[400px] bg-secondary/5 rounded-full blur-[130px]"
        />
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -60, 0] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-20 left-1/3 w-[300px] h-[300px] bg-tertiary/3 rounded-full blur-[100px]"
        />

        {/* Grid overlay */}
        <div
          className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(140,231,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(140,231,255,0.2) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        {/* Floating rings */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          className="absolute right-[10%] top-[30%] w-48 h-48 border border-tertiary/5 rounded-full pointer-events-none"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 45, repeat: Infinity, ease: "linear" }}
          className="absolute left-[15%] bottom-[25%] w-32 h-32 border border-secondary/5 rounded-full pointer-events-none"
        />

        <div className="relative max-w-5xl mx-auto px-8 py-20 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-surface-container rounded-full border border-outline-variant/20 mb-8">
              <div className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
              <span className="text-xs font-label text-on-surface-variant uppercase tracking-widest">
                Trust Provider Protocol
              </span>
            </div>

            <h1 className="text-4xl md:text-6xl lg:text-7xl font-headline font-bold tracking-tighter text-primary leading-[1.05] mb-8 max-w-4xl mx-auto">
              Bridging{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-tertiary to-secondary">
                Institutional Trust
              </span>{" "}
              On-chain — Privately.
            </h1>

            <p className="text-base md:text-lg text-on-surface-variant max-w-2xl mx-auto leading-relaxed mb-12">
              From DeFi compliance to DAO&apos;s one-person-one-vote. Leverage
              existing X.509 certificates (e.g. government eID, corporate PKI, TLS) to prove on-chain trust —
              with zero privacy exposure.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/dashboard"
                className="px-10 py-4 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 text-lg"
              >
                Launch Platform <ArrowRight className="w-5 h-5" />
              </Link>
              <Link
                href="/create"
                className="px-10 py-4 border border-outline-variant/30 text-on-surface font-headline rounded-full hover:bg-surface-container-highest transition-all text-lg"
              >
                Create Auth Policy
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/*  Trust Animation Section                                       */}
      {/* ------------------------------------------------------------ */}
      <TrustAnimationSection />

      {/* ------------------------------------------------------------ */}
      {/*  Use Cases Section                                             */}
      {/* ------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-8 py-24">
        <motion.div {...fadeUp} className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-headline font-bold text-primary mb-4">
            Customizable Trust Infrastructure for Every Service
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: Shield,
              title: "DeFi / RWA",
              subtitle: "Regulatory Compliance",
              requirement:
                "Only users with financial institution certificates",
              solution:
                "Proves first-class CA verification while keeping identity anonymous",
              color: "tertiary",
            },
            {
              icon: Users,
              title: "DAO / Voting",
              subtitle: "Sybil Resistance",
              requirement:
                "One person, one account — prevent multi-wallet voting",
              solution:
                "Generates unique nullifiers from trusted certificates to block bots",
              color: "secondary",
            },
            {
              icon: Building,
              title: "B2B / Private Network",
              subtitle: "Membership Proof",
              requirement: "Only employees or partners can access",
              solution:
                "Proves ownership of private CA certificate on-chain",
              color: "tertiary",
            },
          ].map((card, i) => (
            <motion.div
              key={i}
              {...stagger(i * 0.15)}
              className="glass-panel rounded-3xl p-8 relative group"
            >
              <div
                className={`p-3 bg-${card.color}/10 rounded-xl w-fit mb-6`}
              >
                <card.icon className={`w-6 h-6 text-${card.color}`} />
              </div>
              <h3 className="text-xl font-headline font-bold text-primary mb-1">
                {card.title}
              </h3>
              <p className="text-xs font-label uppercase tracking-widest text-on-surface-variant mb-4">
                {card.subtitle}
              </p>
              <div className="space-y-3 text-sm">
                <div>
                  <span className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant block mb-1">
                    Requirement
                  </span>
                  <p className="text-on-surface">{card.requirement}</p>
                </div>
                <div>
                  <span className="text-[10px] font-label uppercase tracking-widest text-tertiary block mb-1">
                    zk-X509
                  </span>
                  <p className="text-on-surface-variant">{card.solution}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/*  Technical Trust Section                                       */}
      {/* ------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-8 py-24">
        <motion.div {...fadeUp} className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-headline font-bold text-primary mb-4">
            Why You Can Trust the Math
          </h2>
          <p className="text-on-surface-variant max-w-xl mx-auto">
            Not an Identity Provider — a{" "}
            <span className="text-tertiary font-bold">Trust Provider</span>.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[
            {
              icon: EyeOff,
              title: "Zero-Knowledge Proof",
              desc: "Certificate verified inside sealed ZK circuit. No personal data ever touches the blockchain.",
            },
            {
              icon: Fingerprint,
              title: "Cross-Service Unlinkability",
              desc: "Different services = different nullifiers = untraceable. Your identity cannot be correlated across services.",
            },
            {
              icon: Server,
              title: "No Central Server",
              desc: "Proofs generated locally on your machine, verified on-chain by smart contracts. No intermediary.",
            },
            {
              icon: Timer,
              title: "Auto-Expiry",
              desc: "Identity follows certificate lifecycle. Verification automatically lapses when the certificate expires.",
            },
            {
              icon: Lock,
              title: "Formal Security",
              desc: "Security reduced to RSA/ECDSA hardness + ZK soundness. Mathematically proven, not trust-based.",
            },
            {
              icon: Zap,
              title: "Front-running Immune",
              desc: "Proofs are cryptographically bound to a specific wallet address. Intercepted proofs are useless to attackers.",
            },
          ].map((item, i) => (
            <motion.div
              key={i}
              {...stagger(i * 0.1)}
              className="bg-surface-container rounded-2xl p-6 border border-outline-variant/10 hover:border-outline-variant/30 transition-all group"
            >
              <item.icon className="w-5 h-5 text-tertiary mb-4 group-hover:text-secondary transition-colors" />
              <h3 className="text-lg font-headline font-bold text-primary mb-2">
                {item.title}
              </h3>
              <p className="text-on-surface-variant text-sm leading-relaxed">
                {item.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/*  Platform Stats                                                */}
      {/* ------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-8 py-16">
        <motion.div
          {...fadeUp}
          className="glass-panel rounded-3xl p-10 md:p-14"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
            {[
              {
                value: "4B+",
                label: "X.509 certificates worldwide",
                color: "tertiary",
              },
              {
                value: "~300K",
                label: "Gas per verification",
                color: "secondary",
              },
              {
                value: "~$0.08",
                label: "Per verification on L2",
                color: "tertiary",
              },
            ].map((stat, i) => (
              <motion.div key={i} {...stagger(i * 0.15)}>
                <div
                  className={`text-4xl md:text-5xl font-headline font-bold text-${stat.color} mb-2`}
                >
                  {stat.value}
                </div>
                <div className="text-xs font-label uppercase tracking-widest text-on-surface-variant">
                  {stat.label}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/*  CTA Footer Section                                            */}
      {/* ------------------------------------------------------------ */}
      <section className="max-w-6xl mx-auto px-8 py-24">
        <motion.div {...fadeUp} className="text-center">
          <h2 className="text-3xl md:text-4xl font-headline font-bold text-primary mb-6">
            Ready to add trust to your service?
          </h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/create"
              className="px-10 py-4 bg-primary text-surface font-headline font-bold rounded-full hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-2 text-lg"
            >
              Create Auth Policy <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/faq"
              className="px-10 py-4 border border-outline-variant/30 text-on-surface font-headline rounded-full hover:bg-surface-container-highest transition-all text-lg"
            >
              Read Documentation
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/*  Footer                                                        */}
      {/* ------------------------------------------------------------ */}
      <footer className="max-w-6xl mx-auto px-8 py-12 border-t border-outline-variant/10 flex flex-col md:flex-row justify-between items-center gap-4 text-on-surface-variant">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-tertiary" />
          <span className="text-sm font-label">
            Developed by Tokamak Network
          </span>
        </div>
        <div className="flex gap-8 text-[10px] font-label uppercase tracking-widest">
          <Link
            href="/faq"
            className="hover:text-primary transition-colors"
          >
            FAQ
          </Link>
          <Link
            href="/admin"
            className="hover:text-primary transition-colors"
          >
            Admin
          </Link>
          <a
            href="https://github.com/tokamak-network/zk-X509"
            className="hover:text-primary transition-colors"
          >
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
