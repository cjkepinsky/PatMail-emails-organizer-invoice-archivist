import { randomUUID } from "node:crypto";
import { parseFromHeader, type ParsedGmailMessage } from "./gmail.js";

export type ReplyMessage = {
  raw: string;
  toEmail: string;
  subject: string;
  threadId: string;
};

export function buildReplyMessage(input: {
  accountEmail: string;
  original: ParsedGmailMessage;
  body: string;
}): ReplyMessage {
  const body = input.body.trim();
  if (!body) throw new Error("Brakuje treści odpowiedzi.");

  const recipient = firstAddress(input.original.headers["reply-to"] || input.original.headers.from || "");
  if (!recipient.email) throw new Error("Nie udało się ustalić adresata odpowiedzi.");

  const originalSubject = input.original.headers.subject || "";
  const subject = replySubject(originalSubject);
  const originalMessageId = sanitizeHeaderValue(input.original.headers["message-id"] || "");
  const references = sanitizeHeaderValue(
    [input.original.headers.references || "", originalMessageId].filter(Boolean).join(" ")
  );
  const messageId = `<mailbot-${randomUUID()}@local.mailbot>`;
  const headers = [
    `From: ${formatAddress({ email: input.accountEmail })}`,
    `To: ${formatAddress(recipient)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    originalMessageId ? `In-Reply-To: ${originalMessageId}` : "",
    references ? `References: ${references}` : "",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit"
  ].filter(Boolean);

  return {
    raw: normalizeCrlf(`${headers.join("\r\n")}\r\n\r\n${body}\r\n`),
    toEmail: recipient.email,
    subject,
    threadId: input.original.threadId
  };
}

function firstAddress(value: string) {
  const parsed = parseFromHeader(value);
  if (isEmail(parsed.email)) {
    return parsed;
  }

  const emailMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (!emailMatch) return { name: "", email: "" };
  const name = value.slice(0, emailMatch.index).replace(/["<>,]/g, " ").trim();
  return {
    name,
    email: emailMatch[0].toLowerCase()
  };
}

function replySubject(subject: string) {
  const clean = sanitizeHeaderValue(subject).trim();
  if (!clean) return "Re:";
  return /^(re|odp)\s*:/i.test(clean) ? clean : `Re: ${clean}`;
}

function formatAddress(address: { name?: string; email: string }) {
  const email = sanitizeEmail(address.email);
  const name = sanitizeHeaderValue(address.name || "");
  return name ? `${encodeHeaderPhrase(name)} <${email}>` : `<${email}>`;
}

function encodeHeader(value: string) {
  const clean = sanitizeHeaderValue(value);
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function encodeHeaderPhrase(value: string) {
  const clean = sanitizeHeaderValue(value);
  if (!clean) return "";
  if (/^[A-Za-z0-9 !#$%&'*+\-/=?^_`{|}~.]+$/.test(clean)) return `"${clean.replace(/(["\\])/g, "\\$1")}"`;
  return encodeHeader(clean);
}

function sanitizeHeaderValue(value: string) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function sanitizeEmail(value: string) {
  const clean = sanitizeHeaderValue(value).replace(/[<>]/g, "");
  if (!isEmail(clean)) throw new Error("Nieprawidłowy adres e-mail odpowiedzi.");
  return clean.toLowerCase();
}

function isEmail(value: string) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function normalizeCrlf(value: string) {
  return value.replace(/\r?\n/g, "\r\n");
}
