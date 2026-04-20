import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Settings = {
  archiveDir: string;
  historyYears: number;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  importantSenders: string;
};

type Account = {
  id: string;
  email: string;
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
  fromEmail: string;
  fromName: string;
  subject: string;
  summary: string;
  actionRequired: string;
  category: string;
  priority: "high" | "medium" | "low";
  dueDate: string | null;
  amount: string | null;
  currency: string | null;
  receivedAt: string;
};

function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [importantItems, setImportantItems] = useState<ImportantItem[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");

  async function load() {
    const data = await api("/api/bootstrap");
    setSettings(data.settings);
    setAccounts(data.accounts);
    setProviders(data.providers);
    setInvoices(data.invoices);
    setImportantItems(data.importantItems);
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

  const progress = useMemo(() => {
    if (!activeJob) return null;
    try {
      return JSON.parse(activeJob.progressJson);
    } catch {
      return null;
    }
  }, [activeJob]);

  async function refreshLists() {
    const [invoiceRows, importantRows] = await Promise.all([
      api("/api/invoices"),
      api("/api/important")
    ]);
    setInvoices(invoiceRows);
    setImportantItems(importantRows);
  }

  async function saveSettings(event: React.FormEvent) {
    event.preventDefault();
    if (!settings) return;
    const saved = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify(settings)
    });
    setSettings(saved);
    setStatus("Ustawienia zapisane.");
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

  async function askMailbox(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setAnswer("Pytam lokalny model...");
    const result = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ question })
    });
    setAnswer(result.answer || result.error || "Brak odpowiedzi.");
  }

  async function disconnectAccount(accountId: string) {
    await api(`/api/accounts/${accountId}`, { method: "DELETE" });
    await load();
    setStatus("Konto odłączone. Podłącz je ponownie, żeby odświeżyć zakresy OAuth.");
  }

  if (!settings) {
    return <main className="shell">Ładuję lokalny panel...</main>;
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Invoice Archivist MVP</p>
        </div>
        <div className="top-actions">
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

            <form className="settings-form" onSubmit={saveSettings}>
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
                Lokalny LLM URL
                <input
                  value={settings.llmBaseUrl}
                  onChange={event => setSettings({ ...settings, llmBaseUrl: event.target.value })}
                />
              </label>
              <label>
                Model
                <input
                  value={settings.llmModel}
                  onChange={event => setSettings({ ...settings, llmModel: event.target.value })}
                  placeholder="auto"
                />
              </label>
              <label className="full">
                Ważni nadawcy, po jednym w linii
                <textarea
                  value={settings.importantSenders}
                  onChange={event => setSettings({ ...settings, importantSenders: event.target.value })}
                  placeholder="ksiegowa@example.com&#10;biuro rachunkowe&#10;bank"
                />
              </label>
              <div className="modal-actions full">
                <button className="button" type="submit">
                  Zapisz ustawienia
                </button>
                <span>{status}</span>
              </div>
            </form>

            <div className="settings-section">
              <div className="section-title">
                <h2>Konta Gmail</h2>
                <span>{accounts.length}</span>
              </div>
              <a className="button secondary" href="/api/auth/google/start">
                Podłącz Gmail
              </a>
              {accounts.length === 0 ? (
                <p className="muted">Podłącz konta przez Google OAuth. Możesz dodać 4-5 skrzynek po kolei.</p>
              ) : (
                <ul className="plain-list">
                  {accounts.map(account => (
                    <li key={account.id}>
                      <span>{account.email}</span>
                      <button className="small-button" onClick={() => void disconnectAccount(account.id)}>
                        Odłącz
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="settings-section">
              <div className="section-title">
                <h2>Dostawcy</h2>
                <span>{providers.filter(provider => provider.enabled).length}</span>
              </div>
              <ul className="provider-list">
                {providers.map(provider => (
                  <li key={provider.id}>
                    <strong>{provider.targetDomain}</strong>
                    <span>{provider.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      )}

      <section className="important-feed">
        <div className="section-title">
          <h2>Teraz ważne</h2>
          <span>{importantItems.length} wpisów</span>
        </div>
        {importantItems.length === 0 ? (
          <p className="muted">Po pierwszym syncu pojawią się tu faktury, terminy płatności, księgowość i sprawy wymagające reakcji.</p>
        ) : (
          <div className="feed-list">
            {importantItems.slice(0, 6).map(item => (
              <article className="feed-item" key={item.id}>
                <div>
                  <strong>{item.fromName || item.fromEmail}</strong>
                  <p>{item.summary || item.subject}</p>
                  {item.actionRequired && <small>{item.actionRequired}</small>}
                </div>
                <div className="feed-meta">
                  <span className={`pill ${item.priority}`}>{item.priority}</span>
                  {item.dueDate && <span>Termin: {item.dueDate}</span>}
                  {item.amount && <span>{item.amount} {item.currency || ""}</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

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

      <section className="panel">
        <div className="section-title">
          <h2>Chat ze skrzynką</h2>
          <span>lokalny model</span>
        </div>
        <form className="chat-form" onSubmit={askMailbox}>
          <input
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder="O co chodzi w mailu od księgowej? Co wymaga płatności?"
          />
          <button className="button accent" type="submit">
            Zapytaj
          </button>
        </form>
        {answer && <p className="answer">{answer}</p>}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>Ostatnie faktury</h2>
          <span>{invoices.length}</span>
        </div>
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
      </section>
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

function shortPath(filePath: string) {
  const parts = filePath.split("/");
  return parts.slice(-3).join("/");
}

createRoot(document.getElementById("root")!).render(<App />);
