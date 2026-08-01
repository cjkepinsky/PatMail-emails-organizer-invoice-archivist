import {
  downloadAttachment,
  getParsedMessage,
  gmailForAccount,
  isMessageUnread,
  listMessageIds,
  markMessageRead,
  markMessageUnread,
  sendRawMessage
} from "./gmail.js";
import {
  downloadImapAttachment,
  getImapParsedMessage,
  getImapParsedMessages,
  getImapUnreadStates,
  isImapMessageUnread,
  listImapMessageIds,
  markImapMessageRead,
  markImapMessageUnread,
  parseImapConfig,
  verifyImapConfig
} from "./imap.js";
import { buildReplyMessage } from "./mailReply.js";
import { sendSmtpMail, smtpHostForImapHost } from "./smtp.js";
import type { GmailAccount, ImapAccountConfig } from "./types.js";

export async function listAccountMessageIds(
  account: GmailAccount,
  query: string,
  onPage?: (count: number) => void,
  limit?: number
) {
  if (account.authType === "imap") return listImapMessageIds(account, query, onPage, limit);
  return listMessageIds(gmailForAccount(account), query, onPage, limit);
}

export async function getAccountParsedMessage(account: GmailAccount, messageId: string) {
  if (account.authType === "imap") return getImapParsedMessage(account, messageId);
  return getParsedMessage(gmailForAccount(account), messageId);
}

export async function getAccountParsedMessages(account: GmailAccount, messageIds: string[]) {
  const uniqueIds = [...new Set(messageIds)];
  if (account.authType === "imap") return getImapParsedMessages(account, uniqueIds);

  const gmail = gmailForAccount(account);
  const messages = new Map();
  await mapWithConcurrency(uniqueIds, 6, async id => {
    try {
      messages.set(id, await getParsedMessage(gmail, id));
    } catch {
      // Individual messages can disappear or fail transiently; keep the rest of the sync moving.
    }
  });
  return messages;
}

export async function downloadAccountAttachment(
  account: GmailAccount,
  messageId: string,
  attachmentId: string
) {
  if (account.authType === "imap") return downloadImapAttachment(account, messageId, attachmentId);
  return downloadAttachment(gmailForAccount(account), messageId, attachmentId);
}

export async function markAccountMessageRead(account: GmailAccount, messageId: string) {
  if (account.authType === "imap") return markImapMessageRead(account, messageId);
  return markMessageRead(gmailForAccount(account), messageId);
}

export async function markAccountMessageUnread(account: GmailAccount, messageId: string) {
  if (account.authType === "imap") return markImapMessageUnread(account, messageId);
  return markMessageUnread(gmailForAccount(account), messageId);
}

export async function isAccountMessageUnread(account: GmailAccount, messageId: string) {
  if (account.authType === "imap") return isImapMessageUnread(account, messageId);
  return isMessageUnread(gmailForAccount(account), messageId);
}

export async function getAccountUnreadStates(account: GmailAccount, messageIds: string[]) {
  const uniqueIds = [...new Set(messageIds)];
  if (account.authType === "imap") return getImapUnreadStates(account, uniqueIds);

  const gmail = gmailForAccount(account);
  const states = new Map<string, boolean>();
  await mapWithConcurrency(uniqueIds, 10, async id => {
    try {
      states.set(id, await isMessageUnread(gmail, id));
    } catch {
      // Preserve the previous best-effort behavior for individual Gmail lookup failures.
    }
  });
  return states;
}

export async function replyToAccountMessage(account: GmailAccount, messageId: string, body: string) {
  const original = await getAccountParsedMessage(account, messageId);
  const reply = buildReplyMessage({
    accountEmail: account.email,
    original,
    body
  });

  if (account.authType === "imap") {
    const config = parseImapConfig(account);
    await sendSmtpMail({
      host: smtpHostForImapHost(config.host),
      port: 465,
      username: config.user,
      password: config.password,
      fromEmail: config.user,
      toEmail: reply.toEmail,
      rawMessage: reply.raw
    });
  } else {
    await sendRawMessage(gmailForAccount(account), {
      raw: reply.raw,
      threadId: reply.threadId
    });
  }

  return {
    to: reply.toEmail,
    subject: reply.subject
  };
}

export async function testImapAccount(config: ImapAccountConfig) {
  return verifyImapConfig(config);
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}
