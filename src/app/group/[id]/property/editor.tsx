"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteRoomAction, setCostItemsAction, startCollectingAction, updatePricingAction, updatePropertyAction, updateRulesAction, upsertRoomAction,
} from "@/app/actions";
import { RoomImage } from "@/components/RoomArt";
import { Badge, Card, Notice, SectionTitle, btn, cx } from "@/components/ui";
import { formatMoney } from "@/lib/engine/money";
import { ATTRIBUTE_KEYS, PRIORITY_LABELS, type AttributeKey } from "@/lib/engine/types";
import type { GroupView, RoomView } from "@/lib/server/views";
import type { ActionResult } from "@/app/actions";

const field = "mt-1 w-full rounded-xl border border-sand-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-pine-500 focus:outline-none";
const lab = "text-xs font-medium text-ink-500";

function useSave() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = (fn: () => Promise<ActionResult<unknown>>, okText = "Saved") =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? { ok: true, text: typeof r.data === "string" ? r.data : okText } : { ok: false, text: r.error });
      if (r.ok) {
        if (r.redirect) router.push(r.redirect);
        else router.refresh();
      }
    });
  return { pending, msg, save };
}

function Msg({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <span role={msg.ok ? "status" : "alert"} className={cx("text-sm", msg.ok ? "text-ok-500" : "text-bad-500")}>{msg.text}</span>;
}

export function PropertyEditor({ view, previews }: { view: GroupView; previews: { one: Record<string, number>; two: Record<string, number> } }) {
  const g = view.group.id;
  const cur = view.property.currency;
  return (
    <div className="space-y-6">
      {view.group.status === "draft" && (
        <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Looks right?</div>
            <div className="text-sm text-ink-500">Confirm the property to start inviting parties. You can still edit later — approvals reset if prices change.</div>
          </div>
          <StartButton groupId={g} />
        </Card>
      )}
      <Details view={view} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Costs view={view} />
        <Pricing view={view} />
      </div>
      <Rules view={view} />
      <Card className="p-6">
        <SectionTitle aside={<span className="text-xs text-ink-400">Weights are editable assumptions, not market valuations</span>}>Bedrooms</SectionTitle>
        <p className="mb-4 text-sm text-ink-500">
          A room&apos;s weight sets its share of the bedroom pool ({formatMoney(Math.round((view.totalCents * (10000 - view.pricing.sharedBps)) / 10000), cur)}). Rooms 2 and 3 have
          similar baseline weights even though one has a view and the other a massage chair — travelers&apos; rankings decide who values which more.
        </p>
        <div className="space-y-4">
          {view.rooms.map((r) => (
            <RoomEditor key={r.id} groupId={g} room={r} totalW={view.rooms.reduce((a, x) => a + x.weightMilli, 0)} preview1={previews.one[r.id]} preview2={previews.two[r.id]} currency={cur} canDelete={view.rooms.length > 1} />
          ))}
          <RoomEditor groupId={g} room={null} totalW={0} currency={cur} canDelete={false} />
        </div>
      </Card>
    </div>
  );
}

function StartButton({ groupId }: { groupId: string }) {
  const { pending, msg, save } = useSave();
  return (
    <span className="flex items-center gap-3">
      <Msg msg={msg} />
      <button className={btn.primary} disabled={pending} onClick={() => save(() => startCollectingAction(groupId))} data-testid="start-collecting">
        Confirm & invite parties
      </button>
    </span>
  );
}

function Details({ view }: { view: GroupView }) {
  const p = view.property;
  const [f, setF] = useState({
    name: p.name, location: p.location, description: p.description, currency: p.currency, listingUrl: p.listingUrl ?? "",
    sharedAmenities: p.sharedAmenities.join(", "), checkIn: p.checkIn ?? "", checkOut: p.checkOut ?? "",
  });
  const { pending, msg, save } = useSave();
  const payload = () => ({ ...f, sharedAmenities: f.sharedAmenities.split(",").map((s) => s.trim()).filter(Boolean) });
  return (
    <Card className="p-6">
      <SectionTitle>Property details</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <label><span className={lab}>Name</span><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><span className={lab}>Location</span><input className={field} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
        <label className="sm:col-span-2"><span className={lab}>Description</span><textarea rows={2} className={field} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label><span className={lab}>Check-in</span><input type="date" className={field} value={f.checkIn} onChange={(e) => setF({ ...f, checkIn: e.target.value })} /></label>
        <label><span className={lab}>Check-out</span><input type="date" className={field} value={f.checkOut} onChange={(e) => setF({ ...f, checkOut: e.target.value })} /></label>
        <label><span className={lab}>Currency</span>
          <select className={field} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "JPY"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label><span className={lab}>Shared amenities (comma-separated)</span><input className={field} value={f.sharedAmenities} onChange={(e) => setF({ ...f, sharedAmenities: e.target.value })} /></label>
      </div>
      <label className="mt-4 block">
        <span className={lab}>Listing link</span>
        <input className={field} placeholder="https://www.airbnb.com/rooms/…" value={f.listingUrl} onChange={(e) => setF({ ...f, listingUrl: e.target.value })} aria-label="Listing URL" />
      </label>
      <div className="mt-4 flex items-center justify-end gap-3">
        <Msg msg={msg} />
        <button className={btn.primary} disabled={pending} onClick={() => save(() => updatePropertyAction(view.group.id, payload()))}>Save details</button>
      </div>
    </Card>
  );
}

function Costs({ view }: { view: GroupView }) {
  const [items, setItems] = useState(view.costItems.map((c) => ({ ...c, amount: (c.amountCents / 100).toFixed(2) })));
  const { pending, msg, save } = useSave();
  const total = items.reduce((a, i) => a + Math.round((parseFloat(i.amount) || 0) * 100), 0);
  return (
    <Card className="p-6">
      <SectionTitle>Rental cost</SectionTitle>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_110px_120px_32px] items-end gap-2">
            <label><span className="sr-only">Label</span><input className={field} value={it.label} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></label>
            <label><span className="sr-only">Kind</span>
              <select className={field} value={it.kind} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}>
                {["base", "cleaning", "tax", "service", "other"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label><span className="sr-only">Amount</span><input inputMode="decimal" className={field + " money text-right"} value={it.amount} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-label={`${it.label} amount`} /></label>
            <button className={btn.ghost + " !px-2"} aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
      </div>
      <button className={btn.small + " mt-3"} onClick={() => setItems([...items, { label: "Cleaning fee", kind: "cleaning", amountCents: 0, amount: "0.00" }])}>+ Add fee or tax</button>
      <div className="mt-4 flex items-center justify-between border-t border-sand-200 pt-4">
        <div><div className={lab}>Total for the stay</div><div className="money font-display text-2xl">{formatMoney(total, view.property.currency)}</div></div>
        <span className="flex items-center gap-3">
          <Msg msg={msg} />
          <button
            className={btn.primary}
            disabled={pending}
            onClick={() => save(() => setCostItemsAction(view.group.id, items.map((i) => ({ label: i.label, kind: i.kind as "base", amountCents: Math.round((parseFloat(i.amount) || 0) * 100) }))))}
            data-testid="save-costs"
          >
            Save costs
          </button>
        </span>
      </div>
    </Card>
  );
}

function Pricing({ view }: { view: GroupView }) {
  const [shared, setShared] = useState(view.pricing.sharedBps / 100);
  const [method, setMethod] = useState(view.pricing.method);
  const { pending, msg, save } = useSave();
  const cur = view.property.currency;
  return (
    <Card className="p-6">
      <SectionTitle>Pricing model</SectionTitle>
      <label className="block">
        <span className="text-sm">
          <strong>{shared}%</strong> shared house (split per traveler) · <strong>{100 - shared}%</strong> by bedroom
        </span>
        <input type="range" min={0} max={100} step={1} value={shared} onChange={(e) => setShared(Number(e.target.value))} className="mt-2 w-full" aria-label="Shared percentage" />
      </label>
      <p className="mt-1 text-xs text-ink-500">
        Shared pool {formatMoney(Math.round((view.totalCents * shared) / 100), cur)} · bedroom pool {formatMoney(view.totalCents - Math.round(view.totalCents * shared / 100), cur)}. More shared → larger parties pay relatively more.
      </p>
      <fieldset className="mt-5">
        <legend className="text-sm font-medium">How room prices are set</legend>
        <div className="mt-2 space-y-2">
          {([
            ["weighted", "Weighted", "Fixed room weights. Predictable and transparent (default)."],
            ["hybrid", "Weighted + auction comparison", "Parties also bid; the market result appears as an extra proposal for price discovery."],
            ["auction", "Auction-led", "Sealed bids decide rooms and envy-free prices; the market proposal is recommended."],
          ] as const).map(([k, t, d]) => (
            <label key={k} className={cx("flex cursor-pointer gap-3 rounded-xl border p-3", method === k ? "border-pine-500 bg-pine-50" : "border-sand-200")}>
              <input type="radio" name="method" className="mt-1" checked={method === k} onChange={() => setMethod(k)} />
              <span><span className="block text-sm font-medium">{t}</span><span className="block text-xs text-ink-500">{d}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-4 flex items-center justify-end gap-3">
        <Msg msg={msg} />
        <button className={btn.primary} disabled={pending} onClick={() => save(() => updatePricingAction(view.group.id, { sharedBps: Math.round(shared * 100), method }))} data-testid="save-pricing">
          Save pricing
        </button>
      </div>
    </Card>
  );
}

function Rules({ view }: { view: GroupView }) {
  const [f, setF] = useState({ name: view.group.name, maxParties: view.group.maxParties, maxPartySize: view.group.maxPartySize, approvalPolicy: view.group.approvalPolicy });
  const { pending, msg, save } = useSave();
  return (
    <Card className="p-6">
      <SectionTitle>Group rules</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-4">
        <label className="sm:col-span-1"><span className={lab}>Group name</span><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label><span className={lab}>Max parties</span><input type="number" min={1} max={26} className={field} value={f.maxParties} onChange={(e) => setF({ ...f, maxParties: Number(e.target.value) })} /></label>
        <label><span className={lab}>Max people per party</span><input type="number" min={1} max={12} className={field} value={f.maxPartySize} onChange={(e) => setF({ ...f, maxPartySize: Number(e.target.value) })} /></label>
        <label><span className={lab}>Approval policy</span>
          <select className={field} value={f.approvalPolicy} onChange={(e) => setF({ ...f, approvalPolicy: e.target.value as "unanimous" })}>
            <option value="unanimous">Every party must approve</option>
            <option value="majority">Majority of parties</option>
          </select>
        </label>
      </div>
      <div className="mt-4 flex items-center justify-end gap-3">
        <Msg msg={msg} />
        <button className={btn.primary} disabled={pending} onClick={() => save(() => updateRulesAction(view.group.id, f))}>Save rules</button>
      </div>
    </Card>
  );
}

const IMAGE_KEYS = ["master", "view", "comfort", "bunk", "generic"] as const;

function RoomEditor({ groupId, room, totalW, preview1, preview2, currency, canDelete }: { groupId: string; room: RoomView | null; totalW: number; preview1?: number; preview2?: number; currency: string; canDelete: boolean }) {
  const blank = {
    name: "", shortName: "", bedConfig: "Queen bed", capacity: 2, bedCount: 1, hasBunk: false, accessible: false, weight: "1.00", qualityRating: 3, description: "", imageKey: "generic" as (typeof IMAGE_KEYS)[number],
    attributes: { privacy: 0.5, privateBath: 0, view: 0.3, bedComfort: 0.6, roomSize: 0.5, relaxation: 0.2, quality: 0.6 } as Record<AttributeKey, number>, amenities: "",
  };
  const init = room
    ? { ...room, weight: (room.weightMilli / 1000).toFixed(2), amenities: room.amenities.map((a) => a.label).join(", ") }
    : blank;
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(init);
  const { pending, msg, save } = useSave();
  if (!room && !open)
    return (
      <button className={btn.secondary + " w-full !rounded-2xl border-dashed"} onClick={() => setOpen(true)}>+ Add a bedroom</button>
    );
  const payload = () => ({
    id: room?.id, name: f.name, shortName: f.shortName, bedConfig: f.bedConfig, capacity: Number(f.capacity), bedCount: Number(f.bedCount), hasBunk: f.hasBunk, accessible: f.accessible,
    weightMilli: Math.round((parseFloat(f.weight) || 0) * 1000), qualityRating: Number(f.qualityRating), description: f.description, imageKey: f.imageKey, attributes: f.attributes,
    amenities: f.amenities.split(",").map((s) => s.trim()).filter(Boolean),
  });
  return (
    <div className="rounded-2xl border border-sand-200">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
        <RoomImage room={{ imageKey: f.imageKey, photo: room?.photo }} className="h-24 w-full shrink-0 rounded-xl sm:w-40" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg">{f.name || "New bedroom"}</span>
            {room && <Badge tone="pine">weight {(room.weightMilli / 1000).toFixed(2)} · {totalW ? ((room.weightMilli / totalW) * 100).toFixed(1) : 0}% of bedroom pool</Badge>}
          </div>
          <div className="text-sm text-ink-500">{f.bedConfig} · sleeps {f.capacity} · {f.bedCount} sleeping surface{Number(f.bedCount) === 1 ? "" : "s"}{f.hasBunk ? " · bunks" : ""}{f.accessible ? " · accessible" : ""}</div>
          {room && preview1 != null && (
            <div className="mt-1 text-sm">Indicative price: <span className="money">{formatMoney(preview1, currency)}</span> solo · <span className="money">{formatMoney(preview2!, currency)}</span> for two</div>
          )}
        </div>
        <button className={btn.small} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Edit"}</button>
      </div>
      {open && (
        <div className="border-t border-sand-200 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className={lab}>Name</span><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label><span className={lab}>Label</span><input className={field} value={f.shortName} onChange={(e) => setF({ ...f, shortName: e.target.value })} placeholder="Bedroom 5" /></label>
            <label><span className={lab}>Bed configuration</span><input className={field} value={f.bedConfig} onChange={(e) => setF({ ...f, bedConfig: e.target.value })} /></label>
            <label><span className={lab}>Sleeps</span><input type="number" min={1} max={12} className={field} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Number(e.target.value) })} /></label>
            <label><span className={lab}>Separate sleeping surfaces</span><input type="number" min={1} max={12} className={field} value={f.bedCount} onChange={(e) => setF({ ...f, bedCount: Number(e.target.value) })} /></label>
            <label><span className={lab}>Pricing weight</span><input inputMode="decimal" className={field + " money"} value={f.weight} onChange={(e) => setF({ ...f, weight: e.target.value })} /></label>
            <label><span className={lab}>Quality rating (1–5)</span><input type="number" min={1} max={5} className={field} value={f.qualityRating} onChange={(e) => setF({ ...f, qualityRating: Number(e.target.value) })} /></label>
            <label><span className={lab}>Illustration</span>
              <select className={field} value={f.imageKey} onChange={(e) => setF({ ...f, imageKey: e.target.value as "generic" })}>{IMAGE_KEYS.map((k) => <option key={k}>{k}</option>)}</select>
            </label>
            <div className="flex items-end gap-4 pb-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.hasBunk} onChange={(e) => setF({ ...f, hasBunk: e.target.checked })} /> Bunks</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.accessible} onChange={(e) => setF({ ...f, accessible: e.target.checked })} /> Accessible</label>
            </div>
            <label className="sm:col-span-3"><span className={lab}>Description</span><input className={field} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
            <label className="sm:col-span-3"><span className={lab}>Amenities (comma-separated)</span><input className={field} value={f.amenities} onChange={(e) => setF({ ...f, amenities: e.target.value })} /></label>
          </div>
          <div className="mt-4">
            <div className={lab}>How strongly this room offers each attribute (used to match priorities)</div>
            <div className="mt-2 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {ATTRIBUTE_KEYS.map((k) => (
                <label key={k} className="grid grid-cols-[150px_1fr_36px] items-center gap-2 text-sm">
                  <span>{PRIORITY_LABELS[k]}</span>
                  <input type="range" min={0} max={1} step={0.05} value={f.attributes[k]} onChange={(e) => setF({ ...f, attributes: { ...f.attributes, [k]: Number(e.target.value) } })} aria-label={`${PRIORITY_LABELS[k]} level`} />
                  <span className="money text-right text-xs text-ink-500">{f.attributes[k].toFixed(2)}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
            <Msg msg={msg} />
            {room && canDelete && <button className={btn.danger} disabled={pending} onClick={() => save(() => deleteRoomAction(groupId, room.id), "Removed")}>Remove room</button>}
            <button className={btn.primary} disabled={pending || !f.name} onClick={() => save(() => upsertRoomAction(groupId, payload()), room ? "Room saved" : "Room added")}>
              {room ? "Save room" : "Add room"}
            </button>
          </div>
        </div>
      )}
      {!open && msg && <div className="px-4 pb-3"><Msg msg={msg} /></div>}
    </div>
  );
}

export { Notice };
