import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userFromSession } from "./services/auth";

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

export async function setSessionCookie(token: string) {
  const c = await cookies();
  c.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
}
