/**
 * Property ingestion abstraction.
 *
 * v1 supports manual entry only. A listing URL is recorded and recognized, but metadata is NOT fetched:
 * we never scrape or bypass a platform's terms. Future adapters (official partner APIs, iCal, owner exports)
 * implement `PropertySource` and return a draft the organizer reviews and corrects before use.
 */
export interface ImportedRoomDraft {
  name: string;
  bedConfig: string;
  capacity: number;
  amenities: string[];
}
export interface PropertyDraft {
  name?: string;
  location?: string;
  rooms?: ImportedRoomDraft[];
  costItems?: { label: string; kind: "base" | "cleaning" | "tax" | "service" | "other"; amountCents: number }[];
  currency?: string;
  nights?: number;
}
export interface PropertySource {
  readonly kind: "manual" | "listing_url" | "partner_api";
  supports(input: string): boolean;
  fetchDraft(input: string): Promise<{ ok: true; draft: PropertyDraft } | { ok: false; reason: string }>;
}

const PLATFORMS: { host: RegExp; name: string }[] = [
  { host: /(^|\.)airbnb\.[a-z.]+$/i, name: "Airbnb" },
  { host: /(^|\.)vrbo\.com$/i, name: "Vrbo" },
  { host: /(^|\.)booking\.com$/i, name: "Booking.com" },
];

export function analyzeListingUrl(raw: string): { valid: boolean; platform: string | null; message: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { valid: false, platform: null, message: "That doesn't look like a web address." };
  }
  if (!/^https?:$/.test(url.protocol)) return { valid: false, platform: null, message: "Only http(s) links are supported." };
  const p = PLATFORMS.find((x) => x.host.test(url.hostname));
  return {
    valid: true,
    platform: p?.name ?? null,
    message: `${p ? `${p.name} listing recognized.` : "Link saved."} Automatic import isn't available yet — Roomsplit doesn't scrape listing sites. Enter or correct the bedrooms and costs below; the link stays attached to the property for reference.`,
  };
}

export class ListingUrlSource implements PropertySource {
  readonly kind = "listing_url" as const;
  supports(input: string) {
    return analyzeListingUrl(input).valid;
  }
  async fetchDraft(input: string) {
    const a = analyzeListingUrl(input);
    return { ok: false as const, reason: a.message };
  }
}
