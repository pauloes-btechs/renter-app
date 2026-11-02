import { GroupNav } from "@/components/GroupNav";
import { ActionButton } from "@/components/client";
import { RoomArt } from "@/components/RoomArt";
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { applyMarketWeightsAction } from "@/app/actions";
import { formatMoney } from "@/lib/engine/money";
import { loadView } from "@/lib/server/page";

export const metadata = { title: "Market & price discovery" };
export default async function Market({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { view } = await loadView(groupId, `/results/${groupId}/market`);
  const cur = view.property.currency;
  const m = (c: number) => formatMoney(c, cur);
  const a = view.auction;
  const bidders = view.parties.filter((p) => p.hasBids).length;
  return (
    <div className="fade-in">
      <GroupNav view={view} active="market" />
      <PageHeader
        eyebrow="Room auction"
        title="Price discovery"
        subtitle="Sealed bids reveal how much each room is really worth to this group. Rooms in demand clear above their weighted price; unwanted rooms clear below."
        actions={view.myParty ? <ButtonLink href={`/survey/${view.myParty.id}`} variant="secondary">{view.myParty.hasBids ? "Update my bids" : "Place my bids"}</ButtonLink> : undefined}
      />
      <Card className="mb-6 grid gap-4 p-6 text-sm sm:grid-cols-3">
        <div><div className="text-xs uppercase tracking-wide text-ink-400">Bidding parties</div><div className="font-display text-2xl">{bidders} / {view.parties.length}</div></div>
        <div><div className="text-xs uppercase tracking-wide text-ink-400">Mode</div><div className="font-display text-2xl">{view.pricing.method === "auction" ? "Auction-led" : "Comparison"}</div></div>
        <div><div className="text-xs uppercase tracking-wide text-ink-400">Result</div><div className="font-display text-2xl">{!a ? "Not run" : a.feasible ? (a.envyFree ? "Cleared · envy-free" : "Cleared") : "Did not clear"}</div></div>
      </Card>
      {!a ? (
        <EmptyState title="The auction hasn't run yet" body="Once every party has placed bids, the organizer's allocation run clears the auction alongside the weighted proposals." />
      ) : (
        <>
          {!a.feasible && (
            <Notice tone="bad" className="mb-6" title="The auction did not clear">
              <ul className="list-disc pl-5">{a.conflicts.map((c) => <li key={c}>{c}</li>)}</ul>
              <ul className="mt-2 list-disc pl-5">{a.suggestions.map((c) => <li key={c}>{c}</li>)}</ul>
            </Notice>
          )}
          {a.mySurplusCents != null && a.feasible && (
            <Notice className="mb-6" title="Your result (private)">
              You bid {m(a.myBidCents ?? 0)} for your room and would pay {m((a.myBidCents ?? 0) - a.mySurplusCents)} — keeping {m(a.mySurplusCents)} below your bid.
            </Notice>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {view.rooms.map((r) => {
              const s = a.rooms.find((x) => x.roomId === r.id);
              const winner = s?.winnerPartyId ? view.parties.find((p) => p.id === s.winnerPartyId) : null;
              const demand = s ? s.bidCount / Math.max(1, view.parties.length) : 0;
              return (
                <Card key={r.id} className="overflow-hidden">
                  <RoomArt kind={r.imageKey} className="block aspect-[16/10] w-full" />
                  <div className="p-4">
                    <div className="font-display text-lg">{r.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={demand >= 0.75 ? "clay" : demand >= 0.5 ? "warn" : "neutral"}>{s?.bidCount ?? 0} bid{s?.bidCount === 1 ? "" : "s"} · {demand >= 0.75 ? "high demand" : demand >= 0.5 ? "contested" : "low demand"}</Badge>
                    </div>
                    <dl className="mt-3 space-y-1 text-sm">
                      <div className="flex justify-between"><dt className="text-ink-500">Weighted price</dt><dd className="money">{s?.weightedCents != null ? m(s.weightedCents) : "—"}</dd></div>
                      <div className="flex justify-between font-medium"><dt>Clearing price</dt><dd className="money">{s?.clearingCents != null ? m(s.clearingCents) : "—"}</dd></div>
                      {s?.premiumCents != null && (
                        <div className="flex justify-between"><dt className="text-ink-500">Market signal</dt><dd className={"money " + (s.premiumCents >= 0 ? "text-clay-600" : "text-pine-600")}>{s.premiumCents >= 0 ? "+" : "−"}{m(Math.abs(s.premiumCents))}</dd></div>
                      )}
                      {view.isOrganizer && s?.highestCents != null && (
                        <div className="flex justify-between text-xs text-ink-400"><dt>Top / second bid</dt><dd className="money">{m(s.highestCents)} / {s.secondCents != null ? m(s.secondCents) : "—"}</dd></div>
                      )}
                      <div className="flex justify-between text-xs text-ink-500"><dt>Market weight</dt><dd className="money">{a.marketWeights[r.id] != null ? (a.marketWeights[r.id] / 1000).toFixed(2) : "—"} (now {(r.weightMilli / 1000).toFixed(2)})</dd></div>
                    </dl>
                    <div className="mt-3 border-t border-sand-200 pt-2 text-sm">{winner ? <>Won by <span className="font-medium">{winner.name}</span></> : <span className="text-ink-400">Unassigned</span>}</div>
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card className="p-6">
              <SectionTitle>How the auction works</SectionTitle>
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-700">
                <li>Each party privately bids the most it would pay (party total) for every room it would accept.</li>
                <li>Rooms go to the arrangement with the highest combined bids, respecting all hard constraints.</li>
                <li>Prices are envy-free: at the clearing prices, no party would rather have another room it bid on.</li>
                <li>Among envy-free prices, the one leaving the least-advantaged party the most room under its bid is chosen, then shifted to sum exactly to {m(view.totalCents)}.</li>
              </ol>
              <p className="mt-3 text-xs text-ink-500">Raw bids are private. Other parties see only bid counts, clearing prices and the market signal.</p>
            </Card>
            {view.isOrganizer && (
              <Card className="p-6">
                <SectionTitle>Feed the market back into weights</SectionTitle>
                <p className="text-sm text-ink-500">Replace room weights with the weights implied by clearing prices. This makes the weighted model reflect this group&apos;s demand; it clears approvals and requires re-running the allocation.</p>
                <div className="mt-4"><ActionButton action={applyMarketWeightsAction.bind(null, groupId)} variant="secondary" disabled={!a.feasible || view.group.status === "finalized"} confirm="Apply market weights to all rooms?">Apply market weights</ActionButton></div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}
