import { notFound } from "next/navigation";
import { GroupNav } from "@/components/GroupNav";
import { ActionButton, PrintButton } from "@/components/client";
import { Badge, Card, Notice, PageHeader } from "@/components/ui";
import { reopenAction } from "@/app/actions";
import { formatBps, formatMoney } from "@/lib/engine/money";
import { loadView } from "@/lib/server/page";

export const metadata = { title: "Final agreement" };
export default async function Agreement({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { view } = await loadView(groupId, `/results/${groupId}/agreement`);
  if (!view.agreement) {
    return (
      <div className="fade-in">
        <GroupNav view={view} active="agreement" />
        <Notice title="Not finalized yet">The agreement appears here once every required party approves and the organizer finalizes it.</Notice>
      </div>
    );
  }
  const p = view.proposals.find((x) => x.id === view.agreement!.proposalId);
  if (!p) notFound();
  const cur = view.property.currency;
  const m = (c: number) => formatMoney(c, cur);
  return (
    <div className="fade-in">
      <GroupNav view={view} active="agreement" />
      <div className="no-print mb-6 flex flex-wrap justify-end gap-2">
        <PrintButton />
        {view.isOrganizer && <ActionButton action={reopenAction.bind(null, groupId)} variant="secondary" confirm="Reopen? All approvals reset.">Reopen agreement</ActionButton>}
      </div>
      <Card className="mx-auto max-w-3xl p-8 sm:p-12">
        <PageHeader eyebrow="Cost-sharing agreement" title={view.property.name} subtitle={`${view.group.name} · ${view.property.location}${view.property.checkIn ? ` · ${view.property.checkIn} → ${view.property.checkOut}` : ""}`} />
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Badge tone="ok">Finalized {new Date(view.agreement.finalizedAt).toLocaleString()}</Badge>
          <Badge>Proposal v{view.version?.no} · {p.label}</Badge>
          <span className="text-sm text-ink-500">Total rental: <span className="money font-semibold text-ink-900">{m(view.totalCents)}</span></span>
        </div>
        <table className="w-full text-sm" data-testid="agreement-table">
          <thead><tr className="border-b-2 border-ink-900 text-left text-xs uppercase tracking-wide"><th className="py-2">Party & members</th><th className="py-2">Bedroom</th><th className="py-2 text-right">Owes</th></tr></thead>
          <tbody>
            {p.assignments.map((a) => {
              const party = view.parties.find((x) => x.id === a.partyId)!;
              const room = view.rooms.find((r) => r.id === a.roomId)!;
              const vote = view.approval?.votes.find((v) => v.partyId === a.partyId);
              return (
                <tr key={a.partyId} className="border-b border-sand-200 align-top">
                  <td className="py-3">
                    <div className="font-medium">{party.name}</div>
                    <div className="text-xs text-ink-500">{party.members.map((mm, i) => `${mm.name} — ${m(a.perPersonCents[i] ?? 0)}`).join(" · ")}</div>
                    <div className="mt-1 text-xs">{vote?.decision === "approve" ? "✓ Approved by " + vote.by : "—"}</div>
                  </td>
                  <td className="py-3">{room.name}<div className="text-xs text-ink-500">{room.bedConfig}</div></td>
                  <td className="money py-3 text-right font-semibold">{m(a.totalCents)}<div className="text-xs font-normal text-ink-500">{formatBps(a.shareBps)}</div></td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td className="pt-3 font-semibold" colSpan={2}>Total</td><td className="money pt-3 text-right font-semibold">{m(p.totalCents)}</td></tr></tfoot>
        </table>
        <div className="mt-8 rounded-xl bg-sand-50 p-5 text-sm text-ink-700">
          <div className="font-medium">Methodology</div>
          {p.strategies.includes("auction") ? (
            <p className="mt-1">Rooms were allocated by sealed-bid auction to the arrangement with the highest combined bids. Prices are envy-free (no party prefers another room at its price) and sum exactly to the rental total.</p>
          ) : (
            <p className="mt-1">
              {formatBps(view.pricing.sharedBps, 0)} of the rental ({m(Math.round((view.totalCents * view.pricing.sharedBps) / 10000))}) is shared equally per traveler; the remaining {formatBps(10000 - view.pricing.sharedBps, 0)} is divided across occupied bedrooms by quality weight (
              {view.rooms.map((r) => `${r.name} ${(r.weightMilli / 1000).toFixed(2)}`).join(", ")}). All amounts are integer cents with largest-remainder rounding.
            </p>
          )}
          <p className="mt-2 text-xs text-ink-500">No payment has been processed. Ledger: {view.agreement.ledger.length} obligations recorded ({view.agreement.ledger.map((l) => l.status).filter((v, i, a) => a.indexOf(v) === i).join(", ")}).</p>
        </div>
      </Card>
    </div>
  );
}
