import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import type { ParsedGmailMessage } from "../src/server/gmail.js";
import { relatedMessagesByHeaders, threadMessageForClient, threadMessagesNewestFirst } from "../src/server/mailThread.js";

const testDataDir = mkdtempSync(path.join(tmpdir(), "patmail-thread-test-"));
process.env.DATA_DIR = testDataDir;
after(() => rmSync(testDataDir, { recursive: true, force: true }));

function message(id: string, date: string, headers: Record<string, string>): ParsedGmailMessage {
  return {
    id,
    threadId: id,
    snippet: "",
    internalDate: String(new Date(date).getTime()),
    headers,
    text: "",
    html: "",
    attachments: []
  };
}

test("IMAP fallback connects replies by message headers, not by subject alone", () => {
  const original = message("original", "2026-09-20", { "message-id": "<root@example.com>" });
  const reply = message("reply", "2026-09-21", {
    "message-id": "<reply@example.com>",
    "in-reply-to": "<root@example.com>",
    references: "<root@example.com>"
  });
  const followUp = message("follow-up", "2026-09-22", {
    "message-id": "<follow-up@example.com>",
    references: "<root@example.com> <reply@example.com>"
  });
  const unrelated = message("unrelated", "2026-09-23", { "message-id": "<other@example.com>" });

  const matches = relatedMessagesByHeaders(reply, [unrelated, followUp, original]);
  assert.deepEqual(new Set(matches.map(item => item.id)), new Set(["original", "reply", "follow-up"]));
});

test("thread display puts latest messages first and removes copies from multiple IMAP folders", () => {
  const older = message("all-mail-copy", "2026-09-20", { "message-id": "<same@example.com>" });
  const duplicate = message("inbox-copy", "2026-09-20", { "message-id": "<SAME@example.com>" });
  const newer = message("reply", "2026-09-22", { "message-id": "<reply@example.com>" });

  assert.deepEqual(
    threadMessagesNewestFirst([older, duplicate, newer]).map(item => item.id),
    ["reply", "all-mail-copy"]
  );
});

test("Gmail retrieves complete thread including the sent reply", async () => {
  const { getParsedThread } = await import("../src/server/gmail.js");
  const calls: unknown[] = [];
  const gmail = {
    users: {
      threads: {
        get: async (request: unknown) => {
          calls.push(request);
          return { data: { messages: [
            {
              id: "received",
              threadId: "conversation",
              internalDate: "1789905600000",
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: "Sender <sender@example.com>" },
                  { name: "Message-ID", value: "<received@example.com>" }
                ],
                body: { data: Buffer.from("First message").toString("base64url") }
              }
            },
            {
              id: "sent",
              threadId: "conversation",
              internalDate: "1789992000000",
              payload: {
                mimeType: "text/plain",
                headers: [
                  { name: "From", value: "Me <me@example.com>" },
                  { name: "To", value: "sender@example.com" },
                  { name: "Message-ID", value: "<sent@example.com>" },
                  { name: "In-Reply-To", value: "<received@example.com>" }
                ],
                body: { data: Buffer.from("My reply").toString("base64url") }
              }
            }
          ] } };
        }
      }
    }
  };

  const parsed = await getParsedThread(gmail as Parameters<typeof getParsedThread>[0], "conversation");
  assert.deepEqual(calls, [{ userId: "me", id: "conversation", format: "full" }]);
  const newestFirst = threadMessagesNewestFirst(parsed);
  assert.deepEqual(newestFirst.map(item => item.id), ["sent", "received"]);
  assert.equal(threadMessageForClient("account", newestFirst[0]).text, "My reply");
});

test("sent reply carries headers needed to reconnect an IMAP conversation", async () => {
  const { buildReplyMessage } = await import("../src/server/mailReply.js");
  const original = message("received", "2026-09-20", {
    from: "Sender <sender@example.com>",
    subject: "Question",
    "message-id": "<received@example.com>"
  });
  const reply = buildReplyMessage({ accountEmail: "me@example.com", original, body: "My answer" });
  assert.equal(reply.toEmail, "sender@example.com");
  assert.match(reply.raw, /\r\nIn-Reply-To: <received@example\.com>\r\n/);
  assert.match(reply.raw, /\r\nReferences: <received@example\.com>\r\n/);
  assert.match(reply.raw, /\r\nMessage-ID: <patmail-[^>]+>\r\n/);
  const sent = message("sent", "2026-09-21", {
    "message-id": reply.raw.match(/\r\nMessage-ID: ([^\r]+)/)?.[1] || "",
    "in-reply-to": "<received@example.com>",
    references: "<received@example.com>"
  });
  assert.deepEqual(
    relatedMessagesByHeaders(original, [sent]).map(item => item.id),
    ["received", "sent"]
  );
});

test("thread API payload keeps sender, timestamp, body and attachment metadata", () => {
  const sent = message("sent", "2026-09-21", {
    from: "Me <me@example.com>",
    to: "sender@example.com",
    subject: "Re: Question"
  });
  sent.text = "My answer";
  sent.attachments = [{ attachmentId: "a1", filename: "note.pdf", mimeType: "application/pdf", partId: "1", size: 42 }];
  assert.deepEqual(threadMessageForClient("account", sent), {
    id: "sent",
    accountId: "account",
    from: "Me <me@example.com>",
    to: "sender@example.com",
    subject: "Re: Question",
    receivedAt: "2026-09-21T00:00:00.000Z",
    text: "My answer",
    html: "",
    attachments: [{ attachmentId: "a1", filename: "note.pdf", mimeType: "application/pdf", size: 42 }]
  });
});
