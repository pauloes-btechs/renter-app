import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revokeSession, userFromSession } from "./services/auth";

export const SESSION_COOKIE = "rs_session";

export function isDemoEnabled() {
  if (process.env.DEMO_MODE === "false") return false;
  return process.env.DEMO_MODE === "true" || process.env.NODE_ENV !== "production";
}

export async function getViewer() {
  const c = await cookies();
  return userFromSession(c.get(SESSION_COOKIE)?.value);
}

export async function requireViewer(next?: string) {
  const v = await getViewer();
  if (!v) redirect(`/signin${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return v;
}

export function sessionCookieOptions(maxAge = 60 * 60 * 24 * 30) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge };
}

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(SESSION_COOKIE, token, sessionCookieOptions());
}

/** Signs out: revokes the session server-side (a copied cookie stops working) and drops the cookie. */
export async function clearSessionCookie() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) revokeSession(token);
  c.delete(SESSION_COOKIE);
}
