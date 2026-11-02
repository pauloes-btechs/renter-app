import type { QuestionnaireData } from "../domain/questionnaire";
import type { AttributeKey } from "../engine/types";

export interface RoomTemplate {
  key: string;
  name: string;
  shortName: string;
  bedConfig: string;
  capacity: number;
  bedCount: number;
  hasBunk: boolean;
  accessible: boolean;
  weightMilli: number;
  qualityRating: number; // 1..5 display rating
  description: string;
  imageKey: "master" | "view" | "comfort" | "bunk" | "generic";
  attributes: Record<AttributeKey, number>;
  amenities: { label: string; icon: string }[];
}

export const DEMO_PROPERTY = {
  name: "The Shared Vacation House",
  location: "Big Sur coast, California",
  description:
    "A four-bedroom coastal retreat with an open kitchen, a fireside living room, and a deck over the water. Every bedroom shares the full house.",
  currency: "USD",
  checkIn: "2027-06-11",
  checkOut: "2027-06-15",
  costItems: [{ label: "Entire stay (all-inclusive)", amountCents: 420_000 }],
  sharedAmenities: ["Full kitchen", "Living room with fireplace", "Ocean-view deck", "Hot tub", "Washer & dryer", "Fast Wi-Fi"],
};

export const DEMO_ROOMS: RoomTemplate[] = [
  {
    key: "master",
    name: "Master Suite",
    shortName: "Bedroom 1",
    bedConfig: "King bed (configurable)",
    capacity: 2,
    bedCount: 1,
    hasBunk: false,
    accessible: true,
    weightMilli: 1450,
    qualityRating: 5,
    description: "The largest room, with a private ensuite bathroom. Premium privacy and comfort.",
    imageKey: "master",
    attributes: { privacy: 1, privateBath: 1, view: 0.4, bedComfort: 1, roomSize: 1, relaxation: 0.3, quality: 1 },
    amenities: [
      { label: "Private ensuite bathroom", icon: "bath" },
      { label: "King bed", icon: "bed" },
      { label: "Largest room", icon: "size" },
      { label: "Ground floor", icon: "access" },
    ],
  },
  {
    key: "view",
    name: "View Room",
    shortName: "Bedroom 2",
    bedConfig: "Full-size bed",
    capacity: 2,
    bedCount: 1,
    hasBunk: false,
    accessible: false,
    weightMilli: 1150,
    qualityRating: 4,
    description: "Wake up to the coastline. Standard amenities with the best scenery in the house.",
    imageKey: "view",
    attributes: { privacy: 0.6, privateBath: 0, view: 1, bedComfort: 0.65, roomSize: 0.6, relaxation: 0.3, quality: 0.7 },
    amenities: [
      { label: "Scenic ocean view", icon: "view" },
      { label: "Full-size bed", icon: "bed" },
      { label: "Shared hall bathroom", icon: "bath" },
    ],
  },
  {
    key: "comfort",
    name: "Comfort Room",
    shortName: "Bedroom 3",
    bedConfig: "Full-size bed",
    capacity: 2,
    bedCount: 1,
    hasBunk: false,
    accessible: false,
    weightMilli: 1100,
    qualityRating: 4,
    description: "Comparable to the View Room, with a full-body massage chair instead of the view.",
    imageKey: "comfort",
    attributes: { privacy: 0.6, privateBath: 0, view: 0.2, bedComfort: 0.65, roomSize: 0.6, relaxation: 1, quality: 0.7 },
    amenities: [
      { label: "Massage chair", icon: "relax" },
      { label: "Full-size bed", icon: "bed" },
      { label: "Shared hall bathroom", icon: "bath" },
    ],
  },
  {
    key: "bunk",
    name: "Twin/Bunk Room",
    shortName: "Bedroom 4",
    bedConfig: "Twin bunk beds",
    capacity: 2,
    bedCount: 2,
    hasBunk: true,
    accessible: false,
    weightMilli: 600,
    qualityRating: 2,
    description: "A simple, cozy room with twin bunks. Less privacy, lowest premium.",
    imageKey: "bunk",
    attributes: { privacy: 0.2, privateBath: 0, view: 0.1, bedComfort: 0.3, roomSize: 0.35, relaxation: 0.1, quality: 0.3 },
    amenities: [
      { label: "Two twin bunks", icon: "bed" },
      { label: "Separate sleeping surfaces", icon: "beds" },
      { label: "Shared hall bathroom", icon: "bath" },
    ],
  },
];

export interface DemoPartyFixture {
  slot: string;
  members: { name: string; email: string }[];
  /** Questionnaire answers with room keys (mapped to ids at seed time). */
  /** Room references use template keys; bids are party totals in cents. */
  answers: Omit<QuestionnaireData, "roomRanking" | "refusedRooms" | "bids"> & { roomRanking: string[]; refusedRooms: string[]; bids: Record<string, number> };
  /** Optional differing draft from the second member, to exercise disagreement resolution. */
  secondMemberDraft?: Partial<DemoPartyFixture["answers"]>;
}

export const DEMO_GROUP = {
  name: "Big Sur, June 2027",
  maxParties: 4,
  maxPartySize: 2,
  sharedBps: 4000,
};

export const DEMO_PARTIES: DemoPartyFixture[] = [
  {
    slot: "Party A",
    members: [
      { name: "Maya Chen", email: "maya@example.com" },
      { name: "Jordan Reyes", email: "jordan@example.com" },
    ],
    answers: {
      step: 4,
      partyName: "Maya & Jordan",
      partySize: 2,
      sharingBed: true,
      separateBeds: false,
      noBunk: true,
      accessible: false,
      otherRequirements: "",
      idealBudgetCents: 145_000,
      maxBudgetCents: 150_000,
      hardMax: false,
      premiumFlex: 4,
      priorities: { lowPrice: 1, privacy: 5, privateBath: 5, view: 2, bedComfort: 4, roomSize: 3, relaxation: 1, quality: 4 },
      topPriorities: ["privacy", "privateBath", "bedComfort"],
      roomRanking: ["master", "view", "comfort", "bunk"],
      refusedRooms: ["bunk"],
      premiumForFirstChoice: true,
      bids: { master: 150_000, view: 118_000, comfort: 112_000 },
    },
  },
  {
    slot: "Party B",
    members: [
      { name: "Priya Natarajan", email: "priya@example.com" },
      { name: "Sam Okafor", email: "sam@example.com" },
    ],
    answers: {
      step: 4,
      partyName: "Priya & Sam",
      partySize: 2,
      sharingBed: true,
      separateBeds: false,
      noBunk: true,
      accessible: false,
      otherRequirements: "",
      idealBudgetCents: 125_000,
      maxBudgetCents: 130_000,
      hardMax: false,
      premiumFlex: 2,
      priorities: { lowPrice: 2, privacy: 3, privateBath: 1, view: 5, bedComfort: 3, roomSize: 2, relaxation: 2, quality: 3 },
      topPriorities: ["view", "bedComfort", "privacy"],
      roomRanking: ["view", "comfort", "master", "bunk"],
      refusedRooms: [],
      premiumForFirstChoice: false,
      bids: { view: 130_000, comfort: 110_000, master: 132_000, bunk: 55_000 },
    },
    secondMemberDraft: {
      roomRanking: ["comfort", "view", "master", "bunk"],
      priorities: { lowPrice: 2, privacy: 3, privateBath: 1, view: 3, bedComfort: 3, roomSize: 2, relaxation: 5, quality: 3 },
    },
  },
  {
    slot: "Party C",
    members: [{ name: "Lena Fischer", email: "lena@example.com" }],
    answers: {
      step: 4,
      partyName: "Lena",
      partySize: 1,
      sharingBed: false,
      separateBeds: false,
      noBunk: false,
      accessible: false,
      otherRequirements: "",
      idealBudgetCents: 95_000,
      maxBudgetCents: 100_000,
      hardMax: true,
      premiumFlex: 1,
      priorities: { lowPrice: 2, privacy: 3, privateBath: 1, view: 2, bedComfort: 4, roomSize: 2, relaxation: 5, quality: 3 },
      topPriorities: ["relaxation", "bedComfort", "privacy"],
      roomRanking: ["comfort", "view", "bunk", "master"],
      refusedRooms: [],
      premiumForFirstChoice: false,
      bids: { comfort: 100_000, view: 92_000, bunk: 60_000 },
    },
  },
  {
    slot: "Party D",
    members: [{ name: "Theo Martins", email: "theo@example.com" }],
    answers: {
      step: 4,
      partyName: "Theo",
      partySize: 1,
      sharingBed: false,
      separateBeds: false,
      noBunk: false,
      accessible: false,
      otherRequirements: "",
      idealBudgetCents: 65_000,
      maxBudgetCents: 70_000,
      hardMax: true,
      premiumFlex: 0,
      priorities: { lowPrice: 5, privacy: 1, privateBath: 0, view: 1, bedComfort: 2, roomSize: 1, relaxation: 0, quality: 1 },
      topPriorities: ["lowPrice"],
      roomRanking: ["bunk", "comfort", "view", "master"],
      refusedRooms: [],
      premiumForFirstChoice: false,
      bids: { bunk: 68_000 },
    },
  },
];

/** Expected baseline (cents) under the default 40/60 model. Used by tests, never by the app. */
export const DEMO_EXPECTED = {
  A: { room: "master", cents: 140_977 },
  B: { room: "view", cents: 123_395 },
  C: { room: "comfort", cents: 92_465 },
  D: { room: "bunk", cents: 63_163 },
};
