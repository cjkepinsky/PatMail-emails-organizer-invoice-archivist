import { getAppSettings } from "./db.js";

const modelCache = new Map<string, { models: string[]; expiresAt: number }>();
const MODEL_CACHE_MS = 60_000;

type ModelEndpoint = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  fallbackToFirstModel?: boolean;
};

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
  if (!settings.llmApiKey) {
    return { configured: false, models: [], selectedModel: null };
  }

  const endpoint = chatEndpoint(settings);
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl);
  const models = await listLoadedModels(endpoint, baseUrl);
  return {
    configured: true,
    baseUrl,
    configuredModel: endpoint.model || "auto",
    models,
    selectedModel: selectModel(models, endpoint.model || "auto", endpoint.fallbackToFirstModel !== false)
  };
}

export async function getClassifierStatus() {
  const settings = getAppSettings();
  if (settings.classifierMode === "rules" || !settings.classifierBaseUrl) {
    return {
      configured: settings.classifierMode !== "rules",
      mode: settings.classifierMode,
      models: [],
      selectedModel: null
    };
  }

  const endpoint = classifierEndpoint(settings);
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl);
  const models = await listLoadedModels(endpoint, baseUrl);
  return {
    configured: true,
    mode: settings.classifierMode,
    baseUrl,
    configuredModel: endpoint.model || "auto",
    timeoutMs: endpoint.timeoutMs,
    models,
    selectedModel: selectModel(models, endpoint.model || "auto", endpoint.fallbackToFirstModel !== false)
  };
}

export async function classifyMailWithLlm(input: {
  from: string;
  subject: string;
  snippet: string;
  text: string;
  importantSenders: string[];
  importantCategories: string[];
  language?: "pl" | "en";
}): Promise<MailClassification | null> {
  const settings = getAppSettings();
  if (settings.classifierMode === "rules" || !settings.classifierBaseUrl) return null;
  const language = input.language || settings.language || "pl";

  const messages = [
    {
      role: "system",
      content:
        language === "en"
          ? "You are a local mailbox assistant. Decide whether an email is important for the user. Return only JSON without markdown. Treat as important only emails matching configured_important_categories or important_senders. Newsletters, marketing, and casual content are low priority unless they clearly match configured categories. Write summary and action_required in English."
          : "Jesteś lokalnym asystentem pocztowym. Oceniasz, czy mail jest ważny dla użytkownika. Zwracaj wyłącznie JSON bez markdown. Jako ważne traktuj tylko maile pasujące do listy configured_important_categories albo od important_senders. Newslettery, marketing i luźne treści są nisko, chyba że wyraźnie pasują do skonfigurowanych kategorii. Pisz summary i action_required po polsku."
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
          category: language === "en" ? "one of configured_important_categories or noise | other" : "jedna z configured_important_categories albo noise | other",
          summary: language === "en" ? "one short sentence in English" : "jedno krótkie zdanie po polsku",
          action_required: language === "en" ? "what the user should do, or an empty string" : "co użytkownik powinien zrobić albo pusty string",
          due_date: "YYYY-MM-DD albo null",
          amount: "kwota jako tekst albo null",
          currency: "PLN | USD | EUR | GBP albo null"
        }
      })
    }
  ];

  try {
    const data = await chatCompletion(messages, {
      endpoint: classifierEndpoint(settings),
      temperature: 0,
      responseFormatJson: true,
      maxTokens: 180
    });
    return normalizeClassification(parseJsonObject(data));
  } catch {
    return null;
  }
}

export async function chatWithMailbox(input: { question: string; context: unknown; useWebSearch?: boolean }) {
  const settings = getAppSettings();
  if (!settings.llmApiKey) {
    return settings.language === "en"
      ? "OpenAI token for mailbox chat is not configured."
      : "Nie skonfigurowano tokenu OpenAI do czatu ze skrzynką.";
  }
  const language = settings.language || "pl";
  const useWebSearch = Boolean(input.useWebSearch);
  const systemPrompt = mailboxSystemPrompt(language, useWebSearch);

  const messages = [
    {
      role: "system",
      content: systemPrompt
    },
    {
      role: "user",
      content: JSON.stringify({
        question: input.question,
        mailbox_context: input.context
      })
    }
  ];

  if (useWebSearch) {
    return responseWithWebSearch({
      endpoint: chatEndpoint(settings),
      systemPrompt,
      question: input.question,
      context: input.context,
      maxTokens: 900
    });
  }

  return chatCompletion(messages, {
    endpoint: chatEndpoint(settings),
    temperature: 0.1,
    responseFormatJson: false,
    maxTokens: 700
  });
}

function mailboxSystemPrompt(language: "pl" | "en", useWebSearch: boolean) {
  const base =
    language === "en"
      ? "You are the user's assistant for talking with Gmail mailboxes. Answer briefly and concretely. Always answer in the same language as the user's latest question, regardless of the app interface language. If the question is in Polish, answer in Polish; if it is in English, answer in English; if it is in German, answer in German; for mixed-language questions, use the dominant language unless the user explicitly asks otherwise. Prefer 3-7 short bullet points, dates, amounts, and required actions."
      : "Jesteś asystentem użytkownika do rozmowy ze skrzynkami Gmail. Odpowiadaj krótko i konkretnie. Zawsze odpowiadaj w tym samym języku, w którym użytkownik zadał ostatnie pytanie, niezależnie od języka interfejsu aplikacji. Jeśli pytanie jest po polsku, odpowiedz po polsku; jeśli po angielsku, odpowiedz po angielsku; jeśli po niemiecku, odpowiedz po niemiecku; przy pytaniach mieszanych użyj dominującego języka, chyba że użytkownik poprosi inaczej. Preferuj 3-7 krótkich punktów, daty, kwoty i wymagane działania.";
  const sourcePolicy = useWebSearch
    ? language === "en"
      ? "You may use web search when it helps. Clearly separate what comes from the mailbox context from what comes from the web. Include source names or URLs for web-derived claims when available. Do not send or expose unnecessary private mailbox details in the answer."
      : "Możesz użyć wyszukiwania w Internecie, jeśli to pomaga. Wyraźnie oddzielaj informacje wynikające z kontekstu skrzynki od informacji z Internetu. Dla informacji z sieci podawaj nazwy źródeł albo URL-e, jeśli są dostępne. Nie ujawniaj w odpowiedzi zbędnych prywatnych szczegółów ze skrzynki."
    : language === "en"
      ? "Use only the provided mailbox context; if something is missing from context, say so directly."
      : "Używaj tylko podanego kontekstu skrzynki; jeśli czegoś nie ma w kontekście, powiedz to wprost.";
  return `${base} ${sourcePolicy}`;
}

async function responseWithWebSearch(input: {
  endpoint: ModelEndpoint;
  systemPrompt: string;
  question: string;
  context: unknown;
  maxTokens: number;
}) {
  const baseUrl = normalizeBaseUrl(input.endpoint.baseUrl);
  const model = await resolveLoadedModel(input.endpoint, baseUrl);
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.endpoint.apiKey ? { Authorization: `Bearer ${input.endpoint.apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search", search_context_size: "medium" }],
      input: [
        { role: "system", content: input.systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            mailbox_context: input.context
          })
        }
      ],
      temperature: 0.1,
      max_output_tokens: input.maxTokens
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses API HTTP ${response.status}: ${await response.text()}`);
  }

  return extractResponseText(await response.json());
}

function extractResponseText(json: unknown) {
  const response = json as {
    output_text?: unknown;
    output?: Array<{
      content?: Array<{
        text?: unknown;
      }>;
    }>;
  };
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const parts: string[] = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string" && content.text.trim()) parts.push(content.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

async function chatCompletion(
  messages: Array<{ role: string; content: string }>,
  options: { endpoint: ModelEndpoint; temperature: number; responseFormatJson: boolean; maxTokens: number }
) {
  const endpoint = options.endpoint;
  const baseUrl = normalizeBaseUrl(endpoint.baseUrl);
  const model = await resolveLoadedModel(endpoint, baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const controller = endpoint.timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), endpoint.timeoutMs) : null;
  const response = await fetch(url, {
    method: "POST",
    signal: controller?.signal,
    headers: {
      "Content-Type": "application/json",
      ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {})
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      ...(options.responseFormatJson ? { response_format: { type: "json_object" } } : {})
    })
  }).finally(() => {
    if (timeout) clearTimeout(timeout);
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
  settings: ModelEndpoint,
  baseUrl: string
) {
  const modelIds = await listLoadedModels(settings, baseUrl);
  const selected = selectModel(modelIds, settings.model || "auto", settings.fallbackToFirstModel !== false);
  if (!selected) {
    const language = getAppSettings().language || "pl";
    throw new Error(
      language === "en"
        ? "The local LLM server did not return any loaded model. Load the model manually in the LLM server and try again."
        : "Lokalny serwer LLM nie zwrócił żadnego załadowanego modelu. Załaduj model ręcznie w serwerze LLM i spróbuj ponownie."
    );
  }
  return selected;
}

async function listLoadedModels(
  settings: ModelEndpoint,
  baseUrl: string
) {
  const cached = modelCache.get(baseUrl);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const response = await fetch(`${baseUrl}/models`, {
    headers: {
      ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {})
    }
  });

  if (!response.ok) {
    const language = getAppSettings().language || "pl";
    throw new Error(
      language === "en"
        ? `Could not check the loaded model through ${baseUrl}/models: HTTP ${response.status}`
        : `Nie mogę sprawdzić załadowanego modelu przez ${baseUrl}/models: HTTP ${response.status}`
    );
  }

  const json = (await response.json()) as { data?: Array<{ id?: string }> };
  const models = (json.data || []).map(model => model.id).filter(Boolean) as string[];
  modelCache.set(baseUrl, { models, expiresAt: Date.now() + MODEL_CACHE_MS });
  return models;
}

function chatEndpoint(settings: { llmApiKey: string; llmModel: string }): ModelEndpoint {
  return {
    baseUrl: "https://api.openai.com",
    apiKey: settings.llmApiKey,
    model: settings.llmModel
  };
}

function classifierEndpoint(settings: {
  classifierBaseUrl: string;
  classifierApiKey: string;
  classifierModel: string;
  classifierTimeoutMs: number;
}): ModelEndpoint {
  return {
    baseUrl: settings.classifierBaseUrl,
    apiKey: settings.classifierApiKey,
    model: settings.classifierModel,
    timeoutMs: settings.classifierTimeoutMs,
    fallbackToFirstModel: false
  };
}

function selectModel(modelIds: string[], configuredModel: string, fallbackToFirstModel = true) {
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

  return fallbackToFirstModel ? modelIds[0] : null;
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
