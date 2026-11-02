/**
 * Pure domain types for the pricing + assignment engine.
 * The engine never touches the database; services map DB rows into these shapes.
 * All money is integer cents. All fractions are integer basis points (1/100 of a percent).
 */

export const ATTRIBUTE_KEYS = [
  "privacy",
  "privateBath",
  "view",
  "bedComfort",
  "roomSize",
  "relaxation",
  "quality",
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export const PRIORITY_KEYS = ["lowPrice", ...ATTRIBUTE_KEYS] as const;
export type PriorityKey = (typeof PRIORITY_KEYS)[number];

export const PRIORITY_LABELS: Record<PriorityKey, string> = {
  lowPrice: "Lowest possible price",
  privacy: "Privacy",
  privateBath: "Private bathroom",
  view: "Scenic view",
  bedComfort: "Bed size & sleeping comfort",
  roomSize: "Room size",
  relaxation: "Massage chair & relaxation",
  quality: "Overall room quality",
};

export interface RoomInput {
  id: string;
  name: string;
  capacity: number;
  bedCount: number;
  hasBunk: boolean;
  accessible: boolean;
  /** Pricing weight in thousandths (1.45 → 1450). Integer so allocation is exact. */
  weightMilli: number;
  /** 0..1 levels describing how strongly the room offers each attribute. */
  attributes: Record<AttributeKey, number>;
  sort: number;
}

export interface PartyRequirements {
  separateBeds: boolean;
  noBunk: boolean;
  accessible: boolean;
}

export interface PartyBudget {
  idealCents: number;
  maxCents: number;
  hardMax: boolean;
  /** 0..5 willingness to stretch toward max for a preferred room. */
  premiumFlex: number;
}

export interface PartyInput {
  id: string;
  name: string;
  size: number;
  requirements: PartyRequirements;
  budget: PartyBudget;
  /** 0..5 importance per priority. */
  priorities: Record<PriorityKey, number>;
  /** Up to three priorities in rank order. */
  topPriorities: PriorityKey[];
  /** Room ids most → least preferred. Rooms missing from the list are treated as least preferred. */
  roomRanking: string[];
  /** Rooms the party refuses outright (hard constraint). */
  refusedRooms: string[];
  premiumForFirstChoice: boolean;
  sort: number;
  /** Auction mode: max party total the party would pay per room (cents). Missing/0 = won't take that room. */
  bids?: Record<string, number>;
}

export interface PricingConfig {
  totalCents: number;
  /** Shared-property fraction in basis points (4000 = 40%). Private fraction = 10000 - sharedBps. */
  sharedBps: number;
}

/** weighted = deterministic weights; hybrid = weighted + auction comparison; auction = auction-led. */
export type PricingMethod = "weighted" | "hybrid" | "auction";

/** partyId → roomId */
export type Assignment = Record<string, string>;
