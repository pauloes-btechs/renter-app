import type { GroupView, ProposalView } from "@/lib/server/views";
import { formatBps, formatMoney } from "@/lib/engine/money";
import { RoomImage } from "./RoomArt";
import { Avatar, Badge, Card, Progress, cx, pct } from "./ui";

const STRATEGY_TONE: Record<string, "pine" | "clay" | "ok" | "warn"> = { balanced: "pine", budget: "ok", preference: "clay", auction: "warn" };
const STRATEGY_SHORT: Record<string, string> = { balanced: "Balanced", budget: "Budget-conscious", preference: "Preference-first", auction: "Market auction" };

export function StrategyBadges({ p }: { p: ProposalView }) {
  if (p.strategies.length === 0) return <Badge>Alternative</Badge>;
  return (
    <span className="flex flex-wrap gap-1">
      {p.strategies.map((s) => (
        <Badge key={s} tone={STRATEGY_TONE[s] ?? "neutral"}>
          {s === "balanced" ? "★ Recommended · Balanced" : STRATEGY_SHORT[s] ?? s}
        </Badge>
      ))}
    </span>
  );
}

/** Room-to-party visual map. */
export function AllocationMap({ view, proposal, compact = false }: { view: GroupView; proposal: ProposalView; compact?: boolean }) {
  const cur = view.property.currency;
  return (
    <div className={cx("grid gap-4", compact ? "grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-4")}>
      {view.rooms.map((r) => {
        const a = proposal.assignments.find((x) => x.roomId === r.id);
        const party = a ? view.parties.find((p) => p.id === a.partyId) : null;
        const mine = party?.isMine;
        return (
          <Card key={r.id} className={cx("overflow-hidden", mine && "ring-2 ring-pine-500", !a && "opacity-60")}>
            <RoomImage room={r} className="block aspect-[16/10] w-full" title={r.name} />
            <div className="p-4">
              <div className="text-xs text-ink-400">{r.shortName}</div>
              <div className="font-display text-lg leading-tight">{r.name}</div>
              {!compact && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {r.amenities.slice(0, 3).map((am) => (
                    <Badge key={am.label}>{am.label}</Badge>
                  ))}
                </div>
              )}
              <div className="mt-4 border-t border-sand-200 pt-3">
                {party && a ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">{party.members.map((m) => <Avatar key={m.id} name={m.name} size={26} />)}</div>
                      <div className="min-w-0 truncate text-sm font-medium" data-testid={`assign-${r.name}`}>
                        {party.name}
                      </div>
                      {mine && <Badge tone="pine">You</Badge>}
                    </div>
                    <div className="mt-2 flex flex-col">
                      <span className="money font-display text-2xl" data-testid={`price-${r.name}`}>{formatMoney(a.totalCents, cur)}</span>
                      <span className="text-xs text-ink-500">{a.size === 1 ? "1 person" : `${a.size} people · ${formatMoney(a.perPersonCents[0], cur)} each`}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-ink-400">Unoccupied — no charge</div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Exact cost table that reconciles to the property total. */
export function CostTable({ view, proposal }: { view: GroupView; proposal: ProposalView }) {
  const cur = view.property.currency;
  const m = (c: number) => formatMoney(c, cur);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-sand-200 text-left text-xs uppercase tracking-wide text-ink-400">
            <th className="py-2 pr-3 font-medium">Party</th>
            <th className="py-2 pr-3 font-medium">Room</th>
            <th className="py-2 pr-3 text-right font-medium">Shared</th>
            <th className="py-2 pr-3 text-right font-medium">{proposal.strategies.includes("auction") ? "Room (market)" : "Bedroom"}</th>
            <th className="py-2 pr-3 text-right font-medium">Party total</th>
            <th className="py-2 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {proposal.assignments.map((a) => {
            const party = view.parties.find((p) => p.id === a.partyId);
            const room = view.rooms.find((r) => r.id === a.roomId);
            return (
              <tr key={a.partyId} className={cx("border-b border-sand-100", party?.isMine && "bg-pine-50/60")}>
                <td className="py-3 pr-3">
                  <div className="font-medium">{party?.name}</div>
                  <div className="text-xs text-ink-500">{a.size} {a.size === 1 ? "traveler" : "travelers"}{a.size > 1 ? ` · ${a.perPersonCents.map(m).join(" + ")}` : ""}</div>
                </td>
                <td className="py-3 pr-3">{room?.name}</td>
                <td className="money py-3 pr-3 text-right">{m(a.sharedCents)}</td>
                <td className="money py-3 pr-3 text-right">{m(a.roomCents)}</td>
                <td className="money py-3 pr-3 text-right font-semibold">{m(a.totalCents)}</td>
                <td className="money py-3 text-right text-ink-500">{formatBps(a.shareBps)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td className="pt-3 font-medium" colSpan={4}>
              Total {proposal.totalCents === view.totalCents ? <Badge tone="ok" className="ml-2">Reconciles exactly ✓</Badge> : <Badge tone="bad">Mismatch</Badge>}
            </td>
            <td className="money pt-3 text-right font-semibold" data-testid="total-reconciled">{m(proposal.totalCents)}</td>
            <td className="money pt-3 text-right text-ink-500">100%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function FairnessMetrics({ p }: { p: ProposalView }) {
  const items = [
    { k: "Least-satisfied party", v: p.metrics.minSatisfaction },
    { k: "Average satisfaction", v: p.metrics.meanSatisfaction },
    { k: "Average affordability", v: p.metrics.meanAfford },
    { k: "Envy-free", v: 1 - p.metrics.maxEnvy },
  ];
  return (
    <div className="space-y-3">
      {items.map((i) => (
        <div key={i.k}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-ink-500">{i.k}</span>
            <span className="money font-medium">{pct(i.v)}</span>
          </div>
          <Progress value={i.v} label={i.k} tone={i.v > 0.8 ? "pine" : i.v > 0.6 ? "warn" : "bad"} />
        </div>
      ))}
      <div className="text-xs text-ink-500">{p.metrics.firstChoiceCount} first-choice match{p.metrics.firstChoiceCount === 1 ? "" : "es"} · {p.metrics.envyFreeParties} of {p.assignments.length} parties envy-free</div>
    </div>
  );
}

export function ApprovalList({ view }: { view: GroupView }) {
  const votes = view.approval?.votes ?? [];
  return (
    <ul className="space-y-2">
      {view.parties
        .filter((p) => p.members.length > 0)
        .map((p) => {
          const v = votes.find((x) => x.partyId === p.id);
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl bg-sand-50 px-3 py-2.5" data-testid={`approval-${p.name}`}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex -space-x-2">{p.members.map((m) => <Avatar key={m.id} name={m.name} size={24} />)}</span>
                <span className="truncate text-sm font-medium">{p.name}</span>
              </span>
              {v ? (
                v.decision === "approve" ? <Badge tone="ok">Approved</Badge> : <Badge tone="warn">Requested changes</Badge>
              ) : (
                <Badge>Waiting</Badge>
              )}
            </li>
          );
        })}
    </ul>
  );
}
