import type { ProviderRule } from "./types.js";

export const defaultProviders: ProviderRule[] = [
  {
    id: "suno",
    name: "Suno AI",
    targetDomain: "suno.com",
    senderDomains: ["suno.com"],
    senderEmails: [],
    searchTerms: ["Suno", "invoice", "receipt", "billing", "payment"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "setapp",
    name: "Setapp Limited",
    targetDomain: "setapp.com",
    senderDomains: ["setapp.com", "macpaw.com", "paddle.com"],
    senderEmails: [],
    searchTerms: ["Setapp", "Setapp Limited", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "leonardo",
    name: "Leonardo AI",
    targetDomain: "leonardo.ai",
    senderDomains: ["leonardo.ai"],
    senderEmails: [],
    searchTerms: ["Leonardo", "Leonardo AI", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "openai",
    name: "OpenAI",
    targetDomain: "openai.com",
    senderDomains: ["openai.com"],
    senderEmails: [],
    searchTerms: ["OpenAI", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs Inc",
    targetDomain: "elevenlabs.io",
    senderDomains: ["elevenlabs.io", "elevenlabs.com", "stripe.com"],
    senderEmails: ["team@elevenlabs.io"],
    searchTerms: ["ElevenLabs", "Eleven Labs", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "udio",
    name: "Udio.com",
    targetDomain: "udio.com",
    senderDomains: ["udio.com"],
    senderEmails: ["support@udio.com"],
    searchTerms: ["Udio", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "google-ai-studio",
    name: "Google AI Studio",
    targetDomain: "google.com",
    senderDomains: ["google.com", "payments.google.com"],
    senderEmails: [],
    searchTerms: ["Google AI Studio", "Google", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "capcut",
    name: "CapCut",
    targetDomain: "capcut.com",
    senderDomains: ["email.apple.com"],
    senderEmails: ["no_reply@email.apple.com"],
    searchTerms: ["CapCut", "CapCut - Video Editor", "faktura", "invoice"],
    senderOnly: true,
    emailBodyPdf: true,
    enabled: true
  },
  {
    id: "krea",
    name: "Krea.ai",
    targetDomain: "krea.ai",
    senderDomains: ["krea.ai"],
    senderEmails: ["support+billing@krea.ai"],
    searchTerms: ["Krea", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "midjourney",
    name: "Midjourney",
    targetDomain: "midjourney.com",
    senderDomains: ["midjourney.com"],
    senderEmails: ["billing@midjourney.com"],
    searchTerms: ["Midjourney", "Midjourney Inc", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "perplexity",
    name: "Perplexity.ai",
    targetDomain: "perplexity.ai",
    senderDomains: ["perplexity.ai", "stripe.com"],
    senderEmails: [],
    searchTerms: ["Perplexity", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "jetbrains",
    name: "JetBrains.com",
    targetDomain: "jetbrains.com",
    senderDomains: ["jetbrains.com"],
    senderEmails: [],
    searchTerms: ["JetBrains", "invoice", "receipt", "billing", "license"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  },
  {
    id: "wisprflow",
    name: "Wispr Flow",
    targetDomain: "wisprflow.ai",
    senderDomains: ["wisprflow.ai", "stripe.com"],
    senderEmails: [],
    searchTerms: ["Wispr", "Wispr Flow", "invoice", "receipt", "billing"],
    senderOnly: true,
    emailBodyPdf: false,
    enabled: true
  }
];
