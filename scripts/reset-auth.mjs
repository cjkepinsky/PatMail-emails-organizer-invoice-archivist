import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dbPath = path.resolve(process.env.DATA_DIR || ".local", "app.sqlite");

if (!fs.existsSync(dbPath)) {
  console.log("No local database found. Nothing to reset.");
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
db.exec(`
  DELETE FROM important_items;
  DELETE FROM mail_cache;
  DELETE FROM gmail_accounts;
`);
db.close();

console.log("Local Gmail OAuth tokens were removed. Connect Gmail again in the app.");
