import { notFound } from "next/navigation";
import { Avatar, ButtonLink, Card, PageHeader } from "@/components/ui";
import { requireViewer } from "@/lib/server/session";
import { getDb } from "@/lib/db/client";
import { getGroupView } from "@/lib/server/views";
import { PersonalLink } from "@/components/PersonalLink";

export const metadata = { title: "Welcome" };
export default async function Onboarding({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params;
  const v = await requireViewer();
  const row = getDb().prepare("SELECT group_id FROM parties WHERE id=?").get(partyId) as { group_id: string } | undefined;
  if (!row) notFound();
  let view;
  try { view = getGroupView(row.group_id, v.id); } catch { notFound(); }
  const party = view.myParty;
  if (!party || party.id !== partyId) notFound();
  const isRep = party.representativeId === v.id;
  return (
    <div className="mx-auto max-w-2xl fade-in">
      <PageHeader eyebrow={`Welcome, ${v.display_name.split(" ")[0]}`} title={`You're in ${party.name}`} subtitle={`${view.group.name} · ${view.property.name}`} />
      <Card className="p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          {party.members.map((m) => (
            <span key={m.id} className="flex items-center gap-2 rounded-full bg-sand-50 py-1 pl-1 pr-3 text-sm">
              <Avatar name={m.name} size={26} />{m.name}{m.role === "representative" && <span className="text-xs text-pine-600">· rep</span>}
            </span>
          ))}
        </div>
        <ol className="mt-6 space-y-4">
          {[
            { t: "Your party shares one bedroom", b: `Up to ${view.group.maxPartySize} people. Your party pays one combined amount; you'll also see your personal share.` },
            {
              t: isRep ? "You're the representative" : "Share your input",
              b: isRep
                ? "Fill in the questionnaire and submit it for your party. Any other member's input will appear next to yours so you can reconcile differences."
                : "Fill in your own answers — your representative sees them and submits the final version for your party.",
            },
            { t: "Then review and vote", b: "Once everyone has submitted, the organizer runs the allocation. Your representative approves or requests changes." },
          ].map((s, i) => (
            <li key={i} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pine-50 font-display text-pine-700">{i + 1}</span>
              <div><div className="font-medium">{s.t}</div><div className="text-sm text-ink-500">{s.b}</div></div>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-wrap gap-2">
          <ButtonLink href={`/survey/${party.id}`}>Start the questionnaire</ButtonLink>
          <ButtonLink href={`/party/${party.id}`} variant="secondary">Party dashboard</ButtonLink>
        </div>
      </Card>
      <div className="mt-6"><PersonalLink /></div>
    </div>
  );
}
