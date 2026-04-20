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
            importantSenders: settings.importantSenders,
            importantCategories: settings.importantCategories
          })) || classifyWithRules({
            fromEmail: from.email,
            subject,
            text,
            importantSenders: settings.importantSenders,
            importantCategories: settings.importantCategories
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
  importantCategories: string[];
}) {
  const haystack = `${input.fromEmail} ${input.subject} ${input.text}`.toLowerCase();
  const senderImportant = input.importantSenders.some(sender =>
    input.fromEmail.includes(sender.toLowerCase())
  );
  const match = findImportantCategory(haystack, input.importantCategories);
  const priority = senderImportant || match?.priority === "high" ? "high" : match?.priority === "medium" ? "medium" : "low";
  return {
    priority: priority as "high" | "medium" | "low",
    category: match?.category || (senderImportant ? "maile od ważnych nadawców" : "other"),
    summary: input.subject || "Wiadomość może wymagać uwagi.",
    action_required: match?.actionRequired || "",
    due_date: null,
    amount: null,
    currency: null
  };
}

function findImportantCategory(haystack: string, categories: string[]) {
  const configured = categories.map(category => ({
    raw: category,
    normalized: normalize(category)
  }));

  const candidates = [
    {
      hints: ["faktur", "rachun", "invoice", "receipt"],
      regex: /(invoice|faktura|rachunek|receipt|payment due|termin płatności|termin platnosci|platne do|płatne do)/i,
      priority: "high",
      actionRequired: "Sprawdź termin płatności lub archiwum faktur."
    },
    {
      hints: ["platn", "płat", "payment", "termin"],
      regex: /(payment due|termin płatności|termin platnosci|platne do|płatne do|payment failed|card declined|amount due)/i,
      priority: "high",
      actionRequired: "Sprawdź płatność albo termin."
    },
    {
      hints: ["ksieg", "księg", "podat", "urzad", "urząd", "accounting", "tax", "legal", "praw"],
      regex: /(urząd|urzad|tax|podatek|księg|ksieg|accountant|legal|lawyer|zus|vat)/i,
      priority: "high",
      actionRequired: "Sprawdź, czy wymaga odpowiedzi lub płatności."
    },
    {
      hints: ["bank"],
      regex: /(bank|transaction|charge|payment card|konto|przelew)/i,
      priority: "high",
      actionRequired: "Sprawdź operację lub komunikat bankowy."
    },
    {
      hints: ["licenc", "subskry", "subscription", "renewal", "commercial"],
      regex: /(license|licencja|subscription|renewal|odnowienie|commercial|plan renewed)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["prac", "job", "rekrut", "career", "hiring"],
      regex: /(oferta pracy|job offer|recruiter|rekrut|hiring|career|interview|linkedin jobs|nofluffjobs)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["media", "internet", "gaz", "prad", "prąd", "woda", "utilities"],
      regex: /(internet|energia|prąd|prad|gaz|woda|utilities|operator|faktura za)/i,
      priority: "high",
      actionRequired: "Sprawdź termin płatności."
    }
  ];

  for (const candidate of candidates) {
    const category = configured.find(item =>
      candidate.hints.some(hint => item.normalized.includes(normalize(hint)))
    );
    if (category && candidate.regex.test(haystack)) {
      return {
        category: category.raw,
        priority: candidate.priority as "high" | "medium",
        actionRequired: candidate.actionRequired
      };
    }
  }
  return null;
}

function normalize(input: string) {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

function formatGmailDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}
