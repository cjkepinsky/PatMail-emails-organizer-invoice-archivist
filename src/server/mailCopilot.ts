import { randomUUID } from "node:crypto";
import { db, getAppSettings, listAccounts, updateJob } from "./db.js";
import { classifyMailWithLlm } from "./llm.js";
import { getParsedMessage, gmailForAccount, listMessageIds, messageDate, parseFromHeader } from "./gmail.js";

type Progress = {
  message: string;
  account?: string;
  scannedMessages: number;
  importantMessages: number;
};

export async function runImportantMailSync(jobId: string, options: { days?: number }) {
  const startedAt = new Date().toISOString();
  const days = Math.max(1, Math.min(30, Number(options.days || 7)));
  const settings = getAppSettings();
  const after = new Date();
  after.setDate(after.getDate() - days);

  const progress: Progress = {
    message: "Start cichego syncu ważnej poczty",
    scannedMessages: 0,
    importantMessages: 0
  };
  updateJob(jobId, { status: "running", startedAt, progress });

  try {
    for (const account of listAccounts()) {
      const gmail = gmailForAccount(account);
      progress.account = account.email;
      progress.message = "Szukam ostatnich wiadomości";
      updateJob(jobId, { progress });

      const query = `after:${formatGmailDate(after)} -category:promotions -category:social`;
      const ids = await listMessageIds(gmail, query, count => {
        progress.message = `Znaleziono ${count} ostatnich wiadomości`;
        updateJob(jobId, { progress });
      });

      for (const id of ids.slice(0, 200)) {
        const exists = db
          .prepare("SELECT id FROM important_items WHERE account_id = ? AND message_id = ?")
          .get(account.id, id);
        if (exists) continue;

        const message = await getParsedMessage(gmail, id);
        const from = parseFromHeader(message.headers.from || "");
        const subject = message.headers.subject || "";
        const receivedAt = messageDate(message).toISOString();
        const text = message.text || message.snippet || "";
        cacheMail({
          accountId: account.id,
          messageId: id,
          threadId: message.threadId,
          fromEmail: from.email,
          fromName: from.name,
          subject,
          snippet: message.snippet,
          receivedAt,
          text
        });

        const classification =
          (await classifyMailWithLlm({
            from: `${from.name} <${from.email}>`,
            subject,
            snippet: message.snippet,
            text,
            importantSenders: settings.importantSenders
          })) || classifyWithRules({
            fromEmail: from.email,
            subject,
            text,
            importantSenders: settings.importantSenders
          });

        progress.scannedMessages += 1;
        if (classification.priority === "high" || classification.priority === "medium") {
          db.prepare(`
            INSERT OR IGNORE INTO important_items(
              id, account_id, message_id, thread_id, from_email, from_name, subject, snippet,
              received_at, priority, category, summary, action_required, due_date, amount, currency,
              raw_json, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            randomUUID(),
            account.id,
            id,
            message.threadId,
            from.email,
            from.name,
            subject,
            message.snippet,
            receivedAt,
            classification.priority,
            classification.category,
            classification.summary,
            classification.action_required,
            classification.due_date,
            classification.amount,
            classification.currency,
            JSON.stringify(classification),
            new Date().toISOString()
          );
          progress.importantMessages += 1;
        }
        updateJob(jobId, { progress });
      }
    }

    progress.message = "Sync ważnej poczty zakończony";
    updateJob(jobId, { status: "done", finishedAt: new Date().toISOString(), progress });
  } catch (error) {
    updateJob(jobId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      progress
    });
  }
}

export function getChatContext(question: string) {
  const like = `%${question.replace(/[%_]/g, " ").slice(0, 80)}%`;
  const recentImportant = db
    .prepare(
      "SELECT from_email, from_name, subject, received_at, priority, category, summary, action_required, due_date, amount, currency FROM important_items ORDER BY received_at DESC LIMIT 12"
    )
    .all();
  const textMatches = db
    .prepare(
      "SELECT from_email, from_name, subject, received_at, substr(text, 1, 900) AS text FROM mail_cache WHERE subject LIKE ? OR from_email LIKE ? OR text LIKE ? ORDER BY received_at DESC LIMIT 4"
    )
    .all(like, like, like);
  return {
    recentImportant,
    focusedMatches: textMatches,
    contextPolicy:
      "recentImportant zawiera najważniejsze ostatnie wiadomości; focusedMatches to krótkie fragmenty pasujące do pytania. Odpowiadaj zwięźle."
  };
}

function cacheMail(input: {
  accountId: string;
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  text: string;
}) {
  db.prepare(`
    INSERT INTO mail_cache(
      id, account_id, message_id, thread_id, from_email, from_name, subject, snippet,
      received_at, text, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, message_id) DO UPDATE SET
      subject = excluded.subject,
      snippet = excluded.snippet,
      text = excluded.text
  `).run(
    randomUUID(),
    input.accountId,
    input.messageId,
    input.threadId,
    input.fromEmail,
    input.fromName,
    input.subject,
    input.snippet,
    input.receivedAt,
    input.text,
    new Date().toISOString()
  );
}

function classifyWithRules(input: {
  fromEmail: string;
  subject: string;
  text: string;
  importantSenders: string[];
}) {
  const haystack = `${input.fromEmail} ${input.subject} ${input.text}`.toLowerCase();
  const senderImportant = input.importantSenders.some(sender =>
    input.fromEmail.includes(sender.toLowerCase())
  );
  const hasInvoice = /(invoice|faktura|rachunek|receipt|payment due|termin płatności|platne do|płatne do)/i.test(
    haystack
  );
  const hasAuthority = /(bank|urząd|urzad|tax|podatek|księg|ksieg|accountant|legal|lawyer)/i.test(haystack);
  const hasLicense = /(license|licencja|subscription|renewal|odnowienie|commercial)/i.test(haystack);

  const priority = senderImportant || hasInvoice || hasAuthority ? "high" : hasLicense ? "medium" : "low";
  return {
    priority: priority as "high" | "medium" | "low",
    category: hasInvoice ? "invoice" : hasAuthority ? "accounting" : hasLicense ? "license" : "other",
    summary: input.subject || "Wiadomość może wymagać uwagi.",
    action_required: hasInvoice ? "Sprawdź termin płatności lub archiwum faktur." : "",
    due_date: null,
    amount: null,
    currency: null
  };
}

function formatGmailDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}
