import { notFound } from "next/navigation";
import Link from "next/link";
import { GroupNav } from "@/components/GroupNav";
import { ActionButton } from "@/components/client";
import { PersonalLink } from "@/components/PersonalLink";
import { RoomArt } from "@/components/RoomArt";
import { VotePanel } from "@/components/VotePanel";
import { Avatar, Badge, ButtonLink, Card, Money, Notice, PageHeader, Progress, SectionTitle } from "@/components/ui";
import { leavePartyAction } from "@/app/actions";
import { getDb } from "@/lib/db/client";
import { formatBps, formatMoney } from "@/lib/engine/money";
import { loadView } from "@/lib/server/page";
import { listDrafts } from "@/lib/server/repo";

export const metadata = { title: "Party" };
export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string; shared?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const row = getDb().prepare("SELECT group_id FROM parties WHERE id=?").get(id) as { group_id: string } | undefined;
  if (!row) notFound();
  const { viewer, view } = await loadView(row.group_id, `/party/${id}`);
  const party = view.parties.find((p) => p.id === id);
  if (!party || !party.isMine) notFound(); // party workspace is private to its members
  const cur = view.property.currency;
  const m = (c: number) => formatMoney(c, cur);
  const isRep = party.representativeId === viewer.id;
  const me = party.members.find((x) => x.id === viewer.id)!;
  const myIndex = party.members.findIndex((x) => x.id === viewer.id);
  const sel = view.selected;
  const mine = sel?.assignments.find((a) => a.partyId === id);
  const room = mine ? view.rooms.find((r) => r.id === mine.roomId) : null;
  const ex = sel?.explanation.parties.find((p) => p.partyId === id);
  const myVote = view.approval?.votes.find((v) => v.partyId === id) ?? null;
  const myDraft = listDrafts(id).find((d) => d.user_id === viewer.id);
  const stale = view.version?.status === "stale";
  const repName = party.members.find((x) => x.id === party.representativeId)?.name ?? "";
  return (
    <div className="fade-in">
      <GroupNav view={view} active="party" />
      <PageHeader
        eyebrow={`${party.slot} · ${isRep ? "You represent this party" : "Party member"}`}
        title={party.name}
        subtitle={`${me.name}, you're one of ${party.size} traveler${party.size === 1 ? "" : "s"} sharing one bedroom.`}
        actions={<ButtonLink href={`/survey/${id}`} variant="secondary">{party.submitted ? "Edit preferences" : "Open questionnaire"}</ButtonLink>}
      />
      {sp.submitted && <Notice className="mb-6" title="Preferences submitted">Thanks! The organizer will run the allocation once every party is in.</Notice>}
      {sp.shared && <Notice className="mb-6" title="Shared with your representative">{repName} can now see your answers next to theirs.</Notice>}

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          {sel && mine && room && !stale ? (
            <Card className="overflow-hidden">
              <div className="grid sm:grid-cols-[1fr_1.2fr]">
                <RoomArt kind={room.imageKey} className="block h-full min-h-48 w-full" title={room.name} />
                <div className="p-6">
                  <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">{view.group.status === "finalized" ? "Final assignment" : "Proposed assignment"}</div>
                  <div className="mt-1 font-display text-3xl" data-testid="my-room">{room.name}</div>
                  <div className="text-sm text-ink-500">{room.bedConfig} · {room.amenities.map((a) => a.label).slice(0, 2).join(" · ")}</div>
                  <div className="mt-5 flex items-end justify-between gap-3">
                    <div>
                      <div className="text-xs text-ink-400">Party total</div>
                      <div className="money font-display text-4xl" data-testid="my-total">{m(mine.totalCents)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-ink-400">Your share</div>
                      <div className="money font-display text-2xl" data-testid="my-share">{m(mine.perPersonCents[Math.max(0, myIndex)] ?? mine.totalCents)}</div>
                    </div>
                  </div>
                  <dl className="mt-5 space-y-1.5 border-t border-sand-200 pt-4 text-sm">
                    <div className="flex justify-between"><dt className="text-ink-500">Shared house ({mine.size} × traveler share)</dt><dd className="money">{m(mine.sharedCents)}</dd></div>
                    <div className="flex justify-between"><dt className="text-ink-500">{sel.strategies.includes("auction") ? "Room (market price)" : "Bedroom share"}</dt><dd className="money">{m(mine.roomCents)}</dd></div>
                    <div className="flex justify-between font-medium"><dt>Party total</dt><dd className="money">{m(mine.totalCents)}</dd></div>
                    {mine.size > 1 && <div className="flex justify-between text-ink-500"><dt>Per person</dt><dd className="money">{mine.perPersonCents.map(m).join(" + ")}</dd></div>}
                    <div className="flex justify-between text-ink-500"><dt>Share of the rental</dt><dd className="money">{formatBps(mine.shareBps)}</dd></div>
                  </dl>
                  {mine.budgetUseBps != null && (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs"><span className="text-ink-500">Budget used (of your max, private)</span><span className="money">{formatBps(mine.budgetUseBps, 0)}</span></div>
                      <Progress value={mine.budgetUseBps / 10000} tone={mine.budgetUseBps > 10000 ? "bad" : mine.budgetUseBps > 9500 ? "warn" : "pine"} label="Budget used" />
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ) : (
            <Card className="p-6">
              <SectionTitle>Your room</SectionTitle>
              <p className="text-ink-500">
                {stale ? "The last proposal is out of date and is being recalculated." : party.submitted ? "Waiting for the other parties and the organizer's allocation run." : "Submit your party's questionnaire to get a room proposal."}
              </p>
              {!party.submitted && <div className="mt-4"><ButtonLink href={`/survey/${id}`}>Start questionnaire</ButtonLink></div>}
            </Card>
          )}

          {ex && !stale && (
            <Card className="p-6">
              <SectionTitle>Why this room and this price</SectionTitle>
              <p className="mb-4 font-medium">{ex.headline}</p>
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Mathematical facts</div>
                  <ul className="space-y-1.5 text-sm">{[...ex.facts, ...ex.privateFacts].map((f) => <li key={f} className="flex gap-2"><span className="text-pine-500">∑</span>{f}</li>)}</ul>
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Fairness judgments (model)</div>
                  <ul className="space-y-1.5 text-sm">{[...ex.judgments, ...ex.tradeoffs].map((f) => <li key={f} className="flex gap-2"><span className="text-clay-500">◇</span>{f}</li>)}</ul>
                </div>
              </div>
              <div className="mt-4 text-sm"><Link className="text-pine-600 hover:underline" href={`/results/${view.group.id}/pricing`}>See the full pricing breakdown →</Link></div>
            </Card>
          )}

          {sel && !stale && (
            <Card className="p-6">
              <SectionTitle aside={<Link href={`/results/${view.group.id}`} className="text-sm text-pine-600 hover:underline">Group results →</Link>}>Everyone&apos;s rooms</SectionTitle>
              <ul className="divide-y divide-sand-100">
                {sel.assignments.map((a) => {
                  const p = view.parties.find((x) => x.id === a.partyId)!;
                  return (
                    <li key={a.partyId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <span className="min-w-0 truncate"><span className="font-medium">{p.name}</span> <span className="text-ink-500">→ {view.rooms.find((r) => r.id === a.roomId)?.name}</span></span>
                      <Money cents={a.totalCents} currency={cur} className="font-medium" />
                    </li>
                  );
                })}
                <li className="flex justify-between pt-3 text-sm font-semibold"><span>Total</span><Money cents={sel.totalCents} currency={cur} /></li>
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {sel && !stale && view.group.status !== "finalized" && (
            <VotePanel groupId={view.group.id} proposalId={sel.id} current={myVote} canVote={isRep} open={["voting", "approved"].includes(view.group.status)} repName={repName} />
          )}
          {view.group.status === "finalized" && (
            <Notice title="Agreement finalized 🎉">
              <Link className="underline" href={`/results/${view.group.id}/agreement`}>View the final agreement</Link>
            </Notice>
          )}
          <Card className="p-5">
            <div className="mb-3 font-medium">Party members</div>
            <ul className="space-y-2">
              {party.members.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2"><Avatar name={x.name} size={28} />{x.name}{x.id === viewer.id && <span className="text-xs text-ink-400">(you)</span>}</span>
                  {x.role === "representative" && <Badge tone="pine">Representative</Badge>}
                </li>
              ))}
            </ul>
            <div className="mt-4 text-sm text-ink-500">
              Questionnaire: {party.submitted ? <Badge tone="ok">Submitted</Badge> : <Badge>Not submitted</Badge>}
              {!isRep && <span className="ml-2">{myDraft?.shared_at ? <Badge tone="pine">Your input shared</Badge> : <Badge>Your input not shared</Badge>}</span>}
            </div>
            {party.prefs && (
              <div className="mt-3 rounded-xl bg-sand-50 p-3 text-xs text-ink-500">
                Budget (private to your party): {m(party.prefs.idealBudgetCents)} ideal · {m(party.prefs.maxBudgetCents)} max{party.prefs.hardMax ? " (hard)" : ""}
              </div>
            )}
          </Card>
          <PersonalLink />
          {view.group.status !== "finalized" && (
            <div className="text-right">
              <ActionButton action={leavePartyAction.bind(null, view.group.id)} variant="danger" confirm="Leave this party? Approvals will reset.">Leave party</ActionButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
