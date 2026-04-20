import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { serverConfig } from "./config.js";
import {
  createJob,
  deleteAccount,
  getAppSettings,
  getJob,
  initDefaults,
  listAccounts,
  listImportantItems,
  listInvoices,
  listProviders,
  cleanupInvoiceIndex,
  updateAppSettings,
  upsertAccount,
  upsertProvider
} from "./db.js";
import { exchangeCode, getAuthUrl } from "./gmail.js";
import { runInvoiceBackfill } from "./invoiceScanner.js";
import { getChatContext, runImportantMailSync } from "./mailCopilot.js";
import { chatWithMailbox, getClassifierStatus, getLlmStatus } from "./llm.js";

initDefaults();

const app = express();
app.use(cors({ origin: serverConfig.appOrigin }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/bootstrap", (_req, res) => {
  res.json({
    settings: safeSettings(),
    accounts: publicAccounts(),
    providers: listProviders(),
    invoices: listInvoices(),
    importantItems: listImportantItems()
  });
});

app.get("/api/settings", (_req, res) => {
  res.json(safeSettings());
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  const current = getAppSettings();
  const settings = updateAppSettings({
    archiveDir: String(body.archiveDir || ""),
    historyYears: Number(body.historyYears || 4),
    llmBaseUrl: String(body.llmBaseUrl || ""),
    llmApiKey: body.llmApiKey === "configured" ? current.llmApiKey : String(body.llmApiKey || ""),
    llmModel: String(body.llmModel || "gpt-oss-20b"),
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
      .filter(Boolean)
  });
  res.json({ ...settings, llmApiKey: settings.llmApiKey ? "configured" : "" });
});

app.get("/api/accounts", (_req, res) => {
  res.json(publicAccounts());
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

app.post("/api/chat", async (req, res) => {
  try {
    const question = String(req.body?.question || "");
    const context = getChatContext(question);
    const answer = await chatWithMailbox({ question, context });
    res.json({ answer, context });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.listen(serverConfig.port, "127.0.0.1", () => {
  console.log(`Invoice Archivist API: http://127.0.0.1:${serverConfig.port}`);
  startHourlyQuietSync();
});

function safeSettings() {
  const settings = getAppSettings();
  return {
    ...settings,
    llmApiKey: settings.llmApiKey ? "configured" : "",
    classifierApiKey: settings.classifierApiKey ? "configured" : "",
    importantSenders: settings.importantSenders.join("\n"),
    importantCategories: settings.importantCategories.join("\n")
  };
}

function publicAccounts() {
  return listAccounts().map(account => ({
    id: account.id,
    email: account.email,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt
  }));
}

function startHourlyQuietSync() {
  setInterval(() => {
    const settings = getAppSettings();
    if (publicAccounts().length === 0) return;

    const importantJob = createJob("scheduled-important-mail-sync");
    void runImportantMailSync(importantJob.id, { days: 2 });

    if (settings.archiveDir) {
      const invoiceJob = createJob("scheduled-invoice-recent-sync");
      void runInvoiceBackfill(invoiceJob.id, { days: 14 });
    }
  }, 60 * 60 * 1000);
}
