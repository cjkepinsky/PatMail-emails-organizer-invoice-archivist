import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { db, getAppSettings, listAccounts, listProviders, updateJob } from "./db.js";
import {
  downloadAttachment,
  getParsedMessage,
  gmailForAccount,
  listMessageIds,
  messageDate,
  parseFromHeader
} from "./gmail.js";
import { extractInvoiceInfo, extractPdfText, invoiceMonth } from "./invoiceParser.js";
import { sanitizeFilename, sanitizePathSegment, uniqueFilePath } from "./storage.js";
import type { GmailAccount, ProviderRule } from "./types.js";

type ScanProgress = {
  message: string;
  account?: string;
  provider?: string;
  scannedMessages: number;
  savedInvoices: number;
  skippedDuplicates: number;
  skippedSenderMismatch: number;
  skippedNonInvoices: number;
  errors: number;
};

const invoiceKeywords = [
  "invoice",
  "receipt",
  "faktura",
  "rachunek",
  "billing",
  "payment",
  "subscription"
];

const genericProviderTerms = new Set([
  ...invoiceKeywords,
  "paid",
  "payment method",
  "amount",
  "total",
  "license",
  "subscription"
]);

const sharedBillingDomains = new Set(["stripe.com", "paddle.com", "paypal.com"]);

export async function runInvoiceBackfill(
  jobId: string,
  options: { years?: number; days?: number; accountId?: string | null }
) {
  const startedAt = new Date().toISOString();
  const settings = getAppSettings();
  const years = Math.max(1, Math.min(10, Number(options.years || settings.historyYears || 4)));
  const archiveDir = settings.archiveDir;

  if (!archiveDir) {
    updateJob(jobId, {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: "Ustaw najpierw główny folder archiwum faktur."
    });
    return;
  }

  const accounts = listAccounts().filter(account => !options.accountId || account.id === options.accountId);
  const providers = listProviders().filter(provider => provider.enabled);
  const after = new Date();
  if (options.days) {
    after.setDate(after.getDate() - Math.max(1, Math.min(90, Number(options.days))));
  } else {
    after.setFullYear(after.getFullYear() - years);
  }
  const afterQuery = formatGmailDate(after);

  const progress: ScanProgress = {
    message: "Start skanowania historycznego",
    scannedMessages: 0,
    savedInvoices: 0,
    skippedDuplicates: 0,
    skippedSenderMismatch: 0,
    skippedNonInvoices: 0,
    errors: 0
  };

  updateJob(jobId, { status: "running", startedAt, progress });

  try {
    for (const account of accounts) {
      const gmail = gmailForAccount(account);
      const seenMessages = new Map<string, ProviderRule>();

      for (const provider of providers) {
        progress.account = account.email;
        progress.provider = provider.name;
        progress.message = `Szukam wiadomości dla ${provider.name}`;
        updateJob(jobId, { progress });

        const query = buildProviderQuery(provider, afterQuery);
        const ids = await listMessageIds(gmail, query, count => {
          progress.message = `Znaleziono ${count} wiadomości dla ${provider.name}`;
          updateJob(jobId, { progress });
        });

        for (const id of ids) {
          if (!seenMessages.has(id)) seenMessages.set(id, provider);
        }
      }

      for (const [messageId, provider] of seenMessages) {
        try {
          progress.account = account.email;
          progress.provider = provider.name;
          progress.message = `Przetwarzam ${messageId}`;
          updateJob(jobId, { progress });
          await processMessage(account, messageId, provider, archiveDir, progress);
        } catch (error) {
          progress.errors += 1;
          progress.message = error instanceof Error ? error.message : "Błąd przetwarzania wiadomości";
          updateJob(jobId, { progress });
        }
      }
    }

    progress.message = "Skanowanie zakończone";
    updateJob(jobId, {
      status: "done",
      finishedAt: new Date().toISOString(),
      progress
    });
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      progress
    });
  }
}

async function processMessage(
  account: GmailAccount,
  messageId: string,
  provider: ProviderRule,
  archiveDir: string,
  progress: ScanProgress
) {
  const gmail = gmailForAccount(account);
  const message = await getParsedMessage(gmail, messageId);
  if (!messageMatchesProvider(message, provider)) {
    progress.skippedSenderMismatch += 1;
    return;
  }

  const pdfAttachments = message.attachments.filter(
    attachment =>
      attachment.filename.toLowerCase().endsWith(".pdf") ||
      attachment.mimeType.toLowerCase().includes("pdf")
  );

  progress.scannedMessages += 1;

  for (const attachment of pdfAttachments) {
    const already = db
      .prepare(
        "SELECT id FROM processed_attachments WHERE account_id = ? AND message_id = ? AND attachment_id = ?"
      )
      .get(account.id, messageId, attachment.attachmentId);
    if (already) {
      progress.skippedDuplicates += 1;
      continue;
    }

    const buffer = await downloadAttachment(gmail, messageId, attachment.attachmentId);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicateByHash = db.prepare("SELECT file_path FROM processed_attachments WHERE sha256 = ?").get(sha256);
    if (duplicateByHash) {
      insertProcessed({
        accountId: account.id,
        messageId,
        attachmentId: attachment.attachmentId,
        providerDomain: provider.targetDomain,
        sha256,
        filePath: String((duplicateByHash as { file_path: string }).file_path),
        invoiceMonth: "duplicate",
        invoiceDate: null,
        dueDate: null,
        amount: null,
        currency: null,
        invoiceNumber: null,
        dateSource: "email_sent_date",
        originalFilename: attachment.filename,
        status: "duplicate",
        error: null
      });
      progress.skippedDuplicates += 1;
      continue;
    }

    const pdfText = await extractPdfText(buffer);
    if (!isLikelyInvoiceAttachment(attachment.filename, pdfText, message.text, provider)) {
      progress.skippedNonInvoices += 1;
      continue;
    }

    const sentDate = messageDate(message);
    const receivedDate = message.internalDate ? new Date(Number(message.internalDate)) : sentDate;
    const info = extractInvoiceInfo({
      text: `${pdfText}\n\n${message.text}`,
      emailSentDate: sentDate,
      gmailReceivedDate: receivedDate
    });
    const month = invoiceMonth(info.invoiceDate);
    const domainFolder = sanitizePathSegment(provider.targetDomain);
    const directory = path.join(archiveDir, domainFolder);
    const originalBase = sanitizeFilename(path.parse(attachment.filename).name || provider.id);
    const invoiceNumber = info.invoiceNumber ? sanitizeFilename(info.invoiceNumber) : "";
    const filename = sanitizeFilename(
      `${month}_${provider.targetDomain}_${invoiceNumber || originalBase}.pdf`
    );
    const filePath = await uniqueFilePath(directory, filename);
    await fs.writeFile(filePath, buffer);

    insertProcessed({
      accountId: account.id,
      messageId,
      attachmentId: attachment.attachmentId,
      providerDomain: provider.targetDomain,
      sha256,
      filePath,
      invoiceMonth: month,
      invoiceDate: info.invoiceDate,
      dueDate: info.dueDate,
      amount: info.amount,
      currency: info.currency,
      invoiceNumber: info.invoiceNumber,
      dateSource: info.dateSource,
      originalFilename: attachment.filename,
      status: "saved",
      error: null
    });
    progress.savedInvoices += 1;
  }
}

function insertProcessed(input: {
  accountId: string;
  messageId: string;
  attachmentId: string;
  providerDomain: string;
  sha256: string;
  filePath: string;
  invoiceMonth: string;
  invoiceDate: string | null;
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  invoiceNumber: string | null;
  dateSource: string;
  originalFilename: string;
  status: string;
  error: string | null;
}) {
  db.prepare(`
    INSERT OR IGNORE INTO processed_attachments(
      id, account_id, message_id, attachment_id, provider_domain, sha256, file_path,
      invoice_month, invoice_date, due_date, amount, currency, invoice_number,
      date_source, original_filename, status, error, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    input.accountId,
    input.messageId,
    input.attachmentId,
    input.providerDomain,
    input.sha256,
    input.filePath,
    input.invoiceMonth,
    input.invoiceDate,
    input.dueDate,
    input.amount,
    input.currency,
    input.invoiceNumber,
    input.dateSource,
    input.originalFilename,
    input.status,
    input.error,
    new Date().toISOString()
  );
}

function buildProviderQuery(provider: ProviderRule, afterQuery: string) {
  const senderTerms = [...provider.senderDomains, ...provider.senderEmails]
    .map(term => term.trim())
    .filter(Boolean)
    .map(term => `from:${sanitizeGmailTerm(term)}`);
  const brandTerms = providerBrandTerms(provider).map(term => `"${sanitizeGmailTerm(term)}"`);
  const providerTerms = provider.senderOnly
    ? senderTerms
    : [...senderTerms, ...brandTerms];
  const providerGroup = providerTerms.join(" OR ");
  const invoiceGroup = invoiceKeywords.join(" OR ");

  if (!providerGroup) {
    return `after:${afterQuery} has:attachment (${invoiceGroup})`;
  }

  return `after:${afterQuery} has:attachment (${providerGroup}) (${invoiceGroup})`;
}

function messageMatchesProvider(message: Awaited<ReturnType<typeof getParsedMessage>>, provider: ProviderRule) {
  const from = parseFromHeader(message.headers.from || "");
  const senderMatch = senderMatchesProvider(from.email, provider);
  if (senderMatch.direct) return true;

  const brandTerms = providerBrandTerms(provider);
  const hasBrand = includesAny(
    `${from.name} ${from.email} ${message.headers.subject || ""} ${message.snippet} ${message.text}`,
    brandTerms
  );

  if (senderMatch.sharedBilling) return hasBrand;
  if (provider.senderOnly) return false;
  return hasBrand;
}

function senderMatchesProvider(email: string, provider: ProviderRule) {
  const normalizedEmail = normalizeMatchValue(email);
  const emailMatch = provider.senderEmails
    .map(normalizeMatchValue)
    .filter(Boolean)
    .some(term => normalizedEmail.includes(term));

  if (emailMatch) return { direct: true, sharedBilling: false };

  let direct = false;
  let sharedBilling = false;
  for (const domain of provider.senderDomains.map(normalizeMatchValue).filter(Boolean)) {
    if (!normalizedEmail.includes(domain)) continue;
    if (sharedBillingDomains.has(domain)) sharedBilling = true;
    else direct = true;
  }

  return { direct, sharedBilling };
}

function isLikelyInvoiceAttachment(
  filename: string,
  pdfText: string,
  messageText: string,
  provider: ProviderRule
) {
  const text = `${filename} ${pdfText} ${messageText}`;
  const hasInvoiceCue = includesAny(text, invoiceKeywords);
  if (!hasInvoiceCue) return false;

  const brandTerms = providerBrandTerms(provider);
  return brandTerms.length === 0 || includesAny(text, brandTerms);
}

function providerBrandTerms(provider: ProviderRule) {
  return provider.searchTerms
    .map(term => term.trim())
    .filter(term => term && !genericProviderTerms.has(term.toLowerCase()));
}

function includesAny(text: string, terms: string[]) {
  const normalizedText = normalizeMatchValue(text);
  return terms.map(normalizeMatchValue).filter(Boolean).some(term => normalizedText.includes(term));
}

function normalizeMatchValue(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function sanitizeGmailTerm(term: string) {
  return term.replaceAll('"', "").trim();
}

function formatGmailDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}
