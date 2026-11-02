import { describe, expect, it } from "vitest";
import { analysisToDraft, isSharedAmenity, type ListingAnalysis } from "@/lib/ingestion/analysis";
import { ClaudeListingAnalyzer, MockListingAnalyzer } from "@/lib/ingestion/analyzer";

const analysis: ListingAnalysis = {
  propertyName: "Cliff House",
  sharedAmenities: ["Air conditioning", "Wi-Fi", "Hot tub"],
  warnings: [],
  rooms: [
    { label: "Primary suite", photoIndexes: [0, 1], beds: [{ size: "king", count: 1 }], sizeClass: "extra_large", ensuiteBathroom: true, walkInCloset: true, viewQuality: 0.5, viewDescription: "Garden view", features: ["Air conditioning", "Fireplace"], confidence: 0.9, notes: "" },
    { label: "Ocean room", photoIndexes: [2], beds: [{ size: "queen", count: 1 }], sizeClass: "medium", ensuiteBathroom: false, walkInCloset: false, viewQuality: 0.95, viewDescription: "Ocean panorama", features: ["Desk"], confidence: 0.85, notes: "" },
    { label: "Queen room", photoIndexes: [3], beds: [{ size: "queen", count: 1 }], sizeClass: "medium", ensuiteBathroom: false, walkInCloset: false, viewQuality: 0.2, viewDescription: "", features: [], confidence: 0.8, notes: "" },
    { label: "Bunk room", photoIndexes: [4], beds: [{ size: "bunk", count: 1 }], sizeClass: "small", ensuiteBathroom: false, walkInCloset: false, viewQuality: 0.1, viewDescription: "", features: ["Ceiling fan"], confidence: 0.4, notes: "" },
  ],
};

describe("analysisToDraft", () => {
  const d = analysisToDraft(analysis);
  it("treats air conditioning and similar as shared, never as a room difference", () => {
    expect(d.sharedAmenities).toEqual(expect.arrayContaining(["Air conditioning", "Wi-Fi", "Ceiling fan"]));
    for (const r of d.rooms) expect(r.amenities.some(isSharedAmenity)).toBe(false);
  });
  it("derives per-room beds, capacity, ensuite, closet and sizes", () => {
    const [primary, ocean, , bunk] = d.rooms;
    expect(primary.bedConfig).toBe("King bed");
    expect(primary.attributes.privateBath).toBe(1);
    expect(primary.amenities).toEqual(expect.arrayContaining(["Private ensuite bathroom", "Walk-in closet", "Fireplace"]));
    expect(primary.imageKey).toBe("master");
    expect(bunk.hasBunk).toBe(true);
    expect(bunk.bedCount).toBe(2);
    expect(bunk.capacity).toBe(2);
    expect(primary.attributes.roomSize).toBeGreaterThan(ocean.attributes.roomSize);
    expect(ocean.attributes.roomSize).toBeGreaterThan(bunk.attributes.roomSize);
  });
  it("ranks views and marks the single best view", () => {
    const ocean = d.rooms[1];
    expect(ocean.viewRank).toBe(1);
    expect(ocean.amenities).toContain("Best view in the house");
    expect(d.rooms.filter((r) => r.amenities.includes("Best view in the house"))).toHaveLength(1);
    expect(ocean.imageKey).toBe("view");
  });
  it("suggests weights that average 1.00 and order sensibly", () => {
    const w = d.rooms.map((r) => r.weightMilli);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    expect(Math.abs(mean - 1000)).toBeLessThanOrEqual(50);
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[1]).toBeGreaterThan(w[2]);
    expect(w[2]).toBeGreaterThan(w[3]);
    w.forEach((x) => expect(x % 50).toBe(0));
  });
  it("warns about low confidence and is deterministic", () => {
    expect(d.warnings.join(" ")).toMatch(/Bunk room: low confidence/);
    expect(analysisToDraft(analysis)).toEqual(d);
  });
  it("deduplicates room names", () => {
    const dd = analysisToDraft({ ...analysis, rooms: [analysis.rooms[2], analysis.rooms[2]] });
    expect(dd.rooms.map((r) => r.name)).toEqual(["Queen room", "Queen room 2"]);
  });
});

describe("ClaudeListingAnalyzer", () => {
  it("sends photos + text with a forced tool call and validates the result", async () => {
    let body: any;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ content: [{ type: "tool_use", name: "record_listing_analysis", input: analysis }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const a = new ClaudeListingAnalyzer("test-key", "test-model", fakeFetch);
    const out = await a.analyze({ text: "Bedroom 1: 1 king bed", photos: [{ dataUrl: "data:image/jpeg;base64,AAAA" }] });
    expect(out.rooms).toHaveLength(4);
    expect(body.tool_choice).toEqual({ type: "tool", name: "record_listing_analysis" });
    expect(body.model).toBe("test-model");
    expect(body.messages[0].content.some((c: any) => c.type === "image" && c.source.data === "AAAA")).toBe(true);
    expect(body.system).toMatch(/air conditioning/i);
  });
  it("surfaces API errors and reports unavailability without a key", async () => {
    const bad = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(new ClaudeListingAnalyzer("k", "m", bad).analyze({ text: "x", photos: [] })).rejects.toThrow(/401/);
    expect(new ClaudeListingAnalyzer("", "m").available()).toBe(false);
  });
  it("mock analyzer parses sleeping arrangements from text", async () => {
    const out = await new MockListingAnalyzer().analyze({ text: "Bedroom 1: 1 king bed\nBedroom 2: 1 queen bed\nBedroom 3: 2 twin beds\nBunk room: 1 bunk bed\nAir conditioning", photos: [] });
    expect(out.rooms).toHaveLength(4);
    expect(analysisToDraft(out).rooms[2].capacity).toBe(2);
  });
});
