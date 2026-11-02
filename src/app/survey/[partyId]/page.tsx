import { notFound } from "next/navigation";
import { GroupNav } from "@/components/GroupNav";
import { PageHeader } from "@/components/ui";
import { getDb } from "@/lib/db/client";
import { diffQuestionnaires } from "@/lib/domain/questionnaire";
import { loadView } from "@/lib/server/page";
import { listDrafts } from "@/lib/server/repo";
import { getDraft } from "@/lib/server/services/questionnaire";
import { Survey } from "./survey";

export const metadata = { title: "Party questionnaire" };
export default async function SurveyPage({ params }: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await params;
  const row = getDb().prepare("SELECT group_id FROM parties WHERE id=?").get(partyId) as { group_id: string } | undefined;
  if (!row) notFound();
  const { viewer, view } = await loadView(row.group_id, `/survey/${partyId}`);
  if (view.myParty?.id !== partyId) notFound(); // only this party's members
  const draft = getDraft(viewer.id, partyId);
  const party = view.myParty;
  const isRep = party.representativeId === viewer.id || party.members.length === 1;
  const others = listDrafts(partyId)
    .filter((d) => d.user_id !== viewer.id && (isRep ? !!d.shared_at : true))
    .map((d) => ({ name: d.display_name, shared: !!d.shared_at, data: d.data, diffs: diffQuestionnaires(draft, d.data) }));
  const otherTravelers = view.parties.filter((p) => p.id !== partyId && p.members.length > 0).reduce((a, p) => a + p.size, 0);
  return (
    <div className="fade-in">
      <GroupNav view={view} active="party" />
      <PageHeader eyebrow={party.name} title="Your party's preferences" subtitle="Answers save automatically. Budgets are for your whole party, and only your party can see them." />
      <Survey
        partyId={partyId}
        initial={draft}
        rooms={view.rooms}
        config={{ totalCents: view.totalCents, sharedBps: view.pricing.sharedBps }}
        currency={view.property.currency}
        otherTravelers={otherTravelers}
        partyCount={view.parties.length}
        isRep={isRep}
        memberCount={party.members.length}
        maxPartySize={view.group.maxPartySize}
        method={view.pricing.method}
        others={others}
        submittedAt={party.submittedAt}
        locked={view.group.status === "finalized"}
        repName={party.members.find((m) => m.id === party.representativeId)?.name ?? ""}
      />
    </div>
  );
}
