import { getAppSettings } from "./db.js";

const modelCache = new Map<string, { models: string[]; expiresAt: number }>();
const MODEL_CACHE_MS = 60_000;

export type MailClassification = {
  priority: "high" | "medium" | "low";
  category: string;
  summary: string;
  action_required: string;
  due_date: string | null;
  amount: string | null;
  currency: string | null;
};

export async function getLlmStatus() {
  const settings = getAppSettings();
  if (!settings.llmBaseUrl) {
    return { configured: false, models: [], selectedModel: null };
  }

  const baseUrl = normalizeBaseUrl(settings.llmBaseUrl);
  const models = await listLoadedModels(settings, baseUrl);
  return {
    configured: true,
    baseUrl,
    configuredModel: settings.llmModel || "auto",
    models,
    selectedModel: selectModel(models, settings.llmModel || "auto")
  };
}

export async function classifyMailWithLlm(input: {
  from: string;
  subject: string;
  snippet: string;
  text: string;
  importantSenders: string[];
  importantCategories: string[];
}): Promise<MailClassification | null> {
  const settings = getAppSettings();
  if (!settings.llmBaseUrl) return null;

  const messages = [
    {
      role: "system",
      content:
        "Jesteś lokalnym asystentem pocztowym. Oceniasz, czy mail jest ważny dla użytkownika. Zwracaj wyłącznie JSON bez markdown. Jako ważne traktuj tylko maile pasujące do listy configured_important_categories albo od important_senders. Newslettery, marketing i luźne treści są nisko, chyba że wyraźnie pasują do skonfigurowanych kategorii."
    },
    {
      role: "user",
      content: JSON.stringify({
        important_senders: input.importantSenders,
        configured_important_categories: input.importantCategories,
        mail: {
          from: input.from,
          subject: input.subject,
          snippet: input.snippet,
          text: input.text.slice(0, 2500)
        },
        expected_json_schema: {
          priority: "high | medium | low",
          category: "jedna z configured_important_categories albo noise | other",
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
    const data = await chatCompletion(settings, messages, {
      temperature: 0,
      responseFormatJson: true,
      maxTokens: 180
    });
    return normalizeClassification(parseJsonObject(data));
  } catch {
    return null;
  }
}

export async function chatWithMailbox(input: { question: string; context: unknown }) {
  const settings = getAppSettings();
  if (!settings.llmBaseUrl) {
    return "Nie skonfigurowano lokalnego modelu LLM.";
  }

  const messages = [
    {
      role: "system",
      content:
        "Jesteś lokalnym asystentem użytkownika do rozmowy ze skrzynkami Gmail. Odpowiadaj po polsku, krótko i konkretnie. Używaj tylko podanego kontekstu; jeśli czegoś nie ma w kontekście, powiedz to wprost. Preferuj 3-7 krótkich punktów, daty, kwoty i wymagane działania."
    },
    {
      role: "user",
      content: JSON.stringify({
        question: input.question,
        mailbox_context: input.context
      })
    }
  ];

  return chatCompletion(settings, messages, {
    temperature: 0.1,
    responseFormatJson: false,
    maxTokens: 700
  });
}

async function chatCompletion(
  settings: { llmBaseUrl: string; llmApiKey: string; llmModel: string },
  messages: Array<{ role: string; content: string }>,
  options: { temperature: number; responseFormatJson: boolean; maxTokens: number }
) {
  const baseUrl = normalizeBaseUrl(settings.llmBaseUrl);
  const model = await resolveLoadedModel(settings, baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
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

async function resolveLoadedModel(
  settings: { llmBaseUrl: string; llmApiKey: string; llmModel: string },
  baseUrl: string
) {
  const modelIds = await listLoadedModels(settings, baseUrl);
  const selected = selectModel(modelIds, settings.llmModel || "auto");
  if (!selected) {
    throw new Error(
      "Lokalny serwer LLM nie zwrócił żadnego załadowanego modelu. Załaduj model ręcznie w serwerze LLM i spróbuj ponownie."
    );
  }
  return selected;
}

async function listLoadedModels(
  settings: { llmBaseUrl: string; llmApiKey: string; llmModel: string },
  baseUrl: string
) {
  const cached = modelCache.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      ...(settings.llmApiKey ? { Authorization: `Bearer ${settings.llmApiKey}` } : {})
    }
  });

  if (!response.ok) {
    throw new Error(
      `Nie mogę sprawdzić załadowanego modelu przez ${baseUrl}/models: HTTP ${response.status}`
    );
  }

  const json = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = (json.data || []).map(model => model.id).filter(Boolean) as string[];
  modelCache.set(baseUrl, { models, expiresAt: Date.now() + MODEL_CACHE_MS });
  return models;
}

function selectModel(modelIds: string[], configuredModel: string) {
  if (modelIds.length === 0) return null;
  const requested = configuredModel.trim();
  if (requested && requested !== "auto") {
    const exact = modelIds.find(id => id === requested);
    if (exact) return exact;

    const fuzzy = modelIds.find(id => {
      const left = id.toLowerCase();
      const right = requested.toLowerCase();
      return left.includes(right) || right.includes(left);
    });
    if (fuzzy) return fuzzy;
  }

  return modelIds[0];
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
