import dns from "node:dns/promises";
import net from "node:net";

/**
 * Fetch a listing page the organizer pasted — only where that's permitted.
 *
 *  - Platforms whose terms prohibit automated access (Airbnb, Vrbo, Booking.com, …) are never fetched;
 *    the organizer pastes the page text and photos instead.
 *  - Every other site is fetched only if its robots.txt allows our user agent for that path.
 *  - SSRF protection: http(s) only, standard ports, public IPs only (checked on every redirect),
 *    timeouts and size caps.
 */

export const USER_AGENT = "RoomsplitListingImport/1.0 (+link preview for a rental-sharing group)";

const PROHIBITED: { re: RegExp; name: string }[] = [
  { re: /(^|\.)airbnb\.[a-z.]+$/i, name: "Airbnb" },
  { re: /(^|\.)(vrbo|homeaway|abritel|fewo-direkt|stayz|bookabach)\.[a-z.]+$/i, name: "Vrbo" },
  { re: /(^|\.)booking\.com$/i, name: "Booking.com" },
  { re: /(^|\.)expedia\.[a-z.]+$/i, name: "Expedia" },
  { re: /(^|\.)hotels\.com$/i, name: "Hotels.com" },
  { re: /(^|\.)tripadvisor\.[a-z.]+$/i, name: "Tripadvisor" },
  { re: /(^|\.)plumguide\.com$/i, name: "Plum Guide" },
];

export function prohibitedPlatform(url: string): string | null {
  try {
    const h = new URL(url).hostname;
    return PROHIBITED.find((p) => p.re.test(h))?.name ?? null;
  } catch {
    return null;
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

export interface FetchDeps {
  fetch: typeof fetch;
  lookup: (host: string) => Promise<string[]>;
}
const defaultDeps: FetchDeps = {
  fetch,
  lookup: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
};

export class FetchBlocked extends Error {}

async function assertPublic(u: URL, deps: FetchDeps) {
  if (!/^https?:$/.test(u.protocol)) throw new FetchBlocked("Only http(s) links are supported.");
  if (u.port && !["80", "443"].includes(u.port)) throw new FetchBlocked("Only standard web ports are allowed.");
  if (u.username || u.password) throw new FetchBlocked("Links with credentials aren't allowed.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [host] : await deps.lookup(host).catch(() => []);
  if (addrs.length === 0) throw new FetchBlocked("That site couldn't be found.");
  if (addrs.some(isPrivateAddress)) throw new FetchBlocked("That address isn't publicly reachable.");
}

/** GET with manual redirects (re-validated each hop), timeout and byte cap. */
export async function safeGet(
  url: string,
  opts: { maxBytes: number; accept: string; timeoutMs?: number },
  deps: FetchDeps = defaultDeps,
): Promise<{ status: number; contentType: string; body: Buffer; finalUrl: string }> {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current, deps);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 8000);
    try {
      const res = await deps.fetch(current.toString(), {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": USER_AGENT, accept: opts.accept },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current);
        continue;
      }
      const len = Number(res.headers.get("content-length") || 0);
      if (len > opts.maxBytes) throw new FetchBlocked("The page is too large to import.");
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) {
            await reader.cancel();
            throw new FetchBlocked("The page is too large to import.");
          }
          chunks.push(value);
        }
      }
      return { status: res.status, contentType: res.headers.get("content-type") || "", body: Buffer.concat(chunks), finalUrl: current.toString() };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new FetchBlocked("Too many redirects.");
}

/** Minimal robots.txt evaluation (User-agent groups for our agent or *, longest-match Allow/Disallow). */
export function robotsAllows(robotsTxt: string, path: string, agent = "RoomsplitListingImport"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (val || key === "allow") cur.rules.push({ allow: key === "allow", path: val });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => agent.toLowerCase().includes(a) && a !== "*"));
  const applicable = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of applicable)
    for (const r of g.rules) {
      if (!r.path) continue;
      const pattern = new RegExp("^" + r.path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
      if (pattern.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) best = { allow: r.allow, len: r.path.length };
    }
  return best ? best.allow : true;
}

export interface ExtractedListing {
  title: string;
  description: string;
  text: string;
  imageUrls: string[];
  structured: Record<string, unknown>[];
}

const decode = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export function extractListing(html: string, baseUrl: string): ExtractedListing {
  const meta = (prop: string) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "gi");
    return [...html.matchAll(re)].map((m) => /content=["']([^"']*)["']/i.exec(m[0])?.[1]).filter(Boolean).map((v) => decode(v!));
  };
  const structured: Record<string, unknown>[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1].trim());
      const items = Array.isArray(j) ? j : j["@graph"] ? j["@graph"] : [j];
      for (const it of items) if (it && typeof it === "object") structured.push(it);
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  const title = meta("og:title")[0] || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "");
  const description = meta("og:description")[0] || meta("description")[0] || "";
  const abs = (u: string) => {
    try {
      return new URL(u, baseUrl).toString();
    } catch {
      return null;
    }
  };
  const imgs = new Set<string>();
  meta("og:image").forEach((u) => abs(u) && imgs.add(abs(u)!));
  for (const s of structured) {
    const im = (s as { image?: unknown }).image;
    const list = Array.isArray(im) ? im : im ? [im] : [];
    for (const x of list) {
      const u = typeof x === "string" ? x : (x as { url?: string })?.url;
      if (u && abs(u)) imgs.add(abs(u)!);
    }
  }
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+\.(?:jpe?g|png|webp)(?:\?[^"']*)?)["']/gi)) {
    const u = abs(decode(m[1]));
    if (u && !/logo|icon|avatar|sprite/i.test(u)) imgs.add(u);
    if (imgs.size >= 24) break;
  }
  const text = decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 15000);
  return { title, description, text, imageUrls: [...imgs].slice(0, 16), structured };
}

export type FetchedListing =
  | { ok: true; title: string; text: string; photos: { dataUrl: string }[]; finalUrl: string }
  | { ok: false; reason: "prohibited" | "robots" | "error"; platform?: string; message: string };

/** Fetch a permitted listing page and its photos (resized to ≤1024px JPEG). */
export async function fetchListing(url: string, deps: FetchDeps = defaultDeps, resize: (b: Buffer) => Promise<Buffer | null> = resizeImage): Promise<FetchedListing> {
  const platform = prohibitedPlatform(url);
  if (platform)
    return {
      ok: false,
      reason: "prohibited",
      platform,
      message: `${platform} doesn't allow automated reading of its listing pages, so paste the page text and add the photos below.`,
    };
  try {
    const u = new URL(url);
    const robots = await safeGet(new URL("/robots.txt", u).toString(), { maxBytes: 500_000, accept: "text/plain" }, deps).catch(() => null);
    if (robots && robots.status >= 500) return { ok: false, reason: "robots", message: "This site isn't accepting automated requests right now. Paste the page text instead." };
    if (robots && robots.status < 300 && !robotsAllows(robots.body.toString("utf8"), u.pathname + u.search))
      return { ok: false, reason: "robots", message: "This site's robots.txt doesn't allow automated reading of that page. Paste the page text and add photos instead." };
    const page = await safeGet(url, { maxBytes: 4_000_000, accept: "text/html,application/xhtml+xml" }, deps);
    if (page.status >= 400) return { ok: false, reason: "error", message: `The page returned an error (${page.status}). Paste the page text instead.` };
    if (!/html/i.test(page.contentType)) return { ok: false, reason: "error", message: "That link isn't a web page." };
    const ex = extractListing(page.body.toString("utf8"), page.finalUrl);
    const structuredText = ex.structured.length ? `\n\nStructured listing data (JSON-LD):\n${JSON.stringify(ex.structured).slice(0, 6000)}` : "";
    const photos: { dataUrl: string }[] = [];
    for (const img of ex.imageUrls) {
      if (photos.length >= 12) break;
      const r = await safeGet(img, { maxBytes: 8_000_000, accept: "image/*", timeoutMs: 6000 }, deps).catch(() => null);
      if (!r || r.status >= 400 || !/^image\//.test(r.contentType)) continue;
      const small = await resize(r.body).catch(() => null);
      if (small) photos.push({ dataUrl: `data:image/jpeg;base64,${small.toString("base64")}` });
    }
    return { ok: true, title: ex.title, text: `${ex.title}\n${ex.description}\n\n${ex.text}${structuredText}`, photos, finalUrl: page.finalUrl };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof FetchBlocked ? e.message : "We couldn't load that page. Paste the page text instead." };
  }
}

export async function resizeImage(buf: Buffer, maxSide = 1024): Promise<Buffer | null> {
  const sharp = (await import("sharp")).default;
  const img = sharp(buf, { failOn: "none" });
  const meta = await img.metadata();
  if (!meta.width || !meta.height || meta.width < 200 || meta.height < 150) return null; // skip icons / tracking pixels
  return img.rotate().resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
}
