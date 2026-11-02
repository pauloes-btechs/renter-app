import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/engine/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <As className={cx("rounded-2xl border border-sand-200 bg-white shadow-card print-plain", className)}>{children}</As>;
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "pine" | "clay" | "ok" | "warn" | "bad"; className?: string }) {
  const tones = {
    neutral: "bg-sand-100 text-ink-700 border-sand-200",
    pine: "bg-pine-50 text-pine-700 border-pine-100",
    clay: "bg-clay-50 text-clay-600 border-[#f1d9cc]",
    ok: "bg-[#eaf5ee] text-ok-500 border-[#cfe7d8]",
    warn: "bg-[#fbf3e4] text-warn-500 border-[#f1dfba]",
    bad: "bg-[#fbecea] text-bad-500 border-[#f2d0cc]",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const btnBase = "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-10";
export const btn = {
  primary: cx(btnBase, "bg-pine-600 text-white hover:bg-pine-700 px-5 py-2.5 text-sm"),
  secondary: cx(btnBase, "bg-white text-ink-900 border border-sand-300 hover:bg-sand-50 px-5 py-2.5 text-sm"),
  ghost: cx(btnBase, "text-ink-700 hover:bg-sand-100 px-3 py-2 text-sm"),
  danger: cx(btnBase, "bg-white text-bad-500 border border-[#f2d0cc] hover:bg-[#fbecea] px-4 py-2 text-sm"),
  small: cx(btnBase, "bg-white text-ink-900 border border-sand-300 hover:bg-sand-50 px-3 py-1.5 text-xs min-h-8"),
};

export function ButtonLink({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: keyof typeof btn; className?: string }) {
  return (
    <Link href={href} className={cx(btn[variant], className)}>
      {children}
    </Link>
  );
}

export function Money({ cents, currency = "USD", className }: { cents: number; currency?: string; className?: string }) {
  return <span className={cx("money", className)}>{formatMoney(cents, currency)}</span>;
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-pine-600">{eyebrow}</div>}
        <h1 className="font-display text-3xl leading-tight text-ink-900 sm:text-4xl">{title}</h1>
        {subtitle && <p className="mt-2 max-w-2xl text-ink-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-display text-xl text-ink-900">{children}</h2>
      {aside}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-400">{label}</div>
      <div className="mt-1 truncate font-display text-2xl text-ink-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-500">{hint}</div>}
    </div>
  );
}

export function Progress({ value, tone = "pine", label }: { value: number; tone?: "pine" | "clay" | "warn" | "bad"; label?: string }) {
  const colors = { pine: "bg-pine-500", clay: "bg-clay-500", warn: "bg-warn-500", bad: "bg-bad-500" };
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className={cx("h-full rounded-full transition-all", colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Avatar({ name, size = 32, tone }: { name: string; size?: number; tone?: number }) {
  const initials = name.split(/\s+/).map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const palette = ["#2f7268", "#c4683f", "#6b5b95", "#3d6e9e", "#8a6d3b", "#557a46"];
  const h = tone ?? [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white"
      style={{ width: size, height: size, fontSize: size * 0.38, background: palette[h % palette.length] }}
    >
      {initials}
    </span>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-sand-300 bg-sand-50 px-6 py-10 text-center">
      <div className="font-display text-lg text-ink-900">{title}</div>
      {body && <div className="mx-auto mt-1 max-w-md text-sm text-ink-500">{body}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "pine", title, children, className }: { tone?: "pine" | "warn" | "bad" | "clay"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const tones = {
    pine: "border-pine-100 bg-pine-50 text-pine-700",
    warn: "border-[#f1dfba] bg-[#fbf3e4] text-[#7a5212]",
    bad: "border-[#f2d0cc] bg-[#fbecea] text-[#7f2c25]",
    clay: "border-[#f1d9cc] bg-clay-50 text-clay-600",
  };
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-sm", tones[tone], className)} role={tone === "bad" ? "alert" : "status"}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
    </div>
  );
}

export function pct(x: number, digits = 0) {
  return `${(x * 100).toFixed(digits)}%`;
}
