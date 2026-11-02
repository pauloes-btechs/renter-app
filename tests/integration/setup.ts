import os from "node:os";
import path from "node:path";
import fs from "node:fs";
export function useTempDb(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roomsplit-"));
  process.env.DATABASE_PATH = path.join(dir, `${name}.db`);
  process.env.APP_SECRET = "test-secret";
}
