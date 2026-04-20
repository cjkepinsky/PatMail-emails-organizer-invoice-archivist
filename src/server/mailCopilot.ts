import { randomUUID } from "node:crypto";
import { db, getAppSettings, listAccounts, updateJob } from "./db.js";
import { classifyMailWithLlm, type MailClassification } from "./llm.js";
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

        const ruleClassification = classifyWithRules({
          fromEmail: from.email,
          fromName: from.name,
          subject,
          snippet: message.snippet,
          text,
          importantSenders: settings.importantSenders,
          importantCategories: settings.importantCategories
        });
        let classification = ruleClassification.classification;
        const shouldAskClassifier =
          settings.classifierMode === "local-llm" ||
          (settings.classifierMode === "hybrid" && !ruleClassification.confident);

        if (shouldAskClassifier) {
          classification =
            (await classifyMailWithLlm({
            from: `${from.name} <${from.email}>`,
            subject,
            snippet: message.snippet,
            text,
            importantSenders: settings.importantSenders,
            importantCategories: settings.importantCategories
            })) || classification;
          classification = guardClassification(classification, ruleClassification, {
            fromEmail: from.email,
            fromName: from.name,
            subject,
            snippet: message.snippet,
            text,
            importantCategories: settings.importantCategories
          });
        }

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
  fromName: string;
  subject: string;
  snippet: string;
  text: string;
  importantSenders: string[];
  importantCategories: string[];
}) {
  const haystack = `${input.fromEmail} ${input.fromName} ${input.subject} ${input.snippet}`.toLowerCase();
  const senderImportant = input.importantSenders.some(sender =>
    input.fromEmail.includes(sender.toLowerCase())
  );
  const clearNoise = isLikelyNoise(haystack);
  const allowedNoiseCue = hasHardImportantCue(haystack) || hasConfiguredJobCue(haystack, input.importantCategories);
  const match = clearNoise && !allowedNoiseCue ? null : findImportantCategory(haystack, input.importantCategories);
  const priority = senderImportant || match?.priority === "high" ? "high" : match?.priority === "medium" ? "medium" : "low";
  const classification: MailClassification = {
    priority,
    category: match?.category || (senderImportant ? "maile od ważnych nadawców" : clearNoise ? "noise" : "other"),
    summary: input.subject || "Wiadomość może wymagać uwagi.",
    action_required: match?.actionRequired || "",
    due_date: null,
    amount: null,
    currency: null
  };

  return {
    classification,
    confident: true
  };
}

function guardClassification(
  classification: MailClassification,
  ruleClassification: { classification: MailClassification },
  input: { fromEmail: string; fromName: string; subject: string; snippet: string; text: string; importantCategories: string[] }
) {
  if (classification.priority === "low") return classification;

  const haystack = `${input.fromEmail} ${input.fromName} ${input.subject} ${input.snippet}`.toLowerCase();
  const noiseCanMatter = hasHardImportantCue(haystack) || hasConfiguredJobCue(haystack, input.importantCategories);
  const ruleMatch =
    isLikelyNoise(haystack) && !noiseCanMatter ? null : findImportantCategory(haystack, input.importantCategories);
  const potentialCue = hasPotentialImportantCue(haystack, input.importantCategories);
  if (((isLikelyNoise(haystack) && !noiseCanMatter) || !potentialCue) && !ruleMatch) {
    return ruleClassification.classification;
  }

  const configured = new Set(input.importantCategories.map(normalize));
  const category = normalize(classification.category);
  if (ruleMatch && category !== normalize(ruleMatch.category)) {
    return ruleClassification.classification;
  }

  if (category !== "other" && category !== "noise" && !configured.has(category)) {
    return {
      ...classification,
      category: ruleMatch?.category || "other"
    };
  }

  return classification;
}

function findImportantCategory(haystack: string, categories: string[]) {
  const configured = categories.map(category => ({
    raw: category,
    normalized: normalize(category)
  }));
  const consumerOrderNoise = isConsumerOrderNoise(haystack);

  const candidates = [
    {
      hints: ["platn", "płat", "payment"],
      regex:
        /(przelewy24|payu|autopay|p24-|status swojej płatności|status swojej platnosci|transakcja płatnicza|transakcja platnicza|zlecenie płatności|zlecenie platnosci|przekazaliśmy twoją płatność|przekazalismy twoja platnosc|potwierdzenie płatności|potwierdzenie platnosci|payment status|payment confirmation)/i,
      priority: "high",
      actionRequired: "Sprawdź płatność albo transakcję."
    },
    {
      hints: ["bank"],
      regex:
        /(\bmbank\b|santander|alior bank|bank pekao|pekao24|ing bank|millennium bank|nest bank|velobank|credit agricole|pko bank|inteligo|bnpparibas|kontakt@mbank\.pl|@[^ ]*bank|bank@)/i,
      priority: "high",
      actionRequired: "Sprawdź komunikat bankowy."
    },
    {
      hints: ["faktur", "rachun", "invoice", "receipt"],
      regex:
        /(\binvoice\b|faktura|rachunek|\breceipt\b|payment due|termin płatności|termin platnosci|platne do|płatne do|amount due|t-mobile|twoja faktura z firmy apple)/i,
      priority: "high",
      actionRequired: "Sprawdź termin płatności lub archiwum faktur.",
      skip: consumerOrderNoise
    },
    {
      hints: ["ksieg", "księg", "podat", "accounting", "tax"],
      regex: /(infakt|księg|ksieg|accountant|składk|skladk|\bzus\b|podatek|\btax\b)/i,
      priority: "high",
      actionRequired: "Sprawdź, czy wymaga odpowiedzi lub płatności."
    },
    {
      hints: ["media", "internet", "gaz", "prad", "prąd", "woda", "utilities"],
      regex: /(internet|energia|prąd|prad|gaz|woda|utilities|operator|faktura za|rachunek za)/i,
      priority: "high",
      actionRequired: "Sprawdź termin płatności."
    },
    {
      hints: ["licenc", "subskry", "subscription", "renewal", "commercial"],
      regex: /(license|licencja|subscription|subskrypcja|renewal|odnowienie|commercial|plan renewed)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["prac", "job", "rekrut", "career", "hiring"],
      regex: /(oferta pracy|oferty pracy|miejsc pracy|dam prac|stanowisko|job offer|job alert|recruiter|rekrut|hiring|career|interview|linkedin jobs|jooble|nofluffjobs|solid\.jobs|justjoin\.it|propozycja projektu|projekt -)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["konto", "bezpieczen", "bezpieczeń", "account", "security"],
      regex:
        /(alert bezpieczeństwa|alert bezpieczenstwa|security alert|wyzerowano hasło|wyzerowano haslo|hasło konta|haslo konta|password reset|konto google|konto apple|apple id|nowe logowanie|logowanie z nowego urządzenia|logowanie z nowego urzadzenia|new sign-in|suspicious activity|accounts\.google|id\.apple|gdpr|privacy|data processing|confirm your account)/i,
      priority: "high",
      actionRequired: "Sprawdź, czy to znana aktywność."
    },
    {
      hints: ["urzad", "urząd", "legal", "praw"],
      regex: /(\burząd\b|\burzad\b|\blegal\b|lawyer|prawnik|gov\.pl|e-?urząd|e-?urzad)/i,
      priority: "high",
      actionRequired: "Sprawdź, czy wymaga odpowiedzi."
    }
  ];

  for (const candidate of candidates) {
    if (candidate.skip) continue;
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

function hasPotentialImportantCue(haystack: string, categories: string[]) {
  const configured = categories.map(normalize).join(" ");
  const cues = [
    {
      hints: ["platn", "płat", "payment"],
      regex: /(przelewy24|payu|autopay|p24-|płatnicz|platnicz|potwierdzenie płatności|payment confirmation)/i
    },
    {
      hints: ["konto", "bezpieczen", "bezpieczeń", "account", "security"],
      regex: /(alert bezpieczeństwa|alert bezpieczenstwa|security alert|password reset|wyzerowano hasło|konto google|konto apple|apple id|gdpr|privacy)/i
    },
    {
      hints: ["faktur", "rachun"],
      regex: /(\binvoice\b|faktura|rachunek|\breceipt\b|payment due|termin płatności|termin platnosci|t-mobile|twoja faktura z firmy apple)/i
    },
    {
      hints: ["ksieg", "księg", "podat"],
      regex: /(księg|ksieg|podatek|\btax\b|\bzus\b|infakt|składk|skladk)/i
    },
    {
      hints: ["bank"],
      regex: /(\bmbank\b|santander|alior bank|bank pekao|pekao24|ing bank|millennium bank|nest bank|velobank|pko bank)/i
    },
    {
      hints: ["licenc", "subskry", "subscription"],
      regex: /(license|licencja|subscription|subskrypcja|renewal|odnowienie|plan renewed)/i
    },
    {
      hints: ["prac", "job", "rekrut", "career", "hiring"],
      regex: /(oferta pracy|oferty pracy|miejsc pracy|dam prac|stanowisko|job offer|job alert|recruiter|rekrut|hiring|career|interview|linkedin|jooble|nofluffjobs|solid\.jobs|justjoin\.it|propozycja projektu)/i
    },
    { hints: ["internet", "gaz", "prad", "prąd", "woda"], regex: /(internet|energia|prąd|prad|gaz|woda|operator)/i }
  ];

  return cues.some(candidate =>
    candidate.hints.some(hint => configured.includes(normalize(hint))) && candidate.regex.test(haystack)
  );
}

function hasHardImportantCue(haystack: string) {
  if (isConsumerOrderNoise(haystack)) return false;
  return /(\binvoice\b|faktura|rachunek|\breceipt\b|payment due|termin płatności|termin platnosci|przelewy24|payu|autopay|t-mobile|infakt|\bmbank\b|\bzus\b|santander|alior bank|alert bezpieczeństwa|security alert|password reset|wyzerowano hasło|konto google|konto apple|apple id)/i.test(
    haystack
  );
}

function hasConfiguredJobCue(haystack: string, categories: string[]) {
  const configured = categories.map(normalize).join(" ");
  if (!/(ofert|prac|job|rekrut|career|hiring)/i.test(configured)) return false;
  return /(oferta pracy|job offer|recruiter|rekrut|hiring|career|interview|linkedin|jooble|nofluffjobs)/i.test(
    haystack
  );
}

function isLikelyNoise(haystack: string) {
  return /(unsubscribe|view in browser|newsletter|substack|beehiiv|sale|discount|\d+%\s*off|promo|promocja|wyprzedaż|kupon|coupon|black friday|follow us|limited time offer|brand days|alert google|google alert|darmowe produkty|free products|free ebook|giveaway|mcdonald'?s account services|twoje zamówienie w aplikacji|twoje zamowienie w aplikacji)/i.test(
    haystack
  );
}

function isConsumerOrderNoise(haystack: string) {
  return /(mcdonald'?s account services|twoje zamówienie w aplikacji|twoje zamowienie w aplikacji|zamówienie w aplikacji mcdonald|zamowienie w aplikacji mcdonald)/i.test(
    haystack
  );
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
