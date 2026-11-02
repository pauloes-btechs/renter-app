import { listingAnalysisSchema, BED_SIZES, ROOM_SIZES, type ListingAnalysis } from "./analysis";

export interface ListingPhoto {
  /** data:image/jpeg;base64,… (client-compressed) */
  dataUrl: string;
}
export interface ListingInput {
  listingUrl?: string;
  text: string;
  photos: ListingPhoto[];
}

export interface ListingAnalyzer {
  readonly name: string;
  available(): boolean;
  analyze(input: ListingInput): Promise<ListingAnalysis>;
}

const TOOL_NAME = "record_listing_analysis";

export const ANALYSIS_INSTRUCTIONS = `You are analyzing a vacation-rental listing so a group can split bedrooms and cost fairly.
You are given numbered listing photos and (optionally) text the organizer copied from the listing
(e.g. "Where you'll sleep" and "What this place offers").

Identify every distinct BEDROOM. Group photos of the same bedroom together by matching decor, bedding, windows and layout.
Ignore kitchens, living rooms and outdoor areas except to learn property-wide amenities.

Rules:
1. Property-wide amenities (air conditioning, heating, Wi-Fi, fans, linens, hair dryer, etc.) apply to ALL rooms equally.
   Put them in sharedAmenities only. Never list them as a room feature. Assume every bedroom has air conditioning if the property does.
2. Per bedroom, determine from the photos (prefer the listing text for bed sizes when it states them):
   - beds: each bed's size (king, queen, full, twin, bunk, sofa_bed, crib) and count
   - sizeClass: small / medium / large / extra_large relative to the other bedrooms in this listing (sizes should differ when the photos show a difference)
   - ensuiteBathroom: true only if a private bathroom clearly connects to the bedroom
   - walkInCloset: true only if visible or stated
   - viewQuality 0–1 from what is visible through the room's windows (0 = wall/none, 0.5 = pleasant, 1 = exceptional, e.g. ocean/mountain panorama) and a short viewDescription
   - features: other room-specific items (balcony, desk, TV, massage chair, fireplace, soaking tub, private entrance)
3. Rank views relative to each other — at most one room should be clearly "best".
4. Do not invent rooms. If the text lists a bedroom with no photos, include it with confidence ≤ 0.4.
   Use confidence (0–1) to show how sure you are, and notes for anything the organizer should double-check.
5. label: a short human name such as "Primary suite", "Ocean-view queen", "Bunk room". Use photoIndexes (0-based) for the photos of that room.
Call the ${TOOL_NAME} tool exactly once.`;

export const ANALYSIS_TOOL = {
  name: TOOL_NAME,
  description: "Record the structured bedroom analysis of the listing.",
  input_schema: {
    type: "object",
    properties: {
      propertyName: { type: "string" },
      sharedAmenities: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
      rooms: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            photoIndexes: { type: "array", items: { type: "integer" } },
            beds: {
              type: "array",
              items: {
                type: "object",
                properties: { size: { type: "string", enum: [...BED_SIZES] }, count: { type: "integer", minimum: 1 } },
                required: ["size", "count"],
              },
            },
            sizeClass: { type: "string", enum: [...ROOM_SIZES] },
            ensuiteBathroom: { type: "boolean" },
            walkInCloset: { type: "boolean" },
            viewQuality: { type: "number", minimum: 0, maximum: 1 },
            viewDescription: { type: "string" },
            features: { type: "array", items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            notes: { type: "string" },
          },
          required: ["label", "beds", "sizeClass", "ensuiteBathroom", "walkInCloset", "viewQuality", "confidence"],
        },
      },
    },
    required: ["sharedAmenities", "rooms"],
  },
} as const;

/** Claude vision analyzer (Anthropic Messages API, forced tool call for structured output). */
export class ClaudeListingAnalyzer implements ListingAnalyzer {
  readonly name = "claude";
  constructor(
    private apiKey = process.env.ANTHROPIC_API_KEY,
    private model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    private fetchImpl: typeof fetch = fetch,
  ) {}
  available() {
    return !!this.apiKey;
  }
  async analyze(input: ListingInput): Promise<ListingAnalysis> {
    if (!this.apiKey) throw new Error("ANTHROPIC_API_KEY is not configured.");
    const content: unknown[] = [];
    input.photos.forEach((p, i) => {
      const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(p.dataUrl);
      if (!m) return;
      content.push({ type: "text", text: `Photo ${i}:` });
      content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    });
    content.push({
      type: "text",
      text: `Listing URL: ${input.listingUrl || "(not provided)"}\n\nListing text from the organizer:\n${input.text || "(none provided)"}\n\nAnalyze the bedrooms now.`,
    });
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        system: ANALYSIS_INSTRUCTIONS,
        tools: [ANALYSIS_TOOL],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Listing analysis failed (${res.status}). ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
    const call = json.content?.find((c) => c.type === "tool_use" && c.name === TOOL_NAME);
    if (!call) throw new Error("The analyzer did not return a structured result.");
    return listingAnalysisSchema.parse(call.input);
  }
}

/**
 * Offline analyzer for tests and demos (LISTING_ANALYZER=mock). Produces a plausible analysis
 * from the pasted text ("Bedroom 1: 1 king bed") and photo count, without any network call.
 */
export class MockListingAnalyzer implements ListingAnalyzer {
  readonly name = "mock";
  available() {
    return true;
  }
  async analyze(input: ListingInput): Promise<ListingAnalysis> {
    const lines = input.text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const bedLines = lines.filter((l) => /bedroom|bunk/i.test(l) && /(king|queen|full|double|twin|single|bunk|sofa)/i.test(l));
    const parseBeds = (l: string) => {
      const out: { size: (typeof BED_SIZES)[number]; count: number }[] = [];
      for (const [re, size] of [[/(\d+)?\s*king/i, "king"], [/(\d+)?\s*queen/i, "queen"], [/(\d+)?\s*(full|double)/i, "full"], [/(\d+)?\s*(twin|single)/i, "twin"], [/(\d+)?\s*bunk/i, "bunk"], [/(\d+)?\s*sofa/i, "sofa_bed"]] as const) {
        const m = re.exec(l);
        if (m) out.push({ size, count: Number(m[1]) || 1 });
      }
      return out;
    };
    const n = Math.max(bedLines.length, Math.min(4, Math.ceil(input.photos.length / 2)), 1);
    const shared = lines.filter((l) => /air|wifi|wi-fi|heating|kitchen|washer|parking|hot tub|pool/i.test(l) && l.length < 50);
    return listingAnalysisSchema.parse({
      propertyName: "",
      sharedAmenities: shared.length ? shared : ["Air conditioning", "Wi-Fi"],
      rooms: Array.from({ length: n }, (_, i) => {
        const l = bedLines[i] ?? "";
        const beds = parseBeds(l);
        const first = i === 0;
        return {
          label: first ? "Primary suite" : beds.some((b) => b.size === "bunk") ? "Bunk room" : `Bedroom ${i + 1}`,
          photoIndexes: input.photos.length ? [i % input.photos.length] : [],
          beds: beds.length ? beds : [{ size: first ? "king" : "queen", count: 1 }],
          sizeClass: first ? "large" : i === n - 1 && n > 2 ? "small" : "medium",
          ensuiteBathroom: first || /ensuite|en-suite|private bath/i.test(l),
          walkInCloset: first && /walk-?in/i.test(input.text),
          viewQuality: i === 1 ? 0.9 : first ? 0.5 : 0.25,
          viewDescription: i === 1 ? "Water view from the window" : "",
          features: i === 2 ? ["Desk", "Air conditioning"] : [],
          confidence: l ? 0.8 : 0.45,
          notes: "Generated by the offline mock analyzer.",
        };
      }),
      warnings: ["Mock analyzer: results are illustrative, not derived from the photos."],
    });
  }
}

/** Convert the JSON-Schema tool definition into Gemini's OpenAPI-subset responseSchema (uppercase types). */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === "type" && typeof v === "string") out.type = v.toUpperCase();
    else if (k === "minimum" || k === "maximum") continue; // not supported on all models; validated with zod instead
    else out[k] = toGeminiSchema(v);
  }
  return out;
}

/** Google Gemini analyzer (free tier available via Google AI Studio). Uses JSON mode with a response schema. */
export class GeminiListingAnalyzer implements ListingAnalyzer {
  readonly name = "gemini";
  constructor(
    private apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
    private model = process.env.GEMINI_MODEL || "gemini-flash-latest",
    private fetchImpl: typeof fetch = fetch,
  ) {}
  available() {
    return !!this.apiKey;
  }
  async analyze(input: ListingInput): Promise<ListingAnalysis> {
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not configured.");
    const parts: unknown[] = [];
    input.photos.forEach((p, i) => {
      const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(p.dataUrl);
      if (!m) return;
      parts.push({ text: `Photo ${i}:` });
      parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
    });
    parts.push({
      text: `Listing URL: ${input.listingUrl || "(not provided)"}\n\nListing text from the organizer:\n${input.text || "(none provided)"}\n\nAnalyze the bedrooms now and respond with JSON only.`,
    });
    const res = await this.fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ANALYSIS_INSTRUCTIONS.replace(`Call the ${TOOL_NAME} tool exactly once.`, "Return a single JSON object matching the response schema.") }] },
        contents: [{ role: "user", parts }],
        generationConfig: { responseMimeType: "application/json", responseSchema: toGeminiSchema(ANALYSIS_TOOL.input_schema), temperature: 0.2 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const hint = res.status === 429 ? " Free-tier quota reached — try again in a minute or tomorrow." : "";
      throw new Error(`Listing analysis failed (${res.status}).${hint} ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    } catch {
      throw new Error("The analyzer did not return valid JSON.");
    }
    return listingAnalysisSchema.parse(parsed);
  }
}

/**
 * Analyzer selection: LISTING_ANALYZER=gemini|claude|mock forces one; otherwise a Google key
 * (GEMINI_API_KEY / GOOGLE_API_KEY) selects Gemini, then ANTHROPIC_API_KEY selects Claude.
 */
export function getListingAnalyzer(): ListingAnalyzer {
  const forced = process.env.LISTING_ANALYZER;
  if (forced === "mock") return new MockListingAnalyzer();
  if (forced === "gemini") return new GeminiListingAnalyzer();
  if (forced === "claude") return new ClaudeListingAnalyzer();
  const gemini = new GeminiListingAnalyzer();
  if (gemini.available()) return gemini;
  const claude = new ClaudeListingAnalyzer();
  if (claude.available()) return claude;
  return gemini; // unavailable → route explains which key to set
}
