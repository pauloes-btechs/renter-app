import type Database from "better-sqlite3";
import { getDb, tx } from "../../db/client";
import { hashToken, newId, randomToken } from "../crypto";
import { invalid } from "../errors";
import type { UserRow } from "../repo";

type DB = Database.Database;
const DAY = 86_400_000;

export function createUser(d: DB, displayName: string, opts: { email?: string; isDemo?: boolean } = {}): string {
  const name = displayName.trim();
  if (name.length < 1 || name.length > 40) throw invalid("Display name must be 1–40 characters.");
  const id = newId("usr");
  d.prepare("INSERT INTO users (id, display_name, email, is_demo) VALUES (?, ?, ?, ?)").run(id, name, opts.email ?? null, opts.isDemo ? 1 : 0);
  return id;
}

export function createSession(d: DB, userId: string, days = 30): string {
  const token = randomToken(32);
  d.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").run(
    newId("ses"),
    userId,
    hashToken(token),
    new Date(Date.now() + days * DAY).toISOString(),
  );
  return token;
}

export function userFromSession(token: string | undefined | null): UserRow | null {
  if (!token) return null;
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(hashToken(token), new Date().toISOString()) as UserRow | undefined;
  return row ?? null;
}

export function revokeSession(token: string) {
  getDb().prepare("UPDATE sessions SET revoked_at = ? WHERE token_hash = ?").run(new Date().toISOString(), hashToken(token));
}

/** Personal sign-in link. Rotating revokes previous links for the user. */
export function createAccessLink(userId: string, opts: { rotate?: boolean; days?: number } = {}): string {
  return tx((d) => {
    if (opts.rotate) d.prepare("UPDATE access_links SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").run(new Date().toISOString(), userId);
    const token = randomToken(24);
    d.prepare("INSERT INTO access_links (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)").run(
      newId("acl"),
      userId,
      hashToken(token),
      new Date(Date.now() + (opts.days ?? 30) * DAY).toISOString(),
    );
    return token;
  });
}

export function redeemAccessLink(token: string): { userId: string; sessionToken: string } | null {
  return tx((d) => {
    const row = d
      .prepare("SELECT user_id FROM access_links WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?")
      .get(hashToken(token), new Date().toISOString()) as { user_id: string } | undefined;
    if (!row) return null;
    return { userId: row.user_id, sessionToken: createSession(d, row.user_id) };
  });
}
