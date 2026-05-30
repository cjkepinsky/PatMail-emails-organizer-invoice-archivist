import {
  downloadAttachment,
  getParsedMessage,
  gmailForAccount,
  isMessageUnread,
  listMessageIds,
  markMessageRead,
  markMessageUnread
} from "./gmail.js";
import {
  downloadImapAttachment,
  getImapParsedMessage,
  isImapMessageUnread,
  listImapMessageIds,
  markImapMessageRead,
  markImapMessageUnread,
  verifyImapConfig
} from "./imap.js";
import type { GmailAccount, ImapAccountConfig } from "./types.js";

export async function listAccountMessageIds(
  account: GmailAccount,
  query: string,
  onPage?: (count: number) => void
) {
  if (account.authType === "imap") return listImapMessageIds(account, query, onPage);
  return listMessageIds(gmailForAccount(account), query, onPage);
}

export async function getAccountParsedMessage(account: GmailAccount, messageId: string) {
  if (account.authType === "imap") return getImapParsedMessage(account, messageId);
  return getParsedMessage(gmailForAccount(account), messageId);
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

export async function testImapAccount(config: ImapAccountConfig) {
  return verifyImapConfig(config);
}
