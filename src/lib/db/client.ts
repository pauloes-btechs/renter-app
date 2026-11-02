import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";

type DB = Database.Database;
const g = globalThis as unknown as { __roomsplitDb?: { path: string; db: DB } };

export function dbPath(): string {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  // Serverless hosts (Vercel) have a read-only project dir; only /tmp is writable and it is ephemeral.
  if (process.env.VERCEL) return "/tmp/roomsplit.db";
  return path.join(process.cwd(), "data", "roomsplit.db");
}

export function getDb(): DB {
  const p = dbPath();
  if (g.__roomsplitDb && g.__roomsplitDb.path === p) return g.__roomsplitDb.db;
  if (g.__roomsplitDb) g.__roomsplitDb.db.close();
  if (p !== ":memory:") fs.mkdirSync(path.dirname(p), { recursive: true });
  const db = new Database(p);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  g.__roomsplitDb = { path: p, db };
  return db;
}

function migrate(db: DB) {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    }).immediate();
  }
}

/** Run fn inside a BEGIN IMMEDIATE transaction (serializes concurrent writers). */
export function tx<T>(fn: (db: DB) => T): T {
  const db = getDb();
  return db.transaction(() => fn(db)).immediate();
}

export function closeDb() {
  if (g.__roomsplitDb) {
    g.__roomsplitDb.db.close();
    g.__roomsplitDb = undefined;
  }
}

export function nowIso() {
  return new Date().toISOString();
}
