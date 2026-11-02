import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db/client";
import { demoPersonas, findDemoGroup, seedDemo } from "@/lib/demo/seed";
import { createSession } from "@/lib/server/services/auth";
import { DEMO_KEY_COOKIE, demoAllowed } from "@/lib/server/demoGate";
import { SESSION_COOKIE } from "@/lib/server/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const qk = req.nextUrl.searchParams.get("key");
  const gate = await demoAllowed(qk);
  if (gate !== "ok") return new NextResponse("Not found", { status: 404 });
  if (!findDemoGroup()) seedDemo();
  const persona = demoPersonas().find((p) => p.key === key);
  if (!persona) return new NextResponse("Unknown persona", { status: 404 });
  // Defense in depth: only seeded demo users can be impersonated.
  const u = getDb().prepare("SELECT is_demo FROM users WHERE id=?").get(persona.userId) as { is_demo: number } | undefined;
  if (!u?.is_demo) return new NextResponse("Not a demo user", { status: 403 });
  const token = createSession(getDb(), persona.userId, 1);
  const res = NextResponse.redirect(new URL(persona.landing, req.url));
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 });
  if (qk) res.cookies.set(DEMO_KEY_COOKIE, qk, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 });
  return res;
}
