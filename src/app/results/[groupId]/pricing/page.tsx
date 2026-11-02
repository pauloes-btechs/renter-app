import { GroupNav } from "@/components/GroupNav";
import { CostTable } from "@/components/results";
import { Card, PageHeader, SectionTitle } from "@/components/ui";
import { formatBps, formatMoney } from "@/lib/engine/money";
import { roomCostsFor, splitPools } from "@/lib/engine/pricing";
import { SCORING_WEIGHTS } from "@/lib/engine/scoring";
import { loadView } from "@/lib/server/page";

export const metadata = { title: "Pricing breakdown" };
export default async function Pricing({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { view } = await loadView(groupId, `/results/${groupId}/pricing`);
  const cur = view.property.currency;
  const m = (c: number) => formatMoney(c, cur);
  const p = view.selected ?? view.proposals[0] ?? null;
  const T = view.totalCents;
  const s = view.pricing.sharedBps;
  const { shared: sharedPool, priv: privPool } = splitPools({ totalCents: T, sharedBps: s });
  const N = p ? p.assignments.reduce((a, x) => a + x.size, 0) : view.travelers;
  const occupied = p ? view.rooms.filter((r) => p.assignments.some((a) => a.roomId === r.id)) : view.rooms;
  const W = occupied.reduce((a, r) => a + r.weightMilli, 0);
  const weightedCosts = roomCostsFor(privPool, occupied); // exact, same apportionment the engine uses
  const W8 = SCORING_WEIGHTS;
  return (
    <div className="fade-in">
      <GroupNav view={view} active="pricing" />
      <PageHeader eyebrow="Methodology" title="How the price is calculated" subtitle="Deterministic arithmetic in integer cents. AI is never used to decide money." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <SectionTitle>1 · Split the rent into two pools</SectionTitle>
          <div className="space-y-3 text-sm">
            <Row k={`Shared property (${formatBps(s, 0)})`} v={m(sharedPool)} hint="Access to the whole house — kitchen, living room, deck." />
            <Row k={`Private bedrooms (${formatBps(10000 - s, 0)})`} v={m(privPool)} hint="Distributed by the quality weight of each occupied bedroom." />
            <Row k="Total" v={m(T)} strong />
          </div>
        </Card>
        <Card className="p-6">
          <SectionTitle>2 · Shared cost per traveler</SectionTitle>
          <pre className="overflow-x-auto rounded-xl bg-sand-50 p-4 text-sm">{`SharedCostPerPerson = (T × s) ÷ N
                    = ${m(sharedPool)} ÷ ${N}
                    = ${N ? m(Math.floor(sharedPool / N)) : "—"}${N && sharedPool % N ? " (+1¢ for " + (sharedPool % N) + " travelers)" : ""}`}</pre>
          <p className="mt-3 text-sm text-ink-500">Every individual pays the same for shared spaces. A two-person party pays twice — but still gets one bedroom.</p>
        </Card>
        <Card className="p-6 lg:col-span-2">
          <SectionTitle>3 · Bedroom weights</SectionTitle>
          <p className="mb-4 text-sm text-ink-500">
            Weights are editable baseline assumptions, not proven market values. Only <strong>occupied</strong> rooms share the bedroom pool, so the full rent is always covered.
            {view.pricing.method !== "weighted" && " With the auction enabled, the market proposal discovers prices from bids instead."}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-ink-400"><th className="py-2">Room</th><th className="py-2 text-right">Weight</th><th className="py-2 text-right">Share of pool</th><th className="py-2 text-right">Bedroom cost</th><th className="py-2 pl-4">Implication</th></tr></thead>
              <tbody>
                {view.rooms.map((r) => {
                  const occ = occupied.some((o) => o.id === r.id);
                  const cost = occ ? weightedCosts[r.id] ?? 0 : 0;
                  return (
                    <tr key={r.id} className="border-b border-sand-100">
                      <td className="py-2.5 font-medium">{r.name}</td>
                      <td className="money py-2.5 text-right">{(r.weightMilli / 1000).toFixed(2)}</td>
                      <td className="money py-2.5 text-right">{occ && W ? ((r.weightMilli / W) * 100).toFixed(1) + "%" : "—"}</td>
                      <td className="money py-2.5 text-right">{occ ? m(cost) : "unoccupied"}</td>
                      <td className="py-2.5 pl-4 text-ink-500">{r.weightMilli >= 1300 ? "Premium room — pays well above average" : r.weightMilli <= 700 ? "Budget room — lowest premium" : "Standard room"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-xl bg-sand-50 p-4 text-sm">{`RoomCost(r) = (T × (1 − s) × w[r]) ÷ Σ w[occupied] = ${m(privPool)} × w[r] ÷ ${(W / 1000).toFixed(2)}
PartyCost(p) = n[p] × SharedCostPerPerson + RoomCost(room(p))`}</pre>
        </Card>
        {p && (
          <Card className="p-6 lg:col-span-2">
            <SectionTitle>4 · Result ({p.label})</SectionTitle>
            <CostTable view={view} proposal={p} />
            <p className="mt-3 text-xs text-ink-500">Rounding: every split uses largest-remainder apportionment on integer cents with deterministic tie-breaks, so the sum is exactly {m(T)} — no unexplained cent.</p>
          </Card>
        )}
        <Card className="p-6 lg:col-span-2">
          <SectionTitle>5 · How rooms are matched (scoring weights)</SectionTitle>
          <div className="grid gap-6 text-sm md:grid-cols-3">
            <div>
              <div className="font-medium">Hard constraints first</div>
              <p className="mt-1 text-ink-500">Occupancy, separate beds, no-bunk, accessibility, refused rooms, hard budgets, one room per party. Never violated — if nothing fits, you get a diagnosis instead.</p>
            </div>
            <div>
              <div className="font-medium">Per-party satisfaction (0–1)</div>
              <p className="mt-1 text-ink-500">
                fit = {W8.fit.rank} × ranking + {W8.fit.attributes} × priority match (top-3 boosted ×{W8.topPriorityBoost.join("/×")}); satisfaction = {W8.satisfaction.fit} × fit + {W8.satisfaction.afford} × affordability. Normalized per party, so larger parties don&apos;t dominate.
              </p>
            </div>
            <div>
              <div className="font-medium">Strategy scores</div>
              <ul className="mt-1 space-y-1 text-ink-500">
                <li>Balanced: {Object.entries(W8.strategies.balanced).map(([k, v]) => `${v}·${k}`).join(" + ")}</li>
                <li>Budget: {Object.entries(W8.strategies.budget).map(([k, v]) => `${v}·${k}`).join(" + ")}</li>
                <li>Preference: {Object.entries(W8.strategies.preference).map(([k, v]) => `${v}·${k}`).join(" + ")}</li>
              </ul>
            </div>
          </div>
          <p className="mt-4 text-xs text-ink-500">A larger budget never earns a better room or a higher price for the same room — budgets only decide what&apos;s affordable. Ties are broken by a stable assignment key, so identical inputs always give identical results.</p>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v, hint, strong }: { k: string; v: string; hint?: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-sand-100 pb-2">
      <div><div className={strong ? "font-semibold" : ""}>{k}</div>{hint && <div className="text-xs text-ink-500">{hint}</div>}</div>
      <div className={"money " + (strong ? "font-semibold" : "")}>{v}</div>
    </div>
  );
}
