"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createGroupAction } from "@/app/actions";
import { Card, btn } from "@/components/ui";

export const field = "mt-1 w-full rounded-xl border border-sand-300 bg-white px-3.5 py-2.5 text-ink-900 placeholder:text-ink-400 focus:border-pine-500 focus:outline-none";
export const labelCls = "text-sm font-medium text-ink-700";

export function CreateGroupForm({ defaultName, signedIn }: { defaultName: string; signedIn: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    organizerName: defaultName, groupName: "Summer house trip", propertyName: "The Shared Vacation House", total: "4200", currency: "USD",
    partyCount: 4, maxPartySize: 2, sharedPct: 40, organizerJoins: true, organizerPartyName: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const totalCents = Math.round(parseFloat(f.total.replace(/[^0-9.]/g, "")) * 100);
          if (!Number.isFinite(totalCents) || totalCents <= 0) return setError("Enter the total rental cost.");
          const r = await createGroupAction({
            organizerName: f.organizerName, groupName: f.groupName, propertyName: f.propertyName, totalCents, currency: f.currency,
            partyCount: f.partyCount, maxPartySize: f.maxPartySize, sharedBps: f.sharedPct * 100, organizerJoins: f.organizerJoins,
            organizerPartyName: f.organizerPartyName || undefined,
          });
          if (!r.ok) setError(r.error);
          else if (r.redirect) router.push(r.redirect);
        });
      }}
    >
      <Card className="space-y-5 p-6 sm:p-8">
        <label className="block">
          <span className={labelCls}>Your name</span>
          <input required className={field} value={f.organizerName} disabled={signedIn} onChange={(e) => set("organizerName", e.target.value)} placeholder="e.g. Maya Chen" name="organizerName" />
          {signedIn && <span className="mt-1 block text-xs text-ink-400">Signed in — the group will be created under your name.</span>}
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Group name</span>
            <input required className={field} value={f.groupName} onChange={(e) => set("groupName", e.target.value)} name="groupName" />
          </label>
          <label className="block">
            <span className={labelCls}>Property</span>
            <input required className={field} value={f.propertyName} onChange={(e) => set("propertyName", e.target.value)} name="propertyName" />
          </label>
        </div>
        <div className="grid gap-5 sm:grid-cols-[1fr_120px]">
          <label className="block">
            <span className={labelCls}>Total rental cost for the stay</span>
            <input required inputMode="decimal" className={field + " money"} value={f.total} onChange={(e) => set("total", e.target.value)} name="total" />
          </label>
          <label className="block">
            <span className={labelCls}>Currency</span>
            <select className={field} value={f.currency} onChange={(e) => set("currency", e.target.value)}>
              {["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "JPY"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Number of parties</span>
            <input type="number" min={1} max={26} className={field} value={f.partyCount} onChange={(e) => set("partyCount", Number(e.target.value))} name="partyCount" />
            <span className="mt-1 block text-xs text-ink-400">One party = one bedroom. The template house has 4 bedrooms.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Max people per party</span>
            <input type="number" min={1} max={12} className={field} value={f.maxPartySize} onChange={(e) => set("maxPartySize", Number(e.target.value))} name="maxPartySize" />
          </label>
        </div>
        <label className="block">
          <span className={labelCls}>Shared-house share of the rent: {f.sharedPct}% shared · {100 - f.sharedPct}% by bedroom</span>
          <input type="range" min={0} max={100} step={5} value={f.sharedPct} onChange={(e) => set("sharedPct", Number(e.target.value))} className="mt-2 w-full" aria-label="Shared percentage" />
        </label>
        <label className="flex items-start gap-3 rounded-xl bg-sand-50 p-4">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={f.organizerJoins} onChange={(e) => set("organizerJoins", e.target.checked)} />
          <span>
            <span className="font-medium">I&apos;m traveling too</span>
            <span className="block text-sm text-ink-500">You&apos;ll take Party A and fill in its questionnaire.</span>
          </span>
        </label>
        {error && <p role="alert" className="text-sm text-bad-500">{error}</p>}
        <div className="flex justify-end">
          <button type="submit" className={btn.primary} disabled={pending} data-testid="create-submit">
            {pending ? "Creating…" : "Create group"}
          </button>
        </div>
      </Card>
    </form>
  );
}
