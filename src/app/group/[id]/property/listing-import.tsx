"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { applyListingImportAction } from "@/app/actions";
import { RoomArt } from "@/components/RoomArt";
import { Badge, Card, Notice, SectionTitle, btn, cx } from "@/components/ui";
import type { ImportDraft, RoomDraft } from "@/lib/ingestion/analysis";

const field = "mt-1 w-full rounded-xl border border-sand-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-pine-500 focus:outline-none";
const MAX_PHOTOS = 16;

type Photo = { dataUrl: string; thumb: string; name: string };

/** Downscale an image in the browser so uploads stay small (analysis copy + stored thumbnail). */
async function compress(file: File, maxSide: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function ListingImport({ groupId, listingUrl, roomCount, submittedCount }: { groupId: string; listingUrl: string; roomCount: number; submittedCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(listingUrl);
  const [text, setText] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [shared, setShared] = useState("");
  const [analyzer, setAnalyzer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | File[]) => {
    setError(null);
    const imgs = [...files].filter((f) => f.type.startsWith("image/")).slice(0, MAX_PHOTOS - photos.length);
    try {
      const out = await Promise.all(imgs.map(async (f) => ({ name: f.name || "pasted image", dataUrl: await compress(f, 1024, 0.72), thumb: await compress(f, 640, 0.7) })));
      setPhotos((p) => [...p, ...out].slice(0, MAX_PHOTOS));
    } catch {
      setError("One of those files couldn't be read as an image.");
    }
  };

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/groups/${groupId}/listing/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingUrl: url, text, photos: photos.map((p) => ({ dataUrl: p.dataUrl })) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Analysis failed.");
      setDraft(json.draft);
      setShared((json.draft as ImportDraft).sharedAmenities.join(", "));
      setAnalyzer(json.analyzer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setBusy(false);
    }
  };

  const updateRoom = (k: number, patch: Partial<RoomDraft>) => setDraft((d) => (d ? { ...d, rooms: d.rooms.map((r, i) => (i === k ? { ...r, ...patch } : r)) } : d));
  const removeRoom = (k: number) => setDraft((d) => (d ? { ...d, rooms: d.rooms.filter((_, i) => i !== k) } : d));

  const apply = () =>
    start(async () => {
      if (!draft) return;
      setError(null);
      const r = await applyListingImportAction(groupId, {
        listingUrl: url,
        propertyName: "",
        sharedAmenities: shared.split(",").map((s) => s.trim()).filter(Boolean),
        rooms: draft.rooms.map((rm) => ({
          name: rm.name, shortName: rm.shortName, bedConfig: rm.bedConfig, capacity: rm.capacity, bedCount: rm.bedCount, hasBunk: rm.hasBunk,
          accessible: rm.accessible, weightMilli: rm.weightMilli, qualityRating: rm.qualityRating, description: rm.description, imageKey: rm.imageKey,
          attributes: rm.attributes, amenities: rm.amenities, photoData: rm.photoIndexes.length ? photos[rm.photoIndexes[0]]?.thumb ?? null : null,
        })),
      });
      if (!r.ok) return setError(r.error);
      setDone(`${draft.rooms.length} bedrooms imported.`);
      setDraft(null);
      setPhotos([]);
      setText("");
      setOpen(false);
      router.refresh();
    });

  if (!open)
    return (
      <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">Import bedrooms from a listing</div>
          <div className="text-sm text-ink-500">Add the Airbnb/Vrbo link, its photos and amenity list — AI drafts each bedroom (size, beds, ensuite, closet, view) for you to review.</div>
          {done && <div className="mt-1 text-sm text-ok-500" role="status">{done}</div>}
        </div>
        <button className={btn.secondary} onClick={() => setOpen(true)} data-testid="open-import">Import from listing</button>
      </Card>
    );

  return (
    <Card className="p-6" as="section">
      <SectionTitle aside={<button className={btn.ghost} onClick={() => setOpen(false)}>Close</button>}>Import bedrooms from a listing</SectionTitle>

      {!draft ? (
        <div className="space-y-5">
          <Notice>
            Roomsplit doesn&apos;t read Airbnb or Vrbo pages directly — their terms prohibit automated access. Open the listing in your browser, save its bedroom photos (or
            screenshot them), and copy the <strong>“Where you&apos;ll sleep”</strong> and <strong>“What this place offers”</strong> sections below.
          </Notice>
          <label className="block">
            <span className="text-sm font-medium">Listing link</span>
            <input className={field} placeholder="https://www.airbnb.com/rooms/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Listing link" />
          </label>
          <div>
            <div className="text-sm font-medium">Listing photos <span className="font-normal text-ink-400">({photos.length}/{MAX_PHOTOS})</span></div>
            <div
              className="mt-1 rounded-2xl border-2 border-dashed border-sand-300 bg-sand-50 p-4 text-center text-sm text-ink-500"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
              onPaste={(e) => addFiles([...e.clipboardData.items].map((i) => i.getAsFile()).filter((f): f is File => !!f))}
              tabIndex={0}
              aria-label="Drop or paste listing photos"
            >
              Drag photos here, paste screenshots, or{" "}
              <button type="button" className="font-medium text-pine-600 underline" onClick={() => fileRef.current?.click()}>
                choose files
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => e.target.files && addFiles(e.target.files)} data-testid="import-files" />
              <div className="mt-1 text-xs">Bedrooms matter most; include bathroom and window shots so ensuites and views can be judged.</div>
            </div>
            {photos.length > 0 && (
              <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                {photos.map((p, i) => (
                  <li key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb} alt={`Photo ${i}`} className="aspect-square w-full rounded-lg object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{i}</span>
                    <button type="button" aria-label={`Remove photo ${i}`} className="absolute right-1 top-1 h-5 w-5 rounded-full bg-white/90 text-xs" onClick={() => setPhotos(photos.filter((_, j) => j !== i))}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className="block">
            <span className="text-sm font-medium">Listing text (sleeping arrangements & amenities)</span>
            <textarea
              rows={6}
              className={field}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Where you'll sleep\nBedroom 1: 1 king bed\nBedroom 2: 1 queen bed\n…\nWhat this place offers\nAir conditioning · Wifi · Kitchen · Hot tub …"}
              data-testid="import-text"
            />
          </label>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <span className="text-xs text-ink-400">Photos are downscaled in your browser and sent only for this analysis.</span>
            <button className={btn.primary} disabled={busy || (photos.length === 0 && text.trim().length < 20)} onClick={analyze} data-testid="analyze-listing">
              {busy ? "Analyzing photos…" : "Analyze listing"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="pine">{draft.rooms.length} bedrooms found</Badge>
            <Badge>{analyzer === "mock" ? "Offline mock analyzer" : analyzer === "gemini" ? "Analyzed with Google Gemini" : "Analyzed with Claude"}</Badge>
            <span className="text-ink-500">Review and correct before applying. Weights are suggestions (average 1.00).</span>
          </div>
          {draft.warnings.length > 0 && (
            <Notice tone="warn" title="Please double-check">
              <ul className="list-disc pl-5">{draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </Notice>
          )}
          <label className="block">
            <span className="text-sm font-medium">Shared amenities — assumed in every room (e.g. air conditioning)</span>
            <input className={field} value={shared} onChange={(e) => setShared(e.target.value)} data-testid="import-shared" />
          </label>
          <ul className="space-y-3">
            {draft.rooms.map((r, k) => {
              const cover = r.photoIndexes.length ? photos[r.photoIndexes[0]] : undefined;
              return (
                <li key={r.key} className="rounded-2xl border border-sand-200 p-4" data-testid="import-room">
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <div className="w-full shrink-0 sm:w-44">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover.thumb} alt={r.name} className="aspect-[4/3] w-full rounded-xl object-cover" />
                      ) : (
                        <RoomArt kind={r.imageKey} className="aspect-[4/3] w-full rounded-xl" />
                      )}
                      {r.photoIndexes.length > 1 && <div className="mt-1 text-xs text-ink-400">Photos {r.photoIndexes.join(", ")}</div>}
                    </div>
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input className={field + " !mt-0 max-w-xs font-medium"} value={r.name} onChange={(e) => updateRoom(k, { name: e.target.value })} aria-label="Room name" />
                        {r.viewRank === 1 && r.attributes.view >= 0.5 && <Badge tone="clay">Best view</Badge>}
                        <Badge tone={r.confidence >= 0.7 ? "ok" : r.confidence >= 0.5 ? "warn" : "bad"}>{Math.round(r.confidence * 100)}% confident</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <label className="col-span-2"><span className="text-xs text-ink-500">Beds</span><input className={field} value={r.bedConfig} onChange={(e) => updateRoom(k, { bedConfig: e.target.value })} /></label>
                        <label><span className="text-xs text-ink-500">Sleeps</span><input type="number" min={1} max={12} className={field} value={r.capacity} onChange={(e) => updateRoom(k, { capacity: Number(e.target.value) })} /></label>
                        <label><span className="text-xs text-ink-500">Weight</span><input inputMode="decimal" className={field + " money"} value={(r.weightMilli / 1000).toFixed(2)} onChange={(e) => updateRoom(k, { weightMilli: Math.round((parseFloat(e.target.value) || 0) * 1000) })} /></label>
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={r.attributes.privateBath === 1} onChange={(e) => updateRoom(k, { attributes: { ...r.attributes, privateBath: e.target.checked ? 1 : 0 }, amenities: e.target.checked ? [...new Set([...r.amenities, "Private ensuite bathroom"])] : r.amenities.filter((a) => a !== "Private ensuite bathroom") })} /> Ensuite bathroom</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={r.amenities.includes("Walk-in closet")} onChange={(e) => updateRoom(k, { amenities: e.target.checked ? [...r.amenities, "Walk-in closet"] : r.amenities.filter((a) => a !== "Walk-in closet") })} /> Walk-in closet</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={r.hasBunk} onChange={(e) => updateRoom(k, { hasBunk: e.target.checked })} /> Bunks</label>
                        <span className="text-ink-500">Size {Math.round(r.attributes.roomSize * 100)} · View {Math.round(r.attributes.view * 100)} (#{r.viewRank})</span>
                      </div>
                      <div className="flex flex-wrap gap-1">{r.amenities.map((a) => <Badge key={a}>{a}</Badge>)}</div>
                      {r.notes && <p className="text-xs text-ink-400">{r.notes}</p>}
                    </div>
                    <button className={cx(btn.ghost, "self-start")} onClick={() => removeRoom(k)} aria-label={`Remove ${r.name}`}>×</button>
                  </div>
                </li>
              );
            })}
          </ul>
          <Notice tone="warn">
            Applying replaces the current {roomCount} bedroom{roomCount === 1 ? "" : "s"}.
            {submittedCount > 0 && ` ${submittedCount} submitted questionnaire${submittedCount === 1 ? "" : "s"} will reopen so parties can rank the new rooms (their other answers are kept).`} Any proposal and approvals reset.
          </Notice>
          {error && <Notice tone="bad">{error}</Notice>}
          <div className="flex flex-wrap justify-end gap-2">
            <button className={btn.secondary} onClick={() => setDraft(null)}>Back</button>
            <button className={btn.primary} disabled={pending || draft.rooms.length === 0} onClick={apply} data-testid="apply-import">
              {pending ? "Applying…" : `Apply ${draft.rooms.length} bedrooms`}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
