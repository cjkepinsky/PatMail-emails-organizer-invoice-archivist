import { randomUUID } from "node:crypto";
import { buildMessageContent, type AttachmentInput, type InlineImageInput } from "./mailMime.js";

export type ComposeMessage = {
  raw: string;
  smtpRaw: string;
  recipientEmails: string[];
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
};

export function buildComposeMessage(input: {
  accountEmail: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  images?: InlineImageInput[];
  attachments?: AttachmentInput[];
}): ComposeMessage {
  const fromEmail = sanitizeEmail(input.accountEmail);
  const to = normalizeEmailList(input.to);
  if (to.length === 0) throw new Error("Brakuje co najmniej jednego adresata w polu Do.");

  const used = new Set(to);
  const cc = normalizeEmailList(input.cc || []).filter(email => !used.has(email) && used.add(email));
  const bcc = normalizeEmailList(input.bcc || []).filter(email => !used.has(email) && used.add(email));
  const body = input.body.trim();
  const content = buildMessageContent(body, input.images, input.attachments);
  if (!body && content.imageCount === 0 && content.attachmentCount === 0) {
    throw new Error("Brakuje treści wiadomości, wklejonego obrazu lub załącznika.");
  }

  const subject = sanitizeHeaderValue(input.subject || "");
  const commonHeaders = [
    `From: <${fromEmail}>`,
    `To: ${formatEmailList(to)}`,
    cc.length ? `Cc: ${formatEmailList(cc)}` : "",
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <patmail-${randomUUID()}@local.patmail>`,
    "MIME-Version: 1.0",
    ...content.headers
  ].filter(Boolean);
  const smtpHeaders = commonHeaders;
  const gmailHeaders = bcc.length
    ? [commonHeaders[0], commonHeaders[1], commonHeaders[2], `Bcc: ${formatEmailList(bcc)}`, ...commonHeaders.slice(3)].filter(Boolean)
    : commonHeaders;

  return {
    raw: normalizeCrlf(`${gmailHeaders.join("\r\n")}\r\n\r\n${content.body}`),
    smtpRaw: normalizeCrlf(`${smtpHeaders.join("\r\n")}\r\n\r\n${content.body}`),
    recipientEmails: [...to, ...cc, ...bcc],
    subject,
    to,
    cc,
    bcc
  };
}

function normalizeEmailList(values: string[]) {
  const seen = new Set<string>();
  return values
    .map(sanitizeEmail)
    .filter(email => {
      if (seen.has(email)) return false;
      seen.add(email);
      return true;
    });
}

function formatEmailList(values: string[]) {
  return values.map(email => `<${email}>`).join(", ");
}

function sanitizeEmail(value: string) {
  const clean = sanitizeHeaderValue(value).replace(/[<>]/g, "").toLowerCase();
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean)) {
    throw new Error(`Nieprawidłowy adres e-mail: ${clean || "(pusty)"}.`);
  }
  return clean;
}

function encodeHeader(value: string) {
  const clean = sanitizeHeaderValue(value);
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function sanitizeHeaderValue(value: string) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeCrlf(value: string) {
  return value.replace(/\r?\n/g, "\r\n");
}
