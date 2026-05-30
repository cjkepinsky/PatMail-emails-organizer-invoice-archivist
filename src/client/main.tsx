import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const IMPORTANT_PAGE_SIZE = 10;

type Settings = {
  archiveDir: string;
  historyYears: number;
  themeMode: "dark" | "light" | "system";
  autoSyncEnabled: boolean;
  autoSyncMinutes: number;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  classifierMode: "rules" | "hybrid" | "local-llm";
  classifierBaseUrl: string;
  classifierApiKey: string;
  classifierModel: string;
  classifierTimeoutMs: number;
  importantSenders: string;
  importantCategories: string;
  senderCategoryRules: string;
  categoryRules: CategoryRule[];
};

type CategoryRule = {
  id: string;
  category: string;
  priority: "high" | "medium";
  actionRequired: string;
  senderTerms: string[];
  keywordTerms: string[];
};

type Account = {
  id: string;
  email: string;
  authType: "gmail_oauth" | "imap";
  createdAt: string;
  updatedAt: string;
};

type Provider = {
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

type Job = {
  id: string;
  type: string;
  status: "queued" | "running" | "done" | "failed";
  progressJson: string;
  error: string | null;
};

type Invoice = {
  id: string;
  provider_domain: string;
  file_path: string;
  invoice_month: string;
  invoice_date: string | null;
  due_date: string | null;
  amount: string | null;
  currency: string | null;
  status: string;
  date_source: string;
  original_filename: string;
  created_at: string;
};

type ImportantItem = {
  id: string;
  accountId: string;
  messageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  snippet: string;
  summary: string;
  actionRequired: string;
  category: string;
  priority: "high" | "medium" | "low";
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  receivedAt: string;
  saved: boolean;
};

type ImportantDetail = ImportantItem & {
  text: string;
  html: string;
  ignored: boolean;
  attachments: MailAttachment[];
};

type CleanupResult = {
  checkedSavedFiles: number;
  removedMissingFileRows: number;
  removedDuplicateRows: number;
};

type MailAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
};

type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

type MailOperation = {
  id: string;
  type: "mark-read" | "mark-visible-read";
  label: string;
  itemCount: number;
  status: "active" | "undone";
  createdAt: string;
  undoneAt: string | null;
  error: string | null;
};

type UiState = {
  selectedCategory: string;
  selectedAccountId: string | null;
  selectedMessageId: string | null;
};

function App() {
  const [settingsTab, setSettingsTab] = useState<"general" | "gmail" | "rules" | "invoices" | "other">("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [importantItems, setImportantItems] = useState<ImportantItem[]>([]);
  const [otherUnreadItems, setOtherUnreadItems] = useState<ImportantItem[]>([]);
  const [savedMailItems, setSavedMailItems] = useState<ImportantItem[]>([]);
  const [mailFeedReady, setMailFeedReady] = useState(false);
  const [uiStateReady, setUiStateReady] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [importantPage, setImportantPage] = useState(1);
  const [selectedImportantId, setSelectedImportantId] = useState("");
  const [shouldRevealSelectedMail, setShouldRevealSelectedMail] = useState(false);
  const [selectedImportant, setSelectedImportant] = useState<ImportantDetail | null>(null);
  const [bulkReadRunning, setBulkReadRunning] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeView, setActiveView] = useState<"mail" | "operations">("mail");
  const [invoicesExpanded, setInvoicesExpanded] = useState(false);
  const [imapForm, setImapForm] = useState({
    email: "",
    password: "",
    host: "imap.gmail.com",
    port: "993",
    secure: true
  });
  const [imapConnecting, setImapConnecting] = useState(false);
  const [question, setQuestion] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const [chatPendingQuestion, setChatPendingQuestion] = useState("");
  const [operations, setOperations] = useState<MailOperation[]>([]);
  const [operationUndoingId, setOperationUndoingId] = useState("");
  const accountEmailById = useMemo(() => {
    return new Map(accounts.map(account => [account.id, account.email]));
  }, [accounts]);

  async function load() {
    const data = await api("/api/bootstrap");
    setMailFeedReady(false);
    setUiStateReady(false);
    setSettings(data.settings);
    setAccounts(data.accounts);
    setProviders(data.providers);
    setInvoices(data.invoices);
    setChatHistory(data.chatHistory || []);
    setOperations(data.operations || []);
    applyPersistedUiState(data.uiState);
    applyMailFeed(data);
    setUiStateReady(true);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!activeJob || activeJob.status === "done" || activeJob.status === "failed") return;
    const interval = window.setInterval(async () => {
      const job = await api(`/api/jobs/${activeJob.id}`);
      setActiveJob(job);
      if (job.status === "done" || job.status === "failed") {
        await refreshLists();
      }
    }, 1500);
    return () => window.clearInterval(interval);
  }, [activeJob]);

  useEffect(() => {
    if (!settings?.autoSyncEnabled) return;
    const interval = window.setInterval(() => {
      void refreshLists().catch(() => {});
    }, 60 * 1000);
    return () => window.clearInterval(interval);
  }, [settings?.autoSyncEnabled]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const mode = settings?.themeMode || "dark";
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode === "system" ? "light dark" : mode;
  }, [settings?.themeMode]);

  const progress = useMemo(() => {
    if (!activeJob) return null;
    try {
      return JSON.parse(activeJob.progressJson);
    } catch {
      return null;
    }
  }, [activeJob]);

  const importantCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of importantItems) counts.set(item.category, (counts.get(item.category) || 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [importantItems]);

  const tabs = useMemo(() => {
    return [
      ...importantCategories.map(([category, count]) => ({
        key: category,
        label: category,
        count
      })),
      {
        key: "pozostałe",
        label: "pozostałe",
        count: otherUnreadItems.length
      },
      {
        key: "zapisane",
        label: "zapisane",
        count: savedMailItems.length
      }
    ];
  }, [importantCategories, otherUnreadItems.length, savedMailItems.length]);

  const filteredImportantItems = useMemo(() => {
    if (selectedCategory === "pozostałe") return otherUnreadItems;
    if (selectedCategory === "zapisane") return savedMailItems;
    if (!selectedCategory) return importantItems;
    return importantItems.filter(item => item.category === selectedCategory);
  }, [importantItems, otherUnreadItems, savedMailItems, selectedCategory]);

  const importantPageCount = Math.max(1, Math.ceil(filteredImportantItems.length / IMPORTANT_PAGE_SIZE));

  const visibleImportantItems = useMemo(() => {
    const start = (importantPage - 1) * IMPORTANT_PAGE_SIZE;
    return filteredImportantItems.slice(start, start + IMPORTANT_PAGE_SIZE);
  }, [filteredImportantItems, importantPage]);

  const importantPageStart = filteredImportantItems.length === 0 ? 0 : (importantPage - 1) * IMPORTANT_PAGE_SIZE + 1;
  const importantPageEnd = Math.min(filteredImportantItems.length, importantPage * IMPORTANT_PAGE_SIZE);

  useEffect(() => {
    if (!mailFeedReady) return;
    if (selectedCategory && tabs.some(tab => tab.key === selectedCategory)) return;
    setSelectedCategory(tabs[0]?.key || "");
  }, [mailFeedReady, selectedCategory, tabs]);

  useEffect(() => {
    setImportantPage(1);
  }, [selectedCategory]);

  useEffect(() => {
    if (importantPage <= importantPageCount) return;
    setImportantPage(importantPageCount);
  }, [importantPage, importantPageCount]);

  useEffect(() => {
    if (!shouldRevealSelectedMail) return;
    if (!mailFeedReady) return;
    if (!selectedImportantId) return;
    const targetIndex = filteredImportantItems.findIndex(item => mailKey(item) === selectedImportantId);
    if (targetIndex < 0) {
      setShouldRevealSelectedMail(false);
      return;
    }
    const targetPage = Math.floor(targetIndex / IMPORTANT_PAGE_SIZE) + 1;
    if (targetPage !== importantPage) setImportantPage(targetPage);
    setShouldRevealSelectedMail(false);
  }, [filteredImportantItems, importantPage, mailFeedReady, selectedImportantId, shouldRevealSelectedMail]);

  useEffect(() => {
    if (!mailFeedReady) return;
    if (shouldRevealSelectedMail) return;
    if (selectedImportantId && visibleImportantItems.some(item => mailKey(item) === selectedImportantId)) return;
    setSelectedImportantId(visibleImportantItems[0] ? mailKey(visibleImportantItems[0]) : "");
  }, [mailFeedReady, selectedImportantId, shouldRevealSelectedMail, visibleImportantItems]);

  useEffect(() => {
    if (!mailFeedReady || !uiStateReady) return;
    const selectedMail = selectedImportantId ? parseMailKey(selectedImportantId) : null;
    const timeout = window.setTimeout(() => {
      void api("/api/ui-state", {
        method: "POST",
        body: JSON.stringify({
          selectedCategory,
          selectedAccountId: selectedMail?.accountId || null,
          selectedMessageId: selectedMail?.messageId || null
        })
      }).catch(() => {});
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [mailFeedReady, uiStateReady, selectedCategory, selectedImportantId]);

  useEffect(() => {
    if (!selectedImportantId) {
      setSelectedImportant(null);
      return;
    }

    let alive = true;
    const selectedMail = parseMailKey(selectedImportantId);
    if (!selectedMail) {
      setSelectedImportant(null);
      return;
    }
    const { accountId, messageId } = selectedMail;
    api(`/api/mail/detail?accountId=${encodeURIComponent(accountId)}&messageId=${encodeURIComponent(messageId)}`)
      .then(detail => {
        if (alive) setSelectedImportant(detail);
      })
      .catch(() => {
        if (alive) setSelectedImportant(null);
      });
    return () => {
      alive = false;
    };
  }, [selectedImportantId]);

  const selectedImportantBodyHtml = useMemo(() => {
    if (!selectedImportant) return "";
    return buildReadableMailHtml(selectedImportant.html, selectedImportant.text || selectedImportant.snippet);
  }, [selectedImportant]);

  const visibleChatHistory = chatPendingQuestion
    ? [
        ...chatHistory,
        {
          id: "pending",
          question: chatPendingQuestion,
          answer: "Pytam OpenAI...",
          createdAt: new Date().toISOString()
        }
      ]
    : chatHistory;

  async function refreshLists() {
    const [invoiceRows, mailFeed] = await Promise.all([
      api("/api/invoices"),
      api("/api/mail-feed")
    ]);
    setInvoices(invoiceRows);
    applyMailFeed(mailFeed);
  }

  function applyMailFeed(data: {
    importantItems: ImportantItem[];
    otherUnreadItems: ImportantItem[];
    savedMailItems: ImportantItem[];
    operations?: MailOperation[];
  }) {
    setImportantItems(data.importantItems || []);
    setOtherUnreadItems(data.otherUnreadItems || []);
    setSavedMailItems(data.savedMailItems || []);
    if (data.operations) setOperations(data.operations);
    setMailFeedReady(true);
  }

  function applyPersistedUiState(uiState: UiState | null | undefined) {
    setSelectedCategory(uiState?.selectedCategory || "");
    if (uiState?.selectedAccountId && uiState?.selectedMessageId) {
      setSelectedImportantId(mailKey({
        accountId: uiState.selectedAccountId,
        messageId: uiState.selectedMessageId
      }));
      setShouldRevealSelectedMail(true);
    } else {
      setSelectedImportantId("");
      setShouldRevealSelectedMail(false);
    }
  }

  async function saveSettings(event?: { preventDefault?: () => void }) {
    event?.preventDefault?.();
    if (!settings) return;
    const saved = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify(settings)
    });
    setSettings(saved);
    await refreshLists();
    setToast("Ustawienia zapisane.");
  }

  async function startInvoiceScan() {
    if (!settings) return;
    setStatus("");
    const job = await api("/api/scan/invoices", {
      method: "POST",
      body: JSON.stringify({ years: settings.historyYears })
    });
    setActiveJob(job);
  }

  async function startImportantSync() {
    setStatus("");
    const job = await api("/api/scan/important", {
      method: "POST",
      body: JSON.stringify({ days: 7 })
    });
    setActiveJob(job);
  }

  async function markMailRead(target: Pick<ImportantItem, "accountId" | "messageId" | "saved">) {
    setStatus("Oznaczam mail jako przeczytany...");
    const response = await api("/api/mail/read", {
      method: "POST",
      body: JSON.stringify({
        accountId: target.accountId,
        messageId: target.messageId
      })
    });
    applyMailFeed(response);
    setStatus(
      response.gmailMarkedRead
        ? target.saved
          ? "Mail oznaczony jako przeczytany. Pozostaje w zakładce Zapisane. Możesz cofnąć to w historii operacji."
          : "Mail oznaczony jako przeczytany i usunięty z list nieprzeczytanych. Możesz cofnąć to w historii operacji."
        : `Mail zniknął z list nieprzeczytanych, ale Gmail nie potwierdził oznaczenia jako przeczytany${response.gmailError ? `: ${response.gmailError}` : "."}`
    );
  }

  async function markVisibleMailRead() {
    if (visibleImportantItems.length === 0 || bulkReadRunning) return;
    const items = visibleImportantItems.map(item => ({
      accountId: item.accountId,
      messageId: item.messageId
    }));
    setBulkReadRunning(true);
    setStatus(`Oznaczam ${items.length} widocznych maili jako przeczytane...`);
    try {
      const response = await api("/api/mail/read-visible", {
        method: "POST",
        body: JSON.stringify({ items })
      });
      applyMailFeed(response);
      const errorCount = Array.isArray(response.errors) ? response.errors.length : 0;
      setStatus(
        errorCount > 0
          ? `Oznaczono lokalnie ${response.markedRead || items.length} widocznych maili. Nie wszystkie konta potwierdziły zmianę: ${response.errors.join("; ")}`
          : `Oznaczono ${response.markedRead || items.length} widocznych maili jako przeczytane. Możesz cofnąć to w historii operacji.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error));
    } finally {
      setBulkReadRunning(false);
    }
  }

  async function undoOperation(operation: MailOperation) {
    if (operation.status === "undone" || operationUndoingId) return;
    setOperationUndoingId(operation.id);
    setStatus(`Cofam operację: ${operation.label}...`);
    try {
      const response = await api(`/api/operations/${operation.id}/undo`, {
        method: "POST"
      });
      applyMailFeed(response);
      const errorCount = Array.isArray(response.errors) ? response.errors.length : 0;
      setStatus(
        errorCount > 0
          ? `Cofnięto lokalnie operację, ale nie wszystkie konta potwierdziły zmianę w Gmailu/IMAP: ${response.errors.join("; ")}`
          : `Cofnięto operację: ${operation.label}.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error));
    } finally {
      setOperationUndoingId("");
    }
  }

  async function toggleSelectedMailSaved() {
    if (!selectedImportant) return;
    const nextSaved = !selectedImportant.saved;
    setStatus(nextSaved ? "Zapisuję mail..." : "Usuwam mail z zapisanych...");
    const response = await api("/api/mail/save", {
      method: "POST",
      body: JSON.stringify({
        accountId: selectedImportant.accountId,
        messageId: selectedImportant.messageId,
        saved: nextSaved
      })
    });
    applyMailFeed(response);
    setSelectedImportant(current => (current ? { ...current, saved: nextSaved } : current));
    setStatus(
      nextSaved
        ? "Mail dodany do zapisanych i przeniesiony do tej zakładki."
        : response.currentUnread === false
        ? "Mail usunięty z zapisanych. Był już przeczytany, więc zniknął z list."
        : response.gmailError
        ? `Mail usunięty z zapisanych. Nie udało się potwierdzić statusu w Gmailu: ${response.gmailError}`
        : "Mail usunięty z zapisanych."
    );
  }

  async function ignoreSelectedMail() {
    if (!selectedImportant || selectedImportant.saved) return;
    setStatus("Oznaczam mail jako nieważny...");
    const response = await api("/api/mail/ignore", {
      method: "POST",
      body: JSON.stringify({
        accountId: selectedImportant.accountId,
        messageId: selectedImportant.messageId,
        ignored: true
      })
    });
    applyMailFeed(response);
    setStatus("Mail został ukryty z list ważnych i nie będzie wracał przy kolejnych synchronizacjach.");
  }

  async function askMailbox(event: React.FormEvent) {
    event.preventDefault();
    const askedQuestion = question.trim();
    if (!askedQuestion || chatPendingQuestion) return;
    setQuestion("");
    setChatPendingQuestion(askedQuestion);
    try {
      const result = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({ question: askedQuestion })
      });
      setChatHistory(result.chatHistory || []);
    } catch (error) {
      setStatus(apiErrorMessage(error));
      setQuestion(askedQuestion);
    } finally {
      setChatPendingQuestion("");
    }
  }

  async function disconnectAccount(accountId: string) {
    await api(`/api/accounts/${accountId}`, { method: "DELETE" });
    await load();
    setToast("Konto pocztowe odłączone.");
  }

  async function connectImapAccount(event: React.FormEvent) {
    event.preventDefault();
    setImapConnecting(true);
    setStatus("Sprawdzam połączenie IMAP...");
    try {
      const nextAccounts = await api("/api/accounts/imap", {
        method: "POST",
        body: JSON.stringify({
          email: imapForm.email,
          password: imapForm.password,
          host: imapForm.host,
          port: Number(imapForm.port || 993),
          secure: imapForm.secure
        })
      }) as Account[];
      setAccounts(nextAccounts);
      setImapForm(current => ({ ...current, email: "", password: "" }));
      setStatus("Konto IMAP podłączone.");
      setToast("Konto IMAP podłączone poprawnie.");
    } catch (error) {
      const message = apiErrorMessage(error);
      setStatus(message);
      setToast(message);
    } finally {
      setImapConnecting(false);
    }
  }

  async function saveProvider(provider: Provider) {
    const saved = await api("/api/providers", {
      method: "POST",
      body: JSON.stringify(provider)
    });
    setProviders(saved);
    setToast(`Zapisano ustawienia dostawcy: ${provider.name}.`);
  }

  async function cleanupInvoiceIndex() {
    setStatus("Naprawiam indeks faktur...");
    const response = await api("/api/invoices/cleanup", {
      method: "POST",
      body: JSON.stringify({ removeMissingFiles: true, removeDuplicateRows: true })
    }) as { result: CleanupResult; invoices: Invoice[] };
    setInvoices(response.invoices);
    setStatus(
      `Indeks naprawiony: sprawdzono ${response.result.checkedSavedFiles}, usunięto brakujące ${response.result.removedMissingFileRows}, duplikaty ${response.result.removedDuplicateRows}.`
    );
  }

  function updateProvider(providerId: string, patch: Partial<Provider>) {
    setProviders(current =>
      current.map(provider => (provider.id === providerId ? { ...provider, ...patch } : provider))
    );
  }

  function updateCategoryRule(ruleId: string, patch: Partial<CategoryRule>) {
    if (!settings) return;
    setSettings({
      ...settings,
      categoryRules: settings.categoryRules.map(rule => (rule.id === ruleId ? { ...rule, ...patch } : rule))
    });
  }

  function addCategoryRule() {
    if (!settings) return;
    setSettings({
      ...settings,
      categoryRules: [
        ...settings.categoryRules,
        {
          id: `rule-${Date.now()}`,
          category: "",
          priority: "medium",
          actionRequired: "",
          senderTerms: [],
          keywordTerms: []
        }
      ]
    });
  }

  function removeCategoryRule(ruleId: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      categoryRules: settings.categoryRules.filter(rule => rule.id !== ruleId)
    });
  }

  if (!settings) {
    return <main className="shell">Ładuję lokalny panel...</main>;
  }

  return (
    <main className="shell">
      {toast && (
        <div className="toast-stack" aria-live="polite">
          <div className="toast toast-success">{toast}</div>
        </div>
      )}
      <section className="topbar">
        <div>
          <p className="eyebrow">MailBot</p>
        </div>
        <div className="top-actions">
          <button
            className={`button ${activeView === "mail" ? "accent" : "secondary"}`}
            onClick={() => setActiveView("mail")}
            type="button"
          >
            Poczta
          </button>
          <button
            className={`button ${activeView === "operations" ? "accent" : "secondary"}`}
            onClick={() => setActiveView("operations")}
            type="button"
          >
            Historia zmian{operations.length > 0 ? ` (${operations.length})` : ""}
          </button>
          <button className="button secondary" onClick={() => setSettingsOpen(true)}>
            Ustawienia
          </button>
          <button className="button" onClick={startInvoiceScan}>
            Skanuj faktury
          </button>
          <button className="button accent" onClick={startImportantSync}>
            Odśwież ważne
          </button>
        </div>
      </section>

	      {settingsOpen && (
	        <div className="modal-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onClick={event => event.stopPropagation()}
          >
	            <div className="modal-header">
              <div>
                <p className="eyebrow">Konfiguracja</p>
                <h2 id="settings-title">Ustawienia</h2>
              </div>
	              <button className="small-button" onClick={() => setSettingsOpen(false)}>
	                Zamknij
	              </button>
	            </div>
	            <div className="settings-tabs" role="tablist" aria-label="Sekcje ustawień">
	              <button
	                className={`settings-tab ${settingsTab === "general" ? "active" : ""}`}
	                onClick={() => setSettingsTab("general")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "general"}
	              >
	                Ogólne
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "gmail" ? "active" : ""}`}
	                onClick={() => setSettingsTab("gmail")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "gmail"}
	              >
	                Konta Gmail
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "rules" ? "active" : ""}`}
	                onClick={() => setSettingsTab("rules")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "rules"}
	              >
	                Reguły
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "invoices" ? "active" : ""}`}
	                onClick={() => setSettingsTab("invoices")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "invoices"}
	              >
	                Faktury
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "other" ? "active" : ""}`}
	                onClick={() => setSettingsTab("other")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "other"}
	              >
	                Inne
	              </button>
	            </div>

	            {settingsTab === "general" && (
	              <>
	                <form className="settings-form" onSubmit={saveSettings}>
	                  <label>
	                    Wygląd
	                    <select
	                      value={settings.themeMode}
	                      onChange={event => setSettings({ ...settings, themeMode: event.target.value as Settings["themeMode"] })}
	                    >
	                      <option value="dark">Ciemny</option>
	                      <option value="light">Jasny</option>
	                      <option value="system">Jak w macOS</option>
	                    </select>
	                  </label>
	                  <label>
	                    Automatyczne odświeżanie ważnych
	                    <select
	                      value={settings.autoSyncEnabled ? "on" : "off"}
	                      onChange={event => setSettings({ ...settings, autoSyncEnabled: event.target.value === "on" })}
	                    >
	                      <option value="off">Wyłączone</option>
	                      <option value="on">Włączone</option>
	                    </select>
	                  </label>
	                  <label>
	                    Interwał auto-syncu, minuty
	                    <input
	                      type="number"
	                      min={5}
	                      max={240}
	                      step={5}
	                      value={settings.autoSyncMinutes}
	                      onChange={event => setSettings({ ...settings, autoSyncMinutes: Number(event.target.value) })}
	                    />
	                  </label>
	                  <p className="muted full">
	                    Auto-sync działa spokojnie w tle po stronie aplikacji, nie uruchamia kolejnego przebiegu, jeśli poprzedni jeszcze trwa, i domyślnie dotyczy tylko sekcji „Teraz ważne”.
	                  </p>
	                  <label>
	                    Google Client ID
	                    <input
	                      value={settings.googleClientId}
	                      onChange={event => setSettings({ ...settings, googleClientId: event.target.value })}
	                    />
	                  </label>
	                  <label>
	                    Google Redirect URI
	                    <input
	                      value={settings.googleRedirectUri}
	                      onChange={event => setSettings({ ...settings, googleRedirectUri: event.target.value })}
	                    />
	                  </label>
	                  <label className="full">
	                    Google Client Secret
	                    <input
	                      type="password"
	                      value={settings.googleClientSecret}
	                      onChange={event => setSettings({ ...settings, googleClientSecret: event.target.value })}
	                      placeholder={settings.googleClientSecret ? "configured" : ""}
	                    />
	                  </label>
	                  <p className="muted full">
	                    Dane OAuth Google są zapisywane lokalnie w folderze aplikacji, a nie w pamięci przeglądarki.
	                  </p>
	                  <label>
	                    Folder archiwum faktur
	                    <input
	                      value={settings.archiveDir}
	                      onChange={event => setSettings({ ...settings, archiveDir: event.target.value })}
	                      placeholder="/Users/krzysztof/Documents/Faktury"
	                    />
	                  </label>
	                  <label>
	                    Historyczny skan
	                    <input
	                      type="number"
	                      min={1}
	                      max={10}
	                      value={settings.historyYears}
	                      onChange={event => setSettings({ ...settings, historyYears: Number(event.target.value) })}
	                    />
	                  </label>
	                  <label>
	                    OpenAI API token
	                    <input
	                      type="password"
	                      value={settings.llmApiKey}
	                      onChange={event => setSettings({ ...settings, llmApiKey: event.target.value })}
	                      placeholder={settings.llmApiKey ? "configured" : "sk-..."}
	                    />
	                  </label>
	                  <label>
	                    Model OpenAI do rozmowy
	                    <input
	                      value={settings.llmModel}
	                      onChange={event => setSettings({ ...settings, llmModel: event.target.value })}
	                      placeholder="gpt-4.1-mini"
	                    />
	                  </label>
	                  <label>
	                    Tryb klasyfikacji
	                    <select
	                      value={settings.classifierMode}
	                      onChange={event =>
	                        setSettings({ ...settings, classifierMode: event.target.value as Settings["classifierMode"] })
	                      }
	                    >
	                      <option value="hybrid">Hybryda: reguły + lekki model</option>
	                      <option value="rules">Tylko reguły</option>
	                      <option value="local-llm">Lekki model dla każdego maila</option>
	                    </select>
	                  </label>
	                  <label>
	                    Klasyfikator URL
	                    <input
	                      value={settings.classifierBaseUrl}
	                      onChange={event => setSettings({ ...settings, classifierBaseUrl: event.target.value })}
	                      placeholder="http://127.0.0.1:11434"
	                    />
	                  </label>
	                  <label>
	                    Model klasyfikatora
	                    <input
	                      value={settings.classifierModel}
	                      onChange={event => setSettings({ ...settings, classifierModel: event.target.value })}
	                      placeholder="qwen2.5:1.5b-instruct"
	                    />
	                  </label>
	                  <label>
	                    Timeout klasyfikatora
	                    <input
	                      type="number"
	                      min={500}
	                      max={15000}
	                      step={500}
	                      value={settings.classifierTimeoutMs}
	                      onChange={event => setSettings({ ...settings, classifierTimeoutMs: Number(event.target.value) })}
	                    />
	                  </label>
	                  <p className="muted full">
	                    Chat ze skrzynką idzie przez OpenAI API, a klasyfikacja może dalej działać lokalnie na lekkim modelu albo samych regułach.
	                  </p>
	                  <label className="full">
	                    Ważni nadawcy, po jednym w linii
	                    <textarea
	                      value={settings.importantSenders}
	                      onChange={event => setSettings({ ...settings, importantSenders: event.target.value })}
	                      placeholder="ksiegowa@example.com&#10;biuro rachunkowe&#10;bank"
	                    />
	                  </label>
		                  <label className="full">
		                    Kategorie ważnych maili, po jednej w linii
		                    <textarea
		                      value={settings.importantCategories}
		                      onChange={event => setSettings({ ...settings, importantCategories: event.target.value })}
		                      placeholder="faktury i rachunki&#10;płatności i terminy płatności&#10;oferty pracy"
		                    />
		                  </label>
		                  <label className="full">
		                    Ręczne klasyfikacje nadawców
		                    <textarea
		                      value={settings.senderCategoryRules}
		                      onChange={event => setSettings({ ...settings, senderCategoryRules: event.target.value })}
		                      placeholder="powiadomienia@allegromail.pl => zamówienia&#10;newsletter@example.com => ai"
		                    />
		                  </label>
		                  <p className="muted full">
		                    Najpierw działają ręczne klasyfikacje nadawców, potem reguły z zakładki Reguły, dalej fallbacki wbudowane w aplikację, a dopiero na końcu model. Format: nadawca =&gt; kategoria.
		                  </p>
		                  <div className="modal-actions full">
		                    <button className="button" type="submit">
		                      Zapisz ustawienia
		                    </button>
		                  </div>
		                </form>
		              </>
		            )}

		            {settingsTab === "gmail" && (
		              <div className="settings-section settings-section-plain">
	                <div className="section-title">
	                  <h2>Konta Gmail</h2>
	                  <span>{accounts.length}</span>
	                </div>
	                <div className="account-connect-actions">
	                  <a className="button secondary" href="/api/auth/google/start">
	                    Podłącz przez Google OAuth
	                  </a>
	                  <span className="muted">OAuth zostaje dostępny, a IMAP omija 7-dniowe wygasanie trybu testowego Google.</span>
	                </div>
	                <form className="imap-connect-form" onSubmit={connectImapAccount}>
	                  <h3>Podłącz przez IMAP</h3>
	                  <label>
	                    Adres Gmail
	                    <input
	                      autoComplete="username"
	                      inputMode="email"
	                      onChange={event => setImapForm({ ...imapForm, email: event.target.value })}
	                      placeholder="twoje.konto@gmail.com"
	                      type="email"
	                      value={imapForm.email}
	                    />
	                  </label>
	                  <label>
	                    Hasło aplikacji Gmail
	                    <input
	                      autoComplete="new-password"
	                      onChange={event => setImapForm({ ...imapForm, password: event.target.value })}
	                      placeholder="16-znakowe hasło aplikacji"
	                      type="password"
	                      value={imapForm.password}
	                    />
	                  </label>
	                  <label>
	                    Host IMAP
	                    <input
	                      onChange={event => setImapForm({ ...imapForm, host: event.target.value })}
	                      value={imapForm.host}
	                    />
	                  </label>
	                  <label>
	                    Port
	                    <input
	                      inputMode="numeric"
	                      onChange={event => setImapForm({ ...imapForm, port: event.target.value })}
	                      value={imapForm.port}
	                    />
	                  </label>
	                  <label className="checkbox-label">
	                    <input
	                      checked={imapForm.secure}
	                      onChange={event => setImapForm({ ...imapForm, secure: event.target.checked })}
	                      type="checkbox"
	                    />
	                    Użyj SSL/TLS
	                  </label>
	                  <button className="button" disabled={imapConnecting} type="submit">
	                    {imapConnecting ? "Sprawdzam..." : "Podłącz IMAP"}
	                  </button>
	                  <p className="muted full">
	                    Dla Gmaila z 2FA użyj hasła aplikacji Google, nie głównego hasła do konta.
	                  </p>
	                </form>
	                {accounts.length === 0 ? (
	                  <p className="muted">Podłącz konta przez IMAP albo Google OAuth. Możesz dodać 4-5 skrzynek po kolei.</p>
	                ) : (
	                  <ul className="plain-list">
	                    {accounts.map(account => (
	                      <li key={account.id}>
	                        <span className="account-row-main">
	                          <span>{account.email}</span>
	                          <span className="account-auth-badge">{account.authType === "imap" ? "IMAP" : "OAuth"}</span>
	                        </span>
	                        <button className="small-button" onClick={() => void disconnectAccount(account.id)} type="button">
	                          Odłącz
	                        </button>
	                      </li>
	                    ))}
	                  </ul>
	                )}
		              </div>
		            )}

		            {settingsTab === "rules" && (
		              <div className="settings-section settings-section-plain">
		                <div className="section-title">
		                  <h2>Reguły klasyfikacji</h2>
		                  <span>{settings.categoryRules.length}</span>
		                </div>
		                <p className="muted">
		                  Reguły z tej zakładki są sprawdzane po ręcznych przypisaniach nadawców, ale przed fallbackami w kodzie i przed modelem. To jest miejsce, w którym możesz sam dostroić klasyfikację bez grzebania w kodzie.
		                </p>
		                <div className="rules-list">
		                  {settings.categoryRules.map(rule => (
		                    <section className="rule-card" key={rule.id}>
		                      <div className="rule-card-header">
		                        <strong>{rule.category || "Nowa reguła"}</strong>
		                        <button className="small-button" onClick={() => removeCategoryRule(rule.id)} type="button">
		                          Usuń
		                        </button>
		                      </div>
		                      <div className="provider-fields">
		                        <label>
		                          Kategoria
		                          <input
		                            value={rule.category}
		                            onChange={event => updateCategoryRule(rule.id, { category: event.target.value })}
		                            placeholder="zamówienia"
		                          />
		                        </label>
		                        <label>
		                          Priorytet
		                          <select
		                            value={rule.priority}
		                            onChange={event => updateCategoryRule(rule.id, { priority: event.target.value as CategoryRule["priority"] })}
		                          >
		                            <option value="high">high</option>
		                            <option value="medium">medium</option>
		                          </select>
		                        </label>
		                        <label className="full">
		                          Co ma zrobić użytkownik
		                          <input
		                            value={rule.actionRequired}
		                            onChange={event => updateCategoryRule(rule.id, { actionRequired: event.target.value })}
		                            placeholder="Sprawdź status zamówienia."
		                          />
		                        </label>
		                        <label>
		                          Nadawcy lub domeny
		                          <textarea
		                            value={rule.senderTerms.join("\n")}
		                            onChange={event => updateCategoryRule(rule.id, { senderTerms: lines(event.target.value) })}
		                            placeholder="powiadomienia@allegromail.pl&#10;allegro.pl"
		                          />
		                        </label>
		                        <label>
		                          Frazy w temacie lub treści
		                          <textarea
		                            value={rule.keywordTerms.join("\n")}
		                            onChange={event => updateCategoryRule(rule.id, { keywordTerms: lines(event.target.value) })}
		                            placeholder="status zamówienia&#10;twoje zamówienie"
		                          />
		                        </label>
		                      </div>
		                    </section>
		                  ))}
		                </div>
		                <div className="modal-actions">
		                  <button className="button secondary" onClick={addCategoryRule} type="button">
		                    Dodaj regułę
		                  </button>
		                  <button className="button" onClick={saveSettings} type="button">
		                    Zapisz reguły
		                  </button>
		                </div>
		              </div>
		            )}

		            {settingsTab === "invoices" && (
		              <div className="settings-section settings-section-plain">
		                <div className="section-title">
		                  <h2>Faktury</h2>
		                  <span>{providers.filter(provider => provider.enabled).length}</span>
		                </div>
	                <ul className="provider-list">
	                  {providers.map(provider => (
	                    <li key={provider.id}>
	                      <div className="provider-header">
	                        <div>
	                          <strong>{provider.targetDomain}</strong>
	                          <span>{provider.name}</span>
	                        </div>
	                        <div className="provider-switches">
	                          <label>
	                            <input
	                              type="checkbox"
	                              checked={provider.enabled}
	                              onChange={event => updateProvider(provider.id, { enabled: event.target.checked })}
	                            />
	                            Aktywny
	                          </label>
	                          <label>
	                            <input
	                              type="checkbox"
	                              checked={provider.senderOnly}
	                              onChange={event => updateProvider(provider.id, { senderOnly: event.target.checked })}
	                            />
	                            Szukaj tylko po nadawcy
	                          </label>
	                          <label>
	                            <input
	                              type="checkbox"
	                              checked={provider.emailBodyPdf}
	                              onChange={event => updateProvider(provider.id, { emailBodyPdf: event.target.checked })}
	                            />
	                            Mail jako PDF
	                          </label>
	                        </div>
	                      </div>
	                      <p className="provider-help">
	                        {provider.emailBodyPdf
	                          ? "Dla tego dostawcy aplikacja może zapisać treść maila jako PDF, gdy faktura nie ma załącznika."
	                          : provider.senderOnly
	                          ? "Frazy marki są wtedy dodatkowym filtrem dla PDF-a, ale nie wyszukują maili samodzielnie."
	                          : "Frazy marki mogą znaleźć maila także wtedy, gdy nadawcą jest Stripe, Paddle albo inny pośrednik."}
	                      </p>
	                      <div className="provider-fields">
	                        <label>
	                          Fragmenty adresu nadawcy, pole From
	                          <textarea
	                            value={provider.senderDomains.join("\n")}
	                            onChange={event =>
	                              updateProvider(provider.id, { senderDomains: lines(event.target.value) })
	                            }
	                          />
	                        </label>
	                        <label>
	                          Konkretne adresy w polu From lub Reply-To
	                          <textarea
	                            value={provider.senderEmails.join("\n")}
	                            onChange={event =>
	                              updateProvider(provider.id, { senderEmails: lines(event.target.value) })
	                            }
	                          />
	                        </label>
	                        <label className="full">
	                          Frazy marki w temacie, treści maila albo PDF-ie
	                          <textarea
	                            value={provider.searchTerms.join("\n")}
	                            onChange={event =>
	                              updateProvider(provider.id, { searchTerms: lines(event.target.value) })
	                            }
	                          />
	                        </label>
	                      </div>
	                      <button className="small-button" onClick={() => void saveProvider(provider)} type="button">
	                        Zapisz dostawcę
	                      </button>
	                    </li>
	                  ))}
	                </ul>
		              </div>
		            )}
		            {settingsTab === "other" && (
		              <div className="settings-section settings-section-plain">
		                <div className="section-title">
		                  <h2>Indeks faktur</h2>
		                  <span>porządki</span>
		                </div>
		                <p className="muted">
		                  Użyj tego po ręcznym usunięciu plików albo po poprawkach konfiguracji dostawców. Aplikacja wyczyści pamięć o brakujących plikach i starych duplikatach.
		                </p>
		                <button className="button secondary" onClick={() => void cleanupInvoiceIndex()} type="button">
		                  Napraw indeks faktur
		                </button>
		              </div>
		            )}
	          </section>
	        </div>
	      )}

      {(status || activeJob) && (
        <section className="status-stack">
          {status && <div className="status-strip">{status}</div>}
          {activeJob && (
            <section className="job-strip">
              <strong>{activeJob.status}</strong>
              <span>{progress?.message || "Pracuję..."}</span>
              {progress && (
                <span>
                  Maile: {progress.scannedMessages || 0} · Faktury: {progress.savedInvoices || 0} · Duplikaty: {progress.skippedDuplicates || 0}
                </span>
              )}
              {activeJob.error && <span className="error">{activeJob.error}</span>}
            </section>
          )}
        </section>
      )}

      {activeView === "operations" ? (
        <section className="operation-history operation-history-view">
          <div className="section-title">
            <div>
              <p className="eyebrow">Cofanie zmian</p>
              <h2>Historia zmian</h2>
            </div>
            <div className="top-actions">
              <span>ostatnie {operations.length} z 50</span>
              <button className="small-button" onClick={() => void refreshLists()} type="button">
                Odśwież historię
              </button>
            </div>
          </div>
          <p className="muted">
            Tu trafiają operacje zmieniające status maili, na przykład „oznacz jako przeczytane” i „oznacz widoczne jako przeczytane”. Przy wybranym rekordzie możesz kliknąć „Cofnij”.
          </p>
          {operations.length === 0 ? (
            <p className="muted">Nie ma jeszcze operacji do cofnięcia.</p>
          ) : (
            <ul className="operation-list">
              {operations.map(operation => (
                <li key={operation.id} className={operation.status === "undone" ? "operation-undone" : ""}>
                  <div>
                    <strong>{operation.label}</strong>
                    <small>
                      {formatDateTime(operation.createdAt)}
                      {operation.status === "undone" ? ` · cofnięto${operation.undoneAt ? ` ${formatDateTime(operation.undoneAt)}` : ""}` : ""}
                      {operation.error ? ` · ${operation.error}` : ""}
                    </small>
                  </div>
                  <button
                    className="small-button"
                    disabled={operation.status === "undone" || Boolean(operationUndoingId)}
                    onClick={() => void undoOperation(operation)}
                    type="button"
                  >
                    {operationUndoingId === operation.id ? "Cofam..." : operation.status === "undone" ? "Cofnięto" : "Cofnij"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>

      <section className="important-feed">
        <div className="section-title">
          <h2>Teraz ważne</h2>
          <span>{importantItems.length + otherUnreadItems.length} wpisów nieprzeczytanych</span>
        </div>
        {importantItems.length === 0 && otherUnreadItems.length === 0 && savedMailItems.length === 0 ? (
          <p className="muted">Po pierwszym syncu pojawią się tu faktury, terminy płatności, księgowość i sprawy wymagające reakcji.</p>
        ) : (
          <div className="important-workspace">
            <div className="important-list-pane">
              <div className="category-tabs" role="tablist" aria-label="Kategorie ważnych maili">
                {tabs.map(tab => (
                  <button
                    className={tab.key === selectedCategory ? "category-tab active" : "category-tab"}
                    key={tab.key}
                    onClick={() => setSelectedCategory(tab.key)}
                    type="button"
                  >
                    <span>{tab.label}</span>
                    <strong>{tab.count}</strong>
                  </button>
                ))}
                <button
                  className="category-tab bulk-read-tab"
                  disabled={visibleImportantItems.length === 0 || bulkReadRunning}
                  onClick={() => void markVisibleMailRead()}
                  title="Oznacz wszystkie maile widoczne na tej stronie jako przeczytane"
                  type="button"
                >
                  <span aria-hidden="true">✓</span>
                  <span>{bulkReadRunning ? "Oznaczam..." : "Oznacz widoczne jako przeczytane"}</span>
                </button>
              </div>
              <div className="feed-list">
                {visibleImportantItems.map(item => (
                  <article
                    className={mailKey(item) === selectedImportantId ? "feed-item selected" : "feed-item"}
                    key={`${selectedCategory}:${mailKey(item)}`}
                  >
                    <button
                      className="feed-select"
                      onClick={() => setSelectedImportantId(mailKey(item))}
                      type="button"
                    >
                      <div>
                        <strong>{item.fromName || item.fromEmail}</strong>
                        <p>{item.summary || item.subject}</p>
                        {item.actionRequired && <small>{item.actionRequired}</small>}
                      </div>
                      <div className="feed-meta">
                        <span className="feed-date">{formatDateTime(item.receivedAt)}</span>
                        <span className={`pill ${item.priority}`}>{item.priority}</span>
                        {item.dueDate && <span>Termin: {item.dueDate}</span>}
                        {item.amount && <span>{item.amount} {item.currency || ""}</span>}
                      </div>
                    </button>
                    <div className="feed-links">
                      <a
                        className="feed-link"
                        href={gmailMessageUrl(item, accountEmailById.get(item.accountId))}
                        rel="noreferrer"
                        target="_blank"
                      >
                        Gmail
                      </a>
                      <button
                        aria-label="Oznacz jako przeczytany"
                        className="feed-check"
                        onClick={() => void markMailRead(item)}
                        title="Oznacz jako przeczytany"
                        type="button"
                      >
                        ✓
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {visibleImportantItems.length === 0 && (
                <p className="muted">W tej zakładce nie ma teraz żadnych maili.</p>
              )}
              {filteredImportantItems.length > IMPORTANT_PAGE_SIZE && (
                <div className="pagination">
                  <span className="pagination-summary">
                    {importantPageStart}-{importantPageEnd} z {filteredImportantItems.length}
                  </span>
                  <div className="pagination-actions">
                    <button
                      className="small-button"
                      disabled={importantPage <= 1}
                      onClick={() => setImportantPage(page => Math.max(1, page - 1))}
                      type="button"
                    >
                      Nowsze
                    </button>
                    <span className="pagination-current">
                      Strona {importantPage} / {importantPageCount}
                    </span>
                    <button
                      className="small-button"
                      disabled={importantPage >= importantPageCount}
                      onClick={() => setImportantPage(page => Math.min(importantPageCount, page + 1))}
                      type="button"
                    >
                      Starsze
                    </button>
                  </div>
                </div>
              )}
            </div>
            <aside className="important-preview">
              {selectedImportant ? (
                <>
                  <div className="preview-header">
                    <div>
                      <span className={`pill ${selectedImportant.priority}`}>{selectedImportant.category}</span>
                      <h3>{selectedImportant.subject}</h3>
                      <p>{selectedImportant.fromName || selectedImportant.fromEmail} &lt;{selectedImportant.fromEmail}&gt;</p>
                      <p>Do: {accountEmailById.get(selectedImportant.accountId) || "nieznane konto"}</p>
                      <small>{formatDateTime(selectedImportant.receivedAt)}</small>
                    </div>
                    <div className="preview-actions">
                      {!selectedImportant.saved && (
                        <button className="button secondary" onClick={() => void ignoreSelectedMail()} type="button">
                          Nieważne
                        </button>
                      )}
                      <button className="button secondary" onClick={() => void toggleSelectedMailSaved()}>
                        {selectedImportant.saved ? "Usuń z zapisanych" : "Zapisz"}
                      </button>
                    </div>
                  </div>
                  {selectedImportant.actionRequired && (
                    <p className="preview-action">{selectedImportant.actionRequired}</p>
                  )}
                  {selectedImportant.attachments.length > 0 && (
                    <section className="mail-attachments">
                      <h4>Załączniki</h4>
                      <ul className="mail-attachments-list">
                        {selectedImportant.attachments.map(attachment => (
                          <li key={attachment.attachmentId}>
                            <div className="mail-attachment-meta">
                              <strong>{attachment.filename}</strong>
                              <small>
                                {formatAttachmentSize(attachment.size)}
                                {attachment.mimeType ? ` · ${attachment.mimeType}` : ""}
                              </small>
                            </div>
                            <div className="mail-attachment-actions">
                              <a
                                className="feed-link"
                                href={mailAttachmentUrl(selectedImportant, attachment)}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Otwórz
                              </a>
                              <a
                                className="feed-link"
                                href={mailAttachmentUrl(selectedImportant, attachment, true)}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Pobierz
                              </a>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <article
                    className="mail-body mail-body-reader"
                    dangerouslySetInnerHTML={{ __html: selectedImportantBodyHtml }}
                  />
                </>
              ) : (
                <p className="muted">Wybierz mail po lewej, żeby zobaczyć treść.</p>
              )}
            </aside>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Chat ze skrzynką</h2>
          <span>ostatnie 10 z 7 dni</span>
        </div>
        <form className="chat-form" onSubmit={askMailbox}>
          <input
            disabled={Boolean(chatPendingQuestion)}
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="O co chodzi w mailu od księgowej? Co wymaga płatności?"
          />
          <button className="button accent" disabled={Boolean(chatPendingQuestion)} type="submit">
            {chatPendingQuestion ? "Pytam..." : "Zapytaj"}
          </button>
        </form>
        <div className="chat-history">
          {visibleChatHistory.length === 0 ? (
            <p className="muted">Tu pojawią się ostatnie pytania i odpowiedzi z czatu ze skrzynką.</p>
          ) : (
            visibleChatHistory.map(turn => (
              <article className="chat-turn" key={turn.id}>
                <time>{formatDateTime(turn.createdAt)}</time>
                <div className="chat-bubble question">
                  <strong>Ty</strong>
                  <p>{turn.question}</p>
                </div>
                <div className="chat-bubble answer">
                  <strong>MailBot</strong>
                  <p>{turn.answer}</p>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Ostatnie faktury</h2>
          <div className="top-actions">
            <span>{invoices.length}</span>
            <button className="small-button" onClick={() => setInvoicesExpanded(current => !current)} type="button">
              {invoicesExpanded ? "Zwiń" : "Pokaż"}
            </button>
          </div>
        </div>
        {invoicesExpanded ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Miesiąc</th>
                  <th>Domena</th>
                  <th>Termin</th>
                  <th>Kwota</th>
                  <th>Status</th>
                  <th>Plik</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id}>
                    <td>{invoice.invoice_month}</td>
                    <td>{invoice.provider_domain}</td>
                    <td>{invoice.due_date || "-"}</td>
                    <td>{invoice.amount ? `${invoice.amount} ${invoice.currency || ""}` : "-"}</td>
                    <td>{invoice.status}</td>
                    <td title={invoice.file_path}>{shortPath(invoice.file_path)}</td>
                  </tr>
                ))}
                {invoices.length === 0 && (
                  <tr>
                    <td colSpan={6}>Po skanowaniu pojawi się tu historia zapisanych faktur.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Lista faktur jest zwinięta.</p>
        )}
      </section>
        </>
      )}
    </main>
  );
}

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function apiErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return parsed.error || raw;
  } catch {
    return raw;
  }
}

function shortPath(filePath: string) {
  const parts = filePath.split("/");
  return parts.slice(-3).join("/");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function mailKey(item: Pick<ImportantItem, "accountId" | "messageId">) {
  return `${encodeURIComponent(item.accountId)}:${encodeURIComponent(item.messageId)}`;
}

function parseMailKey(key: string) {
  const separatorIndex = key.indexOf(":");
  if (separatorIndex < 0) return null;
  const accountId = key.slice(0, separatorIndex);
  const messageId = key.slice(separatorIndex + 1);
  if (!accountId || !messageId) return null;
  return {
    accountId: decodeURIComponent(accountId),
    messageId: decodeURIComponent(messageId)
  };
}

function gmailMessageUrl(item: Pick<ImportantItem, "threadId">, accountEmail?: string) {
  const authuser = accountEmail ? `?authuser=${encodeURIComponent(accountEmail)}` : "";
  return `https://mail.google.com/mail/${authuser}#all/${item.threadId}`;
}

function mailAttachmentUrl(
  item: Pick<ImportantDetail, "accountId" | "messageId">,
  attachment: Pick<MailAttachment, "attachmentId" | "filename" | "mimeType">,
  download = false
) {
  const params = new URLSearchParams({
    accountId: item.accountId,
    messageId: item.messageId,
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType || "application/octet-stream"
  });
  if (download) params.set("download", "1");
  return `/api/mail/attachment?${params.toString()}`;
}

function buildReadableMailHtml(html: string, text: string) {
  const bodyText = normalizeMailText(text);
  const paragraphs = bodyText
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(Boolean);
  const links = collectMailLinks(html, bodyText);

  const parts: string[] = [];

  if (paragraphs.length > 0) {
    for (const paragraph of paragraphs) {
      parts.push(`<p>${escapeMailHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
    }
  } else {
    parts.push("<p>Brak czytelnej treści wiadomości.</p>");
  }

  if (links.length > 0) {
    parts.push("<section class=\"reader-links\">");
    parts.push("<h4>Linki</h4>");
    parts.push("<ul>");
    for (const link of links) {
      parts.push(
        `<li><a href="${escapeMailAttribute(link.href)}" target="_blank" rel="noreferrer noopener">${escapeMailHtml(link.label)}</a></li>`
      );
    }
    parts.push("</ul>");
    parts.push("</section>");
  }

  return parts.join("");
}

function collectMailLinks(html: string, text: string) {
  const links = new Map<string, { href: string; label: string }>();

  if (typeof DOMParser !== "undefined" && html.trim()) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
      const href = String(anchor.getAttribute("href") || "").trim();
      if (!isReadableMailHref(href)) continue;
      const label = (anchor.textContent || "").replace(/\s+/g, " ").trim() || href;
      if (!links.has(href)) links.set(href, { href, label });
    }
  }

  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"')]+/gi)) {
    const href = match[0].trim();
    if (!isReadableMailHref(href)) continue;
    if (!links.has(href)) links.set(href, { href, label: href });
  }

  return [...links.values()];
}

function isReadableMailHref(href: string) {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function normalizeMailText(text: string) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeMailHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMailAttribute(value: string) {
  return escapeMailHtml(value).replace(/"/g, "&quot;");
}

function lines(value: string) {
  return value
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean);
}

function formatAttachmentSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

createRoot(document.getElementById("root")!).render(<App />);
