import { analysisToDraft, type ImportDraft } from "./analysis";
import { getListingAnalyzer, type ListingAnalyzer } from "./analyzer";
import { fetchListing, type FetchedListing } from "./fetchListing";
import { analyzeListingUrl } from "./index";

export interface IngestInput {
  listingUrl?: string;
  text: string;
  photos: { dataUrl: string }[];
}

export type IngestResult =
  | { ok: true; draft: ImportDraft; analyzer: string; photos: { dataUrl: string }[]; source: "fetched" | "pasted" | "fetched+pasted"; notice: string | null }
  | { ok: false; status: number; code: "paste_required" | "not_configured" | "invalid" | "failed"; error: string; platform?: string };

/**
 * One entry point for listing ingestion (used at group creation and on the property page):
 *  1. If only a link is given, fetch it when permitted; otherwise ask for pasted text/photos.
 *  2. Run the vision/text analyzer over everything we have.
 *  3. Map deterministically to an editable draft.
 */
export async function ingestListing(
  input: IngestInput,
  deps: { analyzer?: ListingAnalyzer; fetcher?: (url: string) => Promise<FetchedListing> } = {},
): Promise<IngestResult> {
  const url = input.listingUrl?.trim() ?? "";
  if (url && !analyzeListingUrl(url).valid) return { ok: false, status: 400, code: "invalid", error: "That listing link isn't a valid web address." };
  let text = input.text ?? "";
  let photos = input.photos ?? [];
  let source: "fetched" | "pasted" | "fetched+pasted" = "pasted";
  let notice: string | null = null;
  const hasPasted = text.trim().length >= 20 || photos.length > 0;

  if (url) {
    const fetched = await (deps.fetcher ?? fetchListing)(url);
    if (fetched.ok) {
      text = [fetched.text, text].filter(Boolean).join("\n\n--- Pasted by organizer ---\n");
      photos = [...photos, ...fetched.photos].slice(0, 16);
      source = hasPasted ? "fetched+pasted" : "fetched";
    } else if (!hasPasted) {
      return { ok: false, status: 422, code: "paste_required", error: fetched.message, platform: fetched.platform };
    } else if (fetched.reason !== "prohibited") {
      notice = fetched.message;
    }
  } else if (!hasPasted) {
    return { ok: false, status: 400, code: "invalid", error: "Paste a listing link, or the listing's text and photos." };
  }

  const analyzer = deps.analyzer ?? getListingAnalyzer();
  if (!analyzer.available())
    return {
      ok: false, status: 503, code: "not_configured",
      error: "Listing analysis isn't configured on this server. Set GEMINI_API_KEY (free from Google AI Studio) or ANTHROPIC_API_KEY, then redeploy.",
    };
  try {
    const analysis = await analyzer.analyze({ listingUrl: url, text, photos });
    const draft = analysisToDraft(analysis);
    draft.rooms.forEach((r) => (r.photoIndexes = r.photoIndexes.filter((i) => i < photos.length)));
    return { ok: true, draft, analyzer: analyzer.name, photos, source, notice };
  } catch (e) {
    console.error(e);
    return { ok: false, status: 502, code: "failed", error: e instanceof Error ? e.message : "Analysis failed." };
  }
}

/** Simple in-memory limiter for the unauthenticated create-flow endpoint (per instance). */
const hits = new Map<string, number[]>();
export function rateLimited(key: string, limit = Number(process.env.LISTING_ANALYZE_PER_HOUR || 12)): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
