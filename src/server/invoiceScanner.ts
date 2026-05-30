import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { db, getAppSettings, listAccounts, listProviders, updateJob } from "./db.js";
import { messageDate, parseFromHeader, type ParsedGmailMessage } from "./gmail.js";
import { downloadAccountAttachment, getAccountParsedMessage, listAccountMessageIds } from "./mailSource.js";
import { renderEmailPdf } from "./emailPdf.js";
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
  warning?: string;
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

const emailBodyInvoiceKeywords = ["invoice", "receipt", "faktura", "rachunek"];

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
    const accountWarnings: string[] = [];
    let scannedAccounts = 0;

    for (const account of accounts) {
      try {
        const candidates: { messageId: string; provider: ProviderRule }[] = [];
        const seenCandidates = new Set<string>();

        for (const provider of providers) {
          progress.account = account.email;
          progress.provider = provider.name;
          progress.message = `Szukam wiadomości dla ${provider.name}`;
          updateJob(jobId, { progress });

          const query = buildProviderQuery(provider, afterQuery);
          const ids = await listAccountMessageIds(account, query, count => {
            progress.message = `Znaleziono ${count} wiadomości dla ${provider.name}`;
            updateJob(jobId, { progress });
          });

          for (const id of ids) {
            const key = `${id}:${provider.id}`;
            if (seenCandidates.has(key)) continue;
            seenCandidates.add(key);
            candidates.push({ messageId: id, provider });
          }
        }

        for (const { messageId, provider } of candidates) {
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

        scannedAccounts += 1;
      } catch (error) {
        const warning = describeAccountScanError(account.email, error);
        accountWarnings.push(warning);
        progress.warning = accountWarnings.join(" ");
        progress.message = warning;
        progress.provider = undefined;
        updateJob(jobId, { progress });
      }
    }

    if (accountWarnings.length && scannedAccounts === 0) {
      progress.warning = summarizeAccountWarnings(accountWarnings);
      progress.message = `Nie udało się zeskanować żadnego konta Gmail. ${progress.warning}`;
      updateJob(jobId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: progress.warning,
        progress
      });
      return;
    }

    if (accountWarnings.length) {
      progress.warning = summarizeAccountWarnings(accountWarnings);
      progress.message = `Skanowanie zakończone. ${progress.warning}`;
    } else {
      progress.message = "Skanowanie zakończone";
      delete progress.warning;
    }

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
  const message = await getAccountParsedMessage(account, messageId);
  const from = parseFromHeader(message.headers.from || "");
  const replyTo = parseFromHeader(message.headers["reply-to"] || "");
  const senderMatch = senderMatchesProvider(from.email, replyTo.email, provider);
  const hasPdfAttachment = message.attachments.some(
    attachment =>
      attachment.filename.toLowerCase().endsWith(".pdf") ||
      attachment.mimeType.toLowerCase().includes("pdf")
  );
  const deferSharedBillingValidation = senderMatch.sharedBilling && hasPdfAttachment;

  if (!messageMatchesProvider(message, provider) && !deferSharedBillingValidation) {
    progress.skippedSenderMismatch += 1;
    return;
  }

  progress.scannedMessages += 1;

  if (provider.emailBodyPdf) {
    await processEmailBodyInvoice(account, messageId, provider, archiveDir, progress, message);
  }

  const pdfAttachments = message.attachments.filter(
    attachment =>
      attachment.filename.toLowerCase().endsWith(".pdf") ||
      attachment.mimeType.toLowerCase().includes("pdf")
  );

  for (const attachment of pdfAttachments) {
    const already = db
      .prepare(
        "SELECT status, provider_domain FROM processed_attachments WHERE account_id = ? AND message_id = ? AND attachment_id = ?"
      )
      .get(account.id, messageId, attachment.attachmentId) as
      | { status: string; provider_domain: string }
      | undefined;
    if (already?.status === "saved") {
      progress.skippedDuplicates += 1;
      continue;
    }

    const buffer = await downloadAccountAttachment(account, messageId, attachment.attachmentId);
    const sha256 = createHash("sha256").update(buffer).digest("hex");
    const duplicateByHash = db
      .prepare("SELECT provider_domain, file_path FROM processed_attachments WHERE sha256 = ? AND status = 'saved'")
      .get(sha256) as { provider_domain: string; file_path: string } | undefined;
    if (duplicateByHash?.provider_domain === provider.targetDomain) {
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

async function processEmailBodyInvoice(
  account: GmailAccount,
  messageId: string,
  provider: ProviderRule,
  archiveDir: string,
  progress: ScanProgress,
  message: ParsedGmailMessage
) {
  const syntheticAttachmentId = "email-body-pdf";
  const already = db
    .prepare(
      "SELECT status, provider_domain FROM processed_attachments WHERE account_id = ? AND message_id = ? AND attachment_id = ?"
    )
    .get(account.id, messageId, syntheticAttachmentId) as
    | { status: string; provider_domain: string }
    | undefined;
  if (already?.status === "saved") {
    progress.skippedDuplicates += 1;
    return;
  }

  if (!isLikelyEmailInvoice(message, provider)) {
    progress.skippedNonInvoices += 1;
    return;
  }

  const sentDate = messageDate(message);
  const receivedDate = message.internalDate ? new Date(Number(message.internalDate)) : sentDate;
  const info = extractInvoiceInfo({
    text: message.text,
    emailSentDate: sentDate,
    gmailReceivedDate: receivedDate
  });
  const month = invoiceMonth(info.invoiceDate);
  const domainFolder = sanitizePathSegment(provider.targetDomain);
  const directory = path.join(archiveDir, domainFolder);
  const invoiceNumber = info.invoiceNumber ? sanitizeFilename(info.invoiceNumber) : "";
  const fallbackName = sanitizeFilename(message.headers.subject || provider.id);
  const filename = sanitizeFilename(
    `${month}_${provider.targetDomain}_${invoiceNumber || fallbackName}.pdf`
  );
  const filePath = await uniqueFilePath(directory, filename);
  const from = message.headers.from || "";
  const replyTo = message.headers["reply-to"] || "";
  const subject = message.headers.subject || "";
  const pdf = renderEmailPdf({
    title: `${provider.name} invoice email`,
    headerLines: [
      `Account: ${account.email}`,
      `From: ${from}`,
      replyTo ? `Reply-To: ${replyTo}` : "",
      `Subject: ${subject}`,
      `Date: ${message.headers.date || sentDate.toISOString()}`,
      `Gmail message id: ${messageId}`
    ].filter(Boolean),
    body: message.text
  });
  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const duplicateByHash = db
    .prepare("SELECT provider_domain, file_path FROM processed_attachments WHERE sha256 = ? AND status = 'saved'")
    .get(sha256) as { provider_domain: string; file_path: string } | undefined;
  if (duplicateByHash?.provider_domain === provider.targetDomain) {
    progress.skippedDuplicates += 1;
    return;
  }

  await fs.writeFile(filePath, pdf);
  insertProcessed({
    accountId: account.id,
    messageId,
    attachmentId: syntheticAttachmentId,
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
    originalFilename: "email-body.pdf",
    status: "saved",
    error: null
  });
  progress.savedInvoices += 1;
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
    INSERT INTO processed_attachments(
      id, account_id, message_id, attachment_id, provider_domain, sha256, file_path,
      invoice_month, invoice_date, due_date, amount, currency, invoice_number,
      date_source, original_filename, status, error, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, message_id, attachment_id) DO UPDATE SET
      provider_domain = excluded.provider_domain,
      sha256 = excluded.sha256,
      file_path = excluded.file_path,
      invoice_month = excluded.invoice_month,
      invoice_date = excluded.invoice_date,
      due_date = excluded.due_date,
      amount = excluded.amount,
      currency = excluded.currency,
      invoice_number = excluded.invoice_number,
      date_source = excluded.date_source,
      original_filename = excluded.original_filename,
      status = excluded.status,
      error = excluded.error,
      created_at = excluded.created_at
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
  const senderTerms = provider.senderDomains
    .map(term => term.trim())
    .filter(Boolean)
    .map(term => `from:${sanitizeGmailTerm(term)}`);
  const exactEmailTerms = provider.senderEmails
    .map(term => term.trim())
    .filter(Boolean)
    .flatMap(term => [`from:${sanitizeGmailTerm(term)}`, `"${sanitizeGmailTerm(term)}"`]);
  const brandTerms = providerBrandTerms(provider).map(term => `"${sanitizeGmailTerm(term)}"`);
  const replyToCandidateTerms = exactEmailTerms.length > 0 ? brandTerms : [];
  const providerTerms = provider.senderOnly
    ? [...senderTerms, ...exactEmailTerms, ...replyToCandidateTerms]
    : [...senderTerms, ...exactEmailTerms, ...brandTerms];
  const providerGroup = providerTerms.join(" OR ");
  const invoiceGroup = (provider.emailBodyPdf ? emailBodyInvoiceKeywords : invoiceKeywords).join(" OR ");
  const brandGroup = brandTerms.join(" OR ");
  const attachmentFilter = provider.emailBodyPdf ? "" : "has:attachment ";

  if (!providerGroup) {
    return `after:${afterQuery} ${attachmentFilter}(${invoiceGroup})`;
  }

  const queryParts = [`after:${afterQuery}`, attachmentFilter.trim(), `(${providerGroup})`, `(${invoiceGroup})`]
    .filter(Boolean);
  if (provider.emailBodyPdf && brandGroup) queryParts.push(`(${brandGroup})`);
  return queryParts.join(" ");
}

function messageMatchesProvider(message: ParsedGmailMessage, provider: ProviderRule) {
  const from = parseFromHeader(message.headers.from || "");
  const replyTo = parseFromHeader(message.headers["reply-to"] || "");
  const senderMatch = senderMatchesProvider(from.email, replyTo.email, provider);
  if (senderMatch.direct) return true;

  const brandTerms = providerBrandTerms(provider);
  const hasBrand = includesAny(
    `${from.name} ${from.email} ${replyTo.name} ${replyTo.email} ${message.headers.subject || ""} ${message.snippet} ${message.text}`,
    brandTerms
  );

  if (senderMatch.sharedBilling) return hasBrand;
  if (provider.senderOnly) return false;
  return hasBrand;
}

function senderMatchesProvider(fromEmail: string, replyToEmail: string, provider: ProviderRule) {
  const normalizedFromEmail = normalizeMatchValue(fromEmail);
  const normalizedReplyToEmail = normalizeMatchValue(replyToEmail);
  const emailMatch = provider.senderEmails
    .map(normalizeMatchValue)
    .filter(Boolean)
    .some(term => normalizedFromEmail.includes(term) || normalizedReplyToEmail.includes(term));

  if (emailMatch) return { direct: true, sharedBilling: false };

  let direct = false;
  let sharedBilling = false;
  for (const domain of provider.senderDomains.map(normalizeMatchValue).filter(Boolean)) {
    if (!normalizedFromEmail.includes(domain)) continue;
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

function isLikelyEmailInvoice(message: ParsedGmailMessage, provider: ProviderRule) {
  const text = `${message.headers.subject || ""} ${message.snippet} ${message.text}`;
  const hasInvoiceCue = includesAny(text, emailBodyInvoiceKeywords);
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

function describeAccountScanError(accountEmail: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/\binvalid_grant\b/i.test(message)) {
    return `Konto ${accountEmail} wymaga ponownego podłączenia do Google.`;
  }
  return `Nie udało się zeskanować konta ${accountEmail}: ${message}`;
}

function summarizeAccountWarnings(warnings: string[]) {
  const reauthAccounts = warnings
    .map(warning => warning.match(/^Konto\s+(.+?)\s+wymaga ponownego podłączenia do Google\.$/i)?.[1] || "")
    .filter(Boolean);
  if (reauthAccounts.length === warnings.length && reauthAccounts.length > 0) {
    return `Ponownie podłącz konta Gmail w Ustawienia > Gmail: ${reauthAccounts.join(", ")}.`;
  }
  return warnings.join(" ");
}
