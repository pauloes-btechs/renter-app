import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { ingestListing, rateLimited } from "@/lib/ingestion/ingest";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  listingUrl: z.string().max(500).optional().default(""),
  text: z.string().max(30_000).default(""),
  photos: z.array(z.object({ dataUrl: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,/) })).max(16).default([]),
});

/** Create-flow listing ingestion (before a group exists). Rate-limited per client. Nothing is saved. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  if (rateLimited(ip)) return NextResponse.json({ error: "Too many listing imports from this connection. Try again in an hour.", code: "rate_limited" }, { status: 429 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Up to 16 photos (JPEG/PNG/WebP) and 30,000 characters of listing text.", code: "invalid" }, { status: 400 });
  }
  const r = await ingestListing(body);
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code, platform: r.platform }, { status: r.status });
  return NextResponse.json(r);
}
