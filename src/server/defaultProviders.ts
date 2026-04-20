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
    enabled: true
  },
  {
    id: "udio",
    name: "Udio.com",
    targetDomain: "udio.com",
    senderDomains: ["udio.com"],
    senderEmails: [],
    searchTerms: ["Udio", "invoice", "receipt", "billing"],
    senderOnly: true,
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
    enabled: true
  },
  {
    id: "canva",
    name: "Canva.com",
    targetDomain: "canva.com",
    senderDomains: ["canva.com"],
    senderEmails: [],
    searchTerms: ["Canva", "invoice", "receipt", "billing"],
    senderOnly: true,
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
    enabled: true
  }
];
