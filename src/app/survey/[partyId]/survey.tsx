"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveDraftAction, shareDraftAction, submitPreferencesAction } from "@/app/actions";
import { RoomArt } from "@/components/RoomArt";
import { Badge, Card, Notice, btn, cx } from "@/components/ui";
import { FIELD_LABELS, type QuestionnaireData } from "@/lib/domain/questionnaire";
import { formatMoney } from "@/lib/engine/money";
import { previewRoomPrice } from "@/lib/engine/pricing";
import { PRIORITY_KEYS, PRIORITY_LABELS, type PriorityKey } from "@/lib/engine/types";
import type { RoomView } from "@/lib/server/views";

const field = "mt-1 w-full rounded-xl border border-sand-300 bg-white px-3.5 py-2.5 text-ink-900 focus:border-pine-500 focus:outline-none";

type Props = {
  partyId: string;
  initial: QuestionnaireData;
  rooms: RoomView[];
  config: { totalCents: number; sharedBps: number };
  currency: string;
  otherTravelers: number;
  partyCount: number;
  isRep: boolean;
  memberCount: number;
  maxPartySize: number;
  method: "weighted" | "hybrid" | "auction";
  others: { name: string; shared: boolean; data: QuestionnaireData; diffs: string[] }[];
  submittedAt: string | null;
  locked: boolean;
  repName: string;
};

const toDollars = (c: number) => (c ? (c / 100).toString() : "");
const toCents = (s: string) => {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function Survey(p: Props) {
  const router = useRouter();
  const [q, setQ] = useState<QuestionnaireData>(p.initial);
  const [step, setStep] = useState(Math.min(p.initial.step ?? 0, 4));
  const [saved, setSaved] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const first = useRef(true);
  const [bidsKey, setBidsKey] = useState(0);
  const showBids = p.method !== "weighted";
  const steps = ["Party", "Budget", "Priorities", "Rooms", ...(showBids ? ["Bids"] : []), "Review"];
  const reviewIdx = steps.length - 1;
  const m = (c: number) => formatMoney(c, p.currency);

  // Debounced autosave
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (p.locked) return;
    setSaved("saving");
    const t = setTimeout(async () => {
      const r = await saveDraftAction(p.partyId, { ...q, step: Math.min(step, 4) });
      setSaved(r.ok ? "saved" : "error");
      if (!r.ok) setError(r.error);
    }, 600);
    return () => clearTimeout(t);
  }, [q, step, p.partyId, p.locked]);

  const set = <K extends keyof QuestionnaireData>(k: K, v: QuestionnaireData[K]) => setQ((s) => ({ ...s, [k]: v }));
  const travelers = p.otherTravelers + q.partySize;
  const allRoomIds = p.rooms.map((r) => r.id);
  const previews = useMemo(
    () => previewRoomPrice({ totalCents: p.config.totalCents, sharedBps: p.config.sharedBps }, p.rooms.map((r) => ({ ...r, attributes: r.attributes })), allRoomIds, travelers, q.partySize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [p.config.totalCents, p.config.sharedBps, travelers, q.partySize],
  );
  const estimateCaveat = p.partyCount !== p.rooms.length || p.otherTravelers === 0;
  const roomName = (id: string) => p.rooms.find((r) => r.id === id)?.name ?? id;

  const stepValid = (i: number): string | null => {
    const name = steps[i];
    if (name === "Party") {
      if (!q.partyName.trim()) return "Give your party a name.";
      if (q.partySize < p.memberCount) return `Your party already has ${p.memberCount} members.`;
      if (q.partySize > p.maxPartySize) return `Maximum ${p.maxPartySize} per party.`;
    }
    if (name === "Budget") {
      if (q.maxBudgetCents <= 0) return "Enter a maximum budget.";
      if (q.idealBudgetCents > q.maxBudgetCents) return "Your ideal budget should be at or below your maximum.";
    }
    if (name === "Priorities" && q.topPriorities.length === 0) return "Choose at least one top priority.";
    if (name === "Rooms" && q.refusedRooms.length >= p.rooms.length) return "You can't refuse every room.";
    if (name === "Bids" && !Object.values(q.bids ?? {}).some((v) => v > 0)) return "Bid on at least one room.";
    return null;
  };
  const goto = (i: number) => {
    const err = i > step ? stepValid(step) : null;
    if (err) return setError(err);
    setError(null);
    setStep(i);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const moveRoom = (id: string, dir: -1 | 1) => {
    const r = [...q.roomRanking];
    const i = r.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= r.length) return;
    [r[i], r[j]] = [r[j], r[i]];
    set("roomRanking", r);
  };
  const togglePriority = (k: PriorityKey) => {
    const cur = q.topPriorities;
    if (cur.includes(k)) set("topPriorities", cur.filter((x) => x !== k));
    else if (cur.length < 3) set("topPriorities", [...cur, k]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <ol className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1" aria-label="Questionnaire steps">
          {steps.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => goto(i)}
                aria-current={i === step ? "step" : undefined}
                className={cx(
                  "flex w-full items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-left text-sm lg:rounded-xl",
                  i === step ? "bg-white font-medium shadow-card" : "text-ink-500 hover:bg-white/60",
                )}
              >
                <span className={cx("flex h-6 w-6 items-center justify-center rounded-full text-xs", i < step ? "bg-pine-500 text-white" : i === step ? "bg-pine-50 text-pine-700" : "bg-sand-200 text-ink-500")}>
                  {i < step ? "✓" : i + 1}
                </span>
                {s}
              </button>
            </li>
          ))}
        </ol>
        <div className="mt-3 hidden text-xs text-ink-400 lg:block" aria-live="polite">
          {saved === "saving" ? "Saving…" : saved === "saved" ? "All changes saved" : saved === "error" ? "Couldn't save" : p.submittedAt ? "Submitted — edits need resubmitting" : "Draft"}
        </div>
      </aside>

      <div className="min-w-0">
        {p.locked && <Notice tone="warn" className="mb-4" title="The agreement is finalized">Preferences can't be changed unless the organizer reopens it.</Notice>}
        {!p.isRep && (
          <Notice className="mb-4" title="Your input, not the final answer">
            {p.repName} represents your party and submits its final questionnaire. Fill this in and share it — they&apos;ll see where you differ.
          </Notice>
        )}

        {steps[step] === "Party" && (
          <Card className="space-y-6 p-6 sm:p-8 fade-in">
            <h2 className="font-display text-2xl">About your party</h2>
            <label className="block">
              <span className="text-sm font-medium">Party name</span>
              <input className={field} value={q.partyName} onChange={(e) => set("partyName", e.target.value)} placeholder="e.g. Maya & Jordan" name="partyName" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium">How many people are in your party?</legend>
              <div className="mt-2 flex gap-2">
                {Array.from({ length: p.maxPartySize }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={q.partySize === n}
                    disabled={n < p.memberCount}
                    onClick={() => setQ((s) => ({ ...s, partySize: n, sharingBed: n > 1 ? s.sharingBed : false }))}
                    className={cx("h-12 min-w-12 rounded-xl border px-4 text-lg disabled:opacity-40", q.partySize === n ? "border-pine-500 bg-pine-50 text-pine-700" : "border-sand-300 bg-white")}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-500">Your party always gets one bedroom, however many people are in it.</p>
            </fieldset>
            {q.partySize > 1 && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Toggle label="We're sharing a bed" checked={q.sharingBed} onChange={(v) => setQ((s) => ({ ...s, sharingBed: v, separateBeds: v ? false : s.separateBeds }))} />
                <Toggle label="We need separate sleeping surfaces" hint="Hard requirement — rooms without enough beds are excluded." checked={q.separateBeds} onChange={(v) => setQ((s) => ({ ...s, separateBeds: v, sharingBed: v ? false : s.sharingBed }))} />
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Toggle label="We can't use bunk beds" hint="Hard requirement" checked={q.noBunk} onChange={(v) => set("noBunk", v)} />
              <Toggle label="We need an accessible room" hint="Hard requirement — e.g. ground floor, no stairs" checked={q.accessible} onChange={(v) => set("accessible", v)} />
            </div>
            <label className="block">
              <span className="text-sm font-medium">Other non-negotiable sleeping needs (optional)</span>
              <textarea className={field} rows={2} value={q.otherRequirements} onChange={(e) => set("otherRequirements", e.target.value)} placeholder="Shared with the organizer to check by hand" />
            </label>
          </Card>
        )}

        {steps[step] === "Budget" && (
          <Card className="space-y-6 p-6 sm:p-8 fade-in">
            <div>
              <h2 className="font-display text-2xl">What is your party comfortable paying for the entire stay?</h2>
              <p className="mt-2 rounded-xl bg-clay-50 px-4 py-3 text-sm text-clay-600">
                These are <strong>totals for your whole party</strong> ({q.partySize} {q.partySize === 1 ? "person" : "people"}), not per person. The whole house costs {m(p.config.totalCents)}.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium">Ideal party budget</span>
                <input inputMode="decimal" className={field + " money"} defaultValue={toDollars(q.idealBudgetCents)} onChange={(e) => set("idealBudgetCents", toCents(e.target.value))} placeholder="e.g. 1200" name="ideal" />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Maximum party budget</span>
                <input inputMode="decimal" className={field + " money"} defaultValue={toDollars(q.maxBudgetCents)} onChange={(e) => set("maxBudgetCents", toCents(e.target.value))} placeholder="e.g. 1400" name="max" />
              </label>
            </div>
            <Toggle label="Our maximum is a hard limit" hint="We will never be assigned a price above it. If off, it's a strong preference." checked={q.hardMax} onChange={(v) => set("hardMax", v)} />
            <label className="block">
              <span className="text-sm font-medium">Flexibility to pay a premium for a preferred bedroom: {["None", "A little", "Some", "Moderate", "High", "Very high"][q.premiumFlex]}</span>
              <input type="range" min={0} max={5} value={q.premiumFlex} onChange={(e) => set("premiumFlex", Number(e.target.value))} className="mt-2 w-full" aria-label="Premium flexibility" />
            </label>
            <p className="text-xs text-ink-500">A bigger budget never raises your price for the same room — room prices come from the pricing model, not from what you can afford.</p>
          </Card>
        )}

        {steps[step] === "Priorities" && (
          <Card className="space-y-6 p-6 sm:p-8 fade-in">
            <h2 className="font-display text-2xl">What matters most when choosing a bedroom?</h2>
            <div className="space-y-4">
              {PRIORITY_KEYS.map((k) => (
                <div key={k} className="grid items-center gap-2 sm:grid-cols-[220px_1fr_40px]">
                  <span className="text-sm">{PRIORITY_LABELS[k]}</span>
                  <input type="range" min={0} max={5} value={q.priorities[k]} onChange={(e) => set("priorities", { ...q.priorities, [k]: Number(e.target.value) })} aria-label={PRIORITY_LABELS[k]} />
                  <span className="text-right text-sm text-ink-500 money">{q.priorities[k]}/5</span>
                </div>
              ))}
            </div>
            <div>
              <div className="text-sm font-medium">Your top three, in order</div>
              <p className="text-xs text-ink-500">Tap to rank. These get extra weight in the matching.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRIORITY_KEYS.map((k) => {
                  const idx = q.topPriorities.indexOf(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={idx >= 0}
                      onClick={() => togglePriority(k)}
                      className={cx("rounded-full border px-3.5 py-2 text-sm", idx >= 0 ? "border-pine-500 bg-pine-600 text-white" : "border-sand-300 bg-white hover:bg-sand-50")}
                    >
                      {idx >= 0 && <span className="mr-1.5 font-semibold">{idx + 1}</span>}
                      {PRIORITY_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {steps[step] === "Rooms" && (
          <div className="space-y-4 fade-in">
            <Card className="p-6 sm:p-8">
              <h2 className="font-display text-2xl">Rank the bedrooms</h2>
              <p className="mt-1 text-sm text-ink-500">
                Most preferred first. Prices are previews from the live pricing model for a party of {q.partySize}
                {estimateCaveat ? " — they'll change as other parties join or set their size." : "."}
              </p>
            </Card>
            <ol className="space-y-3">
              {q.roomRanking.map((id, i) => {
                const r = p.rooms.find((x) => x.id === id)!;
                if (!r) return null;
                const refused = q.refusedRooms.includes(id);
                const incompatible = r.capacity < q.partySize || (q.separateBeds && q.partySize > 1 && r.bedCount < q.partySize) || (q.noBunk && r.hasBunk) || (q.accessible && !r.accessible);
                return (
                  <li key={id}>
                    <Card className={cx("flex flex-col overflow-hidden sm:flex-row", (refused || incompatible) && "opacity-60")}>
                      <RoomArt kind={r.imageKey} className="h-32 w-full shrink-0 sm:h-auto sm:w-48" title={r.name} />
                      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="text-xs text-ink-400">#{i + 1} · {r.shortName}</div>
                            <div className="font-display text-lg">{r.name}</div>
                            <div className="text-sm text-ink-500">{r.bedConfig} · sleeps {r.capacity}</div>
                          </div>
                          <div className="text-right">
                            <div className="money font-display text-xl">{m(previews[id])}</div>
                            <div className="text-xs text-ink-400">indicative party total</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {r.amenities.map((a) => <Badge key={a.label}>{a.label}</Badge>)}
                          {incompatible && <Badge tone="bad">Doesn&apos;t meet your requirements</Badge>}
                        </div>
                        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                          <button type="button" className={btn.small} onClick={() => moveRoom(id, -1)} disabled={i === 0} aria-label={`Move ${r.name} up`}>↑ Up</button>
                          <button type="button" className={btn.small} onClick={() => moveRoom(id, 1)} disabled={i === q.roomRanking.length - 1} aria-label={`Move ${r.name} down`}>↓ Down</button>
                          <label className="ml-auto inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={refused} onChange={(e) => set("refusedRooms", e.target.checked ? [...q.refusedRooms, id] : q.refusedRooms.filter((x) => x !== id))} />
                            We&apos;d refuse this room
                          </label>
                        </div>
                      </div>
                    </Card>
                  </li>
                );
              })}
            </ol>
            <Card className="p-5">
              <Toggle
                label={`We'd pay a reasonable premium for our first choice (${roomName(q.roomRanking[0])})`}
                hint="Softens the affordability penalty for that room only."
                checked={q.premiumForFirstChoice}
                onChange={(v) => set("premiumForFirstChoice", v)}
              />
            </Card>
          </div>
        )}

        {steps[step] === "Bids" && (
          <Card className="space-y-5 p-6 sm:p-8 fade-in">
            <div>
              <h2 className="font-display text-2xl">Your sealed bids</h2>
              <p className="mt-1 text-sm text-ink-500">
                For each room you&apos;d accept, enter the <strong>most your party would pay in total</strong>. Bids are private. Rooms go where they&apos;re valued most, and you
                usually pay less than your bid: prices are set so no party would rather swap at the going prices, and they add up exactly to {m(p.config.totalCents)}.
              </p>
            </div>
            <div className="space-y-3">
              {q.roomRanking.map((id) => {
                const r = p.rooms.find((x) => x.id === id)!;
                const refused = q.refusedRooms.includes(id);
                const bid = q.bids?.[id] ?? 0;
                const overMax = q.hardMax && bid > q.maxBudgetCents && q.maxBudgetCents > 0;
                return (
                  <div key={id} className={cx("grid items-center gap-3 rounded-xl border border-sand-200 p-3 sm:grid-cols-[1fr_180px]", refused && "opacity-50")}>
                    <div className="flex items-center gap-3">
                      <RoomArt kind={r.imageKey} className="h-12 w-20 shrink-0 rounded-lg" />
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-ink-500">Weighted price {m(previews[id])}{refused ? " · refused" : ""}</div>
                      </div>
                    </div>
                    <div>
                      <input
                        key={`${id}-${bidsKey}`}
                        inputMode="decimal"
                        aria-label={`Bid for ${r.name}`}
                        disabled={refused}
                        className={field + " money !mt-0"}
                        defaultValue={bid ? toDollars(bid) : ""}
                        placeholder="No bid"
                        onChange={(e) => set("bids", { ...(q.bids ?? {}), [id]: toCents(e.target.value) })}
                      />
                      {overMax && <div className="mt-1 text-xs text-warn-500">Above your hard maximum</div>}
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className={btn.small}
              onClick={() => {
                const b = Object.fromEntries(q.roomRanking.filter((id) => !q.refusedRooms.includes(id)).map((id) => [id, previews[id]]));
                set("bids", b);
                setBidsKey((k) => k + 1); // re-mount inputs with the suggested values
              }}
            >
              Fill with weighted prices as a starting point
            </button>
          </Card>
        )}

        {step === reviewIdx && (
          <div className="space-y-4 fade-in">
            <Card className="p-6 sm:p-8">
              <h2 className="font-display text-2xl">Review</h2>
              <dl className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                <Item k="Party" v={`${q.partyName || "—"} · ${q.partySize} ${q.partySize === 1 ? "person" : "people"}`} />
                <Item k="Budget (party total)" v={`${m(q.idealBudgetCents)} ideal · ${m(q.maxBudgetCents)} max${q.hardMax ? " (hard)" : ""}`} />
                <Item
                  k="Sleeping requirements"
                  v={[q.sharingBed && "sharing a bed", q.separateBeds && "separate beds", q.noBunk && "no bunks", q.accessible && "accessible", q.otherRequirements].filter(Boolean).join(", ") || "None"}
                />
                <Item k="Top priorities" v={q.topPriorities.map((k) => PRIORITY_LABELS[k]).join(" → ") || "—"} />
                <Item k="Room ranking" v={q.roomRanking.filter((r) => !q.refusedRooms.includes(r)).map(roomName).join(" → ")} />
                <Item k="Refused" v={q.refusedRooms.map(roomName).join(", ") || "None"} />
                {showBids && (
                  <Item
                    k="Bids"
                    v={Object.entries(q.bids ?? {}).filter(([, v]) => v > 0).map(([id, v]) => `${roomName(id)} ${m(v)}`).join(" · ") || "None"}
                  />
                )}
              </dl>
            </Card>
            {p.isRep && p.others.length > 0 && (
              <Card className="p-6">
                <div className="font-medium">Input from your party</div>
                {p.others.map((o) => (
                  <div key={o.name} className="mt-3 rounded-xl bg-sand-50 p-4 text-sm">
                    <div className="font-medium">{o.name}</div>
                    {o.diffs.length === 0 ? (
                      <div className="text-ink-500">Matches your answers.</div>
                    ) : (
                      <>
                        <div className="text-ink-500">Differs on: {o.diffs.map((d) => FIELD_LABELS[d] ?? d).join(", ")}</div>
                        {o.diffs.includes("roomRanking") && <div className="mt-1 text-ink-500">Their ranking: {o.data.roomRanking.map(roomName).join(" → ")}</div>}
                        <button type="button" className={btn.small + " mt-2"} onClick={() => setQ({ ...o.data, partyName: q.partyName })}>
                          Use {o.name.split(" ")[0]}&apos;s answers
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}

        {error && <Notice tone="bad" className="mt-4">{error}</Notice>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button type="button" className={btn.ghost} onClick={() => goto(step - 1)} disabled={step === 0}>
            ← Back
          </button>
          {step < reviewIdx ? (
            <button type="button" className={btn.primary} onClick={() => goto(step + 1)} data-testid="survey-next">
              Continue
            </button>
          ) : p.isRep ? (
            <button
              type="button"
              className={btn.primary}
              disabled={pending || p.locked}
              data-testid="survey-submit"
              onClick={() =>
                start(async () => {
                  for (let i = 0; i < reviewIdx; i++) {
                    const e = stepValid(i);
                    if (e) {
                      setStep(i);
                      return setError(e);
                    }
                  }
                  await saveDraftAction(p.partyId, { ...q, step: 4 });
                  const r = await submitPreferencesAction(p.partyId);
                  if (!r.ok) setError(r.error);
                  else if (r.redirect) router.push(r.redirect);
                })
              }
            >
              {pending ? "Submitting…" : p.submittedAt ? "Resubmit for our party" : "Submit for our party"}
            </button>
          ) : (
            <button
              type="button"
              className={btn.primary}
              disabled={pending || p.locked}
              data-testid="survey-share"
              onClick={() =>
                start(async () => {
                  await saveDraftAction(p.partyId, { ...q, step: 4 });
                  const r = await shareDraftAction(p.partyId);
                  if (!r.ok) setError(r.error);
                  else router.push(`/party/${p.partyId}?shared=1`);
                })
              }
            >
              {pending ? "Sharing…" : "Share my input with " + (p.repName.split(" ")[0] || "my representative")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-4", checked ? "border-pine-500 bg-pine-50" : "border-sand-200 bg-white")}>
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-ink-500">{hint}</span>}
      </span>
    </label>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-400">{k}</dt>
      <dd className="mt-1 text-ink-900">{v}</dd>
    </div>
  );
}
