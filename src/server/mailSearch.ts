import { getActiveProfileId, listAccounts, searchMailItems, upsertMailCache } from "./db.js";
import { messageDate, parseFromHeader } from "./gmail.js";
import { getAccountParsedMessages, listAccountMessageIds } from "./mailSource.js";

const REMOTE_RESULTS_PER_ACCOUNT = 30;
const REMOTE_ACCOUNT_CONCURRENCY = 2;

export async function searchMailAcrossAccounts(query: string, options: { limit?: number } = {}) {
  const searchQuery = query.trim();
  const limit = Math.max(1, Math.min(200, Number(options.limit || 100)));
  if (!searchQuery) return { items: [], warnings: [] as string[] };

  const profileId = getActiveProfileId();
  const accounts = listAccounts();
  const cachedItems = searchMailItems(searchQuery, { limit });
  const cachedKeys = new Set(cachedItems.map(item => `${item.accountId}:${item.messageId}`));
  const warnings: string[] = [];

  await mapWithConcurrency(accounts, REMOTE_ACCOUNT_CONCURRENCY, async account => {
    try {
      // No is:unread filter: Gmail/IMAP searches both read and unread mail.
      const messageIds = await listAccountMessageIds(account, searchQuery, undefined, REMOTE_RESULTS_PER_ACCOUNT);
      const missingIds = messageIds.filter(id => !cachedKeys.has(`${account.id}:${id}`));
      if (missingIds.length === 0) return;

      const messages = await getAccountParsedMessages(account, missingIds);
      for (const id of missingIds) {
        const message = messages.get(id);
        if (!message) continue;
        const from = parseFromHeader(message.headers.from || "");
        upsertMailCache({
          profileId,
          accountId: account.id,
          messageId: id,
          threadId: message.threadId,
          fromEmail: from.email,
          fromName: from.name,
          subject: message.headers.subject || "",
          snippet: message.snippet,
          receivedAt: messageDate(message).toISOString(),
          text: message.text || message.snippet || "",
          html: message.html,
          isUnread: message.isUnread === true
        });
      }
    } catch (error) {
      warnings.push(`${account.email}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return {
    items: searchMailItems(searchQuery, { limit }),
    warnings
  };
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
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
