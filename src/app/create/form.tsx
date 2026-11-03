"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { createGroupAction } from "@/app/actions";
import { RoomArt } from "@/components/RoomArt";
import { Badge, Card, Notice, btn, cx } from "@/components/ui";
import type { ImportDraft, RoomDraft } from "@/lib/ingestion/analysis";
import { formatMoney } from "@/lib/engine/money";

export const field = "mt-1 w-full rounded-xl border border-sand-300 bg-white px-3.5 py-2.5 text-ink-900 placeholder:text-ink-400 focus:border-pine-500 focus:outline-none";
export const labelCls = "text-sm font-medium text-ink-700";
const MAX_PHOTOS = 16;
const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "MXN", "JPY"];

type Photo = { dataUrl: string; thumb: string };

async function toCanvasJpeg(src: Blob, maxSide: number, quality: number) {
  const bmp = await createImageBitmap(src);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
async function fromFile(f: File): Promise<Photo> {
  return { dataUrl: await toCanvasJpeg(f, 1024, 0.72), thumb: await toCanvasJpeg(f, 640, 0.7) };
}
async function fromDataUrl(dataUrl: string): Promise<Photo> {
  const blob = await (await fetch(dataUrl)).blob();
  return { dataUrl, thumb: await toCanvasJpeg(blob, 640, 0.7) };
}

type CostLine = { label: string; kind: string; amount: string };

export function CreateGroupForm({ defaultName, signedIn }: { defaultName: string; signedIn: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<"listing" | "details">("listing");
  // listing step
  const [url, setUrl] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [listingMsg, setListingMsg] = useState<{ tone: "warn" | "bad" | "pine"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // details step
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [rooms, setRooms] = useState<RoomDraft[]>([]);
  const [shared, setShared] = useState("");
  const [costs, setCosts] = useState<CostLine[]>([{ label: "Entire stay", kind: "base", amount: "4200" }]);
  const [f, setF] = useState({
    organizerName: defaultName, groupName: "Summer house trip", propertyName: "The Shared Vacation House", location: "", description: "",
    checkIn: "", checkOut: "", currency: "USD", partyCount: 4, maxPartySize: 2, sharedPct: 40, organizerJoins: true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const addFiles = async (files: File[]) => {
    const imgs = files.filter((x) => x.type.startsWith("image/")).slice(0, MAX_PHOTOS - photos.length);
    try {
      const out = await Promise.all(imgs.map(fromFile));
      setPhotos((p) => [...p, ...out].slice(0, MAX_PHOTOS));
    } catch {
      setListingMsg({ tone: "bad", text: "One of those files couldn't be read as an image." });
    }
  };

  const analyze = async () => {
    setBusy(true);
    setListingMsg(null);
    try {
      const res = await fetch("/api/listing/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingUrl: url, text: pasted, photos: photos.map((p) => ({ dataUrl: p.dataUrl })) }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === "paste_required") {
          setPasteOpen(true);
          setListingMsg({ tone: "warn", text: json.error });
        } else setListingMsg({ tone: "bad", text: json.error || "Analysis failed." });
        return;
      }
      const d = json.draft as ImportDraft;
      // Photos the server fetched itself come back in the response; build thumbnails for them.
      const all: Photo[] = json.photos.length > photos.length ? [...photos, ...(await Promise.all((json.photos as { dataUrl: string }[]).slice(photos.length).map((p) => fromDataUrl(p.dataUrl))))] : photos;
      setPhotos(all);
      applyDraft(d, json.notice);
    } catch {
      setListingMsg({ tone: "bad", text: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const applyDraft = (d: ImportDraft, notice?: string | null) => {
    setDraft(d);
    setRooms(d.rooms);
    setShared(d.sharedAmenities.join(", "));
    if (d.property.costItems.length) setCosts(d.property.costItems.map((c) => ({ label: c.label, kind: c.kind, amount: (c.amountCents / 100).toFixed(2) })));
    const maxCap = d.rooms.length ? Math.max(...d.rooms.map((r) => r.capacity)) : 2;
    setF((s) => ({
      ...s,
      propertyName: d.property.name || s.propertyName,
      groupName: d.property.location ? `Trip to ${d.property.location.split(",")[0]}` : d.property.name ? `${d.property.name.slice(0, 50)} trip` : s.groupName,
      location: d.property.location,
      description: d.property.description,
      checkIn: d.property.checkIn ?? "",
      checkOut: d.property.checkOut ?? "",
      currency: d.property.currency && CURRENCIES.includes(d.property.currency) ? d.property.currency : s.currency,
      partyCount: d.rooms.length || s.partyCount,
      maxPartySize: Math.min(12, Math.max(2, maxCap)),
    }));
    if (notice) setListingMsg({ tone: "warn", text: notice });
    setStep("details");
  };

  const totalCents = costs.reduce((a, c) => a + Math.round((parseFloat(c.amount.replace(/[^0-9.]/g, "")) || 0) * 100), 0);
  const m = (c: number) => formatMoney(c, f.currency);

  const submit = () =>
    start(async () => {
      setError(null);
      if (totalCents <= 0) return setError("Enter the total rental cost.");
      const r = await createGroupAction({
        organizerName: f.organizerName, groupName: f.groupName, propertyName: f.propertyName, totalCents, currency: f.currency,
        partyCount: f.partyCount, maxPartySize: f.maxPartySize, sharedBps: f.sharedPct * 100, organizerJoins: f.organizerJoins,
        listing: draft || url
          ? {
              listingUrl: url,
              location: f.location,
              description: f.description,
              checkIn: f.checkIn,
              checkOut: f.checkOut,
              sharedAmenities: shared.split(",").map((s) => s.trim()).filter(Boolean),
              costItems: costs
                .map((c) => ({ label: c.label || "Fee", kind: c.kind as "base", amountCents: Math.round((parseFloat(c.amount.replace(/[^0-9.]/g, "")) || 0) * 100) }))
                .filter((c) => c.amountCents > 0),
              rooms: rooms.map((rm) => ({
                name: rm.name, shortName: rm.shortName, bedConfig: rm.bedConfig, capacity: rm.capacity, bedCount: rm.bedCount, hasBunk: rm.hasBunk,
                accessible: rm.accessible, weightMilli: rm.weightMilli, qualityRating: rm.qualityRating, description: rm.description, imageKey: rm.imageKey,
                attributes: rm.attributes, amenities: rm.amenities, photoData: rm.photoIndexes.length ? photos[rm.photoIndexes[0]]?.thumb ?? null : null,
              })),
            }
          : undefined,
      });
      if (!r.ok) setError(r.error);
      else if (r.redirect) router.push(r.redirect);
    });

  if (step === "listing")
    return (
      <Card className="space-y-5 p-6 sm:p-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">Step 1 of 2</div>
          <h2 className="mt-1 font-display text-2xl">Start with your rental listing</h2>
          <p className="mt-1 text-sm text-ink-500">Paste the link and we&apos;ll fill in the name, price, dates, amenities and bedrooms for you to review.</p>
        </div>
        <label className="block">
          <span className={labelCls}>Listing link</span>
          <input autoFocus className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.airbnb.com/rooms/… or any rental site" name="listingUrl" inputMode="url" />
        </label>
        {listingMsg && <Notice tone={listingMsg.tone}>{listingMsg.text}</Notice>}
        {pasteOpen ? (
          <div className="space-y-4 rounded-2xl bg-sand-50 p-4">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
              <li>Open the listing in your browser and press <kbd className="rounded bg-white px-1.5 py-0.5 text-xs shadow-card">⌘A</kbd> then <kbd className="rounded bg-white px-1.5 py-0.5 text-xs shadow-card">⌘C</kbd> (Ctrl on Windows).</li>
              <li>Paste below — it includes the title, price breakdown, sleeping arrangements and amenities.</li>
              <li>Add bedroom photos: open &quot;Show all photos&quot; and save or screenshot each bedroom (and its bathroom/window).</li>
            </ol>
            <label className="block">
              <span className={labelCls}>Listing page text</span>
              <textarea rows={6} className={field} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the whole listing page here…" data-testid="create-paste" />
            </label>
            <div
              className="rounded-2xl border-2 border-dashed border-sand-300 bg-white p-4 text-center text-sm text-ink-500"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles([...e.dataTransfer.files]);
              }}
              onPaste={(e) => addFiles([...e.clipboardData.items].map((i) => i.getAsFile()).filter((x): x is File => !!x))}
              tabIndex={0}
              aria-label="Drop or paste listing photos"
            >
              Drag photos here, paste screenshots, or{" "}
              <button type="button" className="font-medium text-pine-600 underline" onClick={() => fileRef.current?.click()}>choose files</button> ({photos.length}/{MAX_PHOTOS})
              <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => e.target.files && addFiles([...e.target.files])} data-testid="create-files" />
            </div>
            {photos.length > 0 && (
              <ul className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                {photos.map((p, i) => (
                  <li key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt={`Photo ${i}`} className="aspect-square w-full rounded-lg object-cover" />
                    <button type="button" aria-label={`Remove photo ${i}`} className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white/90 text-xs" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <button type="button" className="text-sm text-pine-600 underline-offset-4 hover:underline" onClick={() => setPasteOpen(true)}>
            Or paste the listing text and photos yourself
          </button>
        )}
        <div className="flex flex-col-reverse gap-3 border-t border-sand-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" className={btn.ghost} onClick={() => setStep("details")} data-testid="skip-listing">
            Skip — enter details manually
          </button>
          <button type="button" className={btn.primary} disabled={busy || (!url.trim() && pasted.trim().length < 20 && photos.length === 0)} onClick={analyze} data-testid="analyze-create">
            {busy ? "Reading the listing…" : "Import listing"}
          </button>
        </div>
      </Card>
    );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      {draft && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="ok">Imported from the listing</Badge>
          <span className="text-ink-500">Review everything below — you can still change it all later.</span>
        </div>
      )}
      {listingMsg && <Notice tone={listingMsg.tone}>{listingMsg.text}</Notice>}
      {draft && draft.warnings.length > 0 && (
        <Notice tone="warn" title="Please double-check">
          <ul className="list-disc pl-5">{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Notice>
      )}
      <Card className="space-y-5 p-6 sm:p-8">
        <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">Step 2 of 2 · The property</div>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block"><span className={labelCls}>Property</span><input required className={field} value={f.propertyName} onChange={(e) => set("propertyName", e.target.value)} name="propertyName" /></label>
          <label className="block"><span className={labelCls}>Location</span><input className={field} value={f.location} onChange={(e) => set("location", e.target.value)} name="location" /></label>
          <label className="block sm:col-span-2"><span className={labelCls}>Description</span><textarea rows={2} className={field} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
          <label className="block"><span className={labelCls}>Check-in</span><input type="date" className={field} value={f.checkIn} onChange={(e) => set("checkIn", e.target.value)} /></label>
          <label className="block"><span className={labelCls}>Check-out</span><input type="date" className={field} value={f.checkOut} onChange={(e) => set("checkOut", e.target.value)} /></label>
        </div>
        <div>
          <div className="flex items-end justify-between gap-3">
            <span className={labelCls}>Cost for the whole stay</span>
            <select className={field + " !w-28"} value={f.currency} onChange={(e) => set("currency", e.target.value)} aria-label="Currency">
              {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="mt-2 space-y-2">
            {costs.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_110px_130px_32px] items-center gap-2">
                <input className={field + " !mt-0"} value={c.label} onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Cost label" />
                <select className={field + " !mt-0"} value={c.kind} onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))} aria-label="Cost type">
                  {["base", "cleaning", "service", "tax", "other"].map((k) => <option key={k}>{k}</option>)}
                </select>
                <input inputMode="decimal" className={field + " !mt-0 money text-right"} value={c.amount} onChange={(e) => setCosts(costs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} aria-label={`${c.label} amount`} name={i === 0 ? "total" : undefined} />
                <button type="button" className={btn.ghost + " !px-2"} aria-label="Remove line" disabled={costs.length === 1} onClick={() => setCosts(costs.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between">
            <button type="button" className={btn.small} onClick={() => setCosts([...costs, { label: "Cleaning fee", kind: "cleaning", amount: "" }])}>+ Add fee or tax</button>
            <span className="text-sm">Total <span className="money font-display text-xl" data-testid="create-total">{m(totalCents)}</span></span>
          </div>
        </div>
        <label className="block"><span className={labelCls}>Shared amenities — assumed in every room</span><input className={field} value={shared} onChange={(e) => setShared(e.target.value)} placeholder="Air conditioning, Wi-Fi, Kitchen…" /></label>
      </Card>

      {rooms.length > 0 ? (
        <Card className="p-6 sm:p-8">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-xl">{rooms.length} bedrooms</div>
            <span className="text-xs text-ink-400">Weights are suggestions (average 1.00)</span>
          </div>
          <ul className="space-y-3">
            {rooms.map((r, k) => {
              const cover = r.photoIndexes.length ? photos[r.photoIndexes[0]] : undefined;
              const upd = (patch: Partial<RoomDraft>) => setRooms(rooms.map((x, i) => (i === k ? { ...x, ...patch } : x)));
              return (
                <li key={r.key} className="flex flex-col gap-3 rounded-2xl border border-sand-200 p-3 sm:flex-row sm:items-center" data-testid="create-room">
                  {cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cover.thumb} alt={r.name} className="h-20 w-full rounded-xl object-cover sm:w-28" />
                  ) : (
                    <RoomArt kind={r.imageKey} className="h-20 w-full rounded-xl sm:w-28" />
                  )}
                  <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1.4fr_70px_80px]">
                    <input className={field + " !mt-0 col-span-2 sm:col-span-1"} value={r.name} onChange={(e) => upd({ name: e.target.value })} aria-label="Room name" />
                    <input className={field + " !mt-0 col-span-2 sm:col-span-1"} value={r.bedConfig} onChange={(e) => upd({ bedConfig: e.target.value })} aria-label="Beds" />
                    <input type="number" min={1} max={12} className={field + " !mt-0"} value={r.capacity} onChange={(e) => upd({ capacity: Number(e.target.value) })} aria-label="Sleeps" />
                    <input inputMode="decimal" className={field + " !mt-0 money"} value={(r.weightMilli / 1000).toFixed(2)} onChange={(e) => upd({ weightMilli: Math.round((parseFloat(e.target.value) || 0) * 1000) })} aria-label="Weight" />
                    <div className="col-span-2 flex flex-wrap gap-1 sm:col-span-4">
                      {r.viewRank === 1 && r.attributes.view >= 0.5 && <Badge tone="clay">Best view</Badge>}
                      {r.amenities.slice(1, 5).map((a) => <Badge key={a}>{a}</Badge>)}
                    </div>
                  </div>
                  <button type="button" className={cx(btn.ghost, "self-end sm:self-center")} aria-label={`Remove ${r.name}`} onClick={() => setRooms(rooms.filter((_, i) => i !== k))}>×</button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <Notice>No bedrooms imported — the group starts with a 4-bedroom template you can edit on the next screen.</Notice>
      )}

      <Card className="space-y-5 p-6 sm:p-8">
        <div className="text-xs font-semibold uppercase tracking-wide text-pine-600">The group</div>
        <label className="block">
          <span className={labelCls}>Your name</span>
          <input required className={field} value={f.organizerName} disabled={signedIn} onChange={(e) => set("organizerName", e.target.value)} placeholder="e.g. Maya Chen" name="organizerName" />
        </label>
        <label className="block"><span className={labelCls}>Group name</span><input required className={field} value={f.groupName} onChange={(e) => set("groupName", e.target.value)} name="groupName" /></label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>Number of parties</span>
            <input type="number" min={1} max={26} className={field} value={f.partyCount} onChange={(e) => set("partyCount", Number(e.target.value))} name="partyCount" />
            <span className="mt-1 block text-xs text-ink-400">One party = one bedroom{rooms.length ? ` (${rooms.length} bedrooms)` : ""}.</span>
          </label>
          <label className="block">
            <span className={labelCls}>Max people per party</span>
            <input type="number" min={1} max={12} className={field} value={f.maxPartySize} onChange={(e) => set("maxPartySize", Number(e.target.value))} name="maxPartySize" />
          </label>
        </div>
        <label className="block">
          <span className={labelCls}>Shared-house share of the rent: {f.sharedPct}% shared · {100 - f.sharedPct}% by bedroom</span>
          <input type="range" min={0} max={100} step={5} value={f.sharedPct} onChange={(e) => set("sharedPct", Number(e.target.value))} className="mt-2 w-full" aria-label="Shared percentage" />
        </label>
        <label className="flex items-start gap-3 rounded-xl bg-sand-50 p-4">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={f.organizerJoins} onChange={(e) => set("organizerJoins", e.target.checked)} />
          <span><span className="font-medium">I&apos;m traveling too</span><span className="block text-sm text-ink-500">You&apos;ll take Party A and fill in its questionnaire.</span></span>
        </label>
        {error && <p role="alert" className="text-sm text-bad-500">{error}</p>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" className={btn.ghost} onClick={() => setStep("listing")}>← Back to listing</button>
          <button type="submit" className={btn.primary} disabled={pending} data-testid="create-submit">{pending ? "Creating…" : "Create group"}</button>
        </div>
      </Card>
    </form>
  );
}
