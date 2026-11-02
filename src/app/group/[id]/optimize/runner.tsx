"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { runOptimizationAction } from "@/app/actions";
import { Card, Notice, btn, cx } from "@/components/ui";

export function OptimizeRunner({ groupId, parties, rooms, perms, auction }: { groupId: string; parties: number; rooms: number; perms: number; auction: boolean }) {
  const router = useRouter();
  const steps = [
    "Loading submitted preferences and party sizes",
    "Applying hard constraints — capacity, beds, accessibility, refused rooms",
    `Enumerating ${perms.toLocaleString()} party-to-room assignments`,
    "Pricing every assignment in integer cents",
    "Rejecting arrangements that break a hard budget",
    "Scoring fairness, satisfaction, affordability and envy",
    ...(auction ? ["Clearing the sealed-bid auction with envy-free prices"] : []),
    "Ranking proposals with deterministic tie-breaks",
  ];
  const [i, setI] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!started) return;
    let cancelled = false;
    let k = 0;
    const tick = setInterval(() => {
      k = Math.min(k + 1, steps.length - 1);
      if (!cancelled) setI(k);
    }, 380);
    (async () => {
      const r = await runOptimizationAction(groupId);
      await new Promise((res) => setTimeout(res, Math.max(0, steps.length * 380 - 200)));
      clearInterval(tick);
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error);
        setStarted(false);
        return;
      }
      setI(steps.length);
      router.push(r.redirect ?? `/results/${groupId}`);
    })();
    return () => {
      cancelled = true;
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  return (
    <Card className="mx-auto max-w-2xl p-6 sm:p-8">
      <ol className="space-y-3" aria-live="polite">
        {steps.map((s, k) => (
          <li key={s} className={cx("flex items-center gap-3 text-sm transition-opacity", started || i >= 0 ? (k <= i ? "opacity-100" : "opacity-40") : "opacity-70")}>
            <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs", k < i ? "bg-pine-500 text-white" : k === i ? "bg-pine-50 text-pine-700 ring-2 ring-pine-500" : "bg-sand-200 text-ink-500")}>
              {k < i ? "✓" : k + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      {error && <Notice tone="bad" className="mt-6">{error}</Notice>}
      <div className="mt-8 flex items-center justify-between gap-3">
        <span className="text-xs text-ink-400">{parties} parties · {rooms} rooms · same inputs always give the same result</span>
        <button className={btn.primary} disabled={started} onClick={() => { setError(null); setI(0); setStarted(true); }} data-testid="run-optimizer">
          {started ? "Calculating…" : "Run allocation"}
        </button>
      </div>
    </Card>
  );
}
