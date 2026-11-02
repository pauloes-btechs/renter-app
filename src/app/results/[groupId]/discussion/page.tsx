import { GroupNav } from "@/components/GroupNav";
import { ApprovalList } from "@/components/results";
import { Avatar, Badge, Card, PageHeader, SectionTitle } from "@/components/ui";
import { loadView } from "@/lib/server/page";
import { CommentBox } from "./comment";

export const metadata = { title: "Approval & discussion" };
export default async function Discussion({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const { view } = await loadView(groupId, `/results/${groupId}/discussion`);
  return (
    <div className="fade-in">
      <GroupNav view={view} active="discussion" />
      <PageHeader eyebrow="Approval & discussion" title={view.selected ? `Discussing “${view.selected.label}”` : "Discussion"} subtitle={`Policy: ${view.group.approvalPolicy === "unanimous" ? "every participating party must approve" : "a majority of parties must approve"}. Any change to prices, rooms, membership or preferences clears approvals.`} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-6">
          <SectionTitle>Conversation</SectionTitle>
          {view.group.status !== "finalized" && <CommentBox groupId={groupId} />}
          <ul className="mt-6 space-y-4">
            {view.comments.length === 0 && <li className="text-sm text-ink-400">No comments yet.</li>}
            {view.comments.map((c) => {
              const party = view.parties.find((p) => p.id === c.partyId);
              const vote = view.approval?.votes.find((v) => v.partyId === c.partyId && v.comment === c.body);
              return (
                <li key={c.id} className="flex gap-3">
                  <Avatar name={c.by} size={34} />
                  <div className="min-w-0 flex-1 rounded-2xl bg-sand-50 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                      <span className="font-medium text-ink-900">{c.by}</span>
                      {party && <span>{party.name}</span>}
                      {vote && (vote.decision === "approve" ? <Badge tone="ok">with approval</Badge> : <Badge tone="warn">requested changes</Badge>)}
                      <span>{new Date(c.at).toLocaleString()}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{c.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <div className="space-y-6">
          <Card className="p-6">
            <SectionTitle aside={<span className="text-sm text-ink-500">{view.approval?.approvals ?? 0} / {view.approval?.needed ?? 0}</span>}>Who has approved</SectionTitle>
            <ApprovalList view={view} />
          </Card>
          <Card className="p-6">
            <SectionTitle>Proposal history</SectionTitle>
            <ul className="space-y-2 text-sm">
              {view.versions.map((v) => (
                <li key={v.no} className="flex items-start justify-between gap-2">
                  <span>v{v.no} · {new Date(v.at).toLocaleString()}{v.staleReason && <span className="block text-xs text-ink-500">{v.staleReason}</span>}</span>
                  <Badge tone={v.status === "current" ? "pine" : "neutral"}>{v.status}</Badge>
                </li>
              ))}
              {view.versions.length === 0 && <li className="text-ink-400">No proposals yet.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
