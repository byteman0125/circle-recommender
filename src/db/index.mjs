// Thin DB layer. node:sqlite is built in (Node >= 22.5); swapping in better-sqlite3
// only means changing this file, since callers use prepare().all/get/run.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, "..", "..");
export const DEFAULT_DB_PATH = process.env.RECS_DB || join(ROOT, "recs.db");

export function openDb(path = DEFAULT_DB_PATH) {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(join(HERE, "schema.sql"), "utf8"));
  return db;
}
