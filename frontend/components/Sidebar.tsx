"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Fingerprint,
  Network,
  ShieldCheck,
  History,
  HelpCircle,
  LifeBuoy,
  Cpu,
  Database,
  Brain,
  Shield,
  UserCog,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

interface NavItem {
  icon: LucideIcon;
  label: string;
  href?: string;
}

const dashboardItems: NavItem[] = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
  { icon: Fingerprint, label: "Identity Vault" },
  { icon: Network, label: "Merkle Proofs" },
  { icon: ShieldCheck, label: "Admin Console", href: "/admin" },
  { icon: History, label: "Audit Logs" },
];

const faqItems: NavItem[] = [
  { icon: Cpu, label: "System Overview", href: "/faq" },
  { icon: ShieldCheck, label: "Certificate & CA" },
  { icon: Database, label: "Service" },
  { icon: Brain, label: "Proof Generation" },
  { icon: Shield, label: "Security" },
  { icon: UserCog, label: "Admin" },
];

export function Sidebar() {
  const pathname = usePathname();

  // 랜딩 페이지에서는 사이드바 숨김
  if (pathname === "/") return null;

  const isFaq = pathname === "/faq";
  const items = isFaq ? faqItems : dashboardItems;

  const isItemActive = (item: NavItem) => {
    if (item.href) return pathname === item.href;
    return false;
  };

  return (
    <aside className="fixed left-0 top-20 h-[calc(100vh-5rem)] w-64 bg-surface-container-low flex-col py-8 border-r border-outline-variant/20 hidden md:flex z-40">
      <div className="px-6 mb-8 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(107,255,143,0.5)]" />
        <div>
          <p className="text-slate-50 font-bold font-headline text-lg">Core Nodes</p>
          <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-widest">
            Mainnet Beta Active
          </p>
        </div>
      </div>

      {isFaq && (
        <div className="px-6 mb-4 text-[10px] uppercase tracking-widest text-on-surface-variant/50 font-bold">
          Categories
        </div>
      )}

      <nav className="flex-1 space-y-1">
        {items.map((item) => {
          const active = isItemActive(item);
          const Component = item.href ? Link : "a";
          return (
            <Component
              key={item.label}
              href={item.href || "#"}
              className={cn(
                "flex items-center gap-3 py-3 px-6 font-headline text-sm font-medium transition-all",
                active
                  ? "bg-surface-container text-tertiary border-l-4 border-tertiary"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Component>
          );
        })}
      </nav>

      <div className="px-6 mt-auto space-y-4">
        {!isFaq && (
          <button className="w-full py-3 bg-tertiary text-surface font-headline font-bold rounded-xl shadow-lg shadow-tertiary/10 transition-transform active:scale-95">
            Issue New Proof
          </button>
        )}
        <div className="pt-4 border-t border-outline-variant/20 flex flex-col gap-2">
          <Link
            href="/faq"
            className="flex items-center gap-3 text-on-surface-variant hover:text-on-surface text-xs font-label"
          >
            <HelpCircle className="w-4 h-4" /> Documentation
          </Link>
          <a
            href="#"
            className="flex items-center gap-3 text-on-surface-variant hover:text-on-surface text-xs font-label"
          >
            {isFaq ? (
              <MessageSquare className="w-4 h-4" />
            ) : (
              <LifeBuoy className="w-4 h-4" />
            )}{" "}
            Support
          </a>
        </div>
      </div>
    </aside>
  );
}
