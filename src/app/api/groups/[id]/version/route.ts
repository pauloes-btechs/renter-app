import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { userFromSession } from "@/lib/server/services/auth";
import { SESSION_COOKIE } from "@/lib/server/session";

export const dynamic = "force-dynamic";
/** Lightweight change counter for live updates. Members/organizer only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = userFromSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const row = getDb()
    .prepare(
      `SELECT g.version FROM groups g WHERE g.id=? AND (g.organizer_user_id=? OR EXISTS
        (SELECT 1 FROM party_memberships m WHERE m.group_id=g.id AND m.user_id=? AND m.left_at IS NULL))`,
    )
    .get(id, user.id, user.id) as { version: number } | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ version: row.version }, { headers: { "Cache-Control": "no-store" } });
}
