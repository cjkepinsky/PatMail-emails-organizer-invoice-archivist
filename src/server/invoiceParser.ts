import { PDFParse } from "pdf-parse";
import type { ExtractedInvoiceInfo } from "./types.js";

const invoiceDateHints = [
  "invoice date",
  "date of issue",
  "issue date",
  "data wystawienia",
  "data faktury",
  "wystawiono",
  "receipt date"
];

const dueDateHints = [
  "due date",
  "payment due",
  "due",
  "termin płatności",
  "platne do",
  "płatne do",
  "pay by",
  "payment deadline"
];

export async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result.text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  } catch {
    return "";
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

export function extractInvoiceInfo(input: {
  text: string;
  emailSentDate: Date;
  gmailReceivedDate: Date;
}): ExtractedInvoiceInfo {
  const invoiceDate = findDateNearHints(input.text, invoiceDateHints) || findAnyDate(input.text);
  const dueDate = findDateNearHints(input.text, dueDateHints);
  const amountInfo = findAmount(input.text);
  const invoiceNumber = findInvoiceNumber(input.text);

  if (invoiceDate) {
    return {
      invoiceDate,
      dueDate,
      amount: amountInfo.amount,
      currency: amountInfo.currency,
      invoiceNumber,
      dateSource: "invoice_text"
    };
  }

  const fallbackSent = toIsoDate(input.emailSentDate);
  if (fallbackSent) {
    return {
      invoiceDate: fallbackSent,
      dueDate,
      amount: amountInfo.amount,
      currency: amountInfo.currency,
      invoiceNumber,
      dateSource: "email_sent_date"
    };
  }

  return {
    invoiceDate: toIsoDate(input.gmailReceivedDate),
    dueDate,
    amount: amountInfo.amount,
    currency: amountInfo.currency,
    invoiceNumber,
    dateSource: "gmail_received_date"
  };
}

export function invoiceMonth(date: string | null) {
  if (!date) return new Date().toISOString().slice(0, 7);
  return date.slice(0, 7);
}

function findDateNearHints(text: string, hints: string[]) {
  const lower = text.toLowerCase();
  for (const hint of hints) {
    let index = lower.indexOf(hint);
    while (index !== -1) {
      const window = text.slice(index, index + 220);
      const found = findAnyDate(window);
      if (found) return found;
      index = lower.indexOf(hint, index + hint.length);
    }
  }
  return null;
}

function findAnyDate(text: string) {
  const iso = text.match(/\b(20\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/);
  if (iso) return normalizeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const eu = text.match(/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](20\d{2})\b/);
  if (eu) return normalizeDate(Number(eu[3]), Number(eu[2]), Number(eu[1]));

  const named = text.match(
    /\b(0?[1-9]|[12]\d|3[01])\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/i
  );
  if (named) return normalizeDate(Number(named[3]), monthName(named[2]), Number(named[1]));

  return null;
}

function findAmount(text: string) {
  const match = text.match(
    /\b(?:total|amount due|balance due|kwota do zapłaty|razem|suma)[^\n\r]{0,80}?((?:PLN|USD|EUR|GBP|zł|\$|€|£)\s*)?([0-9][0-9\s.,]*[0-9])\s*(PLN|USD|EUR|GBP|zł|\$|€|£)?/i
  );
  if (!match) return { amount: null, currency: null };
  return {
    amount: match[2].replace(/\s/g, ""),
    currency: normalizeCurrency(match[1] || match[3] || null)
  };
}

function findInvoiceNumber(text: string) {
  const match = text.match(
    /\b(?:invoice number|invoice no\.?|receipt number|faktura nr|numer faktury|nr faktury)[:\s#-]{0,12}([A-Z0-9][A-Z0-9/_-]{2,})/i
  );
  return match?.[1] || null;
}

function normalizeDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

function toIsoDate(date: Date) {
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function monthName(input: string) {
  const key = input.slice(0, 3).toLowerCase();
  return {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }[key] || 1;
}

function normalizeCurrency(input: string | null) {
  if (!input) return null;
  const trimmed = input.trim();
  if (trimmed === "zł") return "PLN";
  if (trimmed === "$") return "USD";
  if (trimmed === "€") return "EUR";
  if (trimmed === "£") return "GBP";
  return trimmed.toUpperCase();
}
