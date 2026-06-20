import { google, gmail_v1 } from "googleapis";
import { getGoogleOAuthConfig, updateAccountTokens } from "./db.js";
import type { GmailAccount } from "./types.js";

export type ParsedGmailMessage = {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  headers: Record<string, string>;
  text: string;
  html: string;
  attachments: GmailAttachmentMeta[];
};

export type GmailAttachmentMeta = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  partId: string;
  size: number;
};

export function createOAuthClient() {
  const config = getGoogleOAuthConfig();
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
}

export function assertGoogleConfigured() {
  const config = getGoogleOAuthConfig();
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error("Brakuje GOOGLE_CLIENT_ID albo GOOGLE_CLIENT_SECRET w konfiguracji aplikacji");
  }
}

export function getAuthUrl(state: string) {
  assertGoogleConfigured();
  const oauth2 = createOAuthClient();
  return oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    state,
    scope: [
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/userinfo.email"
    ]
  });
}

export async function exchangeCode(code: string) {
  const oauth2 = createOAuthClient();
  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
  const me = await oauth2Api.userinfo.get();
  if (!me.data.email) throw new Error("Google nie zwrócił adresu email konta");

  return {
    email: me.data.email,
    tokens
  };
}

export function gmailForAccount(account: GmailAccount) {
  const auth = createOAuthClient();
  auth.setCredentials(JSON.parse(account.tokensJson));
  auth.on("tokens", tokens => {
    const current = JSON.parse(account.tokensJson);
    updateAccountTokens(account.id, JSON.stringify({ ...current, ...tokens }));
  });
  return google.gmail({ version: "v1", auth });
}

export async function listMessageIds(
  gmail: gmail_v1.Gmail,
  q: string,
  onPage?: (count: number) => void
) {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await gmail.users.messages.list({
      userId: "me",
      q,
      maxResults: 100,
      pageToken
    });
    const messages = response.data.messages || [];
    ids.push(...messages.map(message => message.id).filter(Boolean) as string[]);
    onPage?.(ids.length);
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return [...new Set(ids)];
}

export async function getParsedMessage(gmail: gmail_v1.Gmail, id: string): Promise<ParsedGmailMessage> {
  const response = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "full"
  });
  const message = response.data;
  const headers = Object.fromEntries(
    (message.payload?.headers || []).map(header => [
      header.name?.toLowerCase() || "",
      header.value || ""
    ])
  );

  const parsed: ParsedGmailMessage = {
    id,
    threadId: message.threadId || "",
    snippet: message.snippet || "",
    internalDate: message.internalDate || "",
    headers,
    text: "",
    html: "",
    attachments: []
  };

  collectParts(message.payload, parsed);
  parsed.text = normalizeWhitespace(parsed.text);
  parsed.html = normalizeHtml(parsed.html);
  return parsed;
}

export async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string
) {
  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId
  });
  if (!response.data.data) throw new Error("Załącznik nie zawiera danych");
  return Buffer.from(response.data.data, "base64url");
}

export async function markMessageRead(gmail: gmail_v1.Gmail, messageId: string) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      removeLabelIds: ["UNREAD"]
    }
  });
}

export async function markMessageUnread(gmail: gmail_v1.Gmail, messageId: string) {
  await gmail.users.messages.modify({
    userId: "me",
    id: messageId,
    requestBody: {
      addLabelIds: ["UNREAD"]
    }
  });
}

export async function isMessageUnread(gmail: gmail_v1.Gmail, messageId: string) {
  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "minimal"
  });
  return Boolean(response.data.labelIds?.includes("UNREAD"));
}

function collectParts(part: gmail_v1.Schema$MessagePart | undefined, output: ParsedGmailMessage) {
  if (!part) return;

  const filename = part.filename || "";
  const attachmentId = part.body?.attachmentId;
  if (attachmentId && filename) {
    output.attachments.push({
      attachmentId,
      filename,
      mimeType: part.mimeType || "",
      partId: part.partId || "",
      size: Number(part.body?.size || 0)
    });
  }

  if (part.body?.data) {
    const decoded = Buffer.from(part.body.data, "base64url").toString("utf8");
    if (part.mimeType === "text/plain") {
      output.text += `\n${decoded}`;
    } else if (part.mimeType === "text/html") {
      output.text += `\n${htmlToText(decoded)}`;
      output.html += `\n${sanitizeEmailHtml(decoded)}`;
    }
  }

  for (const child of part.parts || []) collectParts(child, output);
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function normalizeWhitespace(text: string) {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function normalizeHtml(html: string) {
  return html.replace(/\n{3,}/g, "\n\n").trim();
}

export function sanitizeEmailHtml(html: string) {
  const allowedTags = new Set([
    "a",
    "article",
    "b",
    "blockquote",
    "br",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "i",
    "li",
    "ol",
    "p",
    "pre",
    "section",
    "small",
    "span",
    "strong",
    "sub",
    "sup",
    "table",
    "tbody",
    "td",
    "tfoot",
    "th",
    "thead",
    "tr",
    "u",
    "ul"
  ]);

  let sanitized = html
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(
      /<(script|style|head|meta|link|title|svg|img|picture|source|video|audio|iframe|object|embed|form|input|button|textarea|select|option|canvas|noscript)\b[\s\S]*?<\/\1>/gi,
      ""
    )
    .replace(
      /<(img|source|video|audio|iframe|object|embed|input|button|textarea|select|option|canvas|meta|link)\b[^>]*\/?>/gi,
      ""
    )
    .replace(/<\/?(html|body|head)\b[^>]*>/gi, "");

  sanitized = sanitized.replace(/<([a-z0-9:-]+)([^>]*)>/gi, (match, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!allowedTags.has(tag)) return "";
    if (tag === "br" || tag === "hr") return `<${tag}>`;
    if (tag === "a") {
      const hrefMatch = String(rawAttrs).match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = hrefMatch ? hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || "" : "";
      const safeHref = isSafeHref(href) ? escapeHtmlAttribute(href) : "";
      return safeHref
        ? `<a href="${safeHref}" target="_blank" rel="noreferrer noopener">`
        : "<a>";
    }
    return `<${tag}>`;
  });

  sanitized = sanitized.replace(/<\/([a-z0-9:-]+)>/gi, (match, rawTag) => {
    const tag = String(rawTag).toLowerCase();
    return allowedTags.has(tag) ? `</${tag}>` : "";
  });

  return sanitized;
}

function isSafeHref(href: string) {
  const normalized = href.trim().toLowerCase();
  return normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("mailto:") ||
    normalized.startsWith("tel:") ||
    normalized.startsWith("#");
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function parseFromHeader(value: string) {
  const match = value.match(/^(?:"?([^"<]*)"?\s*)?<?([^<>\s]+@[^<>\s]+)>?$/);
  if (!match) return { name: "", email: value.trim() };
  return {
    name: (match[1] || "").trim(),
    email: (match[2] || value).trim().toLowerCase()
  };
}

export function messageDate(message: ParsedGmailMessage) {
  const sent = new Date(message.headers.date || "");
  if (!Number.isNaN(sent.getTime())) return sent;
  const internal = Number(message.internalDate || 0);
  if (internal) return new Date(internal);
  return new Date();
}
