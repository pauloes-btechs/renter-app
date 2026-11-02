import Link from "next/link";
import { GroupNav } from "@/components/GroupNav";
import { ActionButton } from "@/components/client";
import { ApprovalList } from "@/components/results";
import { Avatar, Badge, ButtonLink, Card, Notice, PageHeader, Progress, SectionTitle, Stat, Money } from "@/components/ui";
import { finalizeAction, openVotingAction, startCollectingAction } from "@/app/actions";
import { loadView } from "@/lib/server/page";

export const metadata = { title: "Group dashboard" };

function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default async function GroupDashboard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadView(id, `/group/${id}`);
  const g = view.group;
  const joined = view.parties.filter((p) => p.members.length > 0);
  const submitted = view.parties.filter((p) => p.submitted);
  const needBids = view.pricing.method !== "weighted";
  const done = view.parties.filter((p) => p.submitted && (!needBids || p.hasBids)).length;
  const completion = view.parties.length ? done / view.parties.length : 0;

  const next = (() => {
    if (!view.isOrganizer) return null;
    switch (g.status) {
      case "draft":
        return { title: "Review the house, then invite parties", body: "Check bedrooms, weights and the total before anyone sees prices.", cta: <><ButtonLink href={`/group/${g.id}/property`} variant="secondary">Review property</ButtonLink><ActionButton action={startCollectingAction.bind(null, g.id)}>Start inviting</ActionButton></> };
      case "collecting":
        return { title: `Waiting on ${view.missing.length} part${view.missing.length === 1 ? "y" : "ies"}`, body: view.missing.map((m) => `${m.name}: ${m.reason.toLowerCase()}`).join(" · "), cta: <ButtonLink href={`/group/${g.id}/invites`}>Manage invitations</ButtonLink> };
      case "ready":
        return { title: "Everyone's in — run the allocation", body: "The engine evaluates every feasible room assignment and prices each to the cent.", cta: <ButtonLink href={`/group/${g.id}/optimize`}>Run allocation</ButtonLink> };
      case "proposed":
        return { title: "Review proposals, then open voting", body: `"${view.selected?.label}" is selected as the group's preferred plan.`, cta: <><ButtonLink href={`/results/${g.id}/compare`} variant="secondary">Compare proposals</ButtonLink><ActionButton action={openVotingAction.bind(null, g.id)} testId="open-voting">Open voting</ActionButton></> };
      case "voting":
        return { title: `Approvals: ${view.approval?.approvals ?? 0} of ${view.approval?.needed ?? 0} needed`, body: "Each party's representative approves or requests changes.", cta: <ButtonLink href={`/results/${g.id}/discussion`}>View discussion</ButtonLink> };
      case "approved":
        return { title: "Approved — finalize the agreement", body: "This locks the plan and records what each party owes.", cta: <ActionButton action={finalizeAction.bind(null, g.id)} testId="finalize">Finalize agreement</ActionButton> };
      case "finalized":
        return { title: "Finalized", body: "The agreement is locked.", cta: <ButtonLink href={`/results/${g.id}/agreement`}>View agreement</ButtonLink> };
    }
  })();

  return (
    <div className="fade-in">
      <GroupNav view={view} active="overview" />
      <PageHeader
        eyebrow={view.isOrganizer ? "Organizer dashboard" : "Group overview"}
        title={view.property.name}
        subtitle={`${view.property.location}${view.property.checkIn ? ` · ${view.property.checkIn} → ${view.property.checkOut}` : ""} · organized by ${view.organizerName}`}
        actions={view.myParty ? <ButtonLink href={`/party/${view.myParty.id}`} variant="secondary">My party</ButtonLink> : undefined}
      />

      {view.version?.status === "stale" && (
        <Notice tone="warn" className="mb-6" title="The last proposal is out of date">
          {view.version.staleReason}. Approvals were cleared{view.isOrganizer ? " — re-run the allocation once everyone has submitted." : "."}
        </Notice>
      )}

      {next && (
        <Card className="mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">Next step</div>
            <div className="mt-1 font-display text-2xl">{next.title}</div>
            <div className="mt-1 text-sm text-ink-500">{next.body}</div>
          </div>
          <div className="flex flex-wrap gap-2">{next.cta}</div>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-5"><Stat label="Total rental" value={<Money cents={view.totalCents} currency={view.property.currency} />} /></Card>
        <Card className="p-5"><Stat label="Parties" value={`${joined.length} / ${view.parties.length}`} hint={`max ${g.maxParties}`} /></Card>
        <Card className="p-5"><Stat label="Travelers" value={view.travelers} hint={`up to ${g.maxPartySize} per party`} /></Card>
        <Card className="p-5"><Stat label="Bedrooms" value={view.rooms.length} hint={view.pricing.method === "weighted" ? "weighted pricing" : view.pricing.method === "auction" ? "auction pricing" : "weighted + auction"} /></Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <SectionTitle aside={<span className="text-sm text-ink-500">{submitted.length} of {view.parties.length} submitted</span>}>Questionnaires</SectionTitle>
          <Progress value={completion} label="Questionnaire completion" />
          <ul className="mt-5 divide-y divide-sand-100">
            {view.parties.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`party-row-${p.slot}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex -space-x-2">
                    {p.members.length ? p.members.map((m) => <Avatar key={m.id} name={m.name} size={30} />) : <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-dashed border-sand-300 text-xs text-ink-400">?</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium">{p.name}</div>
                    <div className="truncate text-xs text-ink-500">{p.slot} · {p.members.length ? p.members.map((m) => m.name + (m.role === "representative" ? " (rep)" : "")).join(", ") : "nobody has joined"}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.members.length === 0 ? <Badge>Invite pending</Badge> : p.submitted ? <Badge tone="ok">Submitted</Badge> : p.draftStarted ? <Badge tone="warn">In progress</Badge> : <Badge>Not started</Badge>}
                  {needBids && p.submitted && (p.hasBids ? <Badge tone="pine">Bids in</Badge> : <Badge tone="warn">No bids</Badge>)}
                </div>
              </li>
            ))}
          </ul>
          {view.isOrganizer && (
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href={`/group/${g.id}/invites`} variant="secondary">Invitations</ButtonLink>
              {["ready", "proposed", "voting", "approved"].includes(g.status) && <ButtonLink href={`/group/${g.id}/optimize`} variant="secondary">Re-run allocation</ButtonLink>}
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="p-6">
            <SectionTitle aside={view.selected && <Link href={`/results/${g.id}`} className="text-sm text-pine-600 hover:underline">Results →</Link>}>Proposal</SectionTitle>
            {view.selected ? (
              <>
                <div className="mb-3 text-sm text-ink-500">v{view.version?.no} · {view.selected.label}</div>
                <ApprovalList view={view} />
              </>
            ) : view.version?.diagnosis ? (
              <Notice tone="bad" title="No feasible allocation">{view.version.diagnosis.conflicts[0]}</Notice>
            ) : (
              <p className="text-sm text-ink-500">No proposal yet. It appears here once the organizer runs the allocation.</p>
            )}
          </Card>
          <Card className="p-6">
            <SectionTitle>Activity</SectionTitle>
            <ul className="max-h-80 space-y-3 overflow-y-auto pr-1 text-sm">
              {view.activity.map((a) => (
                <li key={a.id} className="flex gap-3">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pine-500" />
                  <span className="min-w-0"><span className="text-ink-700">{a.message}</span> <span className="text-xs text-ink-400">{timeAgo(a.at)}</span></span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
