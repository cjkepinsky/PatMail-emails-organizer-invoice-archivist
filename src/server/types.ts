export type ProviderRule = {
  id: string;
  name: string;
  targetDomain: string;
  senderDomains: string[];
  senderEmails: string[];
  searchTerms: string[];
  senderOnly: boolean;
  emailBodyPdf: boolean;
  enabled: boolean;
};

export type Profile = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  archiveDir: string;
  historyYears: number;
  language: "pl" | "en";
  themeMode: "dark" | "light" | "system";
  autoSyncEnabled: boolean;
  autoSyncMinutes: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  chatWebSearchEnabled: boolean;
  classifierMode: "rules" | "hybrid" | "local-llm";
  classifierBaseUrl: string;
  classifierApiKey: string;
  classifierModel: string;
  classifierTimeoutMs: number;
  importantSenders: string[];
  importantCategories: string[];
  senderCategoryRules: Array<{ sender: string; category: string }>;
  categoryRules: CategoryRule[];
};

export type CategoryRule = {
  id: string;
  category: string;
  priority: "high" | "medium";
  actionRequired: string;
  senderTerms: string[];
  keywordTerms: string[];
};

export type UiState = {
  selectedCategory: string;
  selectedAccountId: string | null;
  selectedMessageId: string | null;
  profileSidebarWidth: number | null;
  mailColumnWeights: {
    list: number;
    preview: number;
    chat: number;
  } | null;
};

export type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  contextJson: string;
  createdAt: string;
};

export type MailOperation = {
  id: string;
  type: "mark-read" | "mark-visible-read";
  label: string;
  itemCount: number;
  status: "active" | "undone";
  payloadJson: string;
  createdAt: string;
  undoneAt: string | null;
  error: string | null;
};

export type ReadOperationSnapshot = {
  accountId: string;
  messageId: string;
  subject: string;
  fromEmail: string;
  fromName: string;
  wasUnread: boolean;
  importantItem: Record<string, unknown> | null;
};

export type GmailAccount = {
  id: string;
  email: string;
  tokensJson: string;
  historyId: string | null;
  authType: "gmail_oauth" | "imap";
  imapConfigJson: string;
  createdAt: string;
  updatedAt: string;
};

export type ImapAccountConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox?: string;
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
  saved: boolean;
  rawJson: string;
  createdAt: string;
};
