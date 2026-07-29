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
  Profile,
  ProviderRule,
  ReadOperationSnapshot,
  ScanJob,
  UiState
} from "./types.js";

fs.mkdirSync(serverConfig.dataDir, { recursive: true });

const dbPath = path.join(serverConfig.dataDir, "app.sqlite");
export const db = new DatabaseSync(dbPath);
const DEFAULT_PROFILE_ID = "default";

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

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
ensureColumn("providers", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("gmail_accounts", "auth_type", "TEXT NOT NULL DEFAULT 'gmail_oauth'");
ensureColumn("gmail_accounts", "imap_config_json", "TEXT NOT NULL DEFAULT '{}'");
ensureColumn("gmail_accounts", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("processed_attachments", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("scan_jobs", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("chat_history", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("mail_cache", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("mail_cache", "is_unread", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("mail_cache", "html", "TEXT NOT NULL DEFAULT ''");
ensureColumn("saved_mail_items", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
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
ensureColumn("ignored_mail_items", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("important_items", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureColumn("mail_operations", "profile_id", `TEXT NOT NULL DEFAULT '${DEFAULT_PROFILE_ID}'`);
ensureProfileStorage();
migrateUntouchedNonDefaultProfileTemplates();
backfillSavedMailSnapshots();

function now() {
  return new Date().toISOString();
}

function ensureProfileStorage() {
  const existing = db.prepare("SELECT id FROM profiles WHERE id = ?").get(DEFAULT_PROFILE_ID);
  if (!existing) {
    db.prepare("INSERT INTO profiles(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      DEFAULT_PROFILE_ID,
      "Domyślny",
      now(),
      now()
    );
  }
  if (!getGlobalSetting("activeProfileId")) setGlobalSetting("activeProfileId", DEFAULT_PROFILE_ID);
}

function migrateUntouchedNonDefaultProfileTemplates() {
  const migrationKey = "profilesBlankTemplatesMigrationV1";
  if (getGlobalSetting(migrationKey) === "1") return;

  const profiles = db.prepare("SELECT id FROM profiles WHERE id != ?").all(DEFAULT_PROFILE_ID) as { id: string }[];
  for (const profile of profiles) {
    clearUntouchedDefaultCategoryRules(profile.id);
    clearUntouchedDefaultProviders(profile.id);
  }

  setGlobalSetting(migrationKey, "1");
}

function clearUntouchedDefaultCategoryRules(profileId: string) {
  const key = profileSettingKey(profileId, "categoryRules");
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return;
  try {
    const parsed = JSON.parse(row.value);
    if (JSON.stringify(parsed) === JSON.stringify(defaultCategoryRules)) {
      setProfileSetting(profileId, "categoryRules", "[]");
    }
  } catch {
    return;
  }
}

function clearUntouchedDefaultProviders(profileId: string) {
  const rows = db.prepare("SELECT * FROM providers WHERE profile_id = ? ORDER BY id").all(profileId) as Record<
    string,
    unknown
  >[];
  if (rows.length !== defaultProviders.length) return;

  const defaultsById = new Map(defaultProviders.map(provider => [provider.id, provider]));
  for (const row of rows) {
    const baseId = unprofileProviderId(String(row.id), profileId);
    const template = defaultsById.get(baseId);
    if (!template || !providerRowMatchesTemplate(row, template, profileId)) return;
  }

  db.prepare("DELETE FROM providers WHERE profile_id = ?").run(profileId);
}

function providerRowMatchesTemplate(row: Record<string, unknown>, template: ProviderRule, profileId: string) {
  return (
    String(row.id) === profileProviderId(template.id, profileId) &&
    String(row.name) === template.name &&
    String(row.target_domain) === template.targetDomain &&
    String(row.sender_domains_json) === JSON.stringify(template.senderDomains) &&
    String(row.sender_emails_json) === JSON.stringify(template.senderEmails) &&
    String(row.search_terms_json) === JSON.stringify(template.searchTerms) &&
    Boolean(row.sender_only) === (template.senderOnly !== false) &&
    Boolean(row.email_body_pdf) === Boolean(template.emailBodyPdf) &&
    Boolean(row.enabled) === Boolean(template.enabled)
  );
}

function getGlobalSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setGlobalSetting(key: string, value: string) {
  db.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

function profileSettingKey(profileId: string, key: string) {
  return `profile:${profileId}:${key}`;
}

function getProfileSetting(profileId: string, key: string, useLegacyFallback = false): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(profileSettingKey(profileId, key)) as
    | { value: string }
    | undefined;
  if (row) return row.value;
  return useLegacyFallback ? getGlobalSetting(key) : null;
}

function setProfileSetting(profileId: string, key: string, value: string) {
  setGlobalSetting(profileSettingKey(profileId, key), value);
}

export function getActiveProfileId() {
  const configured = getGlobalSetting("activeProfileId") || DEFAULT_PROFILE_ID;
  const row = db.prepare("SELECT id FROM profiles WHERE id = ?").get(configured);
  return row ? configured : DEFAULT_PROFILE_ID;
}

function getActiveProfileLegacyFallback() {
  return getActiveProfileId() === DEFAULT_PROFILE_ID;
}

function getSetting(key: string): string | null {
  return getProfileSetting(getActiveProfileId(), key, getActiveProfileLegacyFallback());
}

function setSetting(key: string, value: string) {
  setProfileSetting(getActiveProfileId(), key, value);
}

export function listProfiles(): Profile[] {
  return db
    .prepare("SELECT id, name, created_at, updated_at FROM profiles ORDER BY created_at ASC")
    .all()
    .map(mapProfile);
}

export function getActiveProfile(): Profile {
  const profileId = getActiveProfileId();
  const row = db.prepare("SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?").get(profileId);
  if (row) return mapProfile(row as Record<string, unknown>);
  return createProfileRecord({ id: DEFAULT_PROFILE_ID, name: "Domyślny" });
}

export function createProfile(name: string): Profile {
  const profile = createProfileRecord({
    id: randomUUID(),
    name: normalizeProfileName(name)
  });
  initializeProfileDefaults(profile.id, false);
  setActiveProfile(profile.id);
  return profile;
}

export function setActiveProfile(profileId: string): Profile {
  const row = db.prepare("SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?").get(profileId);
  if (!row) throw new Error("Nie znaleziono profilu");
  setGlobalSetting("activeProfileId", profileId);
  initializeProfileDefaults(profileId, profileId === DEFAULT_PROFILE_ID);
  return mapProfile(row as Record<string, unknown>);
}

function createProfileRecord(input: { id: string; name: string }): Profile {
  db.prepare("INSERT OR IGNORE INTO profiles(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
    input.id,
    input.name,
    now(),
    now()
  );
  return mapProfile(
    db.prepare("SELECT id, name, created_at, updated_at FROM profiles WHERE id = ?").get(input.id) as Record<
      string,
      unknown
    >
  );
}

function normalizeProfileName(name: string) {
  const normalized = name.trim().replace(/\s+/g, " ");
  return normalized || "Nowy profil";
}

function parseJsonListSetting(key: string, fallback: string[] = []) {
  return parseJsonListSettingForProfile(getActiveProfileId(), key, fallback);
}

function parseJsonListSettingForProfile(profileId: string, key: string, fallback: string[] = []) {
  try {
    const parsed = JSON.parse(getProfileSetting(profileId, key, profileId === DEFAULT_PROFILE_ID) || "[]") as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const values = parsed.map(item => String(item).trim()).filter(Boolean);
    return values.length ? values : fallback;
  } catch {
    return fallback;
  }
}

function parseSenderCategoryRulesSetting() {
  return parseSenderCategoryRulesSettingForProfile(getActiveProfileId());
}

function parseSenderCategoryRulesSettingForProfile(profileId: string) {
  try {
    const parsed = JSON.parse(getProfileSetting(profileId, "senderCategoryRules", profileId === DEFAULT_PROFILE_ID) || "[]") as unknown;
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
  return parseCategoryRulesSettingForProfile(getActiveProfileId());
}

function parseCategoryRulesSettingForProfile(profileId: string, seedTemplates = profileId === DEFAULT_PROFILE_ID) {
  try {
    const raw = getProfileSetting(profileId, "categoryRules", profileId === DEFAULT_PROFILE_ID);
    if (raw === null) return seedTemplates ? defaultCategoryRules : [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return seedTemplates ? defaultCategoryRules : [];
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
    return seedTemplates ? defaultCategoryRules : [];
  }
}

function migrateImportantCategoriesSetting(profileId = getActiveProfileId()) {
  const current = parseJsonListSettingForProfile(profileId, "importantCategories", defaultImportantCategories);
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
    setProfileSetting(profileId, "importantCategories", JSON.stringify(migrated));
    clearImportantItems(profileId);
  }
}

function profileProviderId(providerId: string, profileId: string) {
  const baseId = unprofileProviderId(providerId, profileId);
  return profileId === DEFAULT_PROFILE_ID ? baseId : `${profileId}:${baseId}`;
}

function unprofileProviderId(providerId: string, profileId: string) {
  const prefix = `${profileId}:`;
  return profileId !== DEFAULT_PROFILE_ID && providerId.startsWith(prefix) ? providerId.slice(prefix.length) : providerId;
}

function mergeDefaultProviderSenderEmails(providerId: string, emails: string[], profileId = getActiveProfileId()) {
  const id = profileProviderId(providerId, profileId);
  const row = db.prepare("SELECT sender_emails_json FROM providers WHERE id = ? AND profile_id = ?").get(id, profileId) as
    | { sender_emails_json: string }
    | undefined;
  if (!row) return;

  const current = JSON.parse(row.sender_emails_json) as string[];
  const merged = [...current];
  for (const email of emails) {
    if (!merged.some(item => item.toLowerCase() === email.toLowerCase())) merged.push(email);
  }

  if (merged.length !== current.length) {
    db.prepare("UPDATE providers SET sender_emails_json = ? WHERE id = ? AND profile_id = ?").run(
      JSON.stringify(merged),
      id,
      profileId
    );
  }
}

function mergeDefaultProviderSenderDomains(providerId: string, domains: string[], profileId = getActiveProfileId()) {
  const id = profileProviderId(providerId, profileId);
  const row = db.prepare("SELECT sender_domains_json FROM providers WHERE id = ? AND profile_id = ?").get(id, profileId) as
    | { sender_domains_json: string }
    | undefined;
  if (!row) return;

  const current = JSON.parse(row.sender_domains_json) as string[];
  const merged = [...current];
  for (const domain of domains) {
    if (!merged.some(item => item.toLowerCase() === domain.toLowerCase())) merged.push(domain);
  }

  if (merged.length !== current.length) {
    db.prepare("UPDATE providers SET sender_domains_json = ? WHERE id = ? AND profile_id = ?").run(
      JSON.stringify(merged),
      id,
      profileId
    );
  }
}

function mergeDefaultProviderSearchTerms(providerId: string, terms: string[], profileId = getActiveProfileId()) {
  const id = profileProviderId(providerId, profileId);
  const row = db.prepare("SELECT search_terms_json FROM providers WHERE id = ? AND profile_id = ?").get(id, profileId) as
    | { search_terms_json: string }
    | undefined;
  if (!row) return;

  const current = JSON.parse(row.search_terms_json) as string[];
  const merged = [...current];
  for (const term of terms) {
    if (!merged.some(item => item.toLowerCase() === term.toLowerCase())) merged.push(term);
  }

  if (merged.length !== current.length) {
    db.prepare("UPDATE providers SET search_terms_json = ? WHERE id = ? AND profile_id = ?").run(
      JSON.stringify(merged),
      id,
      profileId
    );
  }
}

function ensureProviderEmailBodyPdf(providerId: string, enabled: boolean, profileId = getActiveProfileId()) {
  db.prepare("UPDATE providers SET email_body_pdf = ? WHERE id = ? AND profile_id = ?").run(
    enabled ? 1 : 0,
    profileProviderId(providerId, profileId),
    profileId
  );
}

function removeProviderSearchTerms(providerId: string, terms: string[], profileId = getActiveProfileId()) {
  const id = profileProviderId(providerId, profileId);
  const row = db.prepare("SELECT search_terms_json FROM providers WHERE id = ? AND profile_id = ?").get(id, profileId) as
    | { search_terms_json: string }
    | undefined;
  if (!row) return;

  const banned = new Set(terms.map(item => item.toLowerCase()));
  const current = JSON.parse(row.search_terms_json) as string[];
  const filtered = current.filter(item => !banned.has(item.toLowerCase()));
  if (filtered.length !== current.length) {
    db.prepare("UPDATE providers SET search_terms_json = ? WHERE id = ? AND profile_id = ?").run(
      JSON.stringify(filtered),
      id,
      profileId
    );
  }
}

function insertDefaultProvider(provider: ProviderRule, profileId = getActiveProfileId()) {
  db.prepare(`
    INSERT INTO providers(profile_id, id, name, target_domain, sender_domains_json, sender_emails_json, search_terms_json, sender_only, email_body_pdf, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profileId,
    profileProviderId(provider.id, profileId),
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

function ensureDefaultProviders(providerIds: string[], profileId = getActiveProfileId()) {
  const existing = db.prepare("SELECT id FROM providers WHERE id = ? AND profile_id = ?");
  for (const provider of defaultProviders.filter(item => providerIds.includes(item.id))) {
    if (existing.get(profileProviderId(provider.id, profileId), profileId)) continue;
    insertDefaultProvider(provider, profileId);
  }
}

function deleteDeprecatedProviders(providerIds: string[], profileId = getActiveProfileId()) {
  const statement = db.prepare("DELETE FROM providers WHERE id = ? AND profile_id = ?");
  for (const id of providerIds) statement.run(profileProviderId(id, profileId), profileId);
}

export function initDefaults() {
  initializeProfileDefaults(getActiveProfileId(), getActiveProfileId() === DEFAULT_PROFILE_ID);
}

function initializeProfileDefaults(profileId: string, useLegacyFallback: boolean) {
  const read = (key: string) => getProfileSetting(profileId, key, useLegacyFallback);
  const write = (key: string, value: string) => setProfileSetting(profileId, key, value);
  const seedTemplates = profileId === DEFAULT_PROFILE_ID || useLegacyFallback;
  const settings: AppSettings = {
    archiveDir: read("archiveDir") || serverConfig.defaultArchiveDir,
    historyYears: Number(read("historyYears") || 4),
    language: normalizeLanguage(read("language"), systemDefaultLanguage()),
    themeMode: normalizeThemeMode(read("themeMode")),
    autoSyncEnabled: normalizeBooleanSetting(read("autoSyncEnabled"), false),
    autoSyncMinutes: normalizeAutoSyncMinutes(read("autoSyncMinutes")),
    llmBaseUrl: read("llmBaseUrl") || serverConfig.defaultLlmBaseUrl,
    llmApiKey: read("llmApiKey") || serverConfig.defaultLlmApiKey,
    llmModel: read("llmModel") || serverConfig.defaultLlmModel,
    classifierMode: normalizeClassifierMode(read("classifierMode") || serverConfig.defaultClassifierMode),
    classifierBaseUrl: read("classifierBaseUrl") || serverConfig.defaultClassifierBaseUrl,
    classifierApiKey: read("classifierApiKey") || serverConfig.defaultClassifierApiKey,
    classifierModel: read("classifierModel") || serverConfig.defaultClassifierModel,
    classifierTimeoutMs: normalizeClassifierTimeout(read("classifierTimeoutMs")),
    importantSenders: parseJsonListSettingForProfile(profileId, "importantSenders"),
    importantCategories: parseJsonListSettingForProfile(profileId, "importantCategories", defaultImportantCategories),
    senderCategoryRules: parseSenderCategoryRulesSettingForProfile(profileId),
    categoryRules: parseCategoryRulesSettingForProfile(profileId, seedTemplates)
  };

  for (const [key, value] of Object.entries(settings)) {
    write(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  write("googleClientId", read("googleClientId") || serverConfig.googleClientId);
  write("googleClientSecret", read("googleClientSecret") || serverConfig.googleClientSecret);
  write(
    "googleRedirectUri",
    read("googleRedirectUri") || serverConfig.googleRedirectUri || "http://127.0.0.1:8797/api/auth/google/callback"
  );
  migrateImportantCategoriesSetting(profileId);

  const existing = db.prepare("SELECT COUNT(*) AS count FROM providers WHERE profile_id = ?").get(profileId) as {
    count: number;
  };
  if (seedTemplates && existing.count === 0) {
    for (const provider of defaultProviders) {
      insertDefaultProvider(provider, profileId);
    }
  }
  if (seedTemplates) {
    deleteDeprecatedProviders(["canva"], profileId);
    ensureDefaultProviders(["capcut", "krea", "midjourney"], profileId);
    removeProviderSearchTerms("capcut", ["Apple"], profileId);
    mergeDefaultProviderSenderEmails("elevenlabs", ["team@elevenlabs.io"], profileId);
    mergeDefaultProviderSenderEmails("udio", ["support@udio.com"], profileId);
    mergeDefaultProviderSenderDomains("setapp", ["setapp.com", "macpaw.com", "paddle.com"], profileId);
    mergeDefaultProviderSenderEmails("setapp", ["help@paddle.com"], profileId);
    mergeDefaultProviderSearchTerms("setapp", ["Setapp", "Setapp Limited", "MacPaw"], profileId);
    ensureProviderEmailBodyPdf("setapp", true, profileId);
  }
}

export function getAppSettings(): AppSettings {
  return {
    archiveDir: getSetting("archiveDir") || "",
    historyYears: Number(getSetting("historyYears") || 4),
    language: normalizeLanguage(getSetting("language"), systemDefaultLanguage()),
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
  const profileId = getActiveProfileId();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const rows = db
    .prepare(
      `SELECT id, question, answer, context_json, created_at
       FROM chat_history
       WHERE created_at >= ?
         AND profile_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(since.toISOString(), profileId, limit)
    .map(mapChatTurn);
  return rows.reverse();
}

export function insertChatTurn(input: { question: string; answer: string; contextJson: string }) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO chat_history(id, profile_id, question, answer, context_json, created_at) VALUES(?, ?, ?, ?, ?, ?)"
  ).run(id, getActiveProfileId(), input.question, input.answer, input.contextJson, now());
  pruneChatHistory();
  return mapChatTurn(db.prepare("SELECT * FROM chat_history WHERE id = ?").get(id) as Record<string, unknown>);
}

function pruneChatHistory() {
  const before = new Date();
  before.setDate(before.getDate() - 90);
  db.prepare("DELETE FROM chat_history WHERE created_at < ? AND profile_id = ?").run(
    before.toISOString(),
    getActiveProfileId()
  );
}

export function updateAppSettings(input: Partial<AppSettings>) {
  if (input.archiveDir !== undefined) setSetting("archiveDir", input.archiveDir);
  if (input.historyYears !== undefined) setSetting("historyYears", String(input.historyYears));
  if (input.language !== undefined) setSetting("language", normalizeLanguage(input.language));
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

export function getGoogleOAuthConfig() {
  return {
    googleClientId: getSetting("googleClientId") || serverConfig.googleClientId,
    googleClientSecret: getSetting("googleClientSecret") || serverConfig.googleClientSecret,
    googleRedirectUri:
      getSetting("googleRedirectUri") ||
      serverConfig.googleRedirectUri ||
      "http://127.0.0.1:8797/api/auth/google/callback"
  };
}

export function updateGoogleOAuthConfig(input: {
  googleClientId?: string;
  googleClientSecret?: string;
  googleRedirectUri?: string;
}) {
  if (input.googleClientId !== undefined) setSetting("googleClientId", input.googleClientId);
  if (input.googleClientSecret !== undefined) setSetting("googleClientSecret", input.googleClientSecret);
  if (input.googleRedirectUri !== undefined) setSetting("googleRedirectUri", input.googleRedirectUri);
  return getGoogleOAuthConfig();
}

function sameList(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((item, index) => item === right[index]);
}

function clearImportantItems(profileId = getActiveProfileId()) {
  db.prepare("DELETE FROM important_items WHERE profile_id = ?").run(profileId);
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

function normalizeLanguage(value: unknown, fallback: AppSettings["language"] = "pl"): AppSettings["language"] {
  const language = String(value || "").trim().toLowerCase();
  if (language === "pl" || language.startsWith("pl-") || language.startsWith("pl_")) return "pl";
  if (language === "en" || language.startsWith("en-") || language.startsWith("en_")) return "en";
  return fallback;
}

function systemDefaultLanguage(): AppSettings["language"] {
  const candidates = [
    process.env.MAILBOT_LOCALE,
    process.env.LC_ALL,
    process.env.LC_MESSAGES,
    process.env.LANG,
    Intl.DateTimeFormat().resolvedOptions().locale
  ];
  return candidates.some(value => /^pl(?:[-_]|$)/i.test(String(value || "").trim())) ? "pl" : "en";
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
  return db.prepare("SELECT * FROM gmail_accounts WHERE profile_id = ? ORDER BY email").all(getActiveProfileId()).map(mapAccount);
}

export function upsertAccount(input: { id: string; email: string; tokensJson: string; historyId?: string | null }) {
  db.prepare(`
    INSERT INTO gmail_accounts(id, profile_id, email, tokens_json, history_id, auth_type, imap_config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'gmail_oauth', '{}', ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      profile_id = excluded.profile_id,
      tokens_json = excluded.tokens_json,
      history_id = COALESCE(excluded.history_id, gmail_accounts.history_id),
      auth_type = 'gmail_oauth',
      imap_config_json = '{}',
      updated_at = excluded.updated_at
  `).run(input.id, getActiveProfileId(), input.email, input.tokensJson, input.historyId || null, now(), now());
}

export function upsertImapAccount(input: { id: string; email: string; config: ImapAccountConfig }) {
  db.prepare(`
    INSERT INTO gmail_accounts(id, profile_id, email, tokens_json, history_id, auth_type, imap_config_json, created_at, updated_at)
    VALUES (?, ?, ?, '{}', NULL, 'imap', ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      profile_id = excluded.profile_id,
      tokens_json = '{}',
      history_id = NULL,
      auth_type = 'imap',
      imap_config_json = excluded.imap_config_json,
      updated_at = excluded.updated_at
  `).run(input.id, getActiveProfileId(), input.email, JSON.stringify(input.config), now(), now());
}

export function getAccount(id: string): GmailAccount | null {
  const row = db.prepare("SELECT * FROM gmail_accounts WHERE id = ? AND profile_id = ?").get(id, getActiveProfileId());
  return row ? mapAccount(row as Record<string, unknown>) : null;
}

export function updateAccountTokens(id: string, tokensJson: string) {
  db.prepare("UPDATE gmail_accounts SET tokens_json = ?, updated_at = ? WHERE id = ? AND profile_id = ?").run(
    tokensJson,
    now(),
    id,
    getActiveProfileId()
  );
}

export function deleteAccount(id: string) {
  const profileId = getActiveProfileId();
  db.prepare("DELETE FROM important_items WHERE account_id = ? AND profile_id = ?").run(id, profileId);
  db.prepare("DELETE FROM saved_mail_items WHERE account_id = ? AND profile_id = ?").run(id, profileId);
  db.prepare("DELETE FROM ignored_mail_items WHERE account_id = ? AND profile_id = ?").run(id, profileId);
  db.prepare("DELETE FROM mail_cache WHERE account_id = ? AND profile_id = ?").run(id, profileId);
  db.prepare("DELETE FROM gmail_accounts WHERE id = ? AND profile_id = ?").run(id, profileId);
}

export function listProviders(): ProviderRule[] {
  return db.prepare("SELECT * FROM providers WHERE profile_id = ? ORDER BY name").all(getActiveProfileId()).map(mapProvider);
}

export function upsertProvider(provider: ProviderRule) {
  const profileId = getActiveProfileId();
  const providerId = profileProviderId(provider.id || provider.targetDomain || randomUUID(), profileId);
  db.prepare(`
    INSERT INTO providers(profile_id, id, name, target_domain, sender_domains_json, sender_emails_json, search_terms_json, sender_only, email_body_pdf, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      profile_id = excluded.profile_id,
      name = excluded.name,
      target_domain = excluded.target_domain,
      sender_domains_json = excluded.sender_domains_json,
      sender_emails_json = excluded.sender_emails_json,
      search_terms_json = excluded.search_terms_json,
      sender_only = excluded.sender_only,
      email_body_pdf = excluded.email_body_pdf,
      enabled = excluded.enabled
  `).run(
    profileId,
    providerId,
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
    "INSERT INTO scan_jobs(id, profile_id, type, status, progress_json) VALUES (?, ?, ?, 'queued', ?)"
  ).run(id, getActiveProfileId(), type, JSON.stringify({ message: "W kolejce" }));
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
    .prepare("SELECT * FROM processed_attachments WHERE profile_id = ? ORDER BY created_at DESC LIMIT 500")
    .all(getActiveProfileId());
}

export function cleanupInvoiceIndex(options: { removeMissingFiles?: boolean; removeDuplicateRows?: boolean }) {
  const profileId = getActiveProfileId();
  const result = {
    checkedSavedFiles: 0,
    removedMissingFileRows: 0,
    removedDuplicateRows: 0
  };

  if (options.removeMissingFiles !== false) {
    const rows = db
      .prepare("SELECT id, file_path FROM processed_attachments WHERE status = 'saved' AND profile_id = ?")
      .all(profileId) as { id: string; file_path: string }[];
    const deleteRow = db.prepare("DELETE FROM processed_attachments WHERE id = ? AND profile_id = ?");

    for (const row of rows) {
      result.checkedSavedFiles += 1;
      if (fs.existsSync(row.file_path)) continue;
      deleteRow.run(row.id, profileId);
      result.removedMissingFileRows += 1;
    }
  }

  if (options.removeDuplicateRows !== false) {
    const deleted = db.prepare("DELETE FROM processed_attachments WHERE status = 'duplicate' AND profile_id = ?").run(profileId) as {
      changes: number;
    };
    result.removedDuplicateRows = deleted.changes;
  }

  return result;
}

export function listImportantItems(): ImportantItem[] {
  const profileId = getActiveProfileId();
  return db
    .prepare(`
      SELECT
        important_items.*,
        CASE WHEN saved_mail_items.id IS NULL THEN 0 ELSE 1 END AS saved
      FROM important_items
      LEFT JOIN saved_mail_items
        ON saved_mail_items.account_id = important_items.account_id
       AND saved_mail_items.message_id = important_items.message_id
       AND saved_mail_items.profile_id = important_items.profile_id
      LEFT JOIN ignored_mail_items
        ON ignored_mail_items.account_id = important_items.account_id
       AND ignored_mail_items.message_id = important_items.message_id
       AND ignored_mail_items.profile_id = important_items.profile_id
      WHERE saved_mail_items.id IS NULL
        AND ignored_mail_items.id IS NULL
        AND important_items.profile_id = ?
      ORDER BY received_at DESC
      LIMIT 100
    `)
    .all(profileId)
    .map(mapImportantItem);
}

export function listOtherUnreadMailItems(): ImportantItem[] {
  const profileId = getActiveProfileId();
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
       AND important_items.profile_id = mail_cache.profile_id
      LEFT JOIN saved_mail_items
        ON saved_mail_items.account_id = mail_cache.account_id
       AND saved_mail_items.message_id = mail_cache.message_id
       AND saved_mail_items.profile_id = mail_cache.profile_id
      LEFT JOIN ignored_mail_items
        ON ignored_mail_items.account_id = mail_cache.account_id
       AND ignored_mail_items.message_id = mail_cache.message_id
       AND ignored_mail_items.profile_id = mail_cache.profile_id
      WHERE mail_cache.is_unread = 1
        AND mail_cache.profile_id = ?
        AND important_items.id IS NULL
        AND saved_mail_items.id IS NULL
        AND ignored_mail_items.id IS NULL
      ORDER BY mail_cache.received_at DESC
      LIMIT 100
    `)
    .all(profileId)
    .map(mapImportantItem);
}

export function listSavedMailItems(): ImportantItem[] {
  const profileId = getActiveProfileId();
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
       AND mail_cache.profile_id = saved_mail_items.profile_id
      LEFT JOIN important_items
        ON important_items.account_id = saved_mail_items.account_id
       AND important_items.message_id = saved_mail_items.message_id
       AND important_items.profile_id = saved_mail_items.profile_id
      WHERE saved_mail_items.profile_id = ?
      ORDER BY saved_mail_items.created_at DESC
      LIMIT 100
    `)
    .all(profileId)
    .map(mapImportantItem);
}

export function getImportantItem(id: string): ImportantItem | null {
  const row = db.prepare("SELECT * FROM important_items WHERE id = ? AND profile_id = ?").get(id, getActiveProfileId());
  return row ? mapImportantItem(row as Record<string, unknown>) : null;
}

export function getImportantItemDetail(id: string) {
  const profileId = getActiveProfileId();
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
       AND mail_cache.profile_id = important_items.profile_id
      WHERE important_items.id = ?
        AND important_items.profile_id = ?`
    )
    .get(id, profileId) as (Record<string, unknown> & { mail_text?: string; mail_html?: string }) | undefined;
}

export function getMailItemDetail(accountId: string, messageId: string) {
  const profileId = getActiveProfileId();
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
       AND important_items.profile_id = mail_cache.profile_id
      LEFT JOIN saved_mail_items
        ON saved_mail_items.account_id = mail_cache.account_id
       AND saved_mail_items.message_id = mail_cache.message_id
       AND saved_mail_items.profile_id = mail_cache.profile_id
      WHERE mail_cache.account_id = ?
        AND mail_cache.message_id = ?
        AND mail_cache.profile_id = ?`
    )
    .get(accountId, messageId, profileId) as (Record<string, unknown> & { mail_text?: string; mail_html?: string }) | undefined;

  if (fromCache) return fromCache;

  return db
    .prepare(
      `SELECT
        saved_mail_items.profile_id,
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
       AND important_items.profile_id = saved_mail_items.profile_id
      WHERE saved_mail_items.account_id = ?
        AND saved_mail_items.message_id = ?
        AND saved_mail_items.profile_id = ?`
    )
    .get(accountId, messageId, profileId) as (Record<string, unknown> & { mail_text?: string; mail_html?: string }) | undefined;
}

export function deleteImportantItem(id: string) {
  db.prepare("DELETE FROM important_items WHERE id = ? AND profile_id = ?").run(id, getActiveProfileId());
}

export function deleteImportantItemByMessage(accountId: string, messageId: string) {
  db.prepare("DELETE FROM important_items WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
    accountId,
    messageId,
    getActiveProfileId()
  );
}

export function isMailIgnored(accountId: string, messageId: string) {
  return Boolean(
    db
      .prepare("SELECT 1 FROM ignored_mail_items WHERE account_id = ? AND message_id = ? AND profile_id = ?")
      .get(accountId, messageId, getActiveProfileId())
  );
}

export function setMailIgnored(accountId: string, messageId: string, ignored: boolean) {
  const profileId = getActiveProfileId();
  if (ignored) {
    db.prepare(
      `INSERT INTO ignored_mail_items(id, profile_id, account_id, message_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account_id, message_id) DO UPDATE SET
         profile_id = excluded.profile_id,
         created_at = excluded.created_at`
    ).run(randomUUID(), profileId, accountId, messageId, now());
    db.prepare("DELETE FROM important_items WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
      accountId,
      messageId,
      profileId
    );
    return;
  }
  db.prepare("DELETE FROM ignored_mail_items WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
    accountId,
    messageId,
    profileId
  );
}

export function setMailSaved(accountId: string, messageId: string, saved: boolean) {
  const profileId = getActiveProfileId();
  if (saved) {
    const snapshot = getSavedMailSnapshotSource(accountId, messageId);
    db.prepare(
      `INSERT INTO saved_mail_items(
        id, profile_id, account_id, message_id, created_at, thread_id, from_email, from_name, subject, snippet,
        received_at, text, html, priority, category, summary, action_required, due_date, amount, currency
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, message_id) DO UPDATE SET
        profile_id = excluded.profile_id,
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
      profileId,
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
  db.prepare("DELETE FROM saved_mail_items WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
    accountId,
    messageId,
    profileId
  );
}

export function markMailCachedRead(accountId: string, messageId: string) {
  db.prepare("UPDATE mail_cache SET is_unread = 0 WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
    accountId,
    messageId,
    getActiveProfileId()
  );
}

export function markMailCachedUnread(accountId: string, messageId: string) {
  db.prepare("UPDATE mail_cache SET is_unread = 1 WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
    accountId,
    messageId,
    getActiveProfileId()
  );
}

export function createMailOperation(input: {
  type: MailOperation["type"];
  label: string;
  payload: { items: ReadOperationSnapshot[] };
}) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO mail_operations(id, profile_id, type, label, item_count, status, payload_json, created_at)
     VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(id, getActiveProfileId(), input.type, input.label, input.payload.items.length, JSON.stringify(input.payload), now());
  pruneMailOperations();
  return getMailOperation(id);
}

export function listMailOperations(limit = 50): MailOperation[] {
  return db
    .prepare(
      `SELECT id, type, label, item_count, status, payload_json, created_at, undone_at, error
       FROM mail_operations
       WHERE profile_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(getActiveProfileId(), Math.max(1, Math.min(50, limit)))
    .map(mapMailOperation);
}

export function getMailOperation(id: string) {
  const row = db
    .prepare(
      `SELECT id, type, label, item_count, status, payload_json, created_at, undone_at, error
       FROM mail_operations
       WHERE id = ?
         AND profile_id = ?`
    )
    .get(id, getActiveProfileId()) as Record<string, unknown> | undefined;
  return row ? mapMailOperation(row) : null;
}

export function markMailOperationUndone(id: string, error: string | null = null) {
  db.prepare("UPDATE mail_operations SET status = 'undone', undone_at = ?, error = ? WHERE id = ? AND profile_id = ?").run(
    now(),
    error,
    id,
    getActiveProfileId()
  );
  return getMailOperation(id);
}

export function getReadOperationSnapshot(accountId: string, messageId: string): ReadOperationSnapshot {
  const profileId = getActiveProfileId();
  const cached = db
    .prepare(
      `SELECT subject, from_email, from_name, is_unread
       FROM mail_cache
       WHERE account_id = ?
         AND message_id = ?
         AND profile_id = ?`
    )
    .get(accountId, messageId, profileId) as Record<string, unknown> | undefined;
  const importantItem = db
    .prepare("SELECT * FROM important_items WHERE account_id = ? AND message_id = ? AND profile_id = ?")
    .get(accountId, messageId, profileId) as Record<string, unknown> | undefined;

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
  db.prepare("UPDATE mail_cache SET text = ?, html = ? WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
    text,
    html,
    accountId,
    messageId,
    getActiveProfileId()
  );
}

function pruneMailOperations() {
  const before = new Date();
  before.setDate(before.getDate() - 90);
  db.prepare("DELETE FROM mail_operations WHERE created_at < ? AND profile_id = ?").run(
    before.toISOString(),
    getActiveProfileId()
  );
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
  const profileId = getActiveProfileId();
  db.prepare(
    `INSERT INTO important_items(
      id, profile_id, account_id, message_id, thread_id, from_email, from_name, subject, snippet,
      received_at, priority, category, summary, action_required, due_date, amount, currency,
      raw_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, message_id) DO UPDATE SET
      profile_id = excluded.profile_id,
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
    profileId,
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

function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    name: String(row.name),
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
  const profileId = row.profile_id ? String(row.profile_id) : DEFAULT_PROFILE_ID;
  return {
    id: unprofileProviderId(String(row.id), profileId),
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
  const profileId = getActiveProfileId();
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
       AND important_items.profile_id = mail_cache.profile_id
      WHERE mail_cache.account_id = ?
        AND mail_cache.message_id = ?
        AND mail_cache.profile_id = ?`
    )
    .get(accountId, messageId, profileId) as Record<string, unknown> | undefined;
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
       AND mail_cache.profile_id = saved_mail_items.profile_id
      LEFT JOIN important_items
        ON important_items.account_id = saved_mail_items.account_id
       AND important_items.message_id = saved_mail_items.message_id
       AND important_items.profile_id = saved_mail_items.profile_id`
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
        AND message_id = ?
        AND profile_id = ?`
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
      String(row.message_id),
      row.profile_id ? String(row.profile_id) : DEFAULT_PROFILE_ID
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
