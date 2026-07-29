import express from "express";
import cors from "cors";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { serverConfig } from "./config.js";
import {
  createJob,
  createMailOperation,
  createProfile,
  deleteAccount,
  deleteImportantItem,
  getActiveProfile,
  getActiveProfileId,
  getAppSettings,
  getAccount,
  getGoogleOAuthConfig,
  getImportantItem,
  getImportantItemDetail,
  getJob,
  getMailOperation,
  getReadOperationSnapshot,
  getUiState,
  insertChatTurn,
  initDefaults,
  isMailIgnored,
  listAccounts,
  listChatHistory,
  listOtherUnreadMailItems,
  listSavedMailItems,
  listImportantItems,
  listInvoices,
  listMailOperations,
  listProfiles,
  markMailCachedRead,
  markMailCachedUnread,
  markMailOperationUndone,
  restoreReadOperationSnapshot,
  updateMailCacheBodies,
  listProviders,
  cleanupInvoiceIndex,
  deleteImportantItemByMessage,
  getMailItemDetail,
  setMailIgnored,
  setMailSaved,
  setActiveProfile,
  updateAppSettings,
  updateGoogleOAuthConfig,
  updateUiState,
  upsertAccount,
  upsertImapAccount,
  upsertProvider
} from "./db.js";
import { exchangeCode, getAuthUrl } from "./gmail.js";
import {
  downloadAccountAttachment,
  getAccountParsedMessage,
  isAccountMessageUnread,
  markAccountMessageRead,
  markAccountMessageUnread,
  testImapAccount
} from "./mailSource.js";
import { runInvoiceBackfill } from "./invoiceScanner.js";
import { getChatContext, runImportantMailSync } from "./mailCopilot.js";
import { chatWithMailbox, getClassifierStatus, getLlmStatus } from "./llm.js";
import type { ReadOperationSnapshot } from "./types.js";

initDefaults();

const app = express();
app.use(cors({ origin: serverConfig.appOrigin }));
app.use(express.json({ limit: "2mb" }));
if (serverConfig.staticDir) app.use(express.static(serverConfig.staticDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/bootstrap", (_req, res) => {
  res.json(bootstrapPayload());
});

app.get("/api/profiles", (_req, res) => {
  res.json({
    profiles: listProfiles(),
    activeProfileId: getActiveProfileId()
  });
});

app.post("/api/profiles", (req, res) => {
  const name = String(req.body?.name || "").trim();
  createProfile(name);
  res.json(bootstrapPayload());
});

app.post("/api/profiles/active", (req, res) => {
  try {
    setActiveProfile(String(req.body?.id || ""));
    res.json(bootstrapPayload());
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/settings", (_req, res) => {
  res.json(safeSettings());
});

app.get("/api/ui-state", (_req, res) => {
  res.json(getUiState());
});

app.post("/api/ui-state", (req, res) => {
  const body = req.body || {};
  res.json(
    updateUiState({
      selectedCategory: typeof body.selectedCategory === "string" ? body.selectedCategory : undefined,
      selectedAccountId: body.selectedAccountId === null ? "" : typeof body.selectedAccountId === "string" ? body.selectedAccountId : undefined,
      selectedMessageId: body.selectedMessageId === null ? "" : typeof body.selectedMessageId === "string" ? body.selectedMessageId : undefined
    })
  );
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  const current = getAppSettings();
  const currentGoogleConfig = getGoogleOAuthConfig();
  const googleClientId = String(body.googleClientId || "").trim();
  const googleClientSecret =
    body.googleClientSecret === "configured"
      ? currentGoogleConfig.googleClientSecret
      : String(body.googleClientSecret || "").trim();
  const googleRedirectUri = String(body.googleRedirectUri || "").trim();

  if (googleClientSecret.startsWith("sk-")) {
    return res.status(400).json({
      error:
        "Pole Google Client Secret wygląda jak klucz OpenAI (sk-...). Wklej tutaj sekret klienta OAuth z Google Cloud, a token OpenAI wpisz w polu OpenAI API token."
    });
  }

  const settings = updateAppSettings({
    archiveDir: String(body.archiveDir || ""),
    historyYears: Number(body.historyYears || 4),
    language: body.language === "en" ? "en" : "pl",
    themeMode: body.themeMode,
    autoSyncEnabled: body.autoSyncEnabled === true || body.autoSyncEnabled === "true" || body.autoSyncEnabled === 1,
    autoSyncMinutes: Number(body.autoSyncMinutes || 30),
    llmBaseUrl: String(body.llmBaseUrl || ""),
    llmApiKey: body.llmApiKey === "configured" ? current.llmApiKey : String(body.llmApiKey || ""),
    llmModel: String(body.llmModel || "gpt-4.1-mini"),
    classifierMode: body.classifierMode,
    classifierBaseUrl: String(body.classifierBaseUrl || ""),
    classifierApiKey:
      body.classifierApiKey === "configured" ? current.classifierApiKey : String(body.classifierApiKey || ""),
    classifierModel: String(body.classifierModel || ""),
    classifierTimeoutMs: Number(body.classifierTimeoutMs || 2500),
    importantSenders: String(body.importantSenders || "")
      .split(/\n|,/)
      .map(item => item.trim())
      .filter(Boolean),
    importantCategories: String(body.importantCategories || "")
      .split(/\n|,/)
      .map(item => item.trim())
      .filter(Boolean),
    senderCategoryRules: parseSenderCategoryRules(String(body.senderCategoryRules || "")),
    categoryRules: Array.isArray(body.categoryRules) ? body.categoryRules.map(parseCategoryRuleInput).filter(Boolean) : undefined
  });
  const storedConfig = updateGoogleOAuthConfig({
    googleClientId,
    googleClientSecret,
    googleRedirectUri
  });
  res.json({
    ...settings,
    googleClientId: storedConfig.googleClientId,
    googleClientSecret: storedConfig.googleClientSecret ? "configured" : "",
    googleRedirectUri: storedConfig.googleRedirectUri,
    llmApiKey: settings.llmApiKey ? "configured" : "",
    classifierApiKey: settings.classifierApiKey ? "configured" : ""
  });
});

app.get("/api/accounts", (_req, res) => {
  res.json(publicAccounts());
});

app.post("/api/accounts/imap", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const host = String(req.body?.host || "imap.gmail.com").trim();
  const port = Number(req.body?.port || 993);
  const secure = req.body?.secure !== false;
  const password = String(req.body?.password || "");

  if (!email) return res.status(400).json({ error: "Podaj adres e-mail konta Gmail." });
  if (!password) return res.status(400).json({ error: "Podaj hasło aplikacji Gmail dla IMAP." });
  if (!host) return res.status(400).json({ error: "Podaj host IMAP." });

  try {
    const config = {
      host,
      port: Number.isFinite(port) ? port : 993,
      secure,
      user: email,
      password
    };
    const verified = await testImapAccount(config);
    upsertImapAccount({
      id: randomUUID(),
      email,
      config: {
        ...config,
        mailbox: verified.mailbox
      }
    });
    res.json(publicAccounts());
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api/accounts/:id", (req, res) => {
  deleteAccount(req.params.id);
  res.json(publicAccounts());
});

app.get("/api/auth/google/start", (_req, res) => {
  try {
    const url = getAuthUrl(randomUUID());
    res.redirect(url);
  } catch (error) {
    res.status(400).send(error instanceof Error ? error.message : String(error));
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  try {
    const code = String(req.query.code || "");
    if (!code) throw new Error("Brakuje parametru code z Google OAuth");
    const result = await exchangeCode(code);
    upsertAccount({
      id: randomUUID(),
      email: result.email,
      tokensJson: JSON.stringify(result.tokens),
      historyId: null
    });
    res.send(`<!doctype html><html><body><script>location.href='${serverConfig.appOrigin}/?connected=1'</script>Połączono konto Gmail.</body></html>`);
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : String(error));
  }
});

app.get("/api/providers", (_req, res) => {
  res.json(listProviders());
});

app.post("/api/providers", (req, res) => {
  upsertProvider(req.body);
  res.json(listProviders());
});

app.post("/api/scan/invoices", (req, res) => {
  const job = createJob("invoice-backfill");
  void runInvoiceBackfill(job.id, {
    years: Number(req.body?.years || getAppSettings().historyYears),
    accountId: req.body?.accountId || null
  });
  res.json(job);
});

app.post("/api/scan/important", (req, res) => {
  const job = createJob("important-mail-sync");
  void runImportantMailSync(job.id, { days: Number(req.body?.days || 7) });
  res.json(job);
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Nie znaleziono zadania" });
  res.json(job);
});

app.get("/api/invoices", (_req, res) => {
  res.json(listInvoices());
});

app.post("/api/invoices/cleanup", (req, res) => {
  const result = cleanupInvoiceIndex({
    removeMissingFiles: req.body?.removeMissingFiles !== false,
    removeDuplicateRows: req.body?.removeDuplicateRows !== false
  });
  res.json({ result, invoices: listInvoices() });
});

app.get("/api/important", (_req, res) => {
  res.json(listImportantItems());
});

app.get("/api/mail-feed", (_req, res) => {
  res.json({
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems(),
    operations: listMailOperations()
  });
});

app.get("/api/important/:id", (req, res) => {
  const row = getImportantItemDetail(req.params.id);
  if (!row) return res.status(404).json({ error: "Nie znaleziono ważnego maila" });
  const item = {
    id: String(row.id),
    accountId: String(row.account_id),
    messageId: String(row.message_id),
    threadId: String(row.thread_id),
    fromEmail: String(row.from_email),
    fromName: String(row.from_name),
    subject: String(row.subject),
    snippet: String(row.snippet),
    receivedAt: String(row.received_at),
    priority: String(row.priority),
    category: String(row.category),
    summary: String(row.summary),
    actionRequired: String(row.action_required),
    dueDate: row.due_date ? String(row.due_date) : null,
    amount: row.amount ? String(row.amount) : null,
    currency: row.currency ? String(row.currency) : null,
    text: row.mail_text ? String(row.mail_text) : "",
    html: row.mail_html ? String(row.mail_html) : ""
  };
  res.json(item);
});

app.get("/api/mail/detail", async (req, res) => {
  const accountId = String(req.query.accountId || "");
  const messageId = String(req.query.messageId || "");
  if (!accountId || !messageId) return res.status(400).json({ error: "Brakuje accountId albo messageId" });
  let row = getMailItemDetail(accountId, messageId);
  if (!row) return res.status(404).json({ error: "Nie znaleziono maila" });
  let attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];

  const account = getAccount(accountId);
  if (account) {
    try {
      const message = await getAccountParsedMessage(account, messageId);
      attachments = message.attachments.map(attachment => ({
        attachmentId: attachment.attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size
      }));
      if (!row.mail_html) {
        updateMailCacheBodies(accountId, messageId, message.text || message.snippet || "", message.html || "");
        row = getMailItemDetail(accountId, messageId) || row;
      }
    } catch {
      // Fall back to cached preview if the mailbox refresh fails.
    }
  }

  res.json({
    id: `${accountId}:${messageId}`,
    accountId: String(row.account_id),
    messageId: String(row.message_id),
    threadId: String(row.thread_id),
    fromEmail: String(row.from_email),
    fromName: String(row.from_name),
    subject: String(row.subject),
    snippet: String(row.snippet),
    receivedAt: String(row.received_at),
    priority: String(row.priority),
    category: String(row.category),
    summary: String(row.summary),
    actionRequired: String(row.action_required),
    dueDate: row.due_date ? String(row.due_date) : null,
    amount: row.amount ? String(row.amount) : null,
    currency: row.currency ? String(row.currency) : null,
    saved: Boolean(row.saved),
    ignored: isMailIgnored(accountId, messageId),
    text: row.mail_text ? String(row.mail_text) : "",
    html: row.mail_html ? String(row.mail_html) : "",
    attachments
  });
});

app.get("/api/mail/attachment", async (req, res) => {
  const accountId = String(req.query.accountId || "");
  const messageId = String(req.query.messageId || "");
  const attachmentId = String(req.query.attachmentId || "");
  const filename = String(req.query.filename || "").trim() || "attachment";
  const mimeType = String(req.query.mimeType || "").trim() || "application/octet-stream";
  const download = String(req.query.download || "") === "1";

  if (!accountId || !messageId || !attachmentId) {
    return res.status(400).json({ error: "Brakuje accountId, messageId albo attachmentId" });
  }

  const account = getAccount(accountId);
  if (!account) return res.status(404).json({ error: "Nie znaleziono konta pocztowego" });

  try {
    const buffer = await downloadAccountAttachment(account, messageId, attachmentId);
    const disposition = download ? "attachment" : "inline";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/important/:id/read", async (req, res) => {
  const item = getImportantItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Nie znaleziono ważnego maila" });

  let gmailMarkedRead = false;
  let gmailError: string | null = null;
  const account = getAccount(item.accountId);
  if (account) {
    try {
      await markAccountMessageRead(account, item.messageId);
      gmailMarkedRead = true;
    } catch (error) {
      gmailError = error instanceof Error ? error.message : String(error);
    }
  }

  deleteImportantItem(item.id);
  res.json({
    ok: true,
    gmailMarkedRead,
    gmailError,
    importantItems: listImportantItems()
  });
});

app.post("/api/mail/read", async (req, res) => {
  const accountId = String(req.body?.accountId || "");
  const messageId = String(req.body?.messageId || "");
  if (!accountId || !messageId) return res.status(400).json({ error: "Brakuje accountId albo messageId" });

  const snapshot = getReadOperationSnapshot(accountId, messageId);
  let gmailMarkedRead = false;
  let gmailError: string | null = null;
  const account = getAccount(accountId);
  if (account) {
    try {
      await markAccountMessageRead(account, messageId);
      gmailMarkedRead = true;
    } catch (error) {
      gmailError = error instanceof Error ? error.message : String(error);
    }
  }

  markMailCachedRead(accountId, messageId);
  deleteImportantItemByMessage(accountId, messageId);
  const operation = createMailOperation({
    type: "mark-read",
    label: `Oznaczono jako przeczytane: ${snapshot.subject}`,
    payload: { items: [snapshot] }
  });
  res.json({
    ok: true,
    gmailMarkedRead,
    gmailError,
    operation,
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems(),
    operations: listMailOperations()
  });
});

app.post("/api/mail/read-visible", async (req, res) => {
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
  const seen = new Set<string>();
  const items: Array<{ accountId: string; messageId: string }> = rawItems
    .map((item: Record<string, unknown>) => ({
      accountId: String(item?.accountId || ""),
      messageId: String(item?.messageId || "")
    }))
    .filter((item: { accountId: string; messageId: string }) => item.accountId && item.messageId)
    .filter((item: { accountId: string; messageId: string }) => {
      const key = `${item.accountId}:${item.messageId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);

  if (items.length === 0) return res.status(400).json({ error: "Brakuje widocznych maili do oznaczenia." });

  const errors: string[] = [];
  let remoteMarkedRead = 0;
  const snapshots = items.map(item => getReadOperationSnapshot(item.accountId, item.messageId));

  for (const item of items) {
    const account = getAccount(item.accountId);
    if (account) {
      try {
        await markAccountMessageRead(account, item.messageId);
        remoteMarkedRead += 1;
      } catch (error) {
        errors.push(`${account.email}: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      errors.push(`${item.accountId}: nie znaleziono konta pocztowego`);
    }

    markMailCachedRead(item.accountId, item.messageId);
    deleteImportantItemByMessage(item.accountId, item.messageId);
  }

  const operation = createMailOperation({
    type: "mark-visible-read",
    label: `Oznaczono ${items.length} widocznych maili jako przeczytane`,
    payload: { items: snapshots }
  });

  res.json({
    ok: errors.length === 0,
    markedRead: items.length,
    remoteMarkedRead,
    errors,
    operation,
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems(),
    operations: listMailOperations()
  });
});

app.post("/api/operations/:id/undo", async (req, res) => {
  const operation = getMailOperation(req.params.id);
  if (!operation) return res.status(404).json({ error: "Nie znaleziono operacji" });
  if (operation.status === "undone") {
    return res.json({
      ok: true,
      alreadyUndone: true,
      importantItems: listImportantItems(),
      otherUnreadItems: listOtherUnreadMailItems(),
      savedMailItems: listSavedMailItems(),
      operations: listMailOperations()
    });
  }
  if (operation.type !== "mark-read" && operation.type !== "mark-visible-read") {
    return res.status(400).json({ error: "Tej operacji nie da się jeszcze cofnąć." });
  }

  const payload = parseReadOperationPayload(operation.payloadJson);
  const errors: string[] = [];
  let remoteMarkedUnread = 0;

  for (const snapshot of payload.items) {
    if (snapshot.wasUnread) {
      const account = getAccount(snapshot.accountId);
      if (account) {
        try {
          await markAccountMessageUnread(account, snapshot.messageId);
          remoteMarkedUnread += 1;
        } catch (error) {
          errors.push(`${account.email}: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        errors.push(`${snapshot.accountId}: nie znaleziono konta pocztowego`);
      }
    }

    restoreReadOperationSnapshot(snapshot);
  }

  markMailOperationUndone(operation.id, errors.length ? errors.join("; ") : null);
  res.json({
    ok: errors.length === 0,
    restored: payload.items.length,
    remoteMarkedUnread,
    errors,
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems(),
    operations: listMailOperations()
  });
});

app.post("/api/mail/save", async (req, res) => {
  const accountId = String(req.body?.accountId || "");
  const messageId = String(req.body?.messageId || "");
  const saved = Boolean(req.body?.saved);
  if (!accountId || !messageId) return res.status(400).json({ error: "Brakuje accountId albo messageId" });

  let currentUnread: boolean | null = null;
  let gmailError: string | null = null;

  if (!saved) {
    const account = getAccount(accountId);
    if (account) {
      try {
        currentUnread = await isAccountMessageUnread(account, messageId);
      } catch (error) {
        gmailError = error instanceof Error ? error.message : String(error);
      }
    }

    if (currentUnread === false) {
      markMailCachedRead(accountId, messageId);
      deleteImportantItemByMessage(accountId, messageId);
    } else if (currentUnread === true) {
      markMailCachedUnread(accountId, messageId);
    }
  }

  setMailSaved(accountId, messageId, saved);
  res.json({
    ok: true,
    currentUnread,
    gmailError,
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems()
  });
});

app.post("/api/mail/ignore", (req, res) => {
  const accountId = String(req.body?.accountId || "");
  const messageId = String(req.body?.messageId || "");
  const ignored = req.body?.ignored !== false;
  if (!accountId || !messageId) return res.status(400).json({ error: "Brakuje accountId albo messageId" });

  setMailIgnored(accountId, messageId, ignored);
  res.json({
    ok: true,
    ignored,
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems()
  });
});

app.get("/api/llm/status", async (_req, res) => {
  try {
    res.json(await getLlmStatus());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/classifier/status", async (_req, res) => {
  try {
    res.json(await getClassifierStatus());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/chat/history", (_req, res) => {
  res.json(listChatHistory());
});

app.post("/api/chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question) return res.status(400).json({ error: "Wpisz pytanie do czatu." });
    const previousChat = listChatHistory({ limit: 6, days: 7 }).map(turn => ({
      question: turn.question,
      answer: turn.answer,
      createdAt: turn.createdAt
    }));
    const context = {
      ...getChatContext(question),
      previousChat
    };
    const answer = await chatWithMailbox({ question, context });
    const turn = insertChatTurn({
      question,
      answer,
      contextJson: JSON.stringify(context)
    });
    res.json({ answer, context, turn, chatHistory: listChatHistory() });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

if (serverConfig.staticDir) {
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(serverConfig.staticDir, "index.html"));
  });
}

let httpServer: Server | null = null;

export function startServer() {
  if (httpServer) return httpServer;
  httpServer = app.listen(serverConfig.port, "127.0.0.1", () => {
    console.log(`Invoice Archivist API: http://127.0.0.1:${serverConfig.port}`);
    startAutomaticImportantSync();
  });
  return httpServer;
}

function isMainModule() {
  return process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
}

if (isMainModule()) startServer();

function bootstrapPayload() {
  return {
    profiles: listProfiles(),
    activeProfile: getActiveProfile(),
    activeProfileId: getActiveProfileId(),
    settings: safeSettings(),
    uiState: getUiState(),
    accounts: publicAccounts(),
    providers: listProviders(),
    invoices: listInvoices(),
    importantItems: listImportantItems(),
    otherUnreadItems: listOtherUnreadMailItems(),
    savedMailItems: listSavedMailItems(),
    chatHistory: listChatHistory(),
    operations: listMailOperations()
  };
}

function safeSettings() {
  const settings = getAppSettings();
  const storedConfig = getGoogleOAuthConfig();
  return {
    ...settings,
    googleClientId: storedConfig.googleClientId,
    googleClientSecret: storedConfig.googleClientSecret ? "configured" : "",
    googleRedirectUri: storedConfig.googleRedirectUri,
    llmApiKey: settings.llmApiKey ? "configured" : "",
    classifierApiKey: settings.classifierApiKey ? "configured" : "",
    importantSenders: settings.importantSenders.join("\n"),
    importantCategories: settings.importantCategories.join("\n"),
    senderCategoryRules: settings.senderCategoryRules.map(rule => `${rule.sender} => ${rule.category}`).join("\n"),
    categoryRules: settings.categoryRules
  };
}

function parseSenderCategoryRules(input: string) {
  return input
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const separator = line.includes("=>") ? "=>" : line.includes("=") ? "=" : line.includes(":") ? ":" : null;
      if (!separator) return null;
      const [sender, category] = line.split(separator, 2).map(part => part.trim());
      if (!sender || !category) return null;
      return { sender, category };
    })
    .filter(Boolean) as Array<{ sender: string; category: string }>;
}

function parseCategoryRuleInput(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const category = String(row.category || "").trim();
  const priority = String(row.priority || "medium").trim() === "high" ? "high" : "medium";
  const senderTerms = Array.isArray(row.senderTerms) ? row.senderTerms.map(term => String(term).trim()).filter(Boolean) : [];
  const keywordTerms = Array.isArray(row.keywordTerms) ? row.keywordTerms.map(term => String(term).trim()).filter(Boolean) : [];
  if (!category || (senderTerms.length === 0 && keywordTerms.length === 0)) return null;
  return {
    id: String(row.id || "").trim() || randomUUID(),
    category,
    priority,
    actionRequired: String(row.actionRequired || "").trim(),
    senderTerms,
    keywordTerms
  };
}

function parseReadOperationPayload(payloadJson: string): { items: ReadOperationSnapshot[] } {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return {
      items: items
        .map(item => normalizeReadOperationSnapshot(item))
        .filter((item): item is ReadOperationSnapshot => Boolean(item))
    };
  } catch {
    return { items: [] };
  }
}

function normalizeReadOperationSnapshot(input: unknown): ReadOperationSnapshot | null {
  if (!input || typeof input !== "object") return null;
  const row = input as Record<string, unknown>;
  const accountId = String(row.accountId || "");
  const messageId = String(row.messageId || "");
  if (!accountId || !messageId) return null;
  return {
    accountId,
    messageId,
    subject: String(row.subject || messageId),
    fromEmail: String(row.fromEmail || ""),
    fromName: String(row.fromName || ""),
    wasUnread: row.wasUnread !== false,
    importantItem:
      row.importantItem && typeof row.importantItem === "object"
        ? (row.importantItem as Record<string, unknown>)
        : null
  };
}

function publicAccounts() {
  return listAccounts().map(account => ({
    id: account.id,
    email: account.email,
    authType: account.authType,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }));
}

let autoImportantSyncStartedAt = 0;
let autoImportantSyncRunning = false;

function startAutomaticImportantSync() {
  const tick = () => {
    void maybeRunAutomaticImportantSync();
  };
  tick();
  setInterval(tick, 60 * 1000);
}

async function maybeRunAutomaticImportantSync() {
  const settings = getAppSettings();
  if (!settings.autoSyncEnabled) return;
  if (publicAccounts().length === 0) return;
  if (autoImportantSyncRunning) return;

  const minIntervalMs = settings.autoSyncMinutes * 60 * 1000;
  if (Date.now() - autoImportantSyncStartedAt < minIntervalMs) return;

  autoImportantSyncRunning = true;
  autoImportantSyncStartedAt = Date.now();
  const importantJob = createJob("scheduled-important-mail-sync");
  try {
    await runImportantMailSync(importantJob.id, { days: 2 });
  } finally {
    autoImportantSyncRunning = false;
  }
}
