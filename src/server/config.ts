import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR || ".local");
const configFilePath = path.join(dataDir, "app-config.json");

fs.mkdirSync(dataDir, { recursive: true });

type StoredConfig = {
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
};

function looksLikeOpenAiKey(value: string | undefined) {
  return typeof value === "string" && value.trim().startsWith("sk-");
}

function looksLikeGoogleClientId(value: string | undefined) {
  return typeof value === "string" && value.includes(".apps.googleusercontent.com");
}

function readStoredConfigFile(): Partial<StoredConfig> {
  try {
    if (!fs.existsSync(configFilePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(configFilePath, "utf8")) as Record<string, unknown>;
    return {
      googleClientId: typeof parsed.googleClientId === "string" ? parsed.googleClientId : undefined,
      googleClientSecret: typeof parsed.googleClientSecret === "string" ? parsed.googleClientSecret : undefined,
      googleRedirectUri: typeof parsed.googleRedirectUri === "string" ? parsed.googleRedirectUri : undefined
    };
  } catch {
    return {};
  }
}

function writeStoredConfigFile(config: Partial<StoredConfig>) {
  fs.writeFileSync(configFilePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export const serverConfig = {
  port: Number(process.env.PORT || 8797),
  appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:5181",
  dataDir,
  configFilePath,
  staticDir: process.env.STATIC_DIR || "",
  googleClientId: "",
  googleClientSecret: "",
  googleRedirectUri: "",
  defaultArchiveDir: process.env.DEFAULT_ARCHIVE_DIR || "",
  defaultLlmBaseUrl: process.env.LLM_BASE_URL || "http://192.168.1.90:1234",
  defaultLlmApiKey: process.env.LLM_API_KEY || "",
  defaultLlmModel: process.env.LLM_MODEL || "auto",
  defaultClassifierMode: process.env.CLASSIFIER_MODE || "hybrid",
  defaultClassifierBaseUrl: process.env.CLASSIFIER_BASE_URL || "http://127.0.0.1:11434",
  defaultClassifierApiKey: process.env.CLASSIFIER_API_KEY || "",
  defaultClassifierModel: process.env.CLASSIFIER_MODEL || "tinydolphin:latest",
  defaultClassifierTimeoutMs: Number(process.env.CLASSIFIER_TIMEOUT_MS || 2500)
};

const defaultStoredConfig: StoredConfig = {
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ||
    "http://127.0.0.1:8797/api/auth/google/callback"
};

const initialStoredConfig = {
  ...defaultStoredConfig,
  ...readStoredConfigFile()
};

const normalizedStoredConfig: StoredConfig = {
  googleClientId:
    looksLikeGoogleClientId(initialStoredConfig.googleClientId) || !looksLikeGoogleClientId(defaultStoredConfig.googleClientId)
      ? initialStoredConfig.googleClientId
      : defaultStoredConfig.googleClientId,
  googleClientSecret:
    looksLikeOpenAiKey(initialStoredConfig.googleClientSecret) && defaultStoredConfig.googleClientSecret
      ? defaultStoredConfig.googleClientSecret
      : initialStoredConfig.googleClientSecret,
  googleRedirectUri: initialStoredConfig.googleRedirectUri || defaultStoredConfig.googleRedirectUri
};

if (!fs.existsSync(configFilePath) || JSON.stringify(initialStoredConfig) !== JSON.stringify(normalizedStoredConfig)) {
  writeStoredConfigFile(normalizedStoredConfig);
}

serverConfig.googleClientId = normalizedStoredConfig.googleClientId;
serverConfig.googleClientSecret = normalizedStoredConfig.googleClientSecret;
serverConfig.googleRedirectUri = normalizedStoredConfig.googleRedirectUri;

export function getStoredConfig() {
  return {
    googleClientId: serverConfig.googleClientId,
    googleClientSecret: serverConfig.googleClientSecret,
    googleRedirectUri: serverConfig.googleRedirectUri
  };
}

export function updateStoredConfig(input: Partial<StoredConfig>) {
  const nextConfig = {
    ...getStoredConfig(),
    ...input
  };
  serverConfig.googleClientId = nextConfig.googleClientId || "";
  serverConfig.googleClientSecret = nextConfig.googleClientSecret || "";
  serverConfig.googleRedirectUri =
    nextConfig.googleRedirectUri || defaultStoredConfig.googleRedirectUri;
  writeStoredConfigFile({
    googleClientId: serverConfig.googleClientId,
    googleClientSecret: serverConfig.googleClientSecret,
    googleRedirectUri: serverConfig.googleRedirectUri
  });
  return getStoredConfig();
}
