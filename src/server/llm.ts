import { getAppSettings } from "./db.js";

export type MailClassification = {
  priority: "high" | "medium" | "low";
  category: string;
  summary: string;
  action_required: string;
  due_date: string | null;
  amount: string | null;
  currency: string | null;
};

export async function classifyMailWithLlm(input: {
  from: string;
  subject: string;
  snippet: string;
  text: string;
  importantSenders: string[];
}): Promise<MailClassification | null> {
  const settings = getAppSettings();
  if (!settings.llmBaseUrl || !settings.llmModel) return null;

  const messages = [
    {
      role: "system",
      content:
        "Jesteś lokalnym asystentem pocztowym. Oceniasz, czy mail jest ważny dla użytkownika. Zwracaj wyłącznie JSON bez markdown. Priorytety: faktury, rachunki, terminy płatności, księgowość, bank, urząd, licencje komercyjne, odnowienia subskrypcji i maile od ważnych nadawców są ważne. Newslettery i marketing są nisko."
    },
    {
      role: "user",
      content: JSON.stringify({
        important_senders: input.importantSenders,
        mail: {
          from: input.from,
          subject: input.subject,
          snippet: input.snippet,
          text: input.text.slice(0, 12000)
        },
        expected_json_schema: {
          priority: "high | medium | low",
          category: "invoice | accounting | utilities | subscription | license | banking | legal | personal-important | noise | other",
          summary: "jedno krótkie zdanie po polsku",
          action_required: "co użytkownik powinien zrobić albo pusty string",
          due_date: "YYYY-MM-DD albo null",
          amount: "kwota jako tekst albo null",
          currency: "PLN | USD | EUR | GBP albo null"
        }
      })
    }
  ];

  try {
    const data = await chatCompletion(settings, messages, { temperature: 0.1, responseFormatJson: true });
    return normalizeClassification(parseJsonObject(data));
  } catch {
    return null;
  }
}

export async function chatWithMailbox(input: { question: string; context: unknown[] }) {
  const settings = getAppSettings();
  if (!settings.llmBaseUrl || !settings.llmModel) {
    return "Nie skonfigurowano lokalnego modelu LLM.";
  }

  const messages = [
    {
      role: "system",
      content:
        "Jesteś lokalnym asystentem użytkownika do rozmowy ze skrzynkami Gmail. Odpowiadaj po polsku, krótko i konkretnie. Używaj tylko podanego kontekstu; jeśli czegoś nie ma w kontekście, powiedz to wprost."
    },
    {
      role: "user",
      content: JSON.stringify({
        question: input.question,
        mailbox_context: input.context
      })
    }
  ];

  return chatCompletion(settings, messages, { temperature: 0.2, responseFormatJson: false });
}

async function chatCompletion(
  settings: { llmBaseUrl: string; llmApiKey: string; llmModel: string },
  messages: Array<{ role: string; content: string }>,
  options: { temperature: number; responseFormatJson: boolean }
) {
  const url = `${normalizeBaseUrl(settings.llmBaseUrl)}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {})
    },
    body: JSON.stringify({
      model: settings.llmModel,
      messages,
      temperature: options.temperature,
      ...(options.responseFormatJson ? { response_format: { type: "json_object" } } : {})
    })
  });

  if (!response.ok) {
    throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
  }
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return json.choices?.[0]?.message?.content || "";
}

function normalizeBaseUrl(baseUrl: string) {
  const clean = baseUrl.replace(/\/+$/, "");
  return clean.endsWith("/v1") ? clean : `${clean}/v1`;
}

function parseJsonObject(text: string) {
  const direct = tryParse(text);
  if (direct) return direct;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? tryParse(match[0]) : null;
}

function tryParse(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeClassification(input: Record<string, unknown> | null): MailClassification | null {
  if (!input) return null;
  const priority = String(input.priority || "low").toLowerCase();
  return {
    priority: priority === "high" || priority === "medium" ? priority : "low",
    category: String(input.category || "other"),
    summary: String(input.summary || ""),
    action_required: String(input.action_required || ""),
    due_date: input.due_date ? String(input.due_date) : null,
    amount: input.amount ? String(input.amount) : null,
    currency: input.currency ? String(input.currency) : null
  };
}
