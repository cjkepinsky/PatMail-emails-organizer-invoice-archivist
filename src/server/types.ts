export type ProviderRule = {
  id: string;
  name: string;
  targetDomain: string;
  senderDomains: string[];
  senderEmails: string[];
  searchTerms: string[];
  senderOnly: boolean;
  enabled: boolean;
};

export type AppSettings = {
  archiveDir: string;
  historyYears: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  importantSenders: string[];
};

export type GmailAccount = {
  id: string;
  email: string;
  tokensJson: string;
  historyId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScanJob = {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  startedAt: string | null;
  finishedAt: string | null;
  progressJson: string;
  error: string | null;
};

export type ExtractedInvoiceInfo = {
  invoiceDate: string | null;
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  invoiceNumber: string | null;
  dateSource: "invoice_text" | "email_sent_date" | "gmail_received_date";
};

export type ImportantItem = {
  id: string;
  accountId: string;
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  priority: "high" | "medium" | "low";
  category: string;
  summary: string;
  actionRequired: string;
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  rawJson: string;
  createdAt: string;
};
