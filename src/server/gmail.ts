import { google, gmail_v1 } from "googleapis";
import { serverConfig } from "./config.js";
import { updateAccountTokens } from "./db.js";
import type { GmailAccount } from "./types.js";

export type ParsedGmailMessage = {
  id: string;
  threadId: string;
  snippet: string;
  internalDate: string;
  headers: Record<string, string>;
  text: string;
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
  return new google.auth.OAuth2(
    serverConfig.googleClientId,
    serverConfig.googleClientSecret,
    serverConfig.googleRedirectUri
  );
}

export function assertGoogleConfigured() {
  if (!serverConfig.googleClientId || !serverConfig.googleClientSecret) {
    throw new Error("Brakuje GOOGLE_CLIENT_ID albo GOOGLE_CLIENT_SECRET w .env");
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
      "https://www.googleapis.com/auth/gmail.readonly",
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
    attachments: []
  };

  collectParts(message.payload, parsed);
  parsed.text = normalizeWhitespace(parsed.text);
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

function normalizeWhitespace(text: string) {
  return text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
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
