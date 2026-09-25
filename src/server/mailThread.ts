import type { ParsedGmailMessage } from "./gmail.js";

export function threadMessagesNewestFirst(messages: ParsedGmailMessage[]) {
  const seen = new Set<string>();
  return messages
    .filter(message => {
      const key = normalizeMessageId(message.headers["message-id"]) || message.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => messageTime(right) - messageTime(left));
}

export function threadMessageForClient(accountId: string, message: ParsedGmailMessage) {
  return {
    id: message.id,
    accountId,
    from: message.headers.from || "",
    to: message.headers.to || "",
    subject: message.headers.subject || "",
    receivedAt: message.internalDate && Number.isFinite(Number(message.internalDate))
      ? new Date(Number(message.internalDate)).toISOString()
      : message.headers.date || "",
    text: message.text || message.snippet || "",
    html: message.html || "",
    attachments: message.attachments.map(attachment => ({
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size
    }))
  };
}

export function relatedMessagesByHeaders(selected: ParsedGmailMessage, candidates: ParsedGmailMessage[]) {
  const related = new Set<ParsedGmailMessage>([selected]);
  const knownIds = new Set(referenceIds(selected));
  const remaining = candidates.filter(message => message.id !== selected.id);

  let changed = true;
  while (changed) {
    changed = false;
    for (const message of remaining) {
      if (related.has(message)) continue;
      const ids = referenceIds(message);
      if (!ids.some(id => knownIds.has(id))) continue;
      related.add(message);
      ids.forEach(id => knownIds.add(id));
      changed = true;
    }
  }

  return [...related];
}

function referenceIds(message: ParsedGmailMessage) {
  const header = [
    message.headers["message-id"],
    message.headers["in-reply-to"],
    message.headers.references
  ].filter(Boolean).join(" ");
  return [...header.matchAll(/<([^<>\s]+)>/g)]
    .map(match => normalizeMessageId(match[1]))
    .filter(Boolean);
}

function normalizeMessageId(value: string | undefined) {
  return String(value || "").trim().replace(/^<|>$/g, "").toLowerCase();
}

function messageTime(message: ParsedGmailMessage) {
  const internalDate = Number(message.internalDate);
  if (Number.isFinite(internalDate) && internalDate > 0) return internalDate;
  const headerDate = Date.parse(message.headers.date || "");
  return Number.isFinite(headerDate) ? headerDate : 0;
}
