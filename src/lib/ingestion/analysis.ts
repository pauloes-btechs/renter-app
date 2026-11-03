import { z } from "zod";
import type { AttributeKey } from "../engine/types";

/**
 * Listing analysis: what a vision model extracts from listing photos + pasted listing text,
 * and the deterministic mapping from that analysis to editable bedroom drafts.
 *
 * Rules (from product requirements):
 *  - Property-wide amenities (air conditioning, heating, Wi-Fi, …) apply to EVERY room equally;
 *    they are recorded once and never used to differentiate rooms.
 *  - Room-specific differences come from photos (and the listing's sleeping-arrangement text):
 *    room size, bed count and sizes, ensuite bathroom, walk-in closet, view quality, other features.
 *  - The organizer always reviews and corrects drafts before they replace the property's rooms.
 */

export const BED_SIZES = ["king", "queen", "full", "twin", "bunk", "sofa_bed", "crib"] as const;
export type BedSize = (typeof BED_SIZES)[number];
export const ROOM_SIZES = ["small", "medium", "large", "extra_large"] as const;
export type RoomSizeClass = (typeof ROOM_SIZES)[number];

export const analyzedRoomSchema = z.object({
  label: z.string().trim().min(1).max(60),
  photoIndexes: z.array(z.number().int().min(0)).max(40).default([]),
  beds: z
    .array(z.object({ size: z.enum(BED_SIZES), count: z.number().int().min(1).max(8) }))
    .max(8)
    .default([]),
  sizeClass: z.enum(ROOM_SIZES).default("medium"),
  ensuiteBathroom: z.boolean().default(false),
  walkInCloset: z.boolean().default(false),
  viewQuality: z.number().min(0).max(1).default(0.2),
  viewDescription: z.string().max(120).default(""),
  features: z.array(z.string().trim().min(1).max(60)).max(15).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  notes: z.string().max(300).default(""),
});
export type AnalyzedRoom = z.infer<typeof analyzedRoomSchema>;

export const COST_KINDS = ["base", "cleaning", "tax", "service", "other"] as const;

/** Whole-property facts read from the listing text. Amounts are in MAJOR currency units (e.g. dollars). */
export const analyzedPropertySchema = z.object({
  name: z.string().max(120).default(""),
  location: z.string().max(120).default(""),
  description: z.string().max(1000).default(""),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nights: z.number().int().min(1).max(365).optional(),
  maxGuests: z.number().int().min(1).max(100).optional(),
  costItems: z
    .array(z.object({ label: z.string().trim().min(1).max(60), kind: z.enum(COST_KINDS).default("other"), amount: z.number().min(0).max(1_000_000) }))
    .max(12)
    .default([]),
  totalAmount: z.number().min(0).max(1_000_000).optional(),
});
export type AnalyzedProperty = z.infer<typeof analyzedPropertySchema>;

export const listingAnalysisSchema = z.object({
  property: analyzedPropertySchema.optional(),
  propertyName: z.string().max(120).optional().default(""),
  sharedAmenities: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  rooms: z.array(analyzedRoomSchema).max(30),
  warnings: z.array(z.string().max(300)).max(20).default([]),
});
export type ListingAnalysis = z.infer<typeof listingAnalysisSchema>;

const BED: Record<BedSize, { label: string; sleeps: number; surfaces: number; comfort: number }> = {
  king: { label: "King bed", sleeps: 2, surfaces: 1, comfort: 1 },
  queen: { label: "Queen bed", sleeps: 2, surfaces: 1, comfort: 0.85 },
  full: { label: "Full bed", sleeps: 2, surfaces: 1, comfort: 0.65 },
  twin: { label: "Twin bed", sleeps: 1, surfaces: 1, comfort: 0.4 },
  bunk: { label: "Bunk bed", sleeps: 2, surfaces: 2, comfort: 0.3 },
  sofa_bed: { label: "Sofa bed", sleeps: 2, surfaces: 1, comfort: 0.25 },
  crib: { label: "Crib", sleeps: 0, surfaces: 0, comfort: 0 },
};
const SIZE_SCORE: Record<RoomSizeClass, number> = { small: 0.3, medium: 0.55, large: 0.8, extra_large: 1 };

/** Amenities that are treated as property-wide no matter where the model saw them. */
const SHARED_PATTERN =
  /air[\s-]?condition|\ba\/?c\b|central air|heating|heater|wi-?fi|wireless|internet|ceiling fan|\bfan\b|smoke alarm|carbon monoxide|hair ?dryer|hangers|\biron\b|bed linens|linens|towels|essentials|shampoo|soap|toilet paper|blackout|extra pillows/i;
const RELAX_PATTERN = /massage|hot tub|jacuzzi|soaking|bathtub|spa|fireplace|reading nook|lounge|sauna/i;
const BALCONY_PATTERN = /balcony|terrace|patio|deck|private entrance/i;

export function isSharedAmenity(label: string) {
  return SHARED_PATTERN.test(label);
}

export interface RoomDraft {
  key: string;
  name: string;
  shortName: string;
  bedConfig: string;
  capacity: number;
  bedCount: number;
  hasBunk: boolean;
  accessible: boolean;
  weightMilli: number;
  qualityRating: number;
  description: string;
  imageKey: "master" | "view" | "comfort" | "bunk" | "generic";
  attributes: Record<AttributeKey, number>;
  amenities: string[];
  photoIndexes: number[];
  confidence: number;
  viewRank: number; // 1 = best view
  notes: string;
}

export interface PropertyDraft {
  name: string;
  location: string;
  description: string;
  currency: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  maxGuests: number | null;
  /** Line items in cents. Their sum is the rental total. */
  costItems: { label: string; kind: (typeof COST_KINDS)[number]; amountCents: number }[];
  totalCents: number | null;
}

export interface ImportDraft {
  property: PropertyDraft;
  propertyName: string;
  sharedAmenities: string[];
  rooms: RoomDraft[];
  warnings: string[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

function describeBeds(beds: AnalyzedRoom["beds"]): string {
  if (beds.length === 0) return "Bed not identified";
  return beds.map((b) => `${b.count} ${BED[b.size].label}${b.count > 1 ? "s" : ""}`.replace("Beds", "beds").replace(/^1 /, "")).join(" + ");
}

/**
 * Deterministic analysis → draft mapping. Same analysis in, same drafts out.
 * Weights are normalized so the average bedroom weight is 1.00, rounded to 0.05.
 */
export function analysisToDraft(raw: ListingAnalysis): ImportDraft {
  const a = listingAnalysisSchema.parse(raw);
  const warnings = [...a.warnings];

  // Shared amenities: everything the model listed as property-wide, plus any shared-type item it attached to a room.
  const shared = new Map<string, string>();
  const addShared = (s: string) => {
    const k = s.trim().toLowerCase();
    if (k && !shared.has(k)) shared.set(k, s.trim());
  };
  a.sharedAmenities.forEach(addShared);
  for (const r of a.rooms) r.features.filter(isSharedAmenity).forEach(addShared);

  if (a.rooms.length === 0) warnings.push("No bedrooms were identified. Add bedroom photos or the listing's sleeping-arrangement text.");

  // View ranking (stable: viewQuality desc, then original order).
  const order = a.rooms.map((r, i) => ({ i, v: r.viewQuality })).sort((x, y) => y.v - x.v || x.i - y.i);
  const viewRank = new Map(order.map((o, rank) => [o.i, rank + 1]));
  const bestViewIdx = order.length && order[0].v >= 0.5 ? order[0].i : -1;

  const pre = a.rooms.map((r, i) => {
    const beds = r.beds;
    const capacity = Math.max(1, beds.reduce((s, b) => s + BED[b.size].sleeps * b.count, 0));
    const surfaces = Math.max(1, beds.reduce((s, b) => s + BED[b.size].surfaces * b.count, 0));
    const hasBunk = beds.some((b) => b.size === "bunk");
    const bedComfort = beds.length ? Math.max(...beds.map((b) => BED[b.size].comfort)) : 0.5;
    const size = SIZE_SCORE[r.sizeClass];
    const ensuite = r.ensuiteBathroom ? 1 : 0;
    const walkIn = r.walkInCloset ? 1 : 0;
    const view = clamp01(r.viewQuality);
    const roomFeatures = r.features.filter((f) => !isSharedAmenity(f));
    const relax = roomFeatures.some((f) => RELAX_PATTERN.test(f)) ? 0.85 : roomFeatures.some((f) => BALCONY_PATTERN.test(f)) ? 0.5 : 0.2;
    const balcony = roomFeatures.some((f) => BALCONY_PATTERN.test(f)) ? 1 : 0;
    const privacy = clamp01(0.35 + 0.35 * ensuite + 0.2 * size + 0.05 * balcony - (hasBunk ? 0.25 : 0));
    const quality = clamp01((size + bedComfort + (ensuite ? 1 : 0.4) + view + (walkIn ? 1 : 0.5)) / 5);
    const rawWeight =
      0.55 + 0.45 * size + 0.3 * ensuite + 0.1 * walkIn + 0.25 * view + 0.2 * bedComfort + 0.05 * Math.min(3, roomFeatures.length) / 3 - (hasBunk ? 0.1 : 0);
    const amenities: string[] = [describeBeds(beds)];
    if (r.ensuiteBathroom) amenities.push("Private ensuite bathroom");
    if (r.walkInCloset) amenities.push("Walk-in closet");
    if (i === bestViewIdx) amenities.push("Best view in the house");
    else if (view >= 0.6) amenities.push("Good view");
    if (r.viewDescription && view >= 0.4) amenities.push(r.viewDescription);
    amenities.push(...roomFeatures);
    const imageKey: RoomDraft["imageKey"] = hasBunk ? "bunk" : ensuite ? "master" : i === bestViewIdx ? "view" : relax >= 0.85 ? "comfort" : "generic";
    return {
      r, i, capacity, surfaces, hasBunk, rawWeight, imageKey,
      attributes: {
        privacy: round2(privacy), privateBath: ensuite, view: round2(view), bedComfort: round2(bedComfort),
        roomSize: round2(size), relaxation: round2(relax), quality: round2(quality),
      } as Record<AttributeKey, number>,
      amenities: [...new Set(amenities)].slice(0, 10),
    };
  });

  const meanRaw = pre.length ? pre.reduce((s, p) => s + p.rawWeight, 0) / pre.length : 1;
  const usedNames = new Set<string>();
  const rooms: RoomDraft[] = pre.map((p, k) => {
    let name = p.r.label.trim() || `Bedroom ${k + 1}`;
    let n = 2;
    while (usedNames.has(name.toLowerCase())) name = `${p.r.label.trim()} ${n++}`;
    usedNames.add(name.toLowerCase());
    const weightMilli = Math.max(100, Math.round((p.rawWeight / meanRaw) * 20) * 50);
    if (p.r.confidence < 0.5) warnings.push(`${name}: low confidence — please check beds and size.`);
    if (p.r.beds.length === 0) warnings.push(`${name}: bed size not identified — defaulted to sleeping 1.`);
    return {
      key: `import-${k}`,
      name,
      shortName: `Bedroom ${k + 1}`,
      bedConfig: describeBeds(p.r.beds),
      capacity: p.capacity,
      bedCount: p.surfaces,
      hasBunk: p.hasBunk,
      accessible: false,
      weightMilli,
      qualityRating: Math.max(1, Math.min(5, Math.round(1 + 4 * p.attributes.quality))),
      description: [p.r.sizeClass.replace("_", " ") + " room", p.r.viewDescription].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase()),
      imageKey: p.imageKey,
      attributes: p.attributes,
      amenities: p.amenities,
      photoIndexes: p.r.photoIndexes,
      confidence: p.r.confidence,
      viewRank: viewRank.get(p.i)!,
      notes: p.r.notes,
    };
  });

  // Property facts: line items in cents; if the listing states a total that differs from the items, keep the
  // stated total and add a balancing "Other fees" line so the total is always what the listing charges.
  const pa = a.property;
  const costItems = (pa?.costItems ?? []).map((c) => ({ label: c.label, kind: c.kind, amountCents: Math.round(c.amount * 100) })).filter((c) => c.amountCents > 0);
  const itemsSum = costItems.reduce((x, c) => x + c.amountCents, 0);
  const stated = pa?.totalAmount != null ? Math.round(pa.totalAmount * 100) : null;
  if (stated != null && stated > 0) {
    if (costItems.length === 0) costItems.push({ label: "Entire stay", kind: "base", amountCents: stated });
    else if (stated !== itemsSum) {
      const diff = stated - itemsSum;
      if (diff > 0) costItems.push({ label: "Other fees (to match listing total)", kind: "other", amountCents: diff });
      else warnings.push("The listed line items add up to more than the stated total — please check the cost breakdown.");
    }
  }
  const totalCents = costItems.length ? costItems.reduce((x, c) => x + c.amountCents, 0) : null;
  if (totalCents == null) warnings.push("No price found — enter the total for the stay.");
  const property: PropertyDraft = {
    name: (pa?.name || a.propertyName || "").trim(),
    location: pa?.location ?? "",
    description: pa?.description ?? "",
    currency: pa?.currency ?? null,
    checkIn: pa?.checkIn ?? null,
    checkOut: pa?.checkOut ?? null,
    nights: pa?.nights ?? null,
    maxGuests: pa?.maxGuests ?? null,
    costItems,
    totalCents,
  };
  return { property, propertyName: property.name, sharedAmenities: [...shared.values()], rooms, warnings };
}
