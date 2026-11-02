import { notFound } from "next/navigation";
import { GroupNav } from "@/components/GroupNav";
import { Notice, PageHeader, ButtonLink } from "@/components/ui";
import { loadView } from "@/lib/server/page";
import { OptimizeRunner } from "./runner";

export const metadata = { title: "Run allocation" };
export default async function OptimizePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadView(id, `/group/${id}/optimize`);
  if (!view.isOrganizer) notFound();
  const n = view.parties.length;
  const r = view.rooms.length;
  let perms = 1;
  for (let i = 0; i < Math.min(n, r); i++) perms *= r - i;
  return (
    <div className="fade-in">
      <GroupNav view={view} active="overview" />
      <PageHeader eyebrow="Allocation engine" title="Find the fairest arrangement" subtitle={`${n} parties × ${r} bedrooms → up to ${perms.toLocaleString()} possible assignments, each priced to the cent.`} />
      {view.missing.length > 0 ? (
        <Notice tone="warn" title="Not everyone is ready">
          {view.missing.map((m) => `${m.name}: ${m.reason.toLowerCase()}`).join(" · ")}
          <div className="mt-3"><ButtonLink href={`/group/${id}`} variant="secondary">Back to dashboard</ButtonLink></div>
        </Notice>
      ) : view.group.status === "finalized" ? (
        <Notice tone="warn" title="Finalized">Reopen the agreement to recalculate.</Notice>
      ) : (
        <OptimizeRunner groupId={id} parties={n} rooms={r} perms={perms} auction={view.pricing.method !== "weighted"} />
      )}
    </div>
  );
}
