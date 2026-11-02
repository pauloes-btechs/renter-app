"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/app/actions";
import { btn, cx } from "./ui";

/** Button that runs a server action, shows pending/error state, then refreshes or follows a redirect. */
export function ActionButton({
  action,
  children,
  variant = "primary",
  className,
  confirm,
  pendingLabel,
  disabled,
  onDone,
  testId,
}: {
  action: () => Promise<ActionResult<unknown>>;
  children: ReactNode;
  variant?: keyof typeof btn;
  className?: string;
  confirm?: string;
  pendingLabel?: string;
  disabled?: boolean;
  onDone?: (r: ActionResult<unknown>) => void;
  testId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const go = () =>
    start(async () => {
      setError(null);
      const r = await action();
      if (!r.ok) setError(r.error);
      else if (r.redirect) router.push(r.redirect);
      else router.refresh();
      setConfirming(false);
      onDone?.(r);
    });
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {confirming ? (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-full bg-sand-100 p-1 pl-3 text-sm">
          <span className="text-ink-700">{confirm}</span>
          <button type="button" className={btn.small} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className={cx(btn.small, "!bg-ink-900 !text-white")} onClick={go} disabled={pending}>
            {pending ? "Working…" : "Confirm"}
          </button>
        </span>
      ) : (
        <button
          type="button"
          data-testid={testId}
          className={cx(btn[variant], className)}
          disabled={pending || disabled}
          onClick={() => (confirm ? setConfirming(true) : go())}
        >
          {pending ? pendingLabel ?? "Working…" : children}
        </button>
      )}
      {error && (
        <span role="alert" className="max-w-sm text-xs text-bad-500">
          {error}
        </span>
      )}
    </span>
  );
}

export function CopyButton({ text, label = "Copy link", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const full = text.startsWith("/") && typeof window !== "undefined" ? window.location.origin + text : text;
  return (
    <button
      type="button"
      className={cx(btn.small, className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(full);
        } catch {
          /* clipboard unavailable — the link is still visible to select */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

/** Polls the group's version counter and refreshes server components when anything changes. */
export function LiveRefresh({ groupId, version, interval = 3000 }: { groupId: string; version: number; interval?: number }) {
  const router = useRouter();
  const v = useRef(version);
  const [live, setLive] = useState(true);
  useEffect(() => {
    v.current = version;
  }, [version]);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/groups/${groupId}/version`, { cache: "no-store" });
        if (!res.ok) return setLive(false);
        const { version: nv } = (await res.json()) as { version: number };
        setLive(true);
        if (!stop && nv !== v.current) {
          v.current = nv;
          router.refresh();
        }
      } catch {
        setLive(false);
      }
    };
    const id = setInterval(tick, interval);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [groupId, interval, router]);
  return (
    <span className="no-print inline-flex items-center gap-1.5 text-xs text-ink-400" title="This page updates automatically">
      <span className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-ok-500 pulse-dot" : "bg-ink-400")} />
      {live ? "Live" : "Offline"}
    </span>
  );
}

export function PrintButton() {
  return (
    <button type="button" className={btn.secondary} onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
