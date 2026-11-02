import { GroupNav } from "@/components/GroupNav";
import { ActionButton } from "@/components/client";
import { FairnessMetrics, StrategyBadges } from "@/components/results";
import { Badge, Card, EmptyState, Notice, PageHeader, cx } from "@/components/ui";
import { selectProposalAction } from "@/app/actions";
import { formatMoney } from "@/lib/engine/money";
import { STRATEGY_DESCRIPTIONS } from "@/lib/engine/scoring";
import { loadView } from "@/lib/server/page";

export const metadata = { title: "Compare proposals" };
export default async function Compare({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { view } = await loadView(groupId, `/results/${groupId}/compare`);
  const cur = view.property.currency;
  const canSelect = view.isOrganizer && ["proposed", "voting", "approved"].includes(view.group.status) && view.version?.status === "current";
  return (
    <div className="fade-in">
      <GroupNav view={view} active="compare" />
      <PageHeader
        eyebrow="Alternatives"
        title="Compare allocation proposals"
        subtitle="Each method optimizes something different. When methods agree, they're shown on the same card instead of inventing a different answer."
      />
      {view.version?.status === "stale" && <Notice tone="warn" className="mb-6" title="Out of date">{view.version.staleReason}.</Notice>}
      {view.proposals.length === 0 ? (
        <EmptyState title="No proposals to compare" />
      ) : (
        <>
          {view.proposals.length < 3 && (
            <Notice className="mb-6">Only {view.proposals.length} distinct feasible arrangement{view.proposals.length === 1 ? "" : "s"} exist{view.proposals.length === 1 ? "s" : ""} under the current constraints.</Notice>
          )}
          <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="grid min-w-[720px] gap-4" style={{ gridTemplateColumns: `repeat(${view.proposals.length}, minmax(0, 1fr))` }}>
              {view.proposals.map((p) => (
                <Card key={p.id} className={cx("flex flex-col p-5", p.isSelected && "ring-2 ring-pine-500")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-xl leading-tight">{p.label}</div>
                    {p.isSelected && <Badge tone="pine">Group&apos;s choice</Badge>}
                  </div>
                  <div className="mt-2"><StrategyBadges p={p} /></div>
                  <p className="mt-2 text-xs text-ink-500">{p.strategies.map((s) => STRATEGY_DESCRIPTIONS[s as keyof typeof STRATEGY_DESCRIPTIONS]).join(" ") || "Next-best feasible arrangement under the balanced score."}</p>
                  <table className="mt-4 w-full text-sm">
                    <tbody>
                      {p.assignments.map((a) => {
                        const party = view.parties.find((x) => x.id === a.partyId)!;
                        const room = view.rooms.find((r) => r.id === a.roomId)!;
                        return (
                          <tr key={a.partyId} className={cx("border-b border-sand-100", party.isMine && "bg-pine-50/60")}>
                            <td className="py-2 pr-2">
                              <div className="font-medium">{party.name}</div>
                              <div className="text-xs text-ink-500">{room.name} · #{a.rankPosition + 1} choice</div>
                            </td>
                            <td className="money py-2 text-right">
                              {formatMoney(a.totalCents, cur)}
                              {a.withinBudget === false && <div className="text-xs text-warn-500">over max</div>}
                            </td>
                          </tr>
                        );
                      })}
                      <tr><td className="pt-2 font-medium">Total</td><td className="money pt-2 text-right font-semibold">{formatMoney(p.totalCents, cur)}</td></tr>
                    </tbody>
                  </table>
                  <div className="mt-5"><FairnessMetrics p={p} /></div>
                  <div className="mt-4 rounded-xl bg-sand-50 p-3 text-xs text-ink-700">
                    <div className="mb-1 font-medium">Scores</div>
                    Balanced {(p.scores.balanced * 100).toFixed(1)} · Budget {(p.scores.budget * 100).toFixed(1)} · Preference {(p.scores.preference * 100).toFixed(1)}
                  </div>
                  <ul className="mt-3 space-y-1 text-xs text-ink-500">{p.explanation.comparison.map((c) => <li key={c}>{c}</li>)}</ul>
                  <div className="mt-auto pt-5">
                    {canSelect && !p.isSelected && (
                      <ActionButton action={selectProposalAction.bind(null, groupId, p.id)} variant="secondary" confirm={view.group.status !== "proposed" ? "Switching clears approvals. Continue?" : undefined}>
                        Make this the group&apos;s choice
                      </ActionButton>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
