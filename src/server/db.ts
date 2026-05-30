import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { serverConfig } from "./config.js";
import { defaultProviders } from "./defaultProviders.js";
import type {
  AppSettings,
  CategoryRule,
  ChatTurn,
  GmailAccount,
  ImapAccountConfig,
  ImportantItem,
  MailOperation,
  ProviderRule,
  ReadOperationSnapshot,
  ScanJob,
  UiState
} from "./types.js";

fs.mkdirSync(serverConfig.dataDir, { recursive: true });

const dbPath = path.join(serverConfig.dataDir, "app.sqlite");
export const db = new DatabaseSync(dbPath);

export const defaultImportantCategories = [
  "faktury i rachunki",
  "płatności",
  "księgowość",
  "bankowe",
  "konta i bezpieczeństwo",
  "software",
  "zdrowie",
  "zadania",
  "ai",
  "vr",
  "rd",
  "zamówienia",
  "oferty pracy",
  "licencje i subskrypcje",
  "maile od ważnych nadawców"
];

const defaultCategoryRules: CategoryRule[] = [
  {
    id: "payments",
    category: "płatności",
    priority: "high",
    actionRequired: "Sprawdź płatność albo transakcję.",
    senderTerms: ["service@paypal.pl", "d@citi.com"],
    keywordTerms: ["paypal", "citi", "przelewy24", "payu", "autopay", "p24-", "payment confirmation", "status swojej płatności"]
  },
  {
    id: "orders",
    category: "zamówienia",
    priority: "high",
    actionRequired: "Sprawdź status zamówienia.",
    senderTerms: ["powiadomienia@allegro.pl", "powiadomienia@allegromail.pl"],
    keywordTerms: ["allegro", "status zamówienia", "twoje zamówienie", "zamówienie nr"]
  },
  {
    id: "banking",
    category: "bankowe",
    priority: "high",
    actionRequired: "Sprawdź komunikat bankowy.",
    senderTerms: ["kontakt@bik.pl", "kontakt@mbank.pl"],
    keywordTerms: ["mbank", "santander", "alior bank", "bank pekao", "pekao24", "ing bank", "millennium bank", "nest bank", "velobank", "pko bank"]
  },
  {
    id: "software",
    category: "software",
    priority: "medium",
    actionRequired: "",
    senderTerms: ["hello@news.setapp.com"],
    keywordTerms: ["setapp"]
  },
  {
    id: "ai",
    category: "ai",
    priority: "medium",
    actionRequired: "",
    senderTerms: [
      "noreply@email.openai.com",
      "whatsupinai@mail.beehiiv.com",
      "newsletter@haicsummit.com",
      "altiamkabir@creators.gumroad.com",
      "hello@ollama.com",
      "no-reply@kaggle.com",
      "the-superpower@mail.beehiiv.com",
      "astro@forwardfuture.ai",
      "andy@aiandy.ai",
      "alerts@theresanaiforthat.com"
    ],
    keywordTerms: ["openai", "ollama", "kaggle", "forwardfuture", "theresanaiforthat", "superpower", "haicsummit", "whatsupinai"]
  },
  {
    id: "vr",
    category: "vr",
    priority: "medium",
    actionRequired: "",
    senderTerms: ["uploadvr@buttondown.email"],
    keywordTerms: ["uploadvr", "buttondown"]
  },
  {
    id: "tasks",
    category: "zadania",
    priority: "high",
    actionRequired: "Sprawdź, czy wymaga działania.",
    senderTerms: ["noreply@tm.openai.com"],
    keywordTerms: ["task", "todo", "reminder", "przypomnienie o zadaniu", "twoje zadanie"]
  },
  {
    id: "rd",
    category: "rd",
    priority: "medium",
    actionRequired: "",
    senderTerms: ["newsletter@the3doors.org", "no-reply@monroeinstitute.org", "stoicmanual@substack.com", "mindfulmondays@substack.com"],
    keywordTerms: ["ligmincha", "the stoic manual", "mindful mondays", "the3doors", "monroeinstitute"]
  },
  {
    id: "health",
    category: "zdrowie",
    priority: "medium",
    actionRequired: "",
    senderTerms: ["kontakt@drbartek.pl"],
    keywordTerms: ["zdrowie", "health", "wizyta", "badanie", "lekarz", "doctor", "drbartek"]
  },
  {
    id: "invoices",
    category: "faktury i rachunki",
    priority: "high",
    actionRequired: "Sprawdź termin płatności lub archiwum faktur.",
    senderTerms: [],
    keywordTerms: ["invoice", "faktura", "rachunek", "receipt", "payment due", "termin płatności", "t-mobile", "twoja faktura z firmy apple"]
  },
  {
    id: "accounting",
    category: "księgowość",
    priority: "high",
    actionRequired: "Sprawdź, czy wymaga odpowiedzi lub płatności.",
    senderTerms: ["dominika.bonk@infakt.com"],
    keywordTerms: ["infakt", "księg", "ksieg", "accountant", "składk", "skladk", "zus", "podatek", "tax"]
  },
  {
    id: "subscriptions",
    category: "licencje i subskrypcje",
    priority: "medium",
    actionRequired: "",
    senderTerms: [],
    keywordTerms: ["license", "licencja", "subscription", "subskrypcja", "renewal", "odnowienie", "commercial", "plan renewed"]
  },
  {
    id: "jobs",
    category: "oferty pracy",
    priority: "medium",
    actionRequired: "",
    senderTerms: ["linkedin_jobs-noreply@linkedin.com"],
    keywordTerms: ["oferta pracy", "job offer", "jobs similar", "new jobs similar", "recruiter", "rekrut", "hiring", "career", "interview", "linkedin", "jooble", "nofluffjobs", "solid.jobs", "justjoin.it"]
  },
  {
    id: "accounts-security",
    category: "konta i bezpieczeństwo",
    priority: "high",
    actionRequired: "Sprawdź, czy to znana aktywność.",
    senderTerms: [],
    keywordTerms: ["alert bezpieczeństwa", "security alert", "password reset", "wyzerowano hasło", "konto google", "konto apple", "apple id", "gdpr", "privacy", "confirm your account"]
  }
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

CREATE TABLE IF NOT EXISTS chat_history (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_history_created_at ON chat_history(created_at);

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

CREATE TABLE IF NOT EXISTS saved_mail_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(account_id, message_id)
);

CREATE TABLE IF NOT EXISTS ignored_mail_items (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS mail_operations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  item_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  undone_at TEXT,
  error TEXT
);
`);

ensureColumn("providers", "sender_only", "INTEGER NOT NULL DEFAULT 1");
ensureColumn("providers", "email_body_pdf", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("gmail_accounts", "auth_type", "TEXT NOT NULL DEFAULT 'gmail_oauth'");
ensureColumn("gmail_accounts", "imap_config_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("mail_cache", "is_unread", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("mail_cache", "html", "TEXT NOT NULL DEFAULT ''");
ensureColumn("saved_mail_items", "thread_id", "TEXT");
ensureColumn("saved_mail_items", "from_email", "TEXT");
ensureColumn("saved_mail_items", "from_name", "TEXT");
ensureColumn("saved_mail_items", "subject", "TEXT");
ensureColumn("saved_mail_items", "snippet", "TEXT");
ensureColumn("saved_mail_items", "received_at", "TEXT");
ensureColumn("saved_mail_items", "text", "TEXT");
ensureColumn("saved_mail_items", "html", "TEXT");
ensureColumn("saved_mail_items", "priority", "TEXT");
ensureColumn("saved_mail_items", "category", "TEXT");
ensureColumn("saved_mail_items", "summary", "TEXT");
ensureColumn("saved_mail_items", "action_required", "TEXT");
ensureColumn("saved_mail_items", "due_date", "TEXT");
ensureColumn("saved_mail_items", "amount", "TEXT");
ensureColumn("saved_mail_items", "currency", "TEXT");
backfillSavedMailSnapshots();

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

function parseSenderCategoryRulesSetting() {
  try {
    const parsed = JSON.parse(getSetting("senderCategoryRules") || "[]") as unknown;
    if (!Array.isArray(parsed)) return [] as Array<{ sender: string; category: string }>;
    return parsed
      .map(item => {
        const row = item as Record<string, unknown>;
        return {
          sender: String(row.sender || "").trim(),
          category: String(row.category || "").trim()
        };
      })
      .filter(item => item.sender && item.category);
  } catch {
    return [] as Array<{ sender: string; category: string }>;
  }
}

function parseCategoryRulesSetting() {
  try {
    const raw = getSetting("categoryRules");
    if (raw === null) return defaultCategoryRules;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultCategoryRules;
    const rules = parsed
      .map(item => {
        const row = item as Record<string, unknown>;
        return {
          id: String(row.id || "").trim() || randomUUID(),
          category: String(row.category || "").trim(),
          priority: String(row.priority || "medium").trim() === "high" ? "high" : "medium",
          actionRequired: String(row.actionRequired || "").trim(),
          senderTerms: Array.isArray(row.senderTerms) ? row.senderTerms.map(term => String(term).trim()).filter(Boolean) : [],
          keywordTerms: Array.isArray(row.keywordTerms) ? row.keywordTerms.map(term => String(term).trim()).filter(Boolean) : []
        } satisfies CategoryRule;
      })
      .filter(rule => rule.category && (rule.senderTerms.length > 0 || rule.keywordTerms.length > 0));
    return rules;
  } catch {
    return defaultCategoryRules;
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

function mergeDefaultProviderSenderDomains(providerId: string, domains: string[]) {
  const row = db.prepare("SELECT sender_domains_json FROM providers WHERE id = ?").get(providerId) as
    | { sender_domains_json: string }
    | undefined;
  if (!row) return;

  const current = JSON.parse(row.sender_domains_json) as string[];
  const merged = [...current];
  for (const domain of domains) {
    if (!merged.some(item => item.toLowerCase() === domain.toLowerCase())) merged.push(domain);
  }

  if (merged.length !== current.length) {
    db.prepare("UPDATE providers SET sender_domains_json = ? WHERE id = ?").run(JSON.stringify(merged), providerId);
  }
}

function mergeDefaultProviderSearchTerms(providerId: string, terms: string[]) {
  const row = db.prepare("SELECT search_terms_json FROM providers WHERE id = ?").get(providerId) as
    | { search_terms_json: string }
    | undefined;
  if (!row) return;

  const current = JSON.parse(row.search_terms_json) as string[];
  const merged = [...current];
  for (const term of terms) {
    if (!merged.some(item => item.toLowerCase() === term.toLowerCase())) merged.push(term);
  }

  if (merged.length !== current.length) {
    db.prepare("UPDATE providers SET search_terms_json = ? WHERE id = ?").run(JSON.stringify(merged), providerId);
  }
}

function ensureProviderEmailBodyPdf(providerId: string, enabled: boolean) {
  db.prepare("UPDATE providers SET email_body_pdf = ? WHERE id = ?").run(enabled ? 1 : 0, providerId);
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
    themeMode: normalizeThemeMode(getSetting("themeMode")),
    autoSyncEnabled: normalizeBooleanSetting(getSetting("autoSyncEnabled"), false),
    autoSyncMinutes: normalizeAutoSyncMinutes(getSetting("autoSyncMinutes")),
    llmBaseUrl: getSetting("llmBaseUrl") || serverConfig.defaultLlmBaseUrl,
    llmApiKey: getSetting("llmApiKey") || serverConfig.defaultLlmApiKey,
    llmModel: getSetting("llmModel") || serverConfig.defaultLlmModel,
    classifierMode: normalizeClassifierMode(getSetting("classifierMode") || serverConfig.defaultClassifierMode),
    classifierBaseUrl: getSetting("classifierBaseUrl") || serverConfig.defaultClassifierBaseUrl,
    classifierApiKey: getSetting("classifierApiKey") || serverConfig.defaultClassifierApiKey,
    classifierModel: getSetting("classifierModel") || serverConfig.defaultClassifierModel,
    classifierTimeoutMs: normalizeClassifierTimeout(getSetting("classifierTimeoutMs")),
    importantSenders: parseJsonListSetting("importantSenders"),
    importantCategories: parseJsonListSetting("importantCategories", defaultImportantCategories),
    senderCategoryRules: parseSenderCategoryRulesSetting(),
    categoryRules: parseCategoryRulesSetting()
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
  mergeDefaultProviderSenderDomains("setapp", ["setapp.com", "macpaw.com", "paddle.com"]);
  mergeDefaultProviderSenderEmails("setapp", ["help@paddle.com"]);
  mergeDefaultProviderSearchTerms("setapp", ["Setapp", "Setapp Limited", "MacPaw"]);
  ensureProviderEmailBodyPdf("setapp", true);
}

export function getAppSettings(): AppSettings {
  return {
    archiveDir: getSetting("archiveDir") || "",
    historyYears: Number(getSetting("historyYears") || 4),
    themeMode: normalizeThemeMode(getSetting("themeMode")),
    autoSyncEnabled: normalizeBooleanSetting(getSetting("autoSyncEnabled"), false),
    autoSyncMinutes: normalizeAutoSyncMinutes(getSetting("autoSyncMinutes")),
    llmBaseUrl: getSetting("llmBaseUrl") || serverConfig.defaultLlmBaseUrl,
    llmApiKey: getSetting("llmApiKey") || "",
    llmModel: getSetting("llmModel") || serverConfig.defaultLlmModel,
    classifierMode: normalizeClassifierMode(getSetting("classifierMode") || serverConfig.defaultClassifierMode),
    classifierBaseUrl: getSetting("classifierBaseUrl") || serverConfig.defaultClassifierBaseUrl,
    classifierApiKey: getSetting("classifierApiKey") || "",
    classifierModel: getSetting("classifierModel") || serverConfig.defaultClassifierModel,
    classifierTimeoutMs: normalizeClassifierTimeout(getSetting("classifierTimeoutMs")),
    importantSenders: parseJsonListSetting("importantSenders"),
    importantCategories: parseJsonListSetting("importantCategories", defaultImportantCategories),
    senderCategoryRules: parseSenderCategoryRulesSetting(),
    categoryRules: parseCategoryRulesSetting()
  };
}

export function getUiState(): UiState {
  const selectedCategory = (getSetting("uiSelectedCategory") || "").trim();
  const selectedAccountId = (getSetting("uiSelectedAccountId") || "").trim() || null;
  const selectedMessageId = (getSetting("uiSelectedMessageId") || "").trim() || null;
  return {
    selectedCategory,
    selectedAccountId,
    selectedMessageId
  };
}

export function updateUiState(input: Partial<UiState>) {
  if (input.selectedCategory !== undefined) {
    setSetting("uiSelectedCategory", (input.selectedCategory || "").trim());
  }
  if (input.selectedAccountId !== undefined) {
    setSetting("uiSelectedAccountId", (input.selectedAccountId || "").trim());
  }
  if (input.selectedMessageId !== undefined) {
    setSetting("uiSelectedMessageId", (input.selectedMessageId || "").trim());
  }
  return getUiState();
}

export function listChatHistory(input: { limit?: number; days?: number } = {}): ChatTurn[] {
  const limit = Math.max(1, Math.min(50, Number(input.limit || 10)));
  const days = Math.max(1, Math.min(90, Number(input.days || 7)));
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = db
    .prepare(
      `SELECT id, question, answer, context_json, created_at
       FROM chat_history
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(since.toISOString(), limit)
    .map(mapChatTurn);
  return rows.reverse();
}

export function insertChatTurn(input: { question: string; answer: string; contextJson: string }) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO chat_history(id, question, answer, context_json, created_at) VALUES(?, ?, ?, ?, ?)"
  ).run(id, input.question, input.answer, input.contextJson, now());
  pruneChatHistory();
  return mapChatTurn(db.prepare("SELECT * FROM chat_history WHERE id = ?").get(id) as Record<string, unknown>);
}

function pruneChatHistory() {
  const before = new Date();
  before.setDate(before.getDate() - 90);
  db.prepare("DELETE FROM chat_history WHERE created_at < ?").run(before.toISOString());
}

export function updateAppSettings(input: Partial<AppSettings>) {
  if (input.archiveDir !== undefined) setSetting("archiveDir", input.archiveDir);
  if (input.historyYears !== undefined) setSetting("historyYears", String(input.historyYears));
  if (input.themeMode !== undefined) setSetting("themeMode", normalizeThemeMode(input.themeMode));
  if (input.autoSyncEnabled !== undefined) setSetting("autoSyncEnabled", input.autoSyncEnabled ? "1" : "0");
  if (input.autoSyncMinutes !== undefined) {
    setSetting("autoSyncMinutes", String(normalizeAutoSyncMinutes(input.autoSyncMinutes)));
  }
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
  if (input.senderCategoryRules !== undefined) {
    const current = parseSenderCategoryRulesSetting();
    if (JSON.stringify(current) !== JSON.stringify(input.senderCategoryRules)) clearImportantItems();
    setSetting("senderCategoryRules", JSON.stringify(input.senderCategoryRules));
  }
  if (input.categoryRules !== undefined) {
    const current = parseCategoryRulesSetting();
    if (JSON.stringify(current) !== JSON.stringify(input.categoryRules)) clearImportantItems();
    setSetting("categoryRules", JSON.stringify(input.categoryRules));
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

function normalizeThemeMode(value: unknown): AppSettings["themeMode"] {
  const mode = String(value || "").trim();
  if (mode === "light" || mode === "system") return mode;
  return "dark";
}

function normalizeClassifierTimeout(value: unknown) {
  const timeout = Number(value || serverConfig.defaultClassifierTimeoutMs);
  if (!Number.isFinite(timeout)) return serverConfig.defaultClassifierTimeoutMs;
  return Math.max(500, Math.min(15000, Math.round(timeout)));
}

function normalizeAutoSyncMinutes(value: unknown) {
  const minutes = Number(value || 30);
  if (!Number.isFinite(minutes)) return 30;
  return Math.max(5, Math.min(240, Math.round(minutes)));
}

function normalizeBooleanSetting(value: unknown, fallback: boolean) {
  if (value === null || value === undefined || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function listAccounts(): GmailAccount[] {
  return db.prepare("SELECT * FROM gmail_accounts ORDER BY email").all().map(mapAccount);
}

export function upsertAccount(input: { id: string; email: string; tokensJson: string; historyId?: string | null }) {
  db.prepare(`
    INSERT INTO gmail_accounts(id, email, tokens_json, history_id, auth_type, imap_config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'gmail_oauth', '{}', ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      tokens_json = excluded.tokens_json,
      history_id = COALESCE(excluded.history_id, gmail_accounts.history_id),
      auth_type = 'gmail_oauth',
      imap_config_json = '{}',
      updated_at = excluded.updated_at
  `).run(input.id, input.email, input.tokensJson, input.historyId || null, now(), now());
}

export function upsertImapAccount(input: { id: string; email: string; config: ImapAccountConfig }) {
  db.prepare(`
    INSERT INTO gmail_accounts(id, email, tokens_json, history_id, auth_type, imap_config_json, created_at, updated_at)
    VALUES (?, ?, '{}', NULL, 'imap', ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      tokens_json = '{}',
      history_id = NULL,
      auth_type = 'imap',
      imap_config_json = excluded.imap_config_json,
      updated_at = excluded.updated_at
  `).run(input.id, input.email, JSON.stringify(input.config), now(), now());
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
  db.prepare("DELETE FROM saved_mail_items WHERE account_id = ?").run(id);
  db.prepare("DELETE FROM ignored_mail_items WHERE account_id = ?").run(id);
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
    .prepare(`
      SELECT
        important_items.*,
        CASE WHEN saved_mail_items.id IS NULL THEN 0 ELSE 1 END AS saved
      FROM important_items
      LEFT JOIN saved_mail_items
        ON saved_mail_items.account_id = important_items.account_id
       AND saved_mail_items.message_id = important_items.message_id
      LEFT JOIN ignored_mail_items
        ON ignored_mail_items.account_id = important_items.account_id
       AND ignored_mail_items.message_id = important_items.message_id
      WHERE saved_mail_items.id IS NULL
        AND ignored_mail_items.id IS NULL
      ORDER BY received_at DESC
      LIMIT 100
    `)
    .all()
    .map(mapImportantItem);
}

export function listOtherUnreadMailItems(): ImportantItem[] {
  return db
    .prepare(`
      SELECT
        mail_cache.account_id,
        mail_cache.message_id,
        mail_cache.thread_id,
        mail_cache.from_email,
        mail_cache.from_name,
        mail_cache.subject,
        mail_cache.snippet,
        mail_cache.received_at,
        'low' AS priority,
        'pozostałe' AS category,
        mail_cache.subject AS summary,
        '' AS action_required,
        NULL AS due_date,
        NULL AS amount,
        NULL AS currency,
        CASE WHEN saved_mail_items.id IS NULL THEN 0 ELSE 1 END AS saved,
        '{}' AS raw_json,
        mail_cache.created_at,
        'other:' || mail_cache.account_id || ':' || mail_cache.message_id AS id
      FROM mail_cache
      LEFT JOIN important_items
        ON important_items.account_id = mail_cache.account_id
       AND important_items.message_id = mail_cache.message_id
      LEFT JOIN saved_mail_items
        ON saved_mail_items.account_id = mail_cache.account_id
       AND saved_mail_items.message_id = mail_cache.message_id
      LEFT JOIN ignored_mail_items
        ON ignored_mail_items.account_id = mail_cache.account_id
       AND ignored_mail_items.message_id = mail_cache.message_id
      WHERE mail_cache.is_unread = 1
        AND important_items.id IS NULL
        AND saved_mail_items.id IS NULL
        AND ignored_mail_items.id IS NULL
      ORDER BY mail_cache.received_at DESC
      LIMIT 100
    `)
    .all()
    .map(mapImportantItem);
}

export function listSavedMailItems(): ImportantItem[] {
  return db
    .prepare(`
      SELECT
        COALESCE(important_items.id, 'saved:' || saved_mail_items.account_id || ':' || saved_mail_items.message_id) AS id,
        saved_mail_items.account_id,
        saved_mail_items.message_id,
        COALESCE(mail_cache.thread_id, saved_mail_items.thread_id, '') AS thread_id,
        COALESCE(mail_cache.from_email, saved_mail_items.from_email, '') AS from_email,
        COALESCE(mail_cache.from_name, saved_mail_items.from_name, '') AS from_name,
        COALESCE(mail_cache.subject, saved_mail_items.subject, '') AS subject,
        COALESCE(mail_cache.snippet, saved_mail_items.snippet, '') AS snippet,
        COALESCE(mail_cache.received_at, saved_mail_items.received_at, saved_mail_items.created_at) AS received_at,
        COALESCE(important_items.priority, saved_mail_items.priority, 'low') AS priority,
        COALESCE(important_items.category, saved_mail_items.category, 'pozostałe') AS category,
        COALESCE(NULLIF(important_items.summary, ''), NULLIF(saved_mail_items.summary, ''), mail_cache.subject, saved_mail_items.subject, '') AS summary,
        COALESCE(important_items.action_required, saved_mail_items.action_required, '') AS action_required,
        COALESCE(important_items.due_date, saved_mail_items.due_date) AS due_date,
        COALESCE(important_items.amount, saved_mail_items.amount) AS amount,
        COALESCE(important_items.currency, saved_mail_items.currency) AS currency,
        1 AS saved,
        COALESCE(important_items.raw_json, '{}') AS raw_json,
        saved_mail_items.created_at
      FROM saved_mail_items
      LEFT JOIN mail_cache
        ON mail_cache.account_id = saved_mail_items.account_id
       AND mail_cache.message_id = saved_mail_items.message_id
      LEFT JOIN important_items
        ON important_items.account_id = saved_mail_items.account_id
       AND important_items.message_id = saved_mail_items.message_id
      ORDER BY saved_mail_items.created_at DESC
      LIMIT 100
    `)
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
        mail_cache.text AS mail_text,
        mail_cache.html AS mail_html
      FROM important_items
      LEFT JOIN mail_cache
        ON mail_cache.account_id = important_items.account_id
       AND mail_cache.message_id = important_items.message_id
      WHERE important_items.id = ?`
    )
    .get(id) as (Record<string, unknown> & { mail_text?: string; mail_html?: string }) | undefined;
}

export function getMailItemDetail(accountId: string, messageId: string) {
  const fromCache = db
    .prepare(
      `SELECT
        mail_cache.account_id,
        mail_cache.message_id,
        mail_cache.thread_id,
        mail_cache.from_email,
        mail_cache.from_name,
        mail_cache.subject,
        mail_cache.snippet,
        mail_cache.received_at,
        COALESCE(important_items.priority, 'low') AS priority,
        COALESCE(important_items.category, 'pozostałe') AS category,
        COALESCE(NULLIF(important_items.summary, ''), mail_cache.subject) AS summary,
        COALESCE(important_items.action_required, '') AS action_required,
        important_items.due_date,
        important_items.amount,
        important_items.currency,
        CASE WHEN saved_mail_items.id IS NULL THEN 0 ELSE 1 END AS saved,
        mail_cache.text AS mail_text,
        mail_cache.html AS mail_html
      FROM mail_cache
      LEFT JOIN important_items
        ON important_items.account_id = mail_cache.account_id
       AND important_items.message_id = mail_cache.message_id
      LEFT JOIN saved_mail_items
        ON saved_mail_items.account_id = mail_cache.account_id
       AND saved_mail_items.message_id = mail_cache.message_id
      WHERE mail_cache.account_id = ?
        AND mail_cache.message_id = ?`
    )
    .get(accountId, messageId) as (Record<string, unknown> & { mail_text?: string; mail_html?: string }) | undefined;

  if (fromCache) return fromCache;

  return db
    .prepare(
      `SELECT
        saved_mail_items.account_id,
        saved_mail_items.message_id,
        COALESCE(saved_mail_items.thread_id, '') AS thread_id,
        COALESCE(saved_mail_items.from_email, '') AS from_email,
        COALESCE(saved_mail_items.from_name, '') AS from_name,
        COALESCE(saved_mail_items.subject, '') AS subject,
        COALESCE(saved_mail_items.snippet, '') AS snippet,
        COALESCE(saved_mail_items.received_at, saved_mail_items.created_at) AS received_at,
        COALESCE(important_items.priority, saved_mail_items.priority, 'low') AS priority,
        COALESCE(important_items.category, saved_mail_items.category, 'pozostałe') AS category,
        COALESCE(NULLIF(important_items.summary, ''), NULLIF(saved_mail_items.summary, ''), saved_mail_items.subject, '') AS summary,
        COALESCE(important_items.action_required, saved_mail_items.action_required, '') AS action_required,
        COALESCE(important_items.due_date, saved_mail_items.due_date) AS due_date,
        COALESCE(important_items.amount, saved_mail_items.amount) AS amount,
        COALESCE(important_items.currency, saved_mail_items.currency) AS currency,
        1 AS saved,
        COALESCE(saved_mail_items.text, '') AS mail_text,
        COALESCE(saved_mail_items.html, '') AS mail_html
      FROM saved_mail_items
      LEFT JOIN important_items
        ON important_items.account_id = saved_mail_items.account_id
       AND important_items.message_id = saved_mail_items.message_id
      WHERE saved_mail_items.account_id = ?
        AND saved_mail_items.message_id = ?`
    )
    .get(accountId, messageId) as (Record<string, unknown> & { mail_text?: string; mail_html?: string }) | undefined;
}

export function deleteImportantItem(id: string) {
  db.prepare("DELETE FROM important_items WHERE id = ?").run(id);
}

export function deleteImportantItemByMessage(accountId: string, messageId: string) {
  db.prepare("DELETE FROM important_items WHERE account_id = ? AND message_id = ?").run(accountId, messageId);
}

export function isMailIgnored(accountId: string, messageId: string) {
  return Boolean(
    db.prepare("SELECT 1 FROM ignored_mail_items WHERE account_id = ? AND message_id = ?").get(accountId, messageId)
  );
}

export function setMailIgnored(accountId: string, messageId: string, ignored: boolean) {
  if (ignored) {
    db.prepare(
      `INSERT INTO ignored_mail_items(id, account_id, message_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, message_id) DO UPDATE SET
         created_at = excluded.created_at`
    ).run(randomUUID(), accountId, messageId, now());
    db.prepare("DELETE FROM important_items WHERE account_id = ? AND message_id = ?").run(accountId, messageId);
    return;
  }
  db.prepare("DELETE FROM ignored_mail_items WHERE account_id = ? AND message_id = ?").run(accountId, messageId);
}

export function setMailSaved(accountId: string, messageId: string, saved: boolean) {
  if (saved) {
    const snapshot = getSavedMailSnapshotSource(accountId, messageId);
    db.prepare(
      `INSERT INTO saved_mail_items(
        id, account_id, message_id, created_at, thread_id, from_email, from_name, subject, snippet,
        received_at, text, html, priority, category, summary, action_required, due_date, amount, currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, message_id) DO UPDATE SET
        thread_id = excluded.thread_id,
        from_email = excluded.from_email,
        from_name = excluded.from_name,
        subject = excluded.subject,
        snippet = excluded.snippet,
        received_at = excluded.received_at,
        text = excluded.text,
        html = excluded.html,
        priority = excluded.priority,
        category = excluded.category,
        summary = excluded.summary,
        action_required = excluded.action_required,
        due_date = excluded.due_date,
        amount = excluded.amount,
        currency = excluded.currency`
    ).run(
      randomUUID(),
      accountId,
      messageId,
      now(),
      snapshot?.thread_id ? String(snapshot.thread_id) : "",
      snapshot?.from_email ? String(snapshot.from_email) : "",
      snapshot?.from_name ? String(snapshot.from_name) : "",
      snapshot?.subject ? String(snapshot.subject) : "",
      snapshot?.snippet ? String(snapshot.snippet) : "",
      snapshot?.received_at ? String(snapshot.received_at) : now(),
      snapshot?.text ? String(snapshot.text) : "",
      snapshot?.html ? String(snapshot.html) : "",
      snapshot?.priority ? String(snapshot.priority) : "low",
      snapshot?.category ? String(snapshot.category) : "pozostałe",
      snapshot?.summary ? String(snapshot.summary) : snapshot?.subject ? String(snapshot.subject) : "",
      snapshot?.action_required ? String(snapshot.action_required) : "",
      snapshot?.due_date ? String(snapshot.due_date) : null,
      snapshot?.amount ? String(snapshot.amount) : null,
      snapshot?.currency ? String(snapshot.currency) : null
    );
    return;
  }
  db.prepare("DELETE FROM saved_mail_items WHERE account_id = ? AND message_id = ?").run(accountId, messageId);
}

export function markMailCachedRead(accountId: string, messageId: string) {
  db.prepare("UPDATE mail_cache SET is_unread = 0 WHERE account_id = ? AND message_id = ?").run(accountId, messageId);
}

export function markMailCachedUnread(accountId: string, messageId: string) {
  db.prepare("UPDATE mail_cache SET is_unread = 1 WHERE account_id = ? AND message_id = ?").run(accountId, messageId);
}

export function createMailOperation(input: {
  type: MailOperation["type"];
  label: string;
  payload: { items: ReadOperationSnapshot[] };
}) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO mail_operations(id, type, label, item_count, status, payload_json, created_at)
     VALUES(?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, input.type, input.label, input.payload.items.length, JSON.stringify(input.payload), now());
  pruneMailOperations();
  return getMailOperation(id);
}

export function listMailOperations(limit = 50): MailOperation[] {
  return db
    .prepare(
      `SELECT id, type, label, item_count, status, payload_json, created_at, undone_at, error
       FROM mail_operations
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(Math.max(1, Math.min(50, limit)))
    .map(mapMailOperation);
}

export function getMailOperation(id: string) {
  const row = db
    .prepare(
      `SELECT id, type, label, item_count, status, payload_json, created_at, undone_at, error
       FROM mail_operations
       WHERE id = ?`
    )
    .get(id) as Record<string, unknown> | undefined;
  return row ? mapMailOperation(row) : null;
}

export function markMailOperationUndone(id: string, error: string | null = null) {
  db.prepare("UPDATE mail_operations SET status = 'undone', undone_at = ?, error = ? WHERE id = ?").run(
    now(),
    error,
    id
  );
  return getMailOperation(id);
}

export function getReadOperationSnapshot(accountId: string, messageId: string): ReadOperationSnapshot {
  const cached = db
    .prepare(
      `SELECT subject, from_email, from_name, is_unread
       FROM mail_cache
       WHERE account_id = ?
         AND message_id = ?`
    )
    .get(accountId, messageId) as Record<string, unknown> | undefined;
  const importantItem = db
    .prepare("SELECT * FROM important_items WHERE account_id = ? AND message_id = ?")
    .get(accountId, messageId) as Record<string, unknown> | undefined;

  return {
    accountId,
    messageId,
    subject: cached?.subject ? String(cached.subject) : importantItem?.subject ? String(importantItem.subject) : messageId,
    fromEmail: cached?.from_email ? String(cached.from_email) : importantItem?.from_email ? String(importantItem.from_email) : "",
    fromName: cached?.from_name ? String(cached.from_name) : importantItem?.from_name ? String(importantItem.from_name) : "",
    wasUnread: cached?.is_unread === undefined ? true : Boolean(cached.is_unread),
    importantItem: importantItem ? normalizeImportantSnapshot(importantItem) : null
  };
}

export function restoreReadOperationSnapshot(snapshot: ReadOperationSnapshot) {
  if (snapshot.wasUnread) {
    markMailCachedUnread(snapshot.accountId, snapshot.messageId);
  } else {
    markMailCachedRead(snapshot.accountId, snapshot.messageId);
  }

  if (snapshot.importantItem) {
    restoreImportantItem(snapshot.importantItem);
  }
}

export function updateMailCacheBodies(accountId: string, messageId: string, text: string, html: string) {
  db.prepare("UPDATE mail_cache SET text = ?, html = ? WHERE account_id = ? AND message_id = ?").run(
    text,
    html,
    accountId,
    messageId
  );
}

function pruneMailOperations() {
  const before = new Date();
  before.setDate(before.getDate() - 90);
  db.prepare("DELETE FROM mail_operations WHERE created_at < ?").run(before.toISOString());
}

function normalizeImportantSnapshot(row: Record<string, unknown>) {
  return {
    id: String(row.id || randomUUID()),
    account_id: String(row.account_id || ""),
    message_id: String(row.message_id || ""),
    thread_id: String(row.thread_id || ""),
    from_email: String(row.from_email || ""),
    from_name: String(row.from_name || ""),
    subject: String(row.subject || ""),
    snippet: String(row.snippet || ""),
    received_at: String(row.received_at || now()),
    priority: String(row.priority || "medium"),
    category: String(row.category || "pozostałe"),
    summary: String(row.summary || row.subject || ""),
    action_required: String(row.action_required || ""),
    due_date: row.due_date ? String(row.due_date) : null,
    amount: row.amount ? String(row.amount) : null,
    currency: row.currency ? String(row.currency) : null,
    raw_json: String(row.raw_json || "{}"),
    created_at: String(row.created_at || now())
  };
}

function restoreImportantItem(row: Record<string, unknown>) {
  const snapshot = normalizeImportantSnapshot(row);
  db.prepare(
    `INSERT INTO important_items(
      id, account_id, message_id, thread_id, from_email, from_name, subject, snippet,
      received_at, priority, category, summary, action_required, due_date, amount, currency,
      raw_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, message_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      from_email = excluded.from_email,
      from_name = excluded.from_name,
      subject = excluded.subject,
      snippet = excluded.snippet,
      received_at = excluded.received_at,
      priority = excluded.priority,
      category = excluded.category,
      summary = excluded.summary,
      action_required = excluded.action_required,
      due_date = excluded.due_date,
      amount = excluded.amount,
      currency = excluded.currency,
      raw_json = excluded.raw_json`
  ).run(
    snapshot.id,
    snapshot.account_id,
    snapshot.message_id,
    snapshot.thread_id,
    snapshot.from_email,
    snapshot.from_name,
    snapshot.subject,
    snapshot.snippet,
    snapshot.received_at,
    snapshot.priority,
    snapshot.category,
    snapshot.summary,
    snapshot.action_required,
    snapshot.due_date,
    snapshot.amount,
    snapshot.currency,
    snapshot.raw_json,
    snapshot.created_at
  );
}

function mapAccount(row: Record<string, unknown>): GmailAccount {
  return {
    id: String(row.id),
    email: String(row.email),
    tokensJson: String(row.tokens_json),
    historyId: row.history_id ? String(row.history_id) : null,
    authType: String(row.auth_type || "gmail_oauth") === "imap" ? "imap" : "gmail_oauth",
    imapConfigJson: String(row.imap_config_json || "{}"),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapChatTurn(row: Record<string, unknown>): ChatTurn {
  return {
    id: String(row.id),
    question: String(row.question),
    answer: String(row.answer),
    contextJson: String(row.context_json || "{}"),
    createdAt: String(row.created_at)
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

function getSavedMailSnapshotSource(accountId: string, messageId: string) {
  return db
    .prepare(
      `SELECT
        mail_cache.thread_id,
        mail_cache.from_email,
        mail_cache.from_name,
        mail_cache.subject,
        mail_cache.snippet,
        mail_cache.received_at,
        mail_cache.text,
        mail_cache.html,
        COALESCE(important_items.priority, 'low') AS priority,
        COALESCE(important_items.category, 'pozostałe') AS category,
        COALESCE(NULLIF(important_items.summary, ''), mail_cache.subject, '') AS summary,
        COALESCE(important_items.action_required, '') AS action_required,
        important_items.due_date,
        important_items.amount,
        important_items.currency
      FROM mail_cache
      LEFT JOIN important_items
        ON important_items.account_id = mail_cache.account_id
       AND important_items.message_id = mail_cache.message_id
      WHERE mail_cache.account_id = ?
        AND mail_cache.message_id = ?`
    )
    .get(accountId, messageId) as Record<string, unknown> | undefined;
}

function backfillSavedMailSnapshots() {
  const rows = db
    .prepare(
      `SELECT
        saved_mail_items.account_id,
        saved_mail_items.message_id,
        mail_cache.thread_id,
        mail_cache.from_email,
        mail_cache.from_name,
        mail_cache.subject,
        mail_cache.snippet,
        mail_cache.received_at,
        mail_cache.text,
        mail_cache.html,
        COALESCE(important_items.priority, 'low') AS priority,
        COALESCE(important_items.category, 'pozostałe') AS category,
        COALESCE(NULLIF(important_items.summary, ''), mail_cache.subject, '') AS summary,
        COALESCE(important_items.action_required, '') AS action_required,
        important_items.due_date,
        important_items.amount,
        important_items.currency
      FROM saved_mail_items
      LEFT JOIN mail_cache
        ON mail_cache.account_id = saved_mail_items.account_id
       AND mail_cache.message_id = saved_mail_items.message_id
      LEFT JOIN important_items
        ON important_items.account_id = saved_mail_items.account_id
       AND important_items.message_id = saved_mail_items.message_id`
    )
    .all() as Record<string, unknown>[];

  const update = db.prepare(
    `UPDATE saved_mail_items
      SET thread_id = COALESCE(?, thread_id),
          from_email = COALESCE(?, from_email),
          from_name = COALESCE(?, from_name),
          subject = COALESCE(?, subject),
          snippet = COALESCE(?, snippet),
          received_at = COALESCE(?, received_at),
          text = COALESCE(?, text),
          html = COALESCE(?, html),
          priority = COALESCE(?, priority),
          category = COALESCE(?, category),
          summary = COALESCE(?, summary),
          action_required = COALESCE(?, action_required),
          due_date = COALESCE(?, due_date),
          amount = COALESCE(?, amount),
          currency = COALESCE(?, currency)
      WHERE account_id = ?
        AND message_id = ?`
  );

  for (const row of rows) {
    update.run(
      row.thread_id ? String(row.thread_id) : null,
      row.from_email ? String(row.from_email) : null,
      row.from_name ? String(row.from_name) : null,
      row.subject ? String(row.subject) : null,
      row.snippet ? String(row.snippet) : null,
      row.received_at ? String(row.received_at) : null,
      row.text ? String(row.text) : null,
      row.html ? String(row.html) : null,
      row.priority ? String(row.priority) : null,
      row.category ? String(row.category) : null,
      row.summary ? String(row.summary) : null,
      row.action_required ? String(row.action_required) : null,
      row.due_date ? String(row.due_date) : null,
      row.amount ? String(row.amount) : null,
      row.currency ? String(row.currency) : null,
      String(row.account_id),
      String(row.message_id)
    );
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

function mapMailOperation(row: Record<string, unknown>): MailOperation {
  return {
    id: String(row.id),
    type: row.type as MailOperation["type"],
    label: String(row.label),
    itemCount: Number(row.item_count || 0),
    status: row.status === "undone" ? "undone" : "active",
    payloadJson: String(row.payload_json || "{}"),
    createdAt: String(row.created_at),
    undoneAt: row.undone_at ? String(row.undone_at) : null,
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
    saved: Boolean(row.saved),
    rawJson: String(row.raw_json),
    createdAt: String(row.created_at)
  };
}
