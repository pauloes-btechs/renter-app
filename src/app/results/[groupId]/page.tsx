import Link from "next/link";
import { GroupNav } from "@/components/GroupNav";
import { ActionButton } from "@/components/client";
import { AllocationMap, ApprovalList, CostTable, FairnessMetrics, StrategyBadges } from "@/components/results";
import { VotePanel } from "@/components/VotePanel";
import { Badge, ButtonLink, Card, EmptyState, Money, Notice, PageHeader, SectionTitle, Stat } from "@/components/ui";
import { finalizeAction, openVotingAction } from "@/app/actions";
import { loadView } from "@/lib/server/page";

export const metadata = { title: "Results" };
export default async function Results({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { viewer, view } = await loadView(groupId, `/results/${groupId}`);
  const sel = view.selected;
  const g = view.group;
  const stale = view.version?.status === "stale";
  const myVote = view.myParty ? view.approval?.votes.find((v) => v.partyId === view.myParty!.id) ?? null : null;

  if (!view.version)
    return (
      <div className="fade-in">
        <GroupNav view={view} active="results" />
        <EmptyState
          title="No allocation yet"
          body={view.missing.length ? `Waiting on: ${view.missing.map((m) => m.name).join(", ")}.` : "Everyone has submitted — the organizer can run the allocation."}
          action={view.isOrganizer && view.missing.length === 0 ? <ButtonLink href={`/group/${groupId}/optimize`}>Run allocation</ButtonLink> : undefined}
        />
      </div>
    );

  if (view.proposals.length === 0)
    return (
      <div className="fade-in">
        <GroupNav view={view} active="results" />
        <PageHeader eyebrow={`Allocation v${view.version.no}`} title="No feasible allocation" subtitle="Hard constraints can't all be satisfied at once. Here's exactly why, and what would fix it." />
        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-6">
            <SectionTitle>Conflicts</SectionTitle>
            <ul className="space-y-2 text-sm">{view.version.diagnosis?.conflicts.map((c) => <li key={c} className="rounded-xl bg-[#fbecea] p-3 text-[#7f2c25]">{c}</li>)}</ul>
          </Card>
          <Card className="p-6">
            <SectionTitle>Ways forward</SectionTitle>
            <ul className="space-y-2 text-sm">{view.version.diagnosis?.suggestions.map((c) => <li key={c} className="rounded-xl bg-sand-50 p-3">{c}</li>)}</ul>
            <div className="mt-4 flex flex-wrap gap-2">
              {view.myParty && <ButtonLink href={`/survey/${view.myParty.id}`} variant="secondary">Edit my party&apos;s answers</ButtonLink>}
              {view.isOrganizer && <ButtonLink href={`/group/${groupId}/property`} variant="secondary">Adjust weights or pricing</ButtonLink>}
            </div>
          </Card>
        </div>
      </div>
    );

  const p = sel ?? view.proposals[0];
  return (
    <div className="fade-in">
      <GroupNav view={view} active="results" />
      {stale && (
        <Notice tone="warn" className="mb-6" title="This proposal is out of date">
          {view.version.staleReason}. Approvals were cleared. {view.isOrganizer ? <Link className="underline" href={`/group/${groupId}/optimize`}>Re-run the allocation</Link> : "The organizer will re-run the allocation."}
        </Notice>
      )}
      <PageHeader
        eyebrow={`Allocation v${view.version.no} · ${p.label}`}
        title={p.explanation.summary}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><StrategyBadges p={p} /><span>{view.version.feasible} feasible arrangements evaluated ({view.version.engine})</span></span>}
        actions={
          <>
            <ButtonLink href={`/results/${groupId}/compare`} variant="secondary">Compare {view.proposals.length} proposals</ButtonLink>
            {view.isOrganizer && g.status === "proposed" && <ActionButton action={openVotingAction.bind(null, groupId)} testId="open-voting">Open voting</ActionButton>}
            {view.isOrganizer && g.status === "approved" && <ActionButton action={finalizeAction.bind(null, groupId)} testId="finalize">Finalize agreement</ActionButton>}
            {g.status === "finalized" && <ButtonLink href={`/results/${groupId}/agreement`}>View agreement</ButtonLink>}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-5"><Stat label="Total cost" value={<Money cents={view.totalCents} currency={view.property.currency} />} hint="allocated exactly" /></Card>
        <Card className="p-5"><Stat label="Travelers" value={p.assignments.reduce((a, x) => a + x.size, 0)} /></Card>
        <Card className="p-5"><Stat label="Parties" value={p.assignments.length} /></Card>
        <Card className="p-5"><Stat label="Approvals" value={`${view.approval?.approvals ?? 0} / ${view.approval?.needed ?? p.assignments.length}`} hint={g.approvalPolicy === "unanimous" ? "all parties must approve" : "majority"} /></Card>
      </div>

      <section className="mb-8"><AllocationMap view={view} proposal={p} /></section>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Card className="p-6">
            <SectionTitle aside={<Link href={`/results/${groupId}/pricing`} className="text-sm text-pine-600 hover:underline">How prices work →</Link>}>Cost breakdown</SectionTitle>
            <CostTable view={view} proposal={p} />
          </Card>
          <Card className="p-6">
            <SectionTitle>Why this allocation</SectionTitle>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Mathematical facts</div>
                <ul className="space-y-1.5 text-sm">{p.explanation.facts.map((f) => <li key={f}>∑ {f}</li>)}</ul>
              </div>
              <div>
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Fairness judgments</div>
                <ul className="space-y-1.5 text-sm">{p.explanation.judgments.map((f) => <li key={f}>◇ {f}</li>)}</ul>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              {p.explanation.parties.map((pe) => (
                <details key={pe.partyId} className="rounded-xl bg-sand-50 p-4" open={pe.partyId === view.myParty?.id}>
                  <summary className="cursor-pointer font-medium">{pe.headline}</summary>
                  <ul className="mt-2 space-y-1 text-sm text-ink-700">
                    {[...pe.facts, ...pe.privateFacts].map((f) => <li key={f}>∑ {f}</li>)}
                    {[...pe.judgments, ...pe.tradeoffs].map((f) => <li key={f} className="text-ink-500">◇ {f}</li>)}
                  </ul>
                </details>
              ))}
            </div>
            {p.explanation.comparison.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">Compared with alternatives</div>
                <ul className="space-y-1 text-sm text-ink-700">{p.explanation.comparison.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          {view.myParty && sel && !stale && g.status !== "finalized" && (
            <VotePanel groupId={groupId} proposalId={sel.id} current={myVote} canVote={view.myParty.representativeId === viewer.id} open={["voting", "approved"].includes(g.status)} repName={view.myParty.members.find((m) => m.id === view.myParty!.representativeId)?.name ?? ""} />
          )}
          <Card className="p-6">
            <SectionTitle aside={<Link href={`/results/${groupId}/discussion`} className="text-sm text-pine-600 hover:underline">Discussion →</Link>}>Approval status</SectionTitle>
            {g.status === "proposed" && <p className="mb-3 text-sm text-ink-500">Voting hasn&apos;t opened yet.</p>}
            <ApprovalList view={view} />
          </Card>
          <Card className="p-6">
            <SectionTitle>Fairness</SectionTitle>
            <FairnessMetrics p={p} />
          </Card>
          {view.isOrganizer && <Badge tone="neutral">Organizer view: party budgets stay private — you see only whether each is within budget.</Badge>}
        </div>
      </div>
    </div>
  );
}
