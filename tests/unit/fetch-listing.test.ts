import { describe, expect, it } from "vitest";
import { extractListing, fetchListing, isPrivateAddress, prohibitedPlatform, robotsAllows, type FetchDeps } from "@/lib/ingestion/fetchListing";
import { ingestListing } from "@/lib/ingestion/ingest";
import { MockListingAnalyzer } from "@/lib/ingestion/analyzer";
import { analysisToDraft } from "@/lib/ingestion/analysis";

const HTML = `<!doctype html><html><head><title>Fallback</title>
<meta property="og:title" content="Seaside Villa &amp; Garden">
<meta property="og:description" content="4-bedroom villa above the cove.">
<meta property="og:image" content="/img/cover.jpg">
<script type="application/ld+json">{"@type":"VacationRental","name":"Seaside Villa","image":["https://cdn.example.com/a.jpg",{"url":"https://cdn.example.com/b.jpg"}],"amenityFeature":[{"name":"Air conditioning"}]}</script>
<style>.x{}</style><script>var tracking=1</script></head>
<body><h1>Seaside Villa</h1><p>Bedroom 1: 1 king bed</p><p>Bedroom 2: 1 queen bed</p><img src="/icons/logo.png"><img src="/photos/room1.jpg"></body></html>`;

function deps(routes: Record<string, { status?: number; type?: string; body?: string; location?: string }>, ips: Record<string, string[]> = {}): FetchDeps {
  return {
    lookup: async (h) => ips[h] ?? ["93.184.216.34"],
    fetch: (async (url: string) => {
      const r = routes[url];
      if (!r) return new Response("missing", { status: 404, headers: { "content-type": "text/plain" } });
      const headers: Record<string, string> = { "content-type": r.type ?? "text/html" };
      if (r.location) headers.location = r.location;
      return new Response(r.body ?? "", { status: r.status ?? 200, headers });
    }) as unknown as typeof fetch,
  };
}

describe("listing fetch safety", () => {
  it("never fetches platforms whose terms prohibit it", async () => {
    expect(prohibitedPlatform("https://www.airbnb.com/rooms/1")).toBe("Airbnb");
    expect(prohibitedPlatform("https://www.airbnb.co.uk/rooms/1")).toBe("Airbnb");
    expect(prohibitedPlatform("https://www.vrbo.com/123")).toBe("Vrbo");
    expect(prohibitedPlatform("https://villas.example.com/x")).toBeNull();
    let called = false;
    const r = await fetchListing("https://www.airbnb.com/rooms/1", { lookup: async () => ["1.1.1.1"], fetch: (async () => { called = true; return new Response(""); }) as unknown as typeof fetch });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it("blocks private and internal addresses, including via redirects", async () => {
    for (const ip of ["10.0.0.5", "127.0.0.1", "192.168.1.1", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1", "100.64.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    const internal = await fetchListing("https://intranet.example.com/x", deps({}, { "intranet.example.com": ["10.1.2.3"] }));
    expect(internal.ok).toBe(false);
    const redirect = await fetchListing(
      "https://villas.example.com/x",
      deps({ "https://villas.example.com/x": { status: 302, location: "http://metadata.internal/latest" } }, { "metadata.internal": ["169.254.169.254"] }),
    );
    expect(redirect.ok).toBe(false);
    if (!redirect.ok) expect(redirect.message).toMatch(/publicly reachable/);
  });
  it("respects robots.txt", async () => {
    expect(robotsAllows("User-agent: *\nDisallow: /rooms/", "/rooms/5")).toBe(false);
    expect(robotsAllows("User-agent: *\nDisallow: /rooms/\nAllow: /rooms/public", "/rooms/public/1")).toBe(true);
    expect(robotsAllows("User-agent: RoomsplitListingImport\nDisallow: /\n\nUser-agent: *\nAllow: /", "/x")).toBe(false);
    expect(robotsAllows("", "/x")).toBe(true);
    const r = await fetchListing(
      "https://villas.example.com/rooms/5",
      deps({ "https://villas.example.com/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /rooms" }, "https://villas.example.com/rooms/5": { body: HTML } }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("robots");
  });
});

describe("extraction", () => {
  it("pulls title, description, JSON-LD, images and readable text", () => {
    const ex = extractListing(HTML, "https://villas.example.com/listing");
    expect(ex.title).toBe("Seaside Villa & Garden");
    expect(ex.description).toBe("4-bedroom villa above the cove.");
    expect(ex.structured[0].name).toBe("Seaside Villa");
    expect(ex.imageUrls).toEqual(["https://villas.example.com/img/cover.jpg", "https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg", "https://villas.example.com/photos/room1.jpg"]);
    expect(ex.text).toMatch(/Bedroom 1: 1 king bed/);
    expect(ex.text).not.toMatch(/tracking/);
  });
  it("fetches permitted pages and their photos", async () => {
    const img = Buffer.from("fake").toString("binary");
    const r = await fetchListing(
      "https://villas.example.com/listing",
      deps({
        "https://villas.example.com/listing": { body: HTML },
        "https://villas.example.com/img/cover.jpg": { type: "image/jpeg", body: img },
        "https://cdn.example.com/a.jpg": { type: "image/jpeg", body: img },
      }),
      async () => Buffer.from("jpeg"),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.text).toMatch(/Seaside Villa/);
      expect(r.photos).toHaveLength(2);
      expect(r.photos[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    }
  });
});

describe("ingestListing", () => {
  const analyzer = new MockListingAnalyzer();
  it("asks for pasted content when the platform prohibits fetching", async () => {
    const r = await ingestListing({ listingUrl: "https://www.airbnb.com/rooms/9", text: "", photos: [] }, { analyzer });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("paste_required");
      expect(r.platform).toBe("Airbnb");
    }
  });
  it("uses pasted Airbnb text and extracts the full property: name, location, costs, rooms", async () => {
    const text = [
      "Cliffside Retreat with Hot Tub",
      "Big Sur, California",
      "$450 x 4 nights $1,800",
      "Cleaning fee $250",
      "Service fee $300",
      "Taxes $150",
      "Total $2,500",
      "Bedroom 1: 1 king bed",
      "Bedroom 2: 1 queen bed",
      "Air conditioning",
    ].join("\n");
    const r = await ingestListing({ listingUrl: "https://www.airbnb.com/rooms/9", text, photos: [] }, { analyzer });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.property.name).toBe("Cliffside Retreat with Hot Tub");
      expect(r.draft.property.location).toBe("Big Sur, California");
      expect(r.draft.property.costItems.map((c) => c.kind)).toEqual(["base", "cleaning", "service", "tax"]);
      expect(r.draft.property.totalCents).toBe(250_000);
      expect(r.draft.rooms).toHaveLength(2);
      expect(r.draft.sharedAmenities).toContain("Air conditioning");
    }
  });
  it("fetches permitted sites from the link alone", async () => {
    const r = await ingestListing(
      { listingUrl: "https://villas.example.com/listing", text: "", photos: [] },
      { analyzer, fetcher: async () => ({ ok: true, title: "Seaside Villa", text: "Seaside Villa\nBedroom 1: 1 king bed\nTotal $3,000", photos: [{ dataUrl: "data:image/jpeg;base64,AA" }], finalUrl: "x" }) },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("fetched");
      expect(r.photos).toHaveLength(1);
      expect(r.draft.property.totalCents).toBe(300_000);
    }
  });
  it("balances line items to the stated total", () => {
    const d = analysisToDraft({
      property: { name: "X", location: "", description: "", costItems: [{ label: "Stay", kind: "base", amount: 1000 }], totalAmount: 1180.5 },
      propertyName: "", sharedAmenities: [], rooms: [], warnings: [],
    });
    expect(d.property.totalCents).toBe(118_050);
    expect(d.property.costItems[1]).toMatchObject({ kind: "other", amountCents: 18_050 });
  });
});
