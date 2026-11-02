import { Avatar, Card, Notice, PageHeader, ButtonLink } from "@/components/ui";
import { resolveInvitation } from "@/lib/server/services/parties";
import { getViewer } from "@/lib/server/session";
import { getDb } from "@/lib/db/client";
import { JoinForm } from "./form";

export const metadata = { title: "Join a group" };
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = resolveInvitation(token);
  const viewer = await getViewer();
  if (!r.ok)
    return (
      <div className="mx-auto max-w-lg py-10">
        <Notice tone="warn" title="Invitation unavailable">{r.reason}</Notice>
        <div className="mt-4"><ButtonLink href="/" variant="secondary">Home</ButtonLink></div>
      </div>
    );
  const already = viewer
    ? (getDb().prepare("SELECT party_id FROM party_memberships WHERE group_id=? AND user_id=? AND left_at IS NULL").get(r.group.id, viewer.id) as { party_id: string } | undefined)
    : undefined;
  return (
    <div className="mx-auto max-w-xl fade-in">
      <PageHeader eyebrow="You're invited" title={r.group.name} subtitle={r.party ? `Join ${r.party.name} — one bedroom, up to ${r.group.maxPartySize} people.` : "Pick the party you're traveling with."} />
      {already ? (
        <Notice title="You're already in this group">
          <a className="underline" href={`/party/${already.party_id}`}>Go to your party →</a>
        </Notice>
      ) : (
        <Card className="p-6 sm:p-8">
          {r.party && (
            <div className="mb-6 flex items-center gap-3 rounded-xl bg-sand-50 p-4">
              <div className="flex -space-x-2">{r.party.members.map((m) => <Avatar key={m} name={m} />)}</div>
              <div className="text-sm text-ink-700">
                {r.party.members.length === 0 ? "You'll be the first in this party and its representative." : `With ${r.party.members.join(" & ")}`}
              </div>
            </div>
          )}
          <JoinForm
            token={token}
            defaultName={viewer?.display_name ?? ""}
            parties={r.party ? null : r.openParties.map((p) => ({ id: p.id, label: `${p.name}${p.members.length ? ` (${p.members.join(", ")})` : " — empty"}` }))}
          />
        </Card>
      )}
    </div>
  );
}
