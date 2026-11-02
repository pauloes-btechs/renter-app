import "server-only";
import { cookies } from "next/headers";
import { isDemoEnabled } from "./session";

export const DEMO_KEY_COOKIE = "rs_demo_key";

/** Demo tools are available only in dev, or when DEMO_MODE=true; optionally behind DEMO_ACCESS_KEY. */
export async function demoAllowed(queryKey?: string | null): Promise<"ok" | "disabled" | "locked"> {
  if (!isDemoEnabled()) return "disabled";
  const required = process.env.DEMO_ACCESS_KEY;
  if (!required) return "ok";
  const c = await cookies();
  if (queryKey === required || c.get(DEMO_KEY_COOKIE)?.value === required) return "ok";
  return "locked";
}
