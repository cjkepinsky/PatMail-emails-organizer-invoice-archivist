import { randomUUID } from "node:crypto";
import { db, getActiveProfileId, getAppSettings, isMailIgnored, listAccounts, markMailCachedUnread, updateJob } from "./db.js";
import { classifyMailWithLlm, type MailClassification } from "./llm.js";
import { messageDate, parseFromHeader } from "./gmail.js";
import { getAccountParsedMessage, isAccountMessageUnread, listAccountMessageIds } from "./mailSource.js";

type Progress = {
  message: string;
  account?: string;
  scannedMessages: number;
  importantMessages: number;
  warning?: string;
};

export async function runImportantMailSync(jobId: string, options: { days?: number }) {
  const startedAt = new Date().toISOString();
  const profileId = getActiveProfileId();
  const days = Math.max(1, Math.min(30, Number(options.days || 7)));
  const settings = getAppSettings();
  const text = mailSyncText(settings.language);
  const after = new Date();
  after.setDate(after.getDate() - days);

  const progress: Progress = {
    message: text.start,
    scannedMessages: 0,
    importantMessages: 0
  };
  updateJob(jobId, { status: "running", startedAt, progress });

  try {
    const accountWarnings: string[] = [];
    let syncedAccounts = 0;

    for (const account of listAccounts()) {
      try {
        progress.account = account.email;
        progress.message = text.checkingTracked;
        updateJob(jobId, { progress });

        const tracked = db
          .prepare(
            `SELECT message_id
             FROM (
               SELECT message_id FROM important_items WHERE account_id = ?
               AND profile_id = ?
               UNION
               SELECT message_id FROM mail_cache WHERE account_id = ? AND is_unread = 1
               AND profile_id = ?
             )`
          )
          .all(account.id, profileId, account.id, profileId) as { message_id: string }[];

        for (const row of tracked) {
          try {
            const unread = await isAccountMessageUnread(account, row.message_id);
            if (unread) {
              markMailCachedUnread(account.id, row.message_id);
              continue;
            }
            db.prepare("UPDATE mail_cache SET is_unread = 0 WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
              account.id,
              row.message_id,
              profileId
            );
            db.prepare("DELETE FROM important_items WHERE account_id = ? AND message_id = ? AND profile_id = ?").run(
              account.id,
              row.message_id,
              profileId
            );
          } catch {
            // Ignore transient Gmail lookup failures for individual messages and continue with the sync.
          }
        }

        progress.message = text.searchingRecent;
        updateJob(jobId, { progress });

        const query = `after:${formatGmailDate(after)} is:unread -category:promotions -category:social`;
        const ids = await listAccountMessageIds(account, query, count => {
          progress.message = text.foundRecent(count);
          updateJob(jobId, { progress });
        });

        for (const id of ids.slice(0, 200)) {
          markMailCachedUnread(account.id, id);
          if (isMailIgnored(account.id, id)) {
            progress.scannedMessages += 1;
            continue;
          }
          const exists = db
            .prepare("SELECT id FROM important_items WHERE account_id = ? AND message_id = ? AND profile_id = ?")
            .get(account.id, id, profileId);
          if (exists) continue;

          const message = await getAccountParsedMessage(account, id);
          const from = parseFromHeader(message.headers.from || "");
          const subject = message.headers.subject || "";
          const receivedAt = messageDate(message).toISOString();
          const text = message.text || message.snippet || "";
          cacheMail({
            profileId,
            accountId: account.id,
            messageId: id,
            threadId: message.threadId,
            fromEmail: from.email,
            fromName: from.name,
            subject,
            snippet: message.snippet,
            receivedAt,
            text,
            html: message.html,
            isUnread: true
          });

          const ruleClassification = classifyWithRules({
            fromEmail: from.email,
            fromName: from.name,
            subject,
            snippet: message.snippet,
            text,
            importantSenders: settings.importantSenders,
            importantCategories: settings.importantCategories,
            senderCategoryRules: settings.senderCategoryRules,
            categoryRules: settings.categoryRules,
            language: settings.language
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
                importantCategories: settings.importantCategories,
                language: settings.language
              })) || classification;
            classification = guardClassification(classification, ruleClassification, {
              fromEmail: from.email,
              fromName: from.name,
              subject,
              snippet: message.snippet,
              text,
              importantCategories: settings.importantCategories,
              categoryRules: settings.categoryRules
            });
          }

          progress.scannedMessages += 1;
          if (classification.priority === "high" || classification.priority === "medium") {
            db.prepare(`
              INSERT OR IGNORE INTO important_items(
                id, profile_id, account_id, message_id, thread_id, from_email, from_name, subject, snippet,
                received_at, priority, category, summary, action_required, due_date, amount, currency,
                raw_json, created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              randomUUID(),
              profileId,
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
        syncedAccounts += 1;
      } catch (error) {
        const warning = describeAccountSyncError(account.email, error, settings.language);
        accountWarnings.push(warning);
        progress.warning = accountWarnings.join(" ");
        progress.message = warning;
        updateJob(jobId, { progress });
      }
    }

    if (accountWarnings.length && syncedAccounts === 0) {
      progress.warning = summarizeAccountWarnings(accountWarnings, settings.language);
      progress.message = text.noAccounts(progress.warning);
      updateJob(jobId, {
        status: "failed",
        finishedAt: new Date().toISOString(),
        error: progress.warning,
        progress
      });
      return;
    }

    if (accountWarnings.length) {
      progress.warning = summarizeAccountWarnings(accountWarnings, settings.language);
      progress.message = text.doneWithWarnings(progress.warning);
    } else {
      progress.message = text.done;
      delete progress.warning;
    }

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
  const profileId = getActiveProfileId();
  const language = getAppSettings().language;
  const recentImportant = db
    .prepare(
      "SELECT from_email, from_name, subject, received_at, priority, category, summary, action_required, due_date, amount, currency FROM important_items WHERE profile_id = ? ORDER BY received_at DESC LIMIT 12"
    )
    .all(profileId);
  const textMatches = db
    .prepare(
      "SELECT from_email, from_name, subject, received_at, substr(text, 1, 900) AS text FROM mail_cache WHERE profile_id = ? AND (subject LIKE ? OR from_email LIKE ? OR text LIKE ?) ORDER BY received_at DESC LIMIT 4"
    )
    .all(profileId, like, like, like);
  return {
    recentImportant,
    focusedMatches: textMatches,
    contextPolicy:
      language === "en"
        ? "recentImportant contains the most important recent messages; focusedMatches are short excerpts matching the question. Answer concisely."
        : "recentImportant zawiera najważniejsze ostatnie wiadomości; focusedMatches to krótkie fragmenty pasujące do pytania. Odpowiadaj zwięźle."
  };
}

function cacheMail(input: {
  profileId: string;
  accountId: string;
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  text: string;
  html: string;
  isUnread: boolean;
}) {
  db.prepare(`
    INSERT INTO mail_cache(
      id, profile_id, account_id, message_id, thread_id, from_email, from_name, subject, snippet,
      received_at, text, html, is_unread, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, message_id) DO UPDATE SET
      profile_id = excluded.profile_id,
      subject = excluded.subject,
      snippet = excluded.snippet,
      text = excluded.text,
      html = excluded.html,
      is_unread = excluded.is_unread
  `).run(
    randomUUID(),
    input.profileId,
    input.accountId,
    input.messageId,
    input.threadId,
    input.fromEmail,
    input.fromName,
    input.subject,
    input.snippet,
    input.receivedAt,
    input.text,
    input.html,
    input.isUnread ? 1 : 0,
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
  senderCategoryRules: Array<{ sender: string; category: string }>;
  categoryRules: Array<{
    category: string;
    priority: "high" | "medium";
    actionRequired: string;
    senderTerms: string[];
    keywordTerms: string[];
  }>;
  language?: "pl" | "en";
}) {
  const text = ruleText(input.language || "pl");
  const manualSenderRule = input.senderCategoryRules.find(rule =>
    input.fromEmail.toLowerCase().includes(rule.sender.toLowerCase())
  );
  if (manualSenderRule) {
    return {
      classification: {
        priority: "high" as const,
        category: manualSenderRule.category,
        summary: input.subject || text.manualSummary,
        action_required: text.manualAction,
        due_date: null,
        amount: null,
        currency: null
      },
      confident: true
    };
  }

  const haystack = `${input.fromEmail} ${input.fromName} ${input.subject} ${input.snippet}`.toLowerCase();
  const senderImportant = input.importantSenders.some(sender =>
    input.fromEmail.includes(sender.toLowerCase())
  );
  const clearNoise = isLikelyNoise(haystack);
  const configuredRuleMatch = findConfiguredCategoryRule(haystack, input.categoryRules);
  const allowedNoiseCue =
    hasConfiguredRuleCue(haystack, input.categoryRules) ||
    hasHardImportantCue(haystack) ||
    hasConfiguredJobCue(haystack, input.importantCategories);
  const match = clearNoise && !allowedNoiseCue ? null : configuredRuleMatch || findImportantCategory(haystack, input.importantCategories, input.language || "pl");
  const priority = senderImportant || match?.priority === "high" ? "high" : match?.priority === "medium" ? "medium" : "low";
  const classification: MailClassification = {
    priority,
    category: match?.category || (senderImportant ? text.importantSenderCategory : clearNoise ? "noise" : "other"),
    summary: input.subject || text.defaultSummary,
    action_required: match?.actionRequired || "",
    due_date: null,
    amount: null,
    currency: null
  };

  return {
    classification,
    confident: Boolean(senderImportant || match)
  };
}

function guardClassification(
  classification: MailClassification,
  ruleClassification: { classification: MailClassification },
  input: {
    fromEmail: string;
    fromName: string;
    subject: string;
    snippet: string;
    text: string;
    importantCategories: string[];
    categoryRules: Array<{
      category: string;
      priority: "high" | "medium";
      actionRequired: string;
      senderTerms: string[];
      keywordTerms: string[];
    }>;
  }
) {
  if (classification.priority === "low") return classification;

  const haystack = `${input.fromEmail} ${input.fromName} ${input.subject} ${input.snippet}`.toLowerCase();
  const noiseCanMatter = hasHardImportantCue(haystack) || hasConfiguredJobCue(haystack, input.importantCategories);
  const configuredRuleMatch = findConfiguredCategoryRule(haystack, input.categoryRules);
  const ruleMatch =
    configuredRuleMatch ||
    (isLikelyNoise(haystack) && !noiseCanMatter ? null : findImportantCategory(haystack, input.importantCategories));
  const potentialCue = hasConfiguredRuleCue(haystack, input.categoryRules) || hasPotentialImportantCue(haystack, input.importantCategories);
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

function findImportantCategory(haystack: string, categories: string[], language: "pl" | "en" = "pl") {
  const configured = categories.map(category => ({
    raw: category,
    normalized: normalize(category)
  }));
  const consumerOrderNoise = isConsumerOrderNoise(haystack);
  const text = ruleText(language);

  const candidates = [
    {
      hints: ["platn", "płat", "payment"],
      regex:
        /(service@paypal\.pl|d@citi\.com|paypal\.pl|citi\.com|przelewy24|payu|autopay|p24-|status swojej płatności|status swojej platnosci|transakcja płatnicza|transakcja platnicza|zlecenie płatności|zlecenie platnosci|przekazaliśmy twoją płatność|przekazalismy twoja platnosc|potwierdzenie płatności|potwierdzenie platnosci|payment status|payment confirmation)/i,
      priority: "high",
      actionRequired: text.paymentAction
    },
    {
      hints: ["zamow", "zamów", "order", "allegro"],
      regex: /(powiadomienia@allegro\.pl|allegro\.pl|status zamówienia|status zamowienia|twoje zamówienie|twoje zamowienie|zamówienie nr|zamowienie nr)/i,
      priority: "high",
      actionRequired: text.orderAction
    },
    {
      hints: ["bank"],
      regex:
        /(\bmbank\b|santander|alior bank|bank pekao|pekao24|ing bank|millennium bank|nest bank|velobank|credit agricole|pko bank|inteligo|bnpparibas|kontakt@mbank\.pl|kontakt@bik\.pl|@[^ ]*bank|bank@)/i,
      priority: "high",
      actionRequired: text.bankAction
    },
    {
      hints: ["software", "setapp"],
      regex: /(hello@news\.setapp\.com|news\.setapp\.com|setapp)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["ai", "ollama", "kaggle"],
      regex:
        /(noreply@email\.openai\.com|whatsupinai@mail\.beehiiv\.com|newsletter@haicsummit\.com|altiamkabir@creators\.gumroad\.com|hello@ollama\.com|no-reply@kaggle\.com|the-superpower@mail\.beehiiv\.com|astro@forwardfuture\.ai|andy@aiandy\.ai|alerts@theresanaiforthat\.com|email\.openai\.com|whatsupinai|haicsummit\.com|gumroad\.com|ollama\.com|kaggle\.com|forwardfuture\.ai|superpower|aiandy\.ai|theresanaiforthat\.com)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["vr", "virtual", "uploadvr"],
      regex: /(uploadvr@buttondown\.email|uploadvr|buttondown\.email)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["zad", "task", "todo", "zadania"],
      regex: /(noreply@tm\.openai\.com|tm\.openai\.com|task|todo|reminder|przypomnienie o zadaniu|twoje zadanie)/i,
      priority: "high",
      actionRequired: text.taskAction
    },
    {
      hints: ["rd", "ligmincha", "monroe", "3doors"],
      regex:
        /(newsletter@the3doors\.org|no-reply@monroeinstitute\.org|stoicmanual@substack\.com|mindfulmondays@substack\.com|the stoic manual|mindful mondays|the3doors\.org|monroeinstitute\.org|ligmincha)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["zdrow", "health", "med", "doctor"],
      regex: /(kontakt@drbartek\.pl|drbartek\.pl|zdrowie|health|wizyta|badanie|lekarz|doctor)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["faktur", "rachun", "invoice", "receipt"],
      regex:
        /(\binvoice\b|faktura|rachunek|\breceipt\b|payment due|termin płatności|termin platnosci|platne do|płatne do|amount due|t-mobile|twoja faktura z firmy apple)/i,
      priority: "high",
      actionRequired: text.invoiceAction,
      skip: consumerOrderNoise
    },
    {
      hints: ["ksieg", "księg", "podat", "accounting", "tax"],
      regex: /(infakt|księg|ksieg|accountant|składk|skladk|\bzus\b|podatek|\btax\b)/i,
      priority: "high",
      actionRequired: text.accountingAction
    },
    {
      hints: ["media", "internet", "gaz", "prad", "prąd", "woda", "utilities"],
      regex: /(internet|energia|prąd|prad|gaz|woda|utilities|operator|faktura za|rachunek za)/i,
      priority: "high",
      actionRequired: text.dueDateAction
    },
    {
      hints: ["licenc", "subskry", "subscription", "renewal", "commercial"],
      regex: /(license|licencja|subscription|subskrypcja|renewal|odnowienie|commercial|plan renewed)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["prac", "job", "rekrut", "career", "hiring"],
      regex:
        /(oferta pracy|oferty pracy|miejsc pracy|dam prac|stanowisko|job offer|job alert|jobs similar|new jobs similar|recruiter|rekrut|hiring|career|interview|linkedin jobs|linkedin_jobs-noreply@linkedin\.com|linkedin\.com\/jobs|jooble|nofluffjobs|solid\.jobs|justjoin\.it|propozycja projektu|projekt -)/i,
      priority: "medium",
      actionRequired: ""
    },
    {
      hints: ["konto", "bezpieczen", "bezpieczeń", "account", "security"],
      regex:
        /(alert bezpieczeństwa|alert bezpieczenstwa|security alert|wyzerowano hasło|wyzerowano haslo|hasło konta|haslo konta|password reset|konto google|konto apple|apple id|nowe logowanie|logowanie z nowego urządzenia|logowanie z nowego urzadzenia|new sign-in|suspicious activity|accounts\.google|id\.apple|gdpr|privacy|data processing|confirm your account)/i,
      priority: "high",
      actionRequired: text.securityAction
    },
    {
      hints: ["urzad", "urząd", "legal", "praw"],
      regex: /(\burząd\b|\burzad\b|\blegal\b|lawyer|prawnik|gov\.pl|e-?urząd|e-?urzad)/i,
      priority: "high",
      actionRequired: text.replyAction
    }
  ];

  for (const candidate of candidates) {
    if (candidate.skip) continue;
    const category = configured.find(item =>
      candidate.hints.some(hint => categoryMatchesHint(item.normalized, normalize(hint)))
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

function findConfiguredCategoryRule(
  haystack: string,
  categoryRules: Array<{
    category: string;
    priority: "high" | "medium";
    actionRequired: string;
    senderTerms: string[];
    keywordTerms: string[];
  }>
) {
  const consumerOrderNoise = isConsumerOrderNoise(haystack);
  for (const rule of categoryRules) {
    if (normalize(rule.category) === normalize("faktury i rachunki") && consumerOrderNoise) continue;
    const senderMatch = rule.senderTerms.some(term => haystack.includes(term.toLowerCase()));
    const keywordMatch = rule.keywordTerms.some(term => haystack.includes(term.toLowerCase()));
    if (senderMatch || keywordMatch) {
      return {
        category: rule.category,
        priority: rule.priority,
        actionRequired: rule.actionRequired
      };
    }
  }
  return null;
}

function hasConfiguredRuleCue(
  haystack: string,
  categoryRules: Array<{
    category: string;
    priority: "high" | "medium";
    actionRequired: string;
    senderTerms: string[];
    keywordTerms: string[];
  }>
) {
  return Boolean(findConfiguredCategoryRule(haystack, categoryRules));
}

function hasPotentialImportantCue(haystack: string, categories: string[]) {
  const configured = categories.map(normalize);
  const cues = [
    {
      hints: ["platn", "płat", "payment"],
      regex: /(service@paypal\.pl|d@citi\.com|paypal\.pl|citi\.com|przelewy24|payu|autopay|p24-|płatnicz|platnicz|potwierdzenie płatności|payment confirmation)/i
    },
    {
      hints: ["zamow", "zamów", "order", "allegro"],
      regex: /(powiadomienia@allegro\.pl|allegro\.pl|status zamówienia|status zamowienia|twoje zamówienie|twoje zamowienie)/i
    },
    {
      hints: ["software", "setapp"],
      regex: /(hello@news\.setapp\.com|news\.setapp\.com|setapp)/i
    },
    {
      hints: ["ai", "ollama", "kaggle"],
      regex:
        /(noreply@email\.openai\.com|whatsupinai@mail\.beehiiv\.com|newsletter@haicsummit\.com|altiamkabir@creators\.gumroad\.com|hello@ollama\.com|no-reply@kaggle\.com|the-superpower@mail\.beehiiv\.com|astro@forwardfuture\.ai|andy@aiandy\.ai|alerts@theresanaiforthat\.com|email\.openai\.com|whatsupinai|haicsummit\.com|gumroad\.com|ollama\.com|kaggle\.com|forwardfuture\.ai|superpower|aiandy\.ai|theresanaiforthat\.com)/i
    },
    {
      hints: ["vr", "virtual", "uploadvr"],
      regex: /(uploadvr@buttondown\.email|uploadvr|buttondown\.email)/i
    },
    {
      hints: ["zad", "task", "todo", "zadania"],
      regex: /(noreply@tm\.openai\.com|tm\.openai\.com|task|todo|reminder)/i
    },
    {
      hints: ["rd", "ligmincha", "monroe", "3doors"],
      regex:
        /(newsletter@the3doors\.org|no-reply@monroeinstitute\.org|stoicmanual@substack\.com|mindfulmondays@substack\.com|the stoic manual|mindful mondays|the3doors\.org|monroeinstitute\.org|ligmincha)/i
    },
    {
      hints: ["zdrow", "health", "med", "doctor"],
      regex: /(kontakt@drbartek\.pl|drbartek\.pl|zdrowie|health|wizyta|badanie|lekarz|doctor)/i
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
      regex: /(\bmbank\b|santander|alior bank|bank pekao|pekao24|ing bank|millennium bank|nest bank|velobank|pko bank|kontakt@bik\.pl)/i
    },
    {
      hints: ["licenc", "subskry", "subscription"],
      regex: /(license|licencja|subscription|subskrypcja|renewal|odnowienie|plan renewed)/i
    },
    {
      hints: ["prac", "job", "rekrut", "career", "hiring"],
      regex:
        /(oferta pracy|oferty pracy|miejsc pracy|dam prac|stanowisko|job offer|job alert|jobs similar|new jobs similar|recruiter|rekrut|hiring|career|interview|linkedin|linkedin_jobs-noreply@linkedin\.com|linkedin\.com\/jobs|jooble|nofluffjobs|solid\.jobs|justjoin\.it|propozycja projektu)/i
    },
    { hints: ["internet", "gaz", "prad", "prąd", "woda"], regex: /(internet|energia|prąd|prad|gaz|woda|operator)/i }
  ];

  return cues.some(candidate =>
    candidate.hints.some(hint => configured.some(category => categoryMatchesHint(category, normalize(hint)))) &&
      candidate.regex.test(haystack)
  );
}

function hasHardImportantCue(haystack: string) {
  if (isConsumerOrderNoise(haystack)) return false;
  return /(\binvoice\b|faktura|rachunek|\breceipt\b|payment due|termin płatności|termin platnosci|service@paypal\.pl|d@citi\.com|paypal\.pl|citi\.com|przelewy24|payu|autopay|t-mobile|infakt|\bmbank\b|\bzus\b|santander|alior bank|kontakt@bik\.pl|alert bezpieczeństwa|security alert|password reset|wyzerowano hasło|konto google|konto apple|apple id|kontakt@drbartek\.pl|noreply@tm\.openai\.com|noreply@email\.openai\.com|hello@news\.setapp\.com|newsletter@haicsummit\.com|altiamkabir@creators\.gumroad\.com|hello@ollama\.com|no-reply@kaggle\.com|the-superpower@mail\.beehiiv\.com|whatsupinai@mail\.beehiiv\.com|astro@forwardfuture\.ai|andy@aiandy\.ai|alerts@theresanaiforthat\.com|uploadvr@buttondown\.email|newsletter@the3doors\.org|no-reply@monroeinstitute\.org|stoicmanual@substack\.com|mindfulmondays@substack\.com|the stoic manual|mindful mondays|ligmincha|powiadomienia@allegro\.pl)/i.test(
    haystack
  );
}

function hasConfiguredJobCue(haystack: string, categories: string[]) {
  const configured = categories.map(normalize);
  if (!configured.some(category => ["ofert", "prac", "job", "rekrut", "career", "hiring"].some(hint => categoryMatchesHint(category, hint)))) {
    return false;
  }
  return /(oferta pracy|job offer|jobs similar|new jobs similar|recruiter|rekrut|hiring|career|interview|linkedin|linkedin_jobs-noreply@linkedin\.com|jooble|nofluffjobs)/i.test(
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

function categoryMatchesHint(category: string, hint: string) {
  const tokens = category.split(/\s+/).filter(Boolean);
  return tokens.some(token => token.startsWith(hint));
}

function formatGmailDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

function mailSyncText(language: "pl" | "en") {
  if (language === "en") {
    return {
      start: "Starting quiet important-mail sync",
      checkingTracked: "Checking status of already tracked messages",
      searchingRecent: "Searching recent messages",
      foundRecent: (count: number) => `Found ${count} recent messages`,
      noAccounts: (warning: string) => `Could not refresh any Gmail account. ${warning}`,
      doneWithWarnings: (warning: string) => `Sync finished. ${warning}`,
      done: "Important-mail sync finished"
    };
  }
  return {
    start: "Start cichego syncu ważnej poczty",
    checkingTracked: "Sprawdzam status już śledzonych wiadomości",
    searchingRecent: "Szukam ostatnich wiadomości",
    foundRecent: (count: number) => `Znaleziono ${count} ostatnich wiadomości`,
    noAccounts: (warning: string) => `Nie udało się odświeżyć żadnego konta Gmail. ${warning}`,
    doneWithWarnings: (warning: string) => `Sync zakończony. ${warning}`,
    done: "Sync ważnej poczty zakończony"
  };
}

function ruleText(language: "pl" | "en") {
  if (language === "en") {
    return {
      manualSummary: "Message manually assigned to a category.",
      manualAction: "Review the message from this sender.",
      importantSenderCategory: "important senders",
      defaultSummary: "Message may need attention.",
      paymentAction: "Check the payment or transaction.",
      orderAction: "Check order status.",
      bankAction: "Check the banking message.",
      taskAction: "Check whether this requires action.",
      invoiceAction: "Check the payment due date or invoice archive.",
      accountingAction: "Check whether this requires a reply or payment.",
      dueDateAction: "Check the payment due date.",
      securityAction: "Check whether this is known activity.",
      replyAction: "Check whether this requires a reply."
    };
  }
  return {
    manualSummary: "Wiadomość przypisana ręcznie do kategorii.",
    manualAction: "Sprawdź wiadomość od tego nadawcy.",
    importantSenderCategory: "maile od ważnych nadawców",
    defaultSummary: "Wiadomość może wymagać uwagi.",
    paymentAction: "Sprawdź płatność albo transakcję.",
    orderAction: "Sprawdź status zamówienia.",
    bankAction: "Sprawdź komunikat bankowy.",
    taskAction: "Sprawdź, czy wymaga działania.",
    invoiceAction: "Sprawdź termin płatności lub archiwum faktur.",
    accountingAction: "Sprawdź, czy wymaga odpowiedzi lub płatności.",
    dueDateAction: "Sprawdź termin płatności.",
    securityAction: "Sprawdź, czy to znana aktywność.",
    replyAction: "Sprawdź, czy wymaga odpowiedzi."
  };
}

function describeAccountSyncError(accountEmail: string, error: unknown, language: "pl" | "en" = "pl") {
  const message = error instanceof Error ? error.message : String(error);
  if (/\binvalid_grant\b/i.test(message)) {
    if (language === "en") return `Account ${accountEmail} needs to be reconnected to Google.`;
    return `Konto ${accountEmail} wymaga ponownego podłączenia do Google.`;
  }
  if (/^Timeout IMAP dla konta\b/i.test(message)) {
    return language === "en"
      ? `IMAP timeout for account ${accountEmail}. The mail server did not respond in time.`
      : message;
  }
  if (language === "en") return `Could not refresh account ${accountEmail}: ${message}`;
  return `Nie udało się odświeżyć konta ${accountEmail}: ${message}`;
}

function summarizeAccountWarnings(warnings: string[], language: "pl" | "en" = "pl") {
  const reauthAccounts = warnings
    .map(
      warning =>
        warning.match(/^Konto\s+(.+?)\s+wymaga ponownego podłączenia do Google\.$/i)?.[1] ||
        warning.match(/^Account\s+(.+?)\s+needs to be reconnected to Google\.$/i)?.[1] ||
        ""
    )
    .filter(Boolean);
  if (reauthAccounts.length === warnings.length && reauthAccounts.length > 0) {
    if (language === "en") return `Reconnect Gmail accounts in Settings > Gmail: ${reauthAccounts.join(", ")}.`;
    return `Ponownie podłącz konta Gmail w Ustawienia > Gmail: ${reauthAccounts.join(", ")}.`;
  }
  return warnings.join(" ");
}
