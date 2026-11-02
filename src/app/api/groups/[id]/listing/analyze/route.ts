import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getGroup } from "@/lib/server/repo";
import { userFromSession } from "@/lib/server/services/auth";
import { SESSION_COOKIE } from "@/lib/server/session";
import { analysisToDraft } from "@/lib/ingestion/analysis";
import { analyzeListingUrl } from "@/lib/ingestion";
import { getListingAnalyzer } from "@/lib/ingestion/analyzer";

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
  if (body.photos.length === 0 && body.text.trim().length < 20)
    return NextResponse.json({ error: "Add the listing's bedroom photos, or paste its sleeping-arrangement and amenity text." }, { status: 400 });
  if (body.listingUrl && !analyzeListingUrl(body.listingUrl).valid) return NextResponse.json({ error: "That listing link isn't a valid web address." }, { status: 400 });

  const analyzer = getListingAnalyzer();
  if (!analyzer.available())
    return NextResponse.json(
      { error: "Photo analysis isn't configured on this server. Set GEMINI_API_KEY (free from Google AI Studio) or ANTHROPIC_API_KEY, then redeploy.", code: "not_configured" },
      { status: 503 },
    );
  try {
    const analysis = await analyzer.analyze({ listingUrl: body.listingUrl, text: body.text, photos: body.photos });
    const draft = analysisToDraft(analysis);
    // Clamp photo references to what was actually uploaded.
    draft.rooms.forEach((r) => (r.photoIndexes = r.photoIndexes.filter((i) => i < body.photos.length)));
    return NextResponse.json({ analyzer: analyzer.name, draft });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed." }, { status: 502 });
  }
}
