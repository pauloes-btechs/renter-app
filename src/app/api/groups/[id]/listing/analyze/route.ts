import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getGroup } from "@/lib/server/repo";
import { userFromSession } from "@/lib/server/services/auth";
import { SESSION_COOKIE } from "@/lib/server/session";
import { ingestListing } from "@/lib/ingestion/ingest";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  listingUrl: z.string().max(500).optional().default(""),
  text: z.string().max(20_000).default(""),
  photos: z
    .array(z.object({ dataUrl: z.string().max(1_500_000).regex(/^data:image\/(jpeg|png|webp);base64,/) }))
    .max(16)
    .default([]),
});

/** Organizer-only: analyze user-supplied listing photos + text into reviewable bedroom drafts. Nothing is saved here. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = userFromSession(req.cookies.get(SESSION_COOKIE)?.value);
  const g = getGroup(id);
  if (!user || !g || g.organizer_user_id !== user.id) return NextResponse.json({ error: "Only the organizer can import a listing." }, { status: 403 });
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Upload up to 16 photos (JPEG/PNG/WebP) and up to 20,000 characters of listing text." }, { status: 400 });
  }
  const r = await ingestListing({ listingUrl: body.listingUrl, text: body.text, photos: body.photos });
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code, platform: r.platform }, { status: r.status });
  return NextResponse.json(r);
}
