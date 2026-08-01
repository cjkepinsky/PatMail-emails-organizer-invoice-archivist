import { Buffer } from "node:buffer";
import { ImapFlow, type FetchMessageObject, type SearchObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import { normalizeHtml, normalizeWhitespace, sanitizeEmailHtml } from "./gmail.js";
import type { GmailAccount, ImapAccountConfig } from "./types.js";
import type { GmailAttachmentMeta, ParsedGmailMessage } from "./gmail.js";

type ImapMessageRef = {
  mailbox: string;
  uidValidity: string;
  uid: number;
};

const IMAP_CONNECTION_TIMEOUT_MS = 30_000;
const IMAP_GREETING_TIMEOUT_MS = 16_000;
const IMAP_SOCKET_TIMEOUT_MS = 45_000;
const IMAP_OPERATION_TIMEOUT_MS = 90_000;
const IMAP_CLOSE_TIMEOUT_MS = 5_000;

type PatMailImapClient = ImapFlow & {
  patMailLastError?: Error;
};

export function parseImapConfig(account: GmailAccount): ImapAccountConfig {
  const parsed = JSON.parse(account.imapConfigJson || "{}") as Partial<ImapAccountConfig>;
  const host = String(parsed.host || "imap.gmail.com").trim();
  const port = Number(parsed.port || 993);
  const user = String(parsed.user || account.email).trim();
  const password = String(parsed.password || "");
  const mailbox = parsed.mailbox ? String(parsed.mailbox) : undefined;

  if (!host) throw new Error(`Brakuje hosta IMAP dla konta ${account.email}`);
  if (!user) throw new Error(`Brakuje użytkownika IMAP dla konta ${account.email}`);
  if (!password) throw new Error(`Brakuje hasła aplikacji IMAP dla konta ${account.email}`);

  return {
    host,
    port: Number.isFinite(port) ? port : 993,
    secure: parsed.secure !== false,
    user,
    password,
    mailbox
  };
}

export async function verifyImapConfig(config: ImapAccountConfig) {
  const client = createClient(config, config.user);
  try {
    await runImapOperation(client, config.user, "łączenie z IMAP", () => client.connect());
    const mailbox = await runImapOperation(client, config.user, "wybór skrzynki IMAP", () =>
      resolveMailbox(client, config.mailbox)
    );
    await runImapOperation(client, config.user, "otwieranie skrzynki IMAP", () => client.mailboxOpen(mailbox));
    return { mailbox };
  } finally {
    await closeClient(client);
  }
}

export async function listImapMessageIds(
  account: GmailAccount,
  query: string,
  onPage?: (count: number) => void,
  limit?: number
) {
  return withMailbox(account, undefined, async (client, mailbox, uidValidity) => {
    const result = (await searchMessages(client, query)).sort((left, right) => right - left);
    const limited = limit ? result.slice(0, limit) : result;
    const ids = limited.map(uid => encodeImapMessageId({ mailbox, uidValidity, uid }));
    onPage?.(ids.length);
    return ids;
  });
}

export async function getImapParsedMessage(account: GmailAccount, messageId: string): Promise<ParsedGmailMessage> {
  const ref = decodeImapMessageId(messageId);
  return withMailbox(account, ref.mailbox, async (client, mailbox, uidValidity) => {
    const fetched = await fetchOne(client, ref.uid);
    const source = fetched.source || Buffer.alloc(0);
    const parsed = await simpleParser(source);
    const id = encodeImapMessageId({ mailbox, uidValidity, uid: fetched.uid || ref.uid });
    return parsedMailToMessage(parsed, fetched, id);
  });
}

export async function getImapParsedMessages(account: GmailAccount, messageIds: string[]) {
  const messages = new Map<string, ParsedGmailMessage>();
  const groups = groupImapMessageRefs(messageIds);

  for (const [mailboxName, refs] of groups) {
    await withMailbox(account, mailboxName, async (client, mailbox, uidValidity) => {
      const refsByUid = refsByUidMap(refs);
      const uidSet = imapUidSet(refs);
      if (!uidSet) return;

      for await (const fetched of client.fetch(
        uidSet,
        {
          source: true,
          uid: true,
          flags: true,
          internalDate: true,
          threadId: true
        },
        { uid: true }
      )) {
        const uid = Number(fetched.uid || 0);
        if (!uid) continue;
        const parsed = await simpleParser(fetched.source || Buffer.alloc(0));
        const canonicalId = encodeImapMessageId({ mailbox, uidValidity, uid });
        const message = parsedMailToMessage(parsed, fetched, canonicalId);

        for (const ref of refsByUid.get(uid) || []) {
          messages.set(ref.messageId, { ...message, id: ref.messageId });
        }
      }
    });
  }

  return messages;
}

export async function downloadImapAttachment(account: GmailAccount, messageId: string, attachmentId: string) {
  const ref = decodeImapMessageId(messageId);
  return withMailbox(account, ref.mailbox, async client => {
    const fetched = await fetchOne(client, ref.uid);
    const parsed = await simpleParser(fetched.source || Buffer.alloc(0));
    const attachment = getAttachmentById(parsed, attachmentId);
    if (!attachment) throw new Error("Nie znaleziono załącznika");
    return Buffer.from(attachment.content);
  });
}

export async function markImapMessageRead(account: GmailAccount, messageId: string) {
  const ref = decodeImapMessageId(messageId);
  await withMailbox(account, ref.mailbox, async client => {
    await client.messageFlagsAdd(String(ref.uid), ["\\Seen"], { uid: true });
  });
}

export async function markImapMessageUnread(account: GmailAccount, messageId: string) {
  const ref = decodeImapMessageId(messageId);
  await withMailbox(account, ref.mailbox, async client => {
    await client.messageFlagsRemove(String(ref.uid), ["\\Seen"], { uid: true });
  });
}

export async function isImapMessageUnread(account: GmailAccount, messageId: string) {
  const ref = decodeImapMessageId(messageId);
  return withMailbox(account, ref.mailbox, async client => {
    const fetched = await client.fetchOne(String(ref.uid), { uid: true, flags: true }, { uid: true });
    if (!fetched) return false;
    return !Boolean(fetched.flags?.has("\\Seen"));
  });
}

export async function getImapUnreadStates(account: GmailAccount, messageIds: string[]) {
  const states = new Map<string, boolean>();
  const groups = groupImapMessageRefs(messageIds);

  for (const [mailboxName, refs] of groups) {
    await withMailbox(account, mailboxName, async client => {
      const refsByUid = refsByUidMap(refs);
      const uidSet = imapUidSet(refs);
      if (!uidSet) return;

      for await (const fetched of client.fetch(uidSet, { uid: true, flags: true }, { uid: true })) {
        const uid = Number(fetched.uid || 0);
        if (!uid) continue;
        const unread = !Boolean(fetched.flags?.has("\\Seen"));
        for (const ref of refsByUid.get(uid) || []) {
          states.set(ref.messageId, unread);
        }
      }
    });
  }

  for (const id of new Set(messageIds)) {
    if (!states.has(id)) states.set(id, false);
  }

  return states;
}

function createClient(config: ImapAccountConfig, accountEmail = config.user) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    },
    disableAutoIdle: true,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    logger: false
  }) as PatMailImapClient;

  client.on("error", error => {
    client.patMailLastError = normalizeImapError(error, accountEmail);
  });

  return client;
}

async function withMailbox<T>(
  account: GmailAccount,
  requestedMailbox: string | undefined,
  callback: (client: ImapFlow, mailbox: string, uidValidity: string) => Promise<T>
) {
  const config = parseImapConfig(account);
  const client = createClient(config, account.email);
  try {
    await runImapOperation(client, account.email, "łączenie z IMAP", () => client.connect());
    const mailbox =
      requestedMailbox ||
      (await runImapOperation(client, account.email, "wybór skrzynki IMAP", () =>
        resolveMailbox(client, config.mailbox)
      ));
    const opened = await runImapOperation(client, account.email, "otwieranie skrzynki IMAP", () =>
      client.mailboxOpen(mailbox)
    );
    return await runImapOperation(client, account.email, "operacja IMAP", () =>
      callback(client, mailbox, String(opened.uidValidity))
    );
  } catch (error) {
    throw normalizeImapError((client as PatMailImapClient).patMailLastError || error, account.email);
  } finally {
    await closeClient(client);
  }
}

async function closeClient(client: ImapFlow) {
  try {
    const logout = client.logout();
    logout.catch(() => {});
    await Promise.race([
      logout,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout zamykania połączenia IMAP")), IMAP_CLOSE_TIMEOUT_MS)
      )
    ]);
  } catch {
    client.close();
  }
}

function runImapOperation<T>(
  client: PatMailImapClient,
  accountEmail: string,
  action: string,
  operation: () => Promise<T>,
  timeoutMs = IMAP_OPERATION_TIMEOUT_MS
) {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      client.removeListener("error", onError);
      callback();
    };
    const onError = (error: unknown) => {
      finish(() => reject(normalizeImapError(error, accountEmail, action)));
    };
    const timeout = setTimeout(() => {
      client.close();
      finish(() => reject(normalizeImapError(new Error(`Timeout IMAP podczas: ${action}`), accountEmail, action)));
    }, timeoutMs);

    client.once("error", onError);
    try {
      operation().then(
        result => finish(() => resolve(result)),
        error => finish(() => reject(normalizeImapError(error, accountEmail, action)))
      );
    } catch (error) {
      finish(() => reject(normalizeImapError(error, accountEmail, action)));
    }
  });
}

function normalizeImapError(error: unknown, accountEmail: string, action?: string) {
  const original = error instanceof Error ? error : new Error(String(error));
  const message = original.message || String(error);
  const errorWithCode = original as Error & { code?: unknown };
  const code = typeof errorWithCode.code === "string" ? errorWithCode.code : "";

  if (/socket timeout|timed?\s*out|timeout|etimeout/i.test(`${code} ${message}`)) {
    return new Error(
      `Timeout IMAP dla konta ${accountEmail}${action ? ` podczas: ${action}` : ""}. Serwer poczty nie odpowiedział w czasie.`
    );
  }

  return original;
}

async function resolveMailbox(client: ImapFlow, preferred?: string) {
  if (preferred) return preferred;
  const boxes = await client.list();
  const allMail = boxes.find(box => box.specialUse === "\\All" || box.flags.has("\\All"));
  if (allMail) return allMail.path;
  const archive = boxes.find(box => box.specialUse === "\\Archive" || box.flags.has("\\Archive"));
  if (archive) return archive.path;
  const namedAllMail = boxes.find(box => /all mail|cała poczta|cala poczta/i.test(box.path));
  return namedAllMail?.path || "INBOX";
}

async function searchMessages(client: ImapFlow, query: string) {
  try {
    const gmailResult = await client.search({ gmailraw: query }, { uid: true });
    return Array.isArray(gmailResult) ? gmailResult : [];
  } catch {
    const fallbackResult = await client.search(buildFallbackSearch(query), { uid: true });
    return Array.isArray(fallbackResult) ? fallbackResult : [];
  }
}

function buildFallbackSearch(query: string): SearchObject {
  const search: SearchObject = { all: true };
  if (/\bis:unread\b/i.test(query)) search.seen = false;

  const after = query.match(/\bafter:(\d{4})\/(\d{2})\/(\d{2})\b/i);
  if (after) search.since = `${after[1]}-${after[2]}-${after[3]}`;

  const from = query.match(/\bfrom:([^\s)]+)/i);
  if (from) search.from = from[1].replace(/^"|"$/g, "");

  return search;
}

async function fetchOne(client: ImapFlow, uid: number) {
  const fetched = await client.fetchOne(
    String(uid),
    {
      source: true,
      uid: true,
      flags: true,
      internalDate: true,
      threadId: true
    },
    { uid: true }
  );
  if (!fetched) throw new Error("Nie znaleziono wiadomości IMAP");
  return fetched;
}

function parsedMailToMessage(parsed: ParsedMail, fetched: FetchMessageObject, id: string): ParsedGmailMessage {
  const html = typeof parsed.html === "string" ? sanitizeEmailHtml(parsed.html) : "";
  const text = parsed.text || htmlToText(html);
  const headers = {
    from: parsed.from?.text || headerText(parsed, "from"),
    to: addressText(parsed.to) || headerText(parsed, "to"),
    cc: addressText(parsed.cc) || headerText(parsed, "cc"),
    bcc: addressText(parsed.bcc) || headerText(parsed, "bcc"),
    "reply-to": parsed.replyTo?.text || headerText(parsed, "reply-to"),
    subject: parsed.subject || headerText(parsed, "subject"),
    date: parsed.date?.toUTCString() || headerText(parsed, "date"),
    "message-id": parsed.messageId || headerText(parsed, "message-id"),
    "in-reply-to": headerText(parsed, "in-reply-to"),
    references: Array.isArray(parsed.references)
      ? parsed.references.join(" ")
      : parsed.references || headerText(parsed, "references")
  };

  return {
    id,
    threadId: fetched.threadId ? String(fetched.threadId) : id,
    snippet: normalizeWhitespace(text).slice(0, 180),
    internalDate: imapInternalDate(fetched.internalDate),
    headers,
    text: normalizeWhitespace(text),
    html: normalizeHtml(html),
    attachments: parsed.attachments.map((attachment, index): GmailAttachmentMeta => ({
      attachmentId: imapAttachmentId(index),
      filename: attachment.filename || `attachment-${index + 1}`,
      mimeType: attachment.contentType || "application/octet-stream",
      partId: String(index),
      size: Number(attachment.size || attachment.content.length || 0)
    }))
  };
}

function addressText(value: ParsedMail["to"]) {
  if (!value) return "";
  if (Array.isArray(value)) return value.map(item => item.text).filter(Boolean).join(", ");
  return value.text || "";
}

function getAttachmentById(parsed: ParsedMail, attachmentId: string) {
  const index = Number(attachmentId.replace(/^imap-att-/, ""));
  if (!Number.isInteger(index) || index < 0) return null;
  return parsed.attachments[index] || null;
}

function imapAttachmentId(index: number) {
  return `imap-att-${index}`;
}

function imapInternalDate(value: FetchMessageObject["internalDate"]) {
  if (value instanceof Date) return String(value.getTime());
  const parsed = new Date(String(value || ""));
  return Number.isNaN(parsed.getTime()) ? String(Date.now()) : String(parsed.getTime());
}

function headerText(parsed: ParsedMail, key: string) {
  const value = parsed.headers.get(key.toLowerCase()) as unknown;
  if (!value) return "";
  if (value instanceof Date) return value.toUTCString();
  if (Array.isArray(value)) return value.map(item => String(item)).join(", ");
  if (typeof value === "object" && "text" in value) return String((value as { text?: unknown }).text || "");
  return String(value);
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

function encodeImapMessageId(ref: ImapMessageRef) {
  return `imap:${Buffer.from(JSON.stringify(ref), "utf8").toString("base64url")}`;
}

type ImapMessageRefWithId = ImapMessageRef & { messageId: string };

function groupImapMessageRefs(messageIds: string[]) {
  const groups = new Map<string, ImapMessageRefWithId[]>();
  for (const messageId of new Set(messageIds)) {
    const ref = decodeImapMessageId(messageId);
    const mailbox = ref.mailbox || "INBOX";
    const group = groups.get(mailbox) || [];
    group.push({ ...ref, mailbox, messageId });
    groups.set(mailbox, group);
  }
  return groups;
}

function refsByUidMap(refs: ImapMessageRefWithId[]) {
  const map = new Map<number, ImapMessageRefWithId[]>();
  for (const ref of refs) {
    const group = map.get(ref.uid) || [];
    group.push(ref);
    map.set(ref.uid, group);
  }
  return map;
}

function imapUidSet(refs: ImapMessageRefWithId[]) {
  return [...new Set(refs.map(ref => ref.uid))]
    .filter(uid => Number.isFinite(uid))
    .sort((left, right) => left - right)
    .join(",");
}

function decodeImapMessageId(messageId: string): ImapMessageRef {
  if (!messageId.startsWith("imap:")) {
    const uid = Number(messageId);
    if (Number.isFinite(uid)) return { mailbox: "INBOX", uidValidity: "", uid };
  }

  try {
    const decoded = JSON.parse(Buffer.from(messageId.replace(/^imap:/, ""), "base64url").toString("utf8")) as ImapMessageRef;
    if (!decoded.mailbox || !Number.isFinite(Number(decoded.uid))) throw new Error("Invalid IMAP message id");
    return {
      mailbox: String(decoded.mailbox),
      uidValidity: String(decoded.uidValidity || ""),
      uid: Number(decoded.uid)
    };
  } catch {
    throw new Error("Nieprawidłowy identyfikator wiadomości IMAP");
  }
}
