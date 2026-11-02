import { NextResponse, type NextRequest } from "next/server";
import { redeemAccessLink } from "@/lib/server/services/auth";
import { SESSION_COOKIE } from "@/lib/server/session";

/** Personal sign-in link: exchanges a private token for a session cookie. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = redeemAccessLink(token);
  const next = req.nextUrl.searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/trips";
  if (!r) return NextResponse.redirect(new URL("/signin?expired=1", req.url));
  const res = NextResponse.redirect(new URL(safeNext, req.url));
  res.cookies.set(SESSION_COOKIE, r.sessionToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
