import { GroupNav } from "@/components/GroupNav";
import { RoomArt } from "@/components/RoomArt";
import { Badge, Card, Money, Notice, PageHeader, SectionTitle } from "@/components/ui";
import { loadView } from "@/lib/server/page";
import { previewRoomPrice } from "@/lib/engine/pricing";
import { formatBps } from "@/lib/engine/money";
import { PropertyEditor } from "./editor";

export const metadata = { title: "Property & bedrooms" };
export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadView(id, `/group/${id}/property`);
  const totalW = view.rooms.reduce((a, r) => a + r.weightMilli, 0);
  const travelers = Math.max(view.travelers, view.parties.length);
  const prev1 = previewRoomPrice({ totalCents: view.totalCents, sharedBps: view.pricing.sharedBps }, view.rooms, view.rooms.map((r) => r.id), travelers, 1);
  const prev2 = previewRoomPrice({ totalCents: view.totalCents, sharedBps: view.pricing.sharedBps }, view.rooms, view.rooms.map((r) => r.id), travelers, 2);
  const locked = view.group.status === "finalized";
  return (
    <div className="fade-in">
      <GroupNav view={view} active="property" />
      <PageHeader
        eyebrow="Property & bedrooms"
        title={view.property.name}
        subtitle={view.isOrganizer ? "Everything here feeds the pricing model. Changing a price, weight or room clears approvals on the current proposal." : "Read-only — the organizer manages these settings."}
      />
      {locked && <Notice tone="warn" className="mb-6" title="Finalized">Reopen the agreement to make changes.</Notice>}
      {view.isOrganizer && !locked ? (
        <PropertyEditor view={view} previews={{ one: prev1, two: prev2 }} />
      ) : (
        <>
          <Card className="mb-6 p-6">
            <SectionTitle>Pricing</SectionTitle>
            <p className="text-ink-700">
              <Money cents={view.totalCents} currency={view.property.currency} /> total · {formatBps(view.pricing.sharedBps, 0)} shared per traveler · {formatBps(10000 - view.pricing.sharedBps, 0)} by bedroom weight
            </p>
            <ul className="mt-2 text-sm text-ink-500">{view.costItems.map((c) => <li key={c.label}>{c.label}: <Money cents={c.amountCents} currency={view.property.currency} /></li>)}</ul>
          </Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {view.rooms.map((r) => (
              <Card key={r.id} className="overflow-hidden">
                <RoomArt kind={r.imageKey} className="block aspect-[16/9] w-full" />
                <div className="p-5">
                  <div className="font-display text-xl">{r.name}</div>
                  <div className="text-sm text-ink-500">{r.bedConfig} · sleeps {r.capacity} · weight {(r.weightMilli / 1000).toFixed(2)} ({((r.weightMilli / totalW) * 100).toFixed(0)}% of bedroom pool)</div>
                  <p className="mt-2 text-sm text-ink-700">{r.description}</p>
                  <div className="mt-3 flex flex-wrap gap-1">{r.amenities.map((a) => <Badge key={a.label}>{a.label}</Badge>)}</div>
                  <div className="mt-3 text-sm">Indicative: <Money cents={prev1[r.id]} /> solo · <Money cents={prev2[r.id]} /> for two</div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
