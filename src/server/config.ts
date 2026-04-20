import "dotenv/config";
import path from "node:path";

export const serverConfig = {
  port: Number(process.env.PORT || 8797),
  appOrigin: process.env.APP_ORIGIN || "http://127.0.0.1:5181",
  googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI ||
    "http://127.0.0.1:8797/api/auth/google/callback",
  dataDir: path.resolve(process.env.DATA_DIR || ".local"),
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
