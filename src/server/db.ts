import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { serverConfig } from "./config.js";
import { defaultProviders } from "./defaultProviders.js";
import type { AppSettings, GmailAccount, ImportantItem, ProviderRule, ScanJob } from "./types.js";

fs.mkdirSync(serverConfig.dataDir, { recursive: true });

const dbPath = path.join(serverConfig.dataDir, "app.sqlite");
export const db = new DatabaseSync(dbPath);

export const defaultImportantCategories = [
  "faktury i rachunki",
  "płatności",
  "księgowość",
  "bankowe",
  "konta i bezpieczeństwo",
  "oferty pracy",
  "licencje i subskrypcje",
  "maile od ważnych nadawców"
];

db.exec(`
PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  tokens_json TEXT NOT NULL,
  history_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_domain TEXT NOT NULL,
  sender_domains_json TEXT NOT NULL,
  sender_emails_json TEXT NOT NULL,
  search_terms_json TEXT NOT NULL,
  sender_only INTEGER NOT NULL DEFAULT 1,
  email_body_pdf INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS processed_attachments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  provider_domain TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  file_path TEXT NOT NULL,
  invoice_month TEXT NOT NULL,
  invoice_date TEXT,
  due_date TEXT,
  amount TEXT,
  currency TEXT,
  invoice_number TEXT,
  date_source TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, message_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS idx_processed_sha ON processed_attachments(sha256);
CREATE INDEX IF NOT EXISTS idx_processed_domain ON processed_attachments(provider_domain);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  progress_json TEXT NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS mail_cache (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  received_at TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, message_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS mail_cache_fts USING fts5(
  subject,
  from_email,
  text,
  content='mail_cache',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS mail_cache_ai AFTER INSERT ON mail_cache BEGIN
  INSERT INTO mail_cache_fts(rowid, subject, from_email, text)
  VALUES (new.rowid, new.subject, new.from_email, new.text);
END;

CREATE TRIGGER IF NOT EXISTS mail_cache_ad AFTER DELETE ON mail_cache BEGIN
  INSERT INTO mail_cache_fts(mail_cache_fts, rowid, subject, from_email, text)
  VALUES('delete', old.rowid, old.subject, old.from_email, old.text);
END;

CREATE TRIGGER IF NOT EXISTS mail_cache_au AFTER UPDATE ON mail_cache BEGIN
  INSERT INTO mail_cache_fts(mail_cache_fts, rowid, subject, from_email, text)
  VALUES('delete', old.rowid, old.subject, old.from_email, old.text);
  INSERT INTO mail_cache_fts(rowid, subject, from_email, text)
  VALUES (new.rowid, new.subject, new.from_email, new.text);
END;

CREATE TABLE IF NOT EXISTS important_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  from_email TEXT NOT NULL,
  from_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  received_at TEXT NOT NULL,
  priority TEXT NOT NULL,
  category TEXT NOT NULL,
  summary TEXT NOT NULL,
  action_required TEXT NOT NULL,
  due_date TEXT,
  amount TEXT,
  currency TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, message_id)
);
`);

ensureColumn("providers", "sender_only", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("providers", "email_body_pdf", "INTEGER NOT NULL DEFAULT 0");

function now() {
  return new Date().toISOString();
}

function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

function parseJsonListSetting(key: string, fallback: string[] = []) {
  try {
    const parsed = JSON.parse(getSetting(key) || "[]") as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const values = parsed.map(item => String(item).trim()).filter(Boolean);
    return values.length ? values : fallback;
  } catch {
    return fallback;
  }
}

function migrateImportantCategoriesSetting() {
  const current = parseJsonListSetting("importantCategories", defaultImportantCategories);
  const migrated: string[] = [];
  let changed = false;

  for (const category of current) {
    const normalized = category.toLowerCase();
    const replacements =
      normalized === "płatności i terminy płatności"
        ? ["płatności"]
        : normalized === "księgowość i podatki"
        ? ["księgowość"]
        : normalized === "bank i sprawy urzędowe"
        ? ["bankowe", "konta i bezpieczeństwo"]
        : [category];

    if (replacements.length !== 1 || replacements[0] !== category) changed = true;
    for (const replacement of replacements) {
      if (!migrated.includes(replacement)) migrated.push(replacement);
    }
  }

  for (const category of defaultImportantCategories) {
    if (!migrated.includes(category)) {
      migrated.push(category);
      changed = true;
    }
  }

  if (changed) {
    setSetting("importantCategories", JSON.stringify(migrated));
    clearImportantItems();
  }
}

function mergeDefaultProviderSenderEmails(providerId: string, emails: string[]) {
  const row = db.prepare("SELECT sender_emails_json FROM providers WHERE id = ?").get(providerId) as
    | { sender_emails_json: string }
    | undefined;
  if (!row) return;

  const current = JSON.parse(row.sender_emails_json) as string[];
  const merged = [...current];
  for (const email of emails) {
    if (!merged.some(item => item.toLowerCase() === email.toLowerCase())) merged.push(email);
  }

  if (merged.length !== current.length) {
    db.prepare("UPDATE providers SET sender_emails_json = ? WHERE id = ?").run(JSON.stringify(merged), providerId);
  }
}

function removeProviderSearchTerms(providerId: string, terms: string[]) {
  const row = db.prepare("SELECT search_terms_json FROM providers WHERE id = ?").get(providerId) as
    | { search_terms_json: string }
    | undefined;
  if (!row) return;

  const banned = new Set(terms.map(item => item.toLowerCase()));
  const current = JSON.parse(row.search_terms_json) as string[];
  const filtered = current.filter(item => !banned.has(item.toLowerCase()));
  if (filtered.length !== current.length) {
    db.prepare("UPDATE providers SET search_terms_json = ? WHERE id = ?").run(JSON.stringify(filtered), providerId);
  }
}

function insertDefaultProvider(provider: ProviderRule) {
  db.prepare(`
    INSERT INTO providers(id, name, target_domain, sender_domains_json, sender_emails_json, search_terms_json, sender_only, email_body_pdf, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    provider.id,
    provider.name,
    provider.targetDomain,
    JSON.stringify(provider.senderDomains),
    JSON.stringify(provider.senderEmails),
    JSON.stringify(provider.searchTerms),
    provider.senderOnly !== false ? 1 : 0,
    provider.emailBodyPdf ? 1 : 0,
    provider.enabled ? 1 : 0
  );
}

function ensureDefaultProviders(providerIds: string[]) {
  const existing = db.prepare("SELECT id FROM providers WHERE id = ?");
  for (const provider of defaultProviders.filter(item => providerIds.includes(item.id))) {
    if (existing.get(provider.id)) continue;
    insertDefaultProvider(provider);
  }
}

function deleteDeprecatedProviders(providerIds: string[]) {
  const statement = db.prepare("DELETE FROM providers WHERE id = ?");
  for (const id of providerIds) statement.run(id);
}

export function initDefaults() {
  const settings: AppSettings = {
    archiveDir: getSetting("archiveDir") || serverConfig.defaultArchiveDir,
    historyYears: Number(getSetting("historyYears") || 4),
    llmBaseUrl: getSetting("llmBaseUrl") || serverConfig.defaultLlmBaseUrl,
    llmApiKey: getSetting("llmApiKey") || serverConfig.defaultLlmApiKey,
    llmModel: getSetting("llmModel") || serverConfig.defaultLlmModel,
    classifierMode: normalizeClassifierMode(getSetting("classifierMode") || serverConfig.defaultClassifierMode),
    classifierBaseUrl: getSetting("classifierBaseUrl") || serverConfig.defaultClassifierBaseUrl,
    classifierApiKey: getSetting("classifierApiKey") || serverConfig.defaultClassifierApiKey,
    classifierModel: getSetting("classifierModel") || serverConfig.defaultClassifierModel,
    classifierTimeoutMs: normalizeClassifierTimeout(getSetting("classifierTimeoutMs")),
    importantSenders: parseJsonListSetting("importantSenders"),
    importantCategories: parseJsonListSetting("importantCategories", defaultImportantCategories)
  };

  for (const [key, value] of Object.entries(settings)) {
    setSetting(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  migrateImportantCategoriesSetting();

  const existing = db.prepare("SELECT COUNT(*) AS count FROM providers").get() as { count: number };
  if (existing.count === 0) {
    for (const provider of defaultProviders) {
      insertDefaultProvider(provider);
    }
  }
  deleteDeprecatedProviders(["canva"]);
  ensureDefaultProviders(["capcut", "krea", "midjourney"]);
  removeProviderSearchTerms("capcut", ["Apple"]);
  mergeDefaultProviderSenderEmails("elevenlabs", ["team@elevenlabs.io"]);
  mergeDefaultProviderSenderEmails("udio", ["support@udio.com"]);
}

export function getAppSettings(): AppSettings {
  return {
    archiveDir: getSetting("archiveDir") || "",
    historyYears: Number(getSetting("historyYears") || 4),
    llmBaseUrl: getSetting("llmBaseUrl") || serverConfig.defaultLlmBaseUrl,
    llmApiKey: getSetting("llmApiKey") || "",
    llmModel: getSetting("llmModel") || serverConfig.defaultLlmModel,
    classifierMode: normalizeClassifierMode(getSetting("classifierMode") || serverConfig.defaultClassifierMode),
    classifierBaseUrl: getSetting("classifierBaseUrl") || serverConfig.defaultClassifierBaseUrl,
    classifierApiKey: getSetting("classifierApiKey") || "",
    classifierModel: getSetting("classifierModel") || serverConfig.defaultClassifierModel,
    classifierTimeoutMs: normalizeClassifierTimeout(getSetting("classifierTimeoutMs")),
    importantSenders: parseJsonListSetting("importantSenders"),
    importantCategories: parseJsonListSetting("importantCategories", defaultImportantCategories)
  };
}

export function updateAppSettings(input: Partial<AppSettings>) {
  if (input.archiveDir !== undefined) setSetting("archiveDir", input.archiveDir);
  if (input.historyYears !== undefined) setSetting("historyYears", String(input.historyYears));
  if (input.llmBaseUrl !== undefined) setSetting("llmBaseUrl", input.llmBaseUrl);
  if (input.llmApiKey !== undefined) setSetting("llmApiKey", input.llmApiKey);
  if (input.llmModel !== undefined) setSetting("llmModel", input.llmModel);
  if (input.classifierMode !== undefined) {
    const mode = normalizeClassifierMode(input.classifierMode);
    if (normalizeClassifierMode(getSetting("classifierMode") || serverConfig.defaultClassifierMode) !== mode) {
      clearImportantItems();
    }
    setSetting("classifierMode", mode);
  }
  if (input.classifierBaseUrl !== undefined) {
    if ((getSetting("classifierBaseUrl") || serverConfig.defaultClassifierBaseUrl) !== input.classifierBaseUrl) {
      clearImportantItems();
    }
    setSetting("classifierBaseUrl", input.classifierBaseUrl);
  }
  if (input.classifierApiKey !== undefined) setSetting("classifierApiKey", input.classifierApiKey);
  if (input.classifierModel !== undefined) {
    if ((getSetting("classifierModel") || serverConfig.defaultClassifierModel) !== input.classifierModel) {
      clearImportantItems();
    }
    setSetting("classifierModel", input.classifierModel);
  }
  if (input.classifierTimeoutMs !== undefined) {
    setSetting("classifierTimeoutMs", String(normalizeClassifierTimeout(input.classifierTimeoutMs)));
  }
  if (input.importantSenders !== undefined) {
    const current = parseJsonListSetting("importantSenders");
    if (!sameList(current, input.importantSenders)) clearImportantItems();
    setSetting("importantSenders", JSON.stringify(input.importantSenders));
  }
  if (input.importantCategories !== undefined) {
    const categories = input.importantCategories.length ? input.importantCategories : defaultImportantCategories;
    const current = parseJsonListSetting("importantCategories", defaultImportantCategories);
    if (!sameList(current, categories)) clearImportantItems();
    setSetting("importantCategories", JSON.stringify(categories));
  }
  return getAppSettings();
}

function sameList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function clearImportantItems() {
  db.prepare("DELETE FROM important_items").run();
}

function normalizeClassifierMode(value: unknown): AppSettings["classifierMode"] {
  const mode = String(value || "").trim();
  if (mode === "rules" || mode === "local-llm") return mode;
  return "hybrid";
}

function normalizeClassifierTimeout(value: unknown) {
  const timeout = Number(value || serverConfig.defaultClassifierTimeoutMs);
  if (!Number.isFinite(timeout)) return serverConfig.defaultClassifierTimeoutMs;
  return Math.max(500, Math.min(15000, Math.round(timeout)));
}

export function listAccounts(): GmailAccount[] {
  return db.prepare("SELECT * FROM gmail_accounts ORDER BY email").all().map(mapAccount);
}

export function upsertAccount(input: { id: string; email: string; tokensJson: string; historyId?: string | null }) {
  db.prepare(`
    INSERT INTO gmail_accounts(id, email, tokens_json, history_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      tokens_json = excluded.tokens_json,
      history_id = COALESCE(excluded.history_id, gmail_accounts.history_id),
      updated_at = excluded.updated_at
  `).run(input.id, input.email, input.tokensJson, input.historyId || null, now(), now());
}

export function getAccount(id: string): GmailAccount | null {
  const row = db.prepare("SELECT * FROM gmail_accounts WHERE id = ?").get(id);
  return row ? mapAccount(row as Record<string, unknown>) : null;
}

export function updateAccountTokens(id: string, tokensJson: string) {
  db.prepare("UPDATE gmail_accounts SET tokens_json = ?, updated_at = ? WHERE id = ?").run(tokensJson, now(), id);
}

export function deleteAccount(id: string) {
  db.prepare("DELETE FROM important_items WHERE account_id = ?").run(id);
  db.prepare("DELETE FROM mail_cache WHERE account_id = ?").run(id);
  db.prepare("DELETE FROM gmail_accounts WHERE id = ?").run(id);
}

export function listProviders(): ProviderRule[] {
  return db.prepare("SELECT * FROM providers ORDER BY name").all().map(mapProvider);
}

export function upsertProvider(provider: ProviderRule) {
  db.prepare(`
    INSERT INTO providers(id, name, target_domain, sender_domains_json, sender_emails_json, search_terms_json, sender_only, email_body_pdf, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      target_domain = excluded.target_domain,
      sender_domains_json = excluded.sender_domains_json,
      sender_emails_json = excluded.sender_emails_json,
      search_terms_json = excluded.search_terms_json,
      sender_only = excluded.sender_only,
      email_body_pdf = excluded.email_body_pdf,
      enabled = excluded.enabled
  `).run(
    provider.id,
    provider.name,
    provider.targetDomain,
    JSON.stringify(provider.senderDomains),
    JSON.stringify(provider.senderEmails),
    JSON.stringify(provider.searchTerms),
    provider.senderOnly !== false ? 1 : 0,
    provider.emailBodyPdf ? 1 : 0,
    provider.enabled ? 1 : 0
  );
}

export function createJob(type: string): ScanJob {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO scan_jobs(id, type, status, progress_json) VALUES (?, ?, 'queued', ?)"
  ).run(id, type, JSON.stringify({ message: "W kolejce" }));
  return getJob(id)!;
}

export function getJob(id: string): ScanJob | null {
  const row = db.prepare("SELECT * FROM scan_jobs WHERE id = ?").get(id);
  return row ? mapJob(row as Record<string, unknown>) : null;
}

export function updateJob(id: string, patch: Partial<ScanJob> & { progress?: unknown }) {
  const current = getJob(id);
  if (!current) return;
  const status = patch.status ?? current.status;
  const startedAt = patch.startedAt ?? current.startedAt;
  const finishedAt = patch.finishedAt ?? current.finishedAt;
  const progressJson =
    patch.progress !== undefined ? JSON.stringify(patch.progress) : patch.progressJson ?? current.progressJson;
  const error = patch.error === undefined ? current.error : patch.error;
  db.prepare(
    "UPDATE scan_jobs SET status = ?, started_at = ?, finished_at = ?, progress_json = ?, error = ? WHERE id = ?"
  ).run(status, startedAt, finishedAt, progressJson, error, id);
}

export function listInvoices() {
  return db
    .prepare("SELECT * FROM processed_attachments ORDER BY created_at DESC LIMIT 500")
    .all();
}

export function cleanupInvoiceIndex(options: { removeMissingFiles?: boolean; removeDuplicateRows?: boolean }) {
  const result = {
    checkedSavedFiles: 0,
    removedMissingFileRows: 0,
    removedDuplicateRows: 0
  };

  if (options.removeMissingFiles !== false) {
    const rows = db
      .prepare("SELECT id, file_path FROM processed_attachments WHERE status = 'saved'")
      .all() as { id: string; file_path: string }[];
    const deleteRow = db.prepare("DELETE FROM processed_attachments WHERE id = ?");

    for (const row of rows) {
      result.checkedSavedFiles += 1;
      if (fs.existsSync(row.file_path)) continue;
      deleteRow.run(row.id);
      result.removedMissingFileRows += 1;
    }
  }

  if (options.removeDuplicateRows !== false) {
    const deleted = db.prepare("DELETE FROM processed_attachments WHERE status = 'duplicate'").run() as {
      changes: number;
    };
    result.removedDuplicateRows = deleted.changes;
  }

  return result;
}

export function listImportantItems(): ImportantItem[] {
  return db
    .prepare("SELECT * FROM important_items ORDER BY received_at DESC LIMIT 100")
    .all()
    .map(mapImportantItem);
}

export function getImportantItem(id: string): ImportantItem | null {
  const row = db.prepare("SELECT * FROM important_items WHERE id = ?").get(id);
  return row ? mapImportantItem(row as Record<string, unknown>) : null;
}

export function getImportantItemDetail(id: string) {
  return db
    .prepare(
      `SELECT
        important_items.*,
        mail_cache.text AS mail_text
      FROM important_items
      LEFT JOIN mail_cache
        ON mail_cache.account_id = important_items.account_id
       AND mail_cache.message_id = important_items.message_id
      WHERE important_items.id = ?`
    )
    .get(id) as (Record<string, unknown> & { mail_text?: string }) | undefined;
}

export function deleteImportantItem(id: string) {
  db.prepare("DELETE FROM important_items WHERE id = ?").run(id);
}

function mapAccount(row: Record<string, unknown>): GmailAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    tokensJson: String(row.tokens_json),
    historyId: row.history_id ? String(row.history_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapProvider(row: Record<string, unknown>): ProviderRule {
  return {
    id: String(row.id),
    name: String(row.name),
    targetDomain: String(row.target_domain),
    senderDomains: JSON.parse(String(row.sender_domains_json)) as string[],
    senderEmails: JSON.parse(String(row.sender_emails_json)) as string[],
    searchTerms: JSON.parse(String(row.search_terms_json)) as string[],
    senderOnly: row.sender_only === undefined ? true : Boolean(row.sender_only),
    emailBodyPdf: row.email_body_pdf === undefined ? false : Boolean(row.email_body_pdf),
    enabled: Boolean(row.enabled)
  };
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some(item => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function mapJob(row: Record<string, unknown>): ScanJob {
  return {
    id: String(row.id),
    type: String(row.type),
    status: row.status as ScanJob["status"],
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    progressJson: String(row.progress_json),
    error: row.error ? String(row.error) : null
  };
}

function mapImportantItem(row: Record<string, unknown>): ImportantItem {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    messageId: String(row.message_id),
    threadId: String(row.thread_id),
    fromEmail: String(row.from_email),
    fromName: String(row.from_name),
    subject: String(row.subject),
    snippet: String(row.snippet),
    receivedAt: String(row.received_at),
    priority: row.priority as ImportantItem["priority"],
    category: String(row.category),
    summary: String(row.summary),
    actionRequired: String(row.action_required),
    dueDate: row.due_date ? String(row.due_date) : null,
    amount: row.amount ? String(row.amount) : null,
    currency: row.currency ? String(row.currency) : null,
    rawJson: String(row.raw_json),
    createdAt: String(row.created_at)
  };
}
