import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const IMPORTANT_PAGE_SIZE = 10;

type Settings = {
  archiveDir: string;
  historyYears: number;
  language: "pl" | "en";
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

type Profile = {
  id: string;
  name: string;
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

type MailChatContext = {
  accountId: string;
  messageId: string;
  subject: string;
  fromLabel: string;
  receivedAt: string;
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

type UiLanguage = Settings["language"];

const TEXT = {
  pl: {
    loading: "Ładuję lokalny panel...",
    profileEyebrow: "Profile",
    spaces: "Przestrzenie",
    active: "aktywny",
    newProfile: "Nowy profil",
    companyProfilePlaceholder: "Firmowy",
    creating: "Chwila...",
    create: "Utwórz",
    profileDescription:
      "Profil obejmuje ustawienia, reguły, konta Gmail, dostawców faktur, indeks faktur i lokalny stan poczty.",
    mail: "Poczta",
    archivizer: "Archivizer",
    changeHistory: "Historia zmian",
    settings: "Ustawienia",
    scanInvoices: "Skanuj faktury",
    refreshImportant: "Odśwież ważne",
    configuration: "Konfiguracja",
    activeProfile: "Aktywny profil",
    close: "Zamknij",
    settingsSections: "Sekcje ustawień",
    general: "Ogólne",
    gmailAccounts: "Konta Gmail",
    rules: "Reguły",
    invoices: "Faktury",
    other: "Inne",
    language: "Język interfejsu",
    polish: "Polski",
    english: "Angielski",
    appearance: "Wygląd",
    dark: "Ciemny",
    light: "Jasny",
    system: "Jak w macOS",
    autoSync: "Automatyczne odświeżanie ważnych",
    enabled: "Włączone",
    disabled: "Wyłączone",
    autoSyncInterval: "Interwał auto-syncu, minuty",
    autoSyncHelp:
      "Auto-sync działa spokojnie w tle po stronie aplikacji, nie uruchamia kolejnego przebiegu, jeśli poprzedni jeszcze trwa, i domyślnie dotyczy tylko sekcji „Teraz ważne”.",
    oauthSavedLocally: "Dane OAuth Google są zapisywane lokalnie w folderze aplikacji, a nie w pamięci przeglądarki.",
    oauthAdvanced: "Google OAuth, opcjonalne",
    oauthOptionalHelp:
      "OAuth jest opcjonalny. Używaj go tylko wtedy, gdy chcesz logować skrzynki przez przeglądarkę i masz własny klient OAuth w Google Cloud.",
    oauthMissingConfig: "Najpierw zapisz Google Client ID i Client Secret, żeby włączyć podłączanie przez OAuth.",
    imapRecommended: "Rekomendowane",
    invoiceArchiveFolder: "Folder archiwum faktur",
    historicalScan: "Historyczny skan",
    openAiToken: "OpenAI API token",
    chatModel: "Model OpenAI do rozmowy",
    classifierMode: "Tryb klasyfikacji",
    classifierHybrid: "Hybryda: reguły + lekki model",
    classifierRules: "Tylko reguły",
    classifierLocal: "Lekki model dla każdego maila",
    classifierUrl: "Klasyfikator URL",
    classifierModel: "Model klasyfikatora",
    classifierTimeout: "Timeout klasyfikatora",
    aiHelp:
      "Chat ze skrzynką idzie przez OpenAI API, a klasyfikacja może dalej działać lokalnie na lekkim modelu albo samych regułach.",
    importantSenders: "Ważni nadawcy, po jednym w linii",
    importantCategories: "Kategorie ważnych maili, po jednej w linii",
    manualSenderRules: "Ręczne klasyfikacje nadawców",
    manualRulesHelp:
      "Najpierw działają ręczne klasyfikacje nadawców, potem reguły z zakładki Reguły, dalej fallbacki wbudowane w aplikację, a dopiero na końcu model. Format: nadawca => kategoria.",
    saveSettings: "Zapisz ustawienia",
    connectOAuth: "Podłącz przez Google OAuth",
    oauthImapHelp: "IMAP jest domyślną ścieżką i nie wymaga Google Client ID ani konfiguracji Google Cloud.",
    connectImap: "Podłącz przez IMAP",
    gmailAddress: "Adres Gmail",
    gmailAddressPlaceholder: "twoje.konto@gmail.com",
    gmailAppPassword: "Hasło aplikacji Gmail",
    gmailAppPasswordPlaceholder: "16-znakowe hasło aplikacji",
    imapHost: "Host IMAP",
    port: "Port",
    useSsl: "Użyj SSL/TLS",
    checking: "Sprawdzam...",
    gmail2faHelp: "Dla Gmaila z 2FA użyj hasła aplikacji Google, nie głównego hasła do konta.",
    connectAccountsHelp: "Podłącz konta przez IMAP. OAuth jest dostępny niżej jako opcja zaawansowana.",
    disconnect: "Odłącz",
    classificationRules: "Reguły klasyfikacji",
    rulesHelp:
      "Reguły z tej zakładki są sprawdzane po ręcznych przypisaniach nadawców, ale przed fallbackami w kodzie i przed modelem. To jest miejsce, w którym możesz sam dostroić klasyfikację bez grzebania w kodzie.",
    selectRule: "Wybierz regułę",
    newRule: "Nowa reguła",
    addRule: "Dodaj regułę",
    delete: "Usuń",
    category: "Kategoria",
    priority: "Priorytet",
    userAction: "Co ma zrobić użytkownik",
    senderDomains: "Nadawcy lub domeny",
    subjectBodyPhrases: "Frazy w temacie lub treści",
    noRules: "Nie ma jeszcze żadnych reguł. Dodaj pierwszą regułę i zapisz ustawienia.",
    saveRules: "Zapisz reguły",
    selectInvoiceProvider: "Wybierz dostawcę faktur",
    noDomain: "bez domeny",
    newProvider: "Nowy dostawca",
    addProvider: "Dodaj dostawcę",
    inactive: "nieaktywny",
    senderOnly: "Szukaj tylko po nadawcy",
    emailAsPdf: "Mail jako PDF",
    providerBodyPdfHelp: "Dla tego dostawcy aplikacja może zapisać treść maila jako PDF, gdy faktura nie ma załącznika.",
    providerSenderOnlyHelp: "Frazy marki są wtedy dodatkowym filtrem dla PDF-a, ale nie wyszukują maili samodzielnie.",
    providerSearchHelp: "Frazy marki mogą znaleźć maila także wtedy, gdy nadawcą jest Stripe, Paddle albo inny pośrednik.",
    providerName: "Nazwa dostawcy",
    folderDomain: "Domena folderu",
    fromFragments: "Fragmenty adresu nadawcy, pole From",
    fromReplyToEmails: "Konkretne adresy w polu From lub Reply-To",
    brandPhrases: "Frazy marki w temacie, treści maila albo PDF-ie",
    saveProvider: "Zapisz dostawcę",
    noProviders: "Nie ma jeszcze żadnych dostawców faktur w tym profilu.",
    invoiceIndex: "Indeks faktur",
    cleanup: "porządki",
    cleanupHelp:
      "Użyj tego po ręcznym usunięciu plików albo po poprawkach konfiguracji dostawców. Aplikacja wyczyści pamięć o brakujących plikach i starych duplikatach.",
    repairInvoiceIndex: "Napraw indeks faktur",
    working: "Pracuję...",
    mails: "Maile",
    duplicates: "Duplikaty",
    undoChanges: "Cofanie zmian",
    lastOf50: "ostatnie",
    refreshHistory: "Odśwież historię",
    historyHelp:
      "Tu trafiają operacje zmieniające status maili, na przykład „oznacz jako przeczytane” i „oznacz widoczne jako przeczytane”. Przy wybranym rekordzie możesz kliknąć „Cofnij”.",
    noOperations: "Nie ma jeszcze operacji do cofnięcia.",
    undone: "cofnięto",
    undoing: "Cofam...",
    undoneButton: "Cofnięto",
    undo: "Cofnij",
    importantNow: "Teraz ważne",
    unreadEntries: "wpisów nieprzeczytanych",
    firstSyncHelp: "Po pierwszym syncu pojawią się tu faktury, terminy płatności, księgowość i sprawy wymagające reakcji.",
    importantCategoriesAria: "Kategorie ważnych maili",
    bulkReadTitle: "Oznacz wszystkie maile widoczne na tej stronie jako przeczytane",
    marking: "Oznaczam...",
    markVisibleRead: "Oznacz widoczne jako przeczytane",
    markRead: "Oznacz jako przeczytany",
    due: "Termin",
    noMailInTab: "W tej zakładce nie ma teraz żadnych maili.",
    newer: "Nowsze",
    older: "Starsze",
    page: "Strona",
    of: "z",
    unknownAccount: "nieznane konto",
    to: "Do",
    notImportant: "Nieważne",
    removeSaved: "Usuń z zapisanych",
    save: "Zapisz",
    summarizeMail: "Streść",
    askAboutMail: "Zadaj pytanie",
    chatContextActive: "Kontekst maila",
    clearChatContext: "Wyczyść",
    chatContextReady: "Czat będzie teraz odpowiadał w kontekście wybranego maila.",
    summarizingSelectedMail: "Streszczam wybrany mail...",
    mailSummaryReady: "Podsumowanie dodane do czatu.",
    attachments: "Załączniki",
    open: "Otwórz",
    download: "Pobierz",
    reply: "Odpowiedz",
    replyHint: "Odpowiedź zostanie wysłana z tej samej skrzynki, na którą przyszedł wybrany mail.",
    replyPlaceholder: "Napisz odpowiedź...",
    sendReply: "Wyślij odpowiedź",
    sendingReply: "Wysyłam...",
    pickMail: "Wybierz mail po lewej, żeby zobaczyć treść.",
    mailboxChat: "Chat ze skrzynką",
    chatWindowInfo: "ostatnie 10 z 7 dni",
    chatPlaceholder: "O co chodzi w mailu od księgowej? Co wymaga płatności?",
    asking: "Pytam...",
    ask: "Zapytaj",
    emptyChat: "Tu pojawią się ostatnie pytania i odpowiedzi z czatu ze skrzynką.",
    you: "Ty",
    recentInvoices: "Ostatnie faktury",
    collapse: "Zwiń",
    show: "Pokaż",
    scanDate: "Data skanowania",
    month: "Miesiąc",
    domain: "Domena",
    amount: "Kwota",
    status: "Status",
    file: "Plik",
    invoiceEmpty: "Po skanowaniu pojawi się tu historia zapisanych faktur.",
    invoiceListCollapsed: "Lista faktur jest zwinięta.",
    remaining: "pozostałe",
    saved: "zapisane",
    readableEmpty: "Brak czytelnej treści wiadomości.",
    links: "Linki"
  },
  en: {
    loading: "Loading local dashboard...",
    profileEyebrow: "Profiles",
    spaces: "Workspaces",
    active: "active",
    newProfile: "New profile",
    companyProfilePlaceholder: "Business",
    creating: "One moment...",
    create: "Create",
    profileDescription:
      "A profile includes settings, rules, Gmail accounts, invoice providers, the invoice index, and local mailbox state.",
    mail: "Mail",
    archivizer: "Archivizer",
    changeHistory: "Change history",
    settings: "Settings",
    scanInvoices: "Scan invoices",
    refreshImportant: "Refresh important",
    configuration: "Configuration",
    activeProfile: "Active profile",
    close: "Close",
    settingsSections: "Settings sections",
    general: "General",
    gmailAccounts: "Gmail accounts",
    rules: "Rules",
    invoices: "Invoices",
    other: "Other",
    language: "Interface language",
    polish: "Polish",
    english: "English",
    appearance: "Appearance",
    dark: "Dark",
    light: "Light",
    system: "Follow macOS",
    autoSync: "Automatic important-mail refresh",
    enabled: "Enabled",
    disabled: "Disabled",
    autoSyncInterval: "Auto-sync interval, minutes",
    autoSyncHelp:
      "Auto-sync runs quietly in the background, does not start another run while one is still active, and by default only updates the Important now section.",
    oauthSavedLocally: "Google OAuth data is stored locally in the app folder, not in browser storage.",
    oauthAdvanced: "Google OAuth, optional",
    oauthOptionalHelp:
      "OAuth is optional. Use it only if you want browser-based mailbox authorization and you have your own OAuth client in Google Cloud.",
    oauthMissingConfig: "Save Google Client ID and Client Secret first to enable OAuth account connection.",
    imapRecommended: "Recommended",
    invoiceArchiveFolder: "Invoice archive folder",
    historicalScan: "Historical scan",
    openAiToken: "OpenAI API token",
    chatModel: "OpenAI chat model",
    classifierMode: "Classifier mode",
    classifierHybrid: "Hybrid: rules + lightweight model",
    classifierRules: "Rules only",
    classifierLocal: "Lightweight model for every mail",
    classifierUrl: "Classifier URL",
    classifierModel: "Classifier model",
    classifierTimeout: "Classifier timeout",
    aiHelp: "Mailbox chat uses OpenAI API, while classification can still run locally on a lightweight model or rules only.",
    importantSenders: "Important senders, one per line",
    importantCategories: "Important mail categories, one per line",
    manualSenderRules: "Manual sender classifications",
    manualRulesHelp:
      "Manual sender classifications run first, then Rules tab rules, then built-in fallbacks, and finally the model. Format: sender => category.",
    saveSettings: "Save settings",
    connectOAuth: "Connect with Google OAuth",
    oauthImapHelp: "IMAP is the default path and does not require Google Client ID or Google Cloud setup.",
    connectImap: "Connect with IMAP",
    gmailAddress: "Gmail address",
    gmailAddressPlaceholder: "your.account@gmail.com",
    gmailAppPassword: "Gmail app password",
    gmailAppPasswordPlaceholder: "16-character app password",
    imapHost: "IMAP host",
    port: "Port",
    useSsl: "Use SSL/TLS",
    checking: "Checking...",
    gmail2faHelp: "For Gmail with 2FA, use a Google app password, not the main account password.",
    connectAccountsHelp: "Connect accounts through IMAP. OAuth is available below as an advanced option.",
    disconnect: "Disconnect",
    classificationRules: "Classification rules",
    rulesHelp:
      "Rules in this tab are checked after manual sender mappings, but before built-in fallbacks and before the model. This is where you can tune classification without editing code.",
    selectRule: "Select rule",
    newRule: "New rule",
    addRule: "Add rule",
    delete: "Delete",
    category: "Category",
    priority: "Priority",
    userAction: "User action",
    senderDomains: "Senders or domains",
    subjectBodyPhrases: "Subject or body phrases",
    noRules: "There are no rules yet. Add the first rule and save settings.",
    saveRules: "Save rules",
    selectInvoiceProvider: "Select invoice provider",
    noDomain: "no domain",
    newProvider: "New provider",
    addProvider: "Add provider",
    inactive: "inactive",
    senderOnly: "Search by sender only",
    emailAsPdf: "Email as PDF",
    providerBodyPdfHelp: "For this provider, the app can save the email body as PDF when there is no invoice attachment.",
    providerSenderOnlyHelp: "Brand phrases are then an additional PDF filter, but they do not search mail by themselves.",
    providerSearchHelp: "Brand phrases can find mail even when the sender is Stripe, Paddle, or another payment intermediary.",
    providerName: "Provider name",
    folderDomain: "Folder domain",
    fromFragments: "Sender address fragments, From field",
    fromReplyToEmails: "Exact addresses in From or Reply-To",
    brandPhrases: "Brand phrases in subject, email body, or PDF",
    saveProvider: "Save provider",
    noProviders: "There are no invoice providers in this profile yet.",
    invoiceIndex: "Invoice index",
    cleanup: "cleanup",
    cleanupHelp:
      "Use this after manually deleting files or after provider configuration fixes. The app will remove references to missing files and old duplicates.",
    repairInvoiceIndex: "Repair invoice index",
    working: "Working...",
    mails: "Mail",
    duplicates: "Duplicates",
    undoChanges: "Undo changes",
    lastOf50: "latest",
    refreshHistory: "Refresh history",
    historyHelp:
      "This view stores operations that change mail status, for example mark as read and mark visible as read. Pick a record and click Undo.",
    noOperations: "There are no operations to undo yet.",
    undone: "undone",
    undoing: "Undoing...",
    undoneButton: "Undone",
    undo: "Undo",
    importantNow: "Important now",
    unreadEntries: "unread entries",
    firstSyncHelp: "After the first sync, invoices, payment due dates, accounting, and action-required mail will appear here.",
    importantCategoriesAria: "Important mail categories",
    bulkReadTitle: "Mark all mail visible on this page as read",
    marking: "Marking...",
    markVisibleRead: "Mark visible as read",
    markRead: "Mark as read",
    due: "Due",
    noMailInTab: "There is no mail in this tab right now.",
    newer: "Newer",
    older: "Older",
    page: "Page",
    of: "of",
    unknownAccount: "unknown account",
    to: "To",
    notImportant: "Not important",
    removeSaved: "Remove from saved",
    save: "Save",
    summarizeMail: "Summarize",
    askAboutMail: "Ask question",
    chatContextActive: "Mail context",
    clearChatContext: "Clear",
    chatContextReady: "Mailbox chat will now answer in the context of the selected email.",
    summarizingSelectedMail: "Summarizing the selected email...",
    mailSummaryReady: "Summary added to the chat.",
    attachments: "Attachments",
    open: "Open",
    download: "Download",
    reply: "Reply",
    replyHint: "The reply will be sent from the same mailbox that received the selected message.",
    replyPlaceholder: "Write a reply...",
    sendReply: "Send reply",
    sendingReply: "Sending...",
    pickMail: "Select a message on the left to see its content.",
    mailboxChat: "Mailbox chat",
    chatWindowInfo: "last 10 from 7 days",
    chatPlaceholder: "What is this email about? What needs payment?",
    asking: "Asking...",
    ask: "Ask",
    emptyChat: "Recent mailbox-chat questions and answers will appear here.",
    you: "You",
    recentInvoices: "Recent invoices",
    collapse: "Collapse",
    show: "Show",
    scanDate: "Scan date",
    month: "Month",
    domain: "Domain",
    amount: "Amount",
    status: "Status",
    file: "File",
    invoiceEmpty: "Saved invoice history will appear here after scanning.",
    invoiceListCollapsed: "The invoice list is collapsed.",
    remaining: "remaining",
    saved: "saved",
    readableEmpty: "No readable message content.",
    links: "Links"
  }
} satisfies Record<UiLanguage, Record<string, string>>;

const CATEGORY_LABELS_EN: Record<string, string> = {
  "pozostałe": "remaining",
  "zapisane": "saved",
  "faktury i rachunki": "invoices and bills",
  "płatności": "payments",
  "platnosci": "payments",
  "zamówienia": "orders",
  "zamowienia": "orders",
  "oferty pracy": "job offers",
  "zdrowie": "health",
  "bankowe": "banking",
  "konta i bezpieczeństwo": "accounts and security",
  "konta i bezpieczenstwo": "accounts and security",
  "księgowość": "accounting",
  "ksiegowosc": "accounting"
};

function App() {
  const [settingsTab, setSettingsTab] = useState<"general" | "gmail" | "rules" | "invoices" | "other">("general");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
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
  const [replyText, setReplyText] = useState("");
  const [replySending, setReplySending] = useState(false);
  const [bulkReadRunning, setBulkReadRunning] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [status, setStatus] = useState("");
  const [toast, setToast] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [activeView, setActiveView] = useState<"mail" | "archivizer" | "operations">("mail");
  const [invoicesExpanded, setInvoicesExpanded] = useState(true);
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
  const [mailChatContext, setMailChatContext] = useState<MailChatContext | null>(null);
  const [operations, setOperations] = useState<MailOperation[]>([]);
  const [operationUndoingId, setOperationUndoingId] = useState("");
  const accountEmailById = useMemo(() => {
    return new Map(accounts.map(account => [account.id, account.email]));
  }, [accounts]);
  const language = settings?.language || browserDefaultLanguage();
  const t = TEXT[language];
  const oauthConfigured = Boolean(settings?.googleClientId.trim() && settings?.googleClientSecret.trim());

  async function load() {
    const data = await api("/api/bootstrap");
    applyBootstrap(data);
  }

  function applyBootstrap(data: {
    profiles?: Profile[];
    activeProfile?: Profile;
    activeProfileId?: string;
    settings: Settings;
    accounts: Account[];
    providers: Provider[];
    invoices: Invoice[];
    chatHistory?: ChatTurn[];
    operations?: MailOperation[];
    uiState?: UiState;
    importantItems: ImportantItem[];
    otherUnreadItems: ImportantItem[];
    savedMailItems: ImportantItem[];
  }) {
    setMailFeedReady(false);
    setUiStateReady(false);
    setProfiles(data.profiles || []);
    setActiveProfileId(data.activeProfileId || "");
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
    setMailChatContext(null);
  }, [activeProfileId]);

  useEffect(() => {
    const rules = settings?.categoryRules || [];
    if (rules.length === 0) {
      if (selectedRuleId) setSelectedRuleId("");
      return;
    }
    if (!rules.some(rule => rule.id === selectedRuleId)) {
      setSelectedRuleId(rules[0].id);
    }
  }, [settings?.categoryRules, selectedRuleId]);

  useEffect(() => {
    if (providers.length === 0) {
      if (selectedProviderId) setSelectedProviderId("");
      return;
    }
    if (!providers.some(provider => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0].id);
    }
  }, [providers, selectedProviderId]);

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

  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
    });
  }, [invoices]);

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
        label: t.remaining,
        count: otherUnreadItems.length
      },
      {
        key: "zapisane",
        label: t.saved,
        count: savedMailItems.length
      }
    ];
  }, [importantCategories, otherUnreadItems.length, savedMailItems.length, t.remaining, t.saved]);

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

  useEffect(() => {
    setReplyText("");
    setReplySending(false);
  }, [selectedImportantId]);

  const selectedImportantBodyHtml = useMemo(() => {
    if (!selectedImportant) return "";
    return buildReadableMailHtml(selectedImportant.html, selectedImportant.text || selectedImportant.snippet, t);
  }, [selectedImportant, t]);

  const visibleChatHistory = chatPendingQuestion
    ? [
        ...chatHistory,
        {
          id: "pending",
          question: chatPendingQuestion,
          answer: language === "en" ? "Asking OpenAI..." : "Pytam OpenAI...",
          createdAt: new Date().toISOString()
        }
      ]
    : chatHistory;

  const categoryRules = settings?.categoryRules || [];
  const selectedRule = categoryRules.find(rule => rule.id === selectedRuleId) || categoryRules[0] || null;
  const selectedProvider = providers.find(provider => provider.id === selectedProviderId) || providers[0] || null;
  const activeProfileName = profiles.find(profile => profile.id === activeProfileId)?.name || t.activeProfile;

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

  async function switchProfile(profileId: string) {
    if (!profileId || profileId === activeProfileId || profileBusy) return;
    setProfileBusy(true);
    setActiveJob(null);
    setStatus(language === "en" ? "Switching profile..." : "Przełączam profil...");
    try {
      const data = await api("/api/profiles/active", {
        method: "POST",
        body: JSON.stringify({ id: profileId })
      });
      applyBootstrap(data);
      setStatus("");
      setToast(
        language === "en"
          ? `Active profile: ${data.activeProfile?.name || "selected profile"}.`
          : `Aktywny profil: ${data.activeProfile?.name || "wybrany profil"}.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error, language));
    } finally {
      setProfileBusy(false);
    }
  }

  async function createNewProfile(event: React.FormEvent) {
    event.preventDefault();
    if (profileBusy) return;
    setProfileBusy(true);
    setActiveJob(null);
    setStatus(language === "en" ? "Creating profile..." : "Tworzę profil...");
    try {
      const data = await api("/api/profiles", {
        method: "POST",
        body: JSON.stringify({ name: newProfileName })
      });
      applyBootstrap(data);
      setNewProfileName("");
      setStatus("");
      setToast(
        language === "en"
          ? `Created profile: ${data.activeProfile?.name || "New profile"}.`
          : `Utworzono profil: ${data.activeProfile?.name || "Nowy profil"}.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error, language));
    } finally {
      setProfileBusy(false);
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
    setToast(language === "en" ? "Settings saved." : "Ustawienia zapisane.");
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
    setStatus(language === "en" ? "Marking mail as read..." : "Oznaczam mail jako przeczytany...");
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
          ? language === "en"
            ? "Mail marked as read. It remains in Saved. You can undo this in operation history."
            : "Mail oznaczony jako przeczytany. Pozostaje w zakładce Zapisane. Możesz cofnąć to w historii operacji."
          : language === "en"
          ? "Mail marked as read and removed from unread lists. You can undo this in operation history."
          : "Mail oznaczony jako przeczytany i usunięty z list nieprzeczytanych. Możesz cofnąć to w historii operacji."
        : language === "en"
        ? `Mail disappeared from unread lists, but Gmail did not confirm marking it as read${response.gmailError ? `: ${response.gmailError}` : "."}`
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
    setStatus(
      language === "en"
        ? `Marking ${items.length} visible messages as read...`
        : `Oznaczam ${items.length} widocznych maili jako przeczytane...`
    );
    try {
      const response = await api("/api/mail/read-visible", {
        method: "POST",
        body: JSON.stringify({ items })
      });
      applyMailFeed(response);
      const errorCount = Array.isArray(response.errors) ? response.errors.length : 0;
      setStatus(
        errorCount > 0
          ? language === "en"
            ? `Marked ${response.markedRead || items.length} visible messages locally. Not all accounts confirmed the change: ${response.errors.join("; ")}`
            : `Oznaczono lokalnie ${response.markedRead || items.length} widocznych maili. Nie wszystkie konta potwierdziły zmianę: ${response.errors.join("; ")}`
          : language === "en"
          ? `Marked ${response.markedRead || items.length} visible messages as read. You can undo this in operation history.`
          : `Oznaczono ${response.markedRead || items.length} widocznych maili jako przeczytane. Możesz cofnąć to w historii operacji.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error, language));
    } finally {
      setBulkReadRunning(false);
    }
  }

  async function undoOperation(operation: MailOperation) {
    if (operation.status === "undone" || operationUndoingId) return;
    setOperationUndoingId(operation.id);
    setStatus(language === "en" ? `Undoing operation: ${operation.label}...` : `Cofam operację: ${operation.label}...`);
    try {
      const response = await api(`/api/operations/${operation.id}/undo`, {
        method: "POST"
      });
      applyMailFeed(response);
      const errorCount = Array.isArray(response.errors) ? response.errors.length : 0;
      setStatus(
        errorCount > 0
          ? language === "en"
            ? `Undone locally, but not all accounts confirmed the change in Gmail/IMAP: ${response.errors.join("; ")}`
            : `Cofnięto lokalnie operację, ale nie wszystkie konta potwierdziły zmianę w Gmailu/IMAP: ${response.errors.join("; ")}`
          : language === "en"
          ? `Undone operation: ${operation.label}.`
          : `Cofnięto operację: ${operation.label}.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error, language));
    } finally {
      setOperationUndoingId("");
    }
  }

  async function toggleSelectedMailSaved() {
    if (!selectedImportant) return;
    const nextSaved = !selectedImportant.saved;
    setStatus(
      nextSaved
        ? language === "en"
          ? "Saving mail..."
          : "Zapisuję mail..."
        : language === "en"
        ? "Removing mail from saved..."
        : "Usuwam mail z zapisanych..."
    );
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
        ? language === "en"
          ? "Mail added to Saved and moved to that tab."
          : "Mail dodany do zapisanych i przeniesiony do tej zakładki."
        : response.currentUnread === false
        ? language === "en"
          ? "Mail removed from Saved. It was already read, so it disappeared from the lists."
          : "Mail usunięty z zapisanych. Był już przeczytany, więc zniknął z list."
        : response.gmailError
        ? language === "en"
          ? `Mail removed from Saved. Could not confirm status in Gmail: ${response.gmailError}`
          : `Mail usunięty z zapisanych. Nie udało się potwierdzić statusu w Gmailu: ${response.gmailError}`
        : language === "en"
        ? "Mail removed from Saved."
        : "Mail usunięty z zapisanych."
    );
  }

  async function ignoreSelectedMail() {
    if (!selectedImportant || selectedImportant.saved) return;
    setStatus(language === "en" ? "Marking mail as not important..." : "Oznaczam mail jako nieważny...");
    const response = await api("/api/mail/ignore", {
      method: "POST",
      body: JSON.stringify({
        accountId: selectedImportant.accountId,
        messageId: selectedImportant.messageId,
        ignored: true
      })
    });
    applyMailFeed(response);
    setStatus(
      language === "en"
        ? "Mail was hidden from important lists and will not return in future syncs."
        : "Mail został ukryty z list ważnych i nie będzie wracał przy kolejnych synchronizacjach."
    );
  }

  function mailContextFromDetail(mail: ImportantDetail): MailChatContext {
    return {
      accountId: mail.accountId,
      messageId: mail.messageId,
      subject: mail.subject,
      fromLabel: `${mail.fromName || mail.fromEmail} <${mail.fromEmail}>`,
      receivedAt: mail.receivedAt
    };
  }

  function summaryQuestionForSelectedMail() {
    return language === "en"
      ? "Summarize the selected email. Focus on what it is about, dates, amounts, deadlines, and what I should do next."
      : "Streść wybrany mail. Skup się na tym, czego dotyczy, datach, kwotach, terminach i tym, co powinienem zrobić dalej.";
  }

  async function submitMailboxQuestion(
    askedQuestion: string,
    focusedContext: MailChatContext | null,
    restoreQuestionOnError = false
  ) {
    const trimmedQuestion = askedQuestion.trim();
    if (!trimmedQuestion || chatPendingQuestion) return false;
    setChatPendingQuestion(trimmedQuestion);
    try {
      const result = await api("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          question: trimmedQuestion,
          ...(focusedContext
            ? {
                mailContext: {
                  accountId: focusedContext.accountId,
                  messageId: focusedContext.messageId
                }
              }
            : {})
        })
      });
      setChatHistory(result.chatHistory || []);
      return true;
    } catch (error) {
      setStatus(apiErrorMessage(error, language));
      if (restoreQuestionOnError) setQuestion(trimmedQuestion);
      return false;
    } finally {
      setChatPendingQuestion("");
    }
  }

  async function summarizeSelectedMail() {
    if (!selectedImportant || chatPendingQuestion) return;
    const context = mailContextFromDetail(selectedImportant);
    setMailChatContext(context);
    setStatus(t.summarizingSelectedMail);
    const ok = await submitMailboxQuestion(summaryQuestionForSelectedMail(), context);
    if (ok) setStatus(t.mailSummaryReady);
  }

  function askAboutSelectedMail() {
    if (!selectedImportant) return;
    setMailChatContext(mailContextFromDetail(selectedImportant));
    setStatus(t.chatContextReady);
  }

  async function askMailbox(event: React.FormEvent) {
    event.preventDefault();
    const askedQuestion = question.trim();
    if (!askedQuestion || chatPendingQuestion) return;
    setQuestion("");
    await submitMailboxQuestion(askedQuestion, mailChatContext, true);
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedImportant || replySending) return;
    const body = replyText.trim();
    if (!body) {
      setStatus(language === "en" ? "Write a reply before sending." : "Napisz treść odpowiedzi przed wysłaniem.");
      return;
    }

    setReplySending(true);
    setStatus(language === "en" ? "Sending reply..." : "Wysyłam odpowiedź...");
    try {
      const result = await api("/api/mail/reply", {
        method: "POST",
        body: JSON.stringify({
          accountId: selectedImportant.accountId,
          messageId: selectedImportant.messageId,
          body
        })
      }) as { to: string; subject: string };
      setReplyText("");
      setStatus(
        language === "en"
          ? `Reply sent to ${result.to}.`
          : `Odpowiedź wysłana do ${result.to}.`
      );
    } catch (error) {
      setStatus(apiErrorMessage(error, language));
    } finally {
      setReplySending(false);
    }
  }

  async function disconnectAccount(accountId: string) {
    await api(`/api/accounts/${accountId}`, { method: "DELETE" });
    await load();
    setToast(language === "en" ? "Mail account disconnected." : "Konto pocztowe odłączone.");
  }

  async function connectImapAccount(event: React.FormEvent) {
    event.preventDefault();
    setImapConnecting(true);
    setStatus(language === "en" ? "Checking IMAP connection..." : "Sprawdzam połączenie IMAP...");
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
      setStatus(language === "en" ? "IMAP account connected." : "Konto IMAP podłączone.");
      setToast(language === "en" ? "IMAP account connected successfully." : "Konto IMAP podłączone poprawnie.");
    } catch (error) {
      const message = apiErrorMessage(error, language);
      setStatus(message);
      setToast(message);
    } finally {
      setImapConnecting(false);
    }
  }

  async function saveProvider(provider: Provider) {
    const normalizedProvider = {
      ...provider,
      name: provider.name.trim(),
      targetDomain: provider.targetDomain.trim().toLowerCase()
    };
    if (!normalizedProvider.name || !normalizedProvider.targetDomain) {
      setToast(
        language === "en"
          ? "Enter provider name and folder domain before saving."
          : "Podaj nazwę dostawcy i domenę folderu przed zapisem."
      );
      return;
    }
    const saved = await api("/api/providers", {
      method: "POST",
      body: JSON.stringify(normalizedProvider)
    });
    setProviders(saved);
    setSelectedProviderId(normalizedProvider.id);
    setToast(
      language === "en"
        ? `Saved provider settings: ${normalizedProvider.name}.`
        : `Zapisano ustawienia dostawcy: ${normalizedProvider.name}.`
    );
  }

  async function cleanupInvoiceIndex() {
    setStatus(language === "en" ? "Repairing invoice index..." : "Naprawiam indeks faktur...");
    const response = await api("/api/invoices/cleanup", {
      method: "POST",
      body: JSON.stringify({ removeMissingFiles: true, removeDuplicateRows: true })
    }) as { result: CleanupResult; invoices: Invoice[] };
    setInvoices(response.invoices);
    setStatus(
      language === "en"
        ? `Index repaired: checked ${response.result.checkedSavedFiles}, removed missing ${response.result.removedMissingFileRows}, duplicates ${response.result.removedDuplicateRows}.`
        : `Indeks naprawiony: sprawdzono ${response.result.checkedSavedFiles}, usunięto brakujące ${response.result.removedMissingFileRows}, duplikaty ${response.result.removedDuplicateRows}.`
    );
  }

  function updateProvider(providerId: string, patch: Partial<Provider>) {
    setProviders(current =>
      current.map(provider => (provider.id === providerId ? { ...provider, ...patch } : provider))
    );
  }

  function addProvider() {
    const provider: Provider = {
      id: `provider-${Date.now()}`,
      name: t.newProvider,
      targetDomain: "",
      senderDomains: [],
      senderEmails: [],
      searchTerms: [],
      senderOnly: true,
      emailBodyPdf: false,
      enabled: true
    };
    setProviders(current => [...current, provider]);
    setSelectedProviderId(provider.id);
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
    const rule: CategoryRule = {
      id: `rule-${Date.now()}`,
      category: "",
      priority: "medium",
      actionRequired: "",
      senderTerms: [],
      keywordTerms: []
    };
    setSettings({
      ...settings,
      categoryRules: [...settings.categoryRules, rule]
    });
    setSelectedRuleId(rule.id);
  }

  function removeCategoryRule(ruleId: string) {
    if (!settings) return;
    const nextRules = settings.categoryRules.filter(rule => rule.id !== ruleId);
    setSettings({
      ...settings,
      categoryRules: nextRules
    });
    if (selectedRuleId === ruleId) {
      setSelectedRuleId(nextRules[0]?.id || "");
    }
  }

  if (!settings) {
    return <main className="shell">{t.loading}</main>;
  }

  return (
    <main className="shell">
      {toast && (
        <div className="toast-stack" aria-live="polite">
          <div className="toast toast-success">{toast}</div>
        </div>
      )}
      <div className="app-layout">
        <aside className="profile-sidebar" aria-label="Profile">
          <div>
            <p className="eyebrow">{t.profileEyebrow}</p>
            <h2>{t.spaces}</h2>
          </div>
          <div className="profile-list">
            {profiles.map(profile => (
              <button
                className={profile.id === activeProfileId ? "profile-pill active" : "profile-pill"}
                disabled={profileBusy}
                key={profile.id}
                onClick={() => void switchProfile(profile.id)}
                type="button"
              >
                <span>{profile.name}</span>
                {profile.id === activeProfileId && <small>{t.active}</small>}
              </button>
            ))}
          </div>
          <form className="profile-create" onSubmit={createNewProfile}>
            <label>
              {t.newProfile}
              <input
                disabled={profileBusy}
                onChange={event => setNewProfileName(event.target.value)}
                placeholder={t.companyProfilePlaceholder}
                value={newProfileName}
              />
            </label>
            <button className="small-button" disabled={profileBusy} type="submit">
              {profileBusy ? t.creating : t.create}
            </button>
          </form>
          <p className="muted">{t.profileDescription}</p>
        </aside>
        <div className="app-content">
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
            {t.mail}
          </button>
          <button
            className={`button ${activeView === "archivizer" ? "accent" : "secondary"}`}
            onClick={() => setActiveView("archivizer")}
            type="button"
          >
            {t.archivizer}
          </button>
          <button
            className={`button ${activeView === "operations" ? "accent" : "secondary"}`}
            onClick={() => setActiveView("operations")}
            type="button"
          >
            {t.changeHistory}{operations.length > 0 ? ` (${operations.length})` : ""}
          </button>
          <button
            aria-label={t.settings}
            className="button secondary icon-button"
            onClick={() => setSettingsOpen(true)}
            title={t.settings}
            type="button"
          >
            <span aria-hidden="true">⚙</span>
          </button>
          {activeView === "mail" && (
            <button className="button accent" onClick={startImportantSync}>
              {t.refreshImportant}
            </button>
          )}
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
                <p className="eyebrow">{t.configuration}</p>
                <h2 id="settings-title">{t.settings}</h2>
                <p className="muted">{t.activeProfile}: {activeProfileName}</p>
              </div>
	              <button className="small-button" onClick={() => setSettingsOpen(false)}>
	                {t.close}
	              </button>
	            </div>
	            <div className="settings-tabs" role="tablist" aria-label={t.settingsSections}>
	              <button
	                className={`settings-tab ${settingsTab === "general" ? "active" : ""}`}
	                onClick={() => setSettingsTab("general")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "general"}
	              >
	                {t.general}
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "gmail" ? "active" : ""}`}
	                onClick={() => setSettingsTab("gmail")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "gmail"}
	              >
	                {t.gmailAccounts}
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "rules" ? "active" : ""}`}
	                onClick={() => setSettingsTab("rules")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "rules"}
	              >
	                {t.rules}
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "invoices" ? "active" : ""}`}
	                onClick={() => setSettingsTab("invoices")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "invoices"}
	              >
	                {t.invoices}
	              </button>
	              <button
	                className={`settings-tab ${settingsTab === "other" ? "active" : ""}`}
	                onClick={() => setSettingsTab("other")}
	                role="tab"
	                type="button"
	                aria-selected={settingsTab === "other"}
	              >
	                {t.other}
	              </button>
	            </div>

	            {settingsTab === "general" && (
	              <>
	                <form className="settings-form" onSubmit={saveSettings}>
	                  <label>
	                    {t.language}
	                    <select
	                      value={settings.language}
	                      onChange={event => setSettings({ ...settings, language: event.target.value as Settings["language"] })}
	                    >
	                      <option value="pl">{t.polish}</option>
	                      <option value="en">{t.english}</option>
	                    </select>
	                  </label>
	                  <label>
	                    {t.appearance}
	                    <select
	                      value={settings.themeMode}
	                      onChange={event => setSettings({ ...settings, themeMode: event.target.value as Settings["themeMode"] })}
	                    >
	                      <option value="dark">{t.dark}</option>
	                      <option value="light">{t.light}</option>
	                      <option value="system">{t.system}</option>
	                    </select>
	                  </label>
	                  <label>
	                    {t.autoSync}
	                    <select
	                      value={settings.autoSyncEnabled ? "on" : "off"}
	                      onChange={event => setSettings({ ...settings, autoSyncEnabled: event.target.value === "on" })}
	                    >
	                      <option value="off">{t.disabled}</option>
	                      <option value="on">{t.enabled}</option>
	                    </select>
	                  </label>
	                  <label>
	                    {t.autoSyncInterval}
	                    <input
	                      type="number"
	                      min={5}
	                      max={240}
	                      step={5}
	                      value={settings.autoSyncMinutes}
	                      onChange={event => setSettings({ ...settings, autoSyncMinutes: Number(event.target.value) })}
	                    />
	                  </label>
	                  <p className="muted full">{t.autoSyncHelp}</p>
	                  <label>
	                    {t.invoiceArchiveFolder}
	                    <input
	                      value={settings.archiveDir}
	                      onChange={event => setSettings({ ...settings, archiveDir: event.target.value })}
	                      placeholder="/Users/krzysztof/Documents/Faktury"
	                    />
	                  </label>
	                  <label>
	                    {t.historicalScan}
	                    <input
	                      type="number"
	                      min={1}
	                      max={10}
	                      value={settings.historyYears}
	                      onChange={event => setSettings({ ...settings, historyYears: Number(event.target.value) })}
	                    />
	                  </label>
	                  <label>
	                    {t.openAiToken}
	                    <input
	                      type="password"
	                      value={settings.llmApiKey}
	                      onChange={event => setSettings({ ...settings, llmApiKey: event.target.value })}
	                      placeholder={settings.llmApiKey ? "configured" : "sk-..."}
	                    />
	                  </label>
	                  <label>
	                    {t.chatModel}
	                    <input
	                      value={settings.llmModel}
	                      onChange={event => setSettings({ ...settings, llmModel: event.target.value })}
	                      placeholder="gpt-4.1-mini"
	                    />
	                  </label>
	                  <label>
	                    {t.classifierMode}
	                    <select
	                      value={settings.classifierMode}
	                      onChange={event =>
	                        setSettings({ ...settings, classifierMode: event.target.value as Settings["classifierMode"] })
	                      }
	                    >
	                      <option value="hybrid">{t.classifierHybrid}</option>
	                      <option value="rules">{t.classifierRules}</option>
	                      <option value="local-llm">{t.classifierLocal}</option>
	                    </select>
	                  </label>
	                  <label>
	                    {t.classifierUrl}
	                    <input
	                      value={settings.classifierBaseUrl}
	                      onChange={event => setSettings({ ...settings, classifierBaseUrl: event.target.value })}
	                      placeholder="http://127.0.0.1:11434"
	                    />
	                  </label>
	                  <label>
	                    {t.classifierModel}
	                    <input
	                      value={settings.classifierModel}
	                      onChange={event => setSettings({ ...settings, classifierModel: event.target.value })}
	                      placeholder="qwen2.5:1.5b-instruct"
	                    />
	                  </label>
	                  <label>
	                    {t.classifierTimeout}
	                    <input
	                      type="number"
	                      min={500}
	                      max={15000}
	                      step={500}
	                      value={settings.classifierTimeoutMs}
	                      onChange={event => setSettings({ ...settings, classifierTimeoutMs: Number(event.target.value) })}
	                    />
	                  </label>
	                  <p className="muted full">{t.aiHelp}</p>
	                  <label className="full">
	                    {t.importantSenders}
	                    <textarea
	                      value={settings.importantSenders}
	                      onChange={event => setSettings({ ...settings, importantSenders: event.target.value })}
	                      placeholder={
	                        language === "en"
	                          ? "accountant@example.com\naccounting office\nbank"
	                          : "ksiegowa@example.com\nbiuro rachunkowe\nbank"
	                      }
	                    />
	                  </label>
		                  <label className="full">
		                    {t.importantCategories}
		                    <textarea
		                      value={settings.importantCategories}
		                      onChange={event => setSettings({ ...settings, importantCategories: event.target.value })}
		                      placeholder={
		                        language === "en"
		                          ? "invoices and bills\npayments and due dates\njob offers"
		                          : "faktury i rachunki\npłatności i terminy płatności\noferty pracy"
		                      }
		                    />
		                  </label>
		                  <label className="full">
		                    {t.manualSenderRules}
		                    <textarea
		                      value={settings.senderCategoryRules}
		                      onChange={event => setSettings({ ...settings, senderCategoryRules: event.target.value })}
		                      placeholder={
		                        language === "en"
		                          ? "notifications@example.com => orders\nnewsletter@example.com => ai"
		                          : "powiadomienia@allegromail.pl => zamówienia\nnewsletter@example.com => ai"
		                      }
		                    />
		                  </label>
		                  <p className="muted full">{t.manualRulesHelp}</p>
		                  <div className="modal-actions full">
		                    <button className="button" type="submit">
		                      {t.saveSettings}
		                    </button>
		                  </div>
		                </form>
		              </>
		            )}

		            {settingsTab === "gmail" && (
		              <div className="settings-section settings-section-plain">
	                <div className="section-title">
	                  <h2>{t.gmailAccounts}</h2>
	                  <span>{accounts.length}</span>
	                </div>
	                <form className="imap-connect-form" onSubmit={connectImapAccount}>
	                  <div className="form-heading full">
	                    <h3>{t.connectImap}</h3>
	                    <span className="account-auth-badge recommended">{t.imapRecommended}</span>
	                  </div>
	                  <p className="muted full">{t.oauthImapHelp}</p>
	                  <label>
	                    {t.gmailAddress}
	                    <input
	                      autoComplete="username"
	                      inputMode="email"
	                      onChange={event => setImapForm({ ...imapForm, email: event.target.value })}
	                      placeholder={t.gmailAddressPlaceholder}
	                      type="email"
	                      value={imapForm.email}
	                    />
	                  </label>
	                  <label>
	                    {t.gmailAppPassword}
	                    <input
	                      autoComplete="new-password"
	                      onChange={event => setImapForm({ ...imapForm, password: event.target.value })}
	                      placeholder={t.gmailAppPasswordPlaceholder}
	                      type="password"
	                      value={imapForm.password}
	                    />
	                  </label>
	                  <label>
	                    {t.imapHost}
	                    <input
	                      onChange={event => setImapForm({ ...imapForm, host: event.target.value })}
	                      value={imapForm.host}
	                    />
	                  </label>
	                  <label>
	                    {t.port}
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
	                    {t.useSsl}
	                  </label>
	                  <button className="button" disabled={imapConnecting} type="submit">
	                    {imapConnecting ? t.checking : t.connectImap}
	                  </button>
	                  <p className="muted full">{t.gmail2faHelp}</p>
	                </form>
	                <details className="oauth-advanced">
	                  <summary>{t.oauthAdvanced}</summary>
	                  <p className="muted">{t.oauthOptionalHelp}</p>
	                  <form className="settings-form oauth-config-form" onSubmit={saveSettings}>
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
	                    <p className="muted full">{t.oauthSavedLocally}</p>
	                    <div className="modal-actions full">
	                      <button className="button" type="submit">
	                        {t.saveSettings}
	                      </button>
	                      {oauthConfigured ? (
	                        <a className="button secondary" href="/api/auth/google/start">
	                          {t.connectOAuth}
	                        </a>
	                      ) : (
	                        <button className="button secondary" disabled type="button">
	                          {t.connectOAuth}
	                        </button>
	                      )}
	                    </div>
	                    {!oauthConfigured && <p className="muted full">{t.oauthMissingConfig}</p>}
	                  </form>
	                </details>
	                {accounts.length === 0 ? (
	                  <p className="muted">{t.connectAccountsHelp}</p>
	                ) : (
	                  <ul className="plain-list">
	                    {accounts.map(account => (
	                      <li key={account.id}>
	                        <span className="account-row-main">
	                          <span>{account.email}</span>
	                          <span className="account-auth-badge">{account.authType === "imap" ? "IMAP" : "OAuth"}</span>
	                        </span>
	                        <button className="small-button" onClick={() => void disconnectAccount(account.id)} type="button">
	                          {t.disconnect}
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
		                  <h2>{t.classificationRules}</h2>
		                  <span>{settings.categoryRules.length}</span>
		                </div>
		                <p className="muted">{t.rulesHelp}</p>
		                <div className="single-editor-toolbar">
		                  <label className="editor-select">
		                    {t.selectRule}
		                    <select
		                      value={selectedRule?.id || ""}
		                      onChange={event => setSelectedRuleId(event.target.value)}
		                    >
		                      {categoryRules.map(rule => (
		                        <option key={rule.id} value={rule.id}>
		                          {rule.category || t.newRule} · {rule.priority}
		                        </option>
		                      ))}
		                    </select>
		                  </label>
		                  <button className="button secondary" onClick={addCategoryRule} type="button">
		                    {t.addRule}
		                  </button>
		                </div>
		                {selectedRule ? (
		                  <section className="rule-card single-editor-card">
		                    <div className="rule-card-header">
		                      <strong>{selectedRule.category || t.newRule}</strong>
		                      <button className="small-button" onClick={() => removeCategoryRule(selectedRule.id)} type="button">
		                        {t.delete}
		                      </button>
		                    </div>
		                    <div className="provider-fields">
		                      <label>
		                        {t.category}
		                        <input
		                          value={selectedRule.category}
		                          onChange={event => updateCategoryRule(selectedRule.id, { category: event.target.value })}
		                          placeholder={language === "en" ? "orders" : "zamówienia"}
		                        />
		                      </label>
		                      <label>
		                        {t.priority}
		                        <select
		                          value={selectedRule.priority}
		                          onChange={event => updateCategoryRule(selectedRule.id, { priority: event.target.value as CategoryRule["priority"] })}
		                        >
		                          <option value="high">high</option>
		                          <option value="medium">medium</option>
		                        </select>
		                      </label>
		                      <label className="full">
		                        {t.userAction}
		                        <input
		                          value={selectedRule.actionRequired}
		                          onChange={event => updateCategoryRule(selectedRule.id, { actionRequired: event.target.value })}
		                          placeholder={language === "en" ? "Check order status." : "Sprawdź status zamówienia."}
		                        />
		                      </label>
		                      <label>
		                        {t.senderDomains}
		                        <textarea
		                          value={selectedRule.senderTerms.join("\n")}
		                          onChange={event => updateCategoryRule(selectedRule.id, { senderTerms: lines(event.target.value) })}
		                          placeholder={language === "en" ? "notifications@example.com\nexample.com" : "powiadomienia@allegromail.pl\nallegro.pl"}
		                        />
		                      </label>
		                      <label>
		                        {t.subjectBodyPhrases}
		                        <textarea
		                          value={selectedRule.keywordTerms.join("\n")}
		                          onChange={event => updateCategoryRule(selectedRule.id, { keywordTerms: lines(event.target.value) })}
		                          placeholder={language === "en" ? "order status\nyour order" : "status zamówienia\ntwoje zamówienie"}
		                        />
		                      </label>
		                    </div>
		                  </section>
		                ) : (
		                  <p className="muted">{t.noRules}</p>
		                )}
		                <div className="modal-actions">
		                  <button className="button" onClick={saveSettings} type="button">
		                    {t.saveRules}
		                  </button>
		                </div>
		              </div>
		            )}

		            {settingsTab === "invoices" && (
		              <div className="settings-section settings-section-plain">
		                <div className="section-title">
		                  <h2>{t.invoices}</h2>
		                  <span>{providers.filter(provider => provider.enabled).length}</span>
		                </div>
		                <div className="single-editor-toolbar">
		                  <label className="editor-select">
		                    {t.selectInvoiceProvider}
		                    <select
		                      value={selectedProvider?.id || ""}
		                      onChange={event => setSelectedProviderId(event.target.value)}
		                    >
		                      {providers.map(provider => (
		                        <option key={provider.id} value={provider.id}>
		                          {provider.targetDomain || t.noDomain} · {provider.name || t.newProvider}
		                        </option>
		                      ))}
		                    </select>
		                  </label>
		                  <button className="button secondary" onClick={addProvider} type="button">
		                    {t.addProvider}
		                  </button>
		                  {selectedProvider && (
		                    <span className={selectedProvider.enabled ? "editor-status active" : "editor-status"}>
		                      {selectedProvider.enabled ? t.active : t.inactive}
		                    </span>
		                  )}
		                </div>
		                {selectedProvider ? (
		                  <section className="provider-editor-card">
		                    <div className="provider-header">
		                      <div>
		                        <strong>{selectedProvider.targetDomain || t.noDomain}</strong>
		                        <span>{selectedProvider.name || t.newProvider}</span>
		                      </div>
		                      <div className="provider-switches">
		                        <label>
		                          <input
		                            type="checkbox"
		                            checked={selectedProvider.enabled}
		                            onChange={event => updateProvider(selectedProvider.id, { enabled: event.target.checked })}
		                          />
		                          {t.active}
		                        </label>
		                        <label>
		                          <input
		                            type="checkbox"
		                            checked={selectedProvider.senderOnly}
		                            onChange={event => updateProvider(selectedProvider.id, { senderOnly: event.target.checked })}
		                          />
		                          {t.senderOnly}
		                        </label>
		                        <label>
		                          <input
		                            type="checkbox"
		                            checked={selectedProvider.emailBodyPdf}
		                            onChange={event => updateProvider(selectedProvider.id, { emailBodyPdf: event.target.checked })}
		                          />
		                          {t.emailAsPdf}
		                        </label>
		                      </div>
		                    </div>
		                    <p className="provider-help">
		                      {selectedProvider.emailBodyPdf
		                        ? t.providerBodyPdfHelp
		                        : selectedProvider.senderOnly
		                        ? t.providerSenderOnlyHelp
		                        : t.providerSearchHelp}
		                    </p>
		                    <div className="provider-fields">
		                      <label>
		                        {t.providerName}
		                        <input
		                          value={selectedProvider.name}
		                          onChange={event => updateProvider(selectedProvider.id, { name: event.target.value })}
		                          placeholder="Suno AI"
		                        />
		                      </label>
		                      <label>
		                        {t.folderDomain}
		                        <input
		                          value={selectedProvider.targetDomain}
		                          onChange={event => updateProvider(selectedProvider.id, { targetDomain: event.target.value })}
		                          placeholder="suno.com"
		                        />
		                      </label>
		                      <label>
		                        {t.fromFragments}
		                        <textarea
		                          value={selectedProvider.senderDomains.join("\n")}
		                          onChange={event =>
		                            updateProvider(selectedProvider.id, { senderDomains: lines(event.target.value) })
		                          }
		                        />
		                      </label>
		                      <label>
		                        {t.fromReplyToEmails}
		                        <textarea
		                          value={selectedProvider.senderEmails.join("\n")}
		                          onChange={event =>
		                            updateProvider(selectedProvider.id, { senderEmails: lines(event.target.value) })
		                          }
		                        />
		                      </label>
		                      <label className="full">
		                        {t.brandPhrases}
		                        <textarea
		                          value={selectedProvider.searchTerms.join("\n")}
		                          onChange={event =>
		                            updateProvider(selectedProvider.id, { searchTerms: lines(event.target.value) })
		                          }
		                        />
		                      </label>
		                    </div>
		                    <div className="modal-actions">
		                      <button className="small-button" onClick={() => void saveProvider(selectedProvider)} type="button">
		                        {t.saveProvider}
		                      </button>
		                    </div>
		                  </section>
		                ) : (
		                  <p className="muted">{t.noProviders}</p>
		                )}
		              </div>
		            )}
		            {settingsTab === "other" && (
		              <div className="settings-section settings-section-plain">
		                <div className="section-title">
		                  <h2>{t.invoiceIndex}</h2>
		                  <span>{t.cleanup}</span>
		                </div>
		                <p className="muted">{t.cleanupHelp}</p>
		                <button className="button secondary" onClick={() => void cleanupInvoiceIndex()} type="button">
		                  {t.repairInvoiceIndex}
		                </button>
		              </div>
		            )}
	          </section>
	        </div>
	      )}

      {(status || activeJob) && (
        <section className="status-stack">
          {status && <div className="status-strip">{localizeServerMessage(status, language)}</div>}
          {activeJob && (
            <section className="job-strip">
              <strong>{formatJobStatus(activeJob.status, language)}</strong>
              <span>{localizeServerMessage(progress?.message || t.working, language)}</span>
              {progress && (
                <span>
                  {t.mails}: {progress.scannedMessages || 0} · {t.invoices}: {progress.savedInvoices || 0} · {t.duplicates}: {progress.skippedDuplicates || 0}
                </span>
              )}
              {activeJob.error && <span className="error">{localizeServerMessage(activeJob.error, language)}</span>}
            </section>
          )}
        </section>
      )}

      {activeView === "operations" ? (
        <section className="operation-history operation-history-view">
          <div className="section-title">
            <div>
              <p className="eyebrow">{t.undoChanges}</p>
              <h2>{t.changeHistory}</h2>
            </div>
            <div className="top-actions">
              <span>{t.lastOf50} {operations.length} {t.of} 50</span>
              <button className="small-button" onClick={() => void refreshLists()} type="button">
                {t.refreshHistory}
              </button>
            </div>
          </div>
          <p className="muted">{t.historyHelp}</p>
          {operations.length === 0 ? (
            <p className="muted">{t.noOperations}</p>
          ) : (
            <ul className="operation-list">
              {operations.map(operation => (
                <li key={operation.id} className={operation.status === "undone" ? "operation-undone" : ""}>
                  <div>
                    <strong>{localizeServerMessage(operation.label, language)}</strong>
                    <small>
                      {formatDateTime(operation.createdAt, language)}
                      {operation.status === "undone" ? ` · ${t.undone}${operation.undoneAt ? ` ${formatDateTime(operation.undoneAt, language)}` : ""}` : ""}
                      {operation.error ? ` · ${operation.error}` : ""}
                    </small>
                  </div>
                  <button
                    className="small-button"
                    disabled={operation.status === "undone" || Boolean(operationUndoingId)}
                    onClick={() => void undoOperation(operation)}
                    type="button"
                  >
                    {operationUndoingId === operation.id ? t.undoing : operation.status === "undone" ? t.undoneButton : t.undo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : activeView === "archivizer" ? (
        <section className="panel archivizer-view">
          <div className="section-title">
            <h2>{t.recentInvoices}</h2>
            <div className="top-actions">
              <span>{invoices.length}</span>
              <button className="small-button" onClick={() => setInvoicesExpanded(current => !current)} type="button">
                {invoicesExpanded ? t.collapse : t.show}
              </button>
              <button className="button accent" onClick={startInvoiceScan} type="button">
                {t.scanInvoices}
              </button>
            </div>
          </div>
          {invoicesExpanded ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t.scanDate}</th>
                    <th>{t.month}</th>
                    <th>{t.domain}</th>
                    <th>{t.due}</th>
                    <th>{t.amount}</th>
                    <th>{t.status}</th>
                    <th>{t.file}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInvoices.map(invoice => (
                    <tr key={invoice.id}>
                      <td>{formatDateTime(invoice.created_at, language)}</td>
                      <td>{invoice.invoice_month}</td>
                      <td>{invoice.provider_domain}</td>
                      <td>{invoice.due_date || "-"}</td>
                      <td>{invoice.amount ? `${invoice.amount} ${invoice.currency || ""}` : "-"}</td>
                      <td>{invoice.status}</td>
                      <td title={invoice.file_path}>{shortPath(invoice.file_path)}</td>
                    </tr>
                  ))}
                  {sortedInvoices.length === 0 && (
                    <tr>
                      <td colSpan={7}>{t.invoiceEmpty}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{t.invoiceListCollapsed}</p>
          )}
        </section>
      ) : (
        <>

      <section className="important-feed">
        <div className="section-title">
          <h2>{t.importantNow}</h2>
          <span>{importantItems.length + otherUnreadItems.length} {t.unreadEntries}</span>
        </div>
        {importantItems.length === 0 && otherUnreadItems.length === 0 && savedMailItems.length === 0 ? (
          <p className="muted">{t.firstSyncHelp}</p>
        ) : (
          <div className="important-workspace">
            <div className="important-list-pane">
              <div className="category-tabs" role="tablist" aria-label={t.importantCategoriesAria}>
                {tabs.map(tab => (
                  <button
                    className={tab.key === selectedCategory ? "category-tab active" : "category-tab"}
                    key={tab.key}
                    onClick={() => setSelectedCategory(tab.key)}
                    type="button"
                  >
                    <span>{displayCategoryLabel(tab.label, language)}</span>
                    <strong>{tab.count}</strong>
                  </button>
                ))}
                <button
                  className="category-tab bulk-read-tab"
                  disabled={visibleImportantItems.length === 0 || bulkReadRunning}
                  onClick={() => void markVisibleMailRead()}
                  title={t.bulkReadTitle}
                  type="button"
                >
                  <span aria-hidden="true">✓</span>
                  <span>{bulkReadRunning ? t.marking : t.markVisibleRead}</span>
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
                        <p>{localizeServerMessage(item.summary || item.subject, language)}</p>
                        {item.actionRequired && <small>{localizeServerMessage(item.actionRequired, language)}</small>}
                      </div>
                      <div className="feed-meta">
                        <span className="feed-date">{formatDateTime(item.receivedAt, language)}</span>
                        <span className={`pill ${item.priority}`}>{item.priority}</span>
                        {item.dueDate && <span>{t.due}: {item.dueDate}</span>}
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
                        aria-label={t.markRead}
                        className="feed-check"
                        onClick={() => void markMailRead(item)}
                        title={t.markRead}
                        type="button"
                      >
                        ✓
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {visibleImportantItems.length === 0 && (
                <p className="muted">{t.noMailInTab}</p>
              )}
              {filteredImportantItems.length > IMPORTANT_PAGE_SIZE && (
                <div className="pagination">
                  <span className="pagination-summary">
                    {importantPageStart}-{importantPageEnd} {t.of} {filteredImportantItems.length}
                  </span>
                  <div className="pagination-actions">
                    <button
                      className="small-button"
                      disabled={importantPage <= 1}
                      onClick={() => setImportantPage(page => Math.max(1, page - 1))}
                      type="button"
                    >
                      {t.newer}
                    </button>
                    <span className="pagination-current">
                      {t.page} {importantPage} / {importantPageCount}
                    </span>
                    <button
                      className="small-button"
                      disabled={importantPage >= importantPageCount}
                      onClick={() => setImportantPage(page => Math.min(importantPageCount, page + 1))}
                      type="button"
                    >
                      {t.older}
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
                      <span className={`pill ${selectedImportant.priority}`}>{displayCategoryLabel(selectedImportant.category, language)}</span>
                      <h3>{selectedImportant.subject}</h3>
                      <p>{selectedImportant.fromName || selectedImportant.fromEmail} &lt;{selectedImportant.fromEmail}&gt;</p>
                      <p>{t.to}: {accountEmailById.get(selectedImportant.accountId) || t.unknownAccount}</p>
                      <small>{formatDateTime(selectedImportant.receivedAt, language)}</small>
                    </div>
                    <div className="preview-actions">
                      {!selectedImportant.saved && (
                        <button className="button secondary" onClick={() => void ignoreSelectedMail()} type="button">
                          {t.notImportant}
                        </button>
                      )}
                      <button className="button secondary" onClick={() => void toggleSelectedMailSaved()}>
                        {selectedImportant.saved ? t.removeSaved : t.save}
                      </button>
                      <div className="preview-chat-actions">
                        <button
                          className="button secondary"
                          disabled={Boolean(chatPendingQuestion)}
                          onClick={() => void summarizeSelectedMail()}
                          type="button"
                        >
                          {t.summarizeMail}
                        </button>
                        <button className="button secondary" onClick={askAboutSelectedMail} type="button">
                          {t.askAboutMail}
                        </button>
                      </div>
                    </div>
                  </div>
                  {selectedImportant.actionRequired && (
                    <p className="preview-action">{localizeServerMessage(selectedImportant.actionRequired, language)}</p>
                  )}
                  {selectedImportant.attachments.length > 0 && (
                    <section className="mail-attachments">
                      <h4>{t.attachments}</h4>
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
                                {t.open}
                              </a>
                              <a
                                className="feed-link"
                                href={mailAttachmentUrl(selectedImportant, attachment, true)}
                                rel="noreferrer"
                                target="_blank"
                              >
                                {t.download}
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
                  <form className="reply-box" onSubmit={sendReply}>
                    <div className="reply-box-header">
                      <div>
                        <h4>{t.reply}</h4>
                        <small>{t.replyHint}</small>
                      </div>
                    </div>
                    <textarea
                      disabled={replySending}
                      onChange={event => setReplyText(event.target.value)}
                      placeholder={t.replyPlaceholder}
                      rows={5}
                      value={replyText}
                    />
                    <div className="reply-actions">
                      <button
                        className="button accent"
                        disabled={replySending || !replyText.trim()}
                        type="submit"
                      >
                        {replySending ? t.sendingReply : t.sendReply}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <p className="muted">{t.pickMail}</p>
              )}
            </aside>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-title">
          <h2>{t.mailboxChat}</h2>
          <span>{t.chatWindowInfo}</span>
        </div>
        {mailChatContext && (
          <div className="chat-context-strip">
            <div>
              <span>{t.chatContextActive}</span>
              <strong>{mailChatContext.subject}</strong>
              <small>
                {mailChatContext.fromLabel} · {formatDateTime(mailChatContext.receivedAt, language)}
              </small>
            </div>
            <button className="small-button" onClick={() => setMailChatContext(null)} type="button">
              {t.clearChatContext}
            </button>
          </div>
        )}
        <form className="chat-form" onSubmit={askMailbox}>
          <input
            disabled={Boolean(chatPendingQuestion)}
            value={question}
            onChange={event => setQuestion(event.target.value)}
            placeholder={t.chatPlaceholder}
          />
          <button className="button accent" disabled={Boolean(chatPendingQuestion)} type="submit">
            {chatPendingQuestion ? t.asking : t.ask}
          </button>
        </form>
        <div className="chat-history">
          {visibleChatHistory.length === 0 ? (
            <p className="muted">{t.emptyChat}</p>
          ) : (
            visibleChatHistory.map(turn => (
              <article className="chat-turn" key={turn.id}>
                <time>{formatDateTime(turn.createdAt, language)}</time>
                <div className="chat-bubble question">
                  <strong>{t.you}</strong>
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

        </>
      )}
        </div>
      </div>
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

function apiErrorMessage(error: unknown, language: UiLanguage = "pl") {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    return localizeServerMessage(parsed.error || raw, language);
  } catch {
    return localizeServerMessage(raw, language);
  }
}

function browserDefaultLanguage(): UiLanguage {
  const locale = navigator.language || navigator.languages?.[0] || "";
  return /^pl(?:[-_]|$)/i.test(locale.trim()) ? "pl" : "en";
}

function shortPath(filePath: string) {
  const parts = filePath.split("/");
  return parts.slice(-3).join("/");
}

function formatDateTime(value: string, language: UiLanguage = "pl") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "en" ? "en-US" : "pl-PL", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatJobStatus(status: Job["status"], language: UiLanguage) {
  if (language === "en") {
    if (status === "queued") return "Queued";
    if (status === "running") return "Running";
    if (status === "done") return "Done";
    return "Failed";
  }
  if (status === "queued") return "oczekuje";
  if (status === "running") return "w toku";
  if (status === "done") return "gotowe";
  return "błąd";
}

function localizeServerMessage(message: string, language: UiLanguage) {
  if (language !== "en" || !message) return message;
  const replacements: Array<[RegExp, string | ((...matches: string[]) => string)]> = [
    [/^Start cichego syncu ważnej poczty$/i, "Starting quiet important-mail sync"],
    [/^Sprawdzam status już śledzonych wiadomości$/i, "Checking status of already tracked messages"],
    [/^Szukam ostatnich wiadomości$/i, "Searching recent messages"],
    [/^Znaleziono (\d+) ostatnich wiadomości$/i, count => `Found ${count} recent messages`],
    [/^Sync ważnej poczty zakończony$/i, "Important-mail sync finished"],
    [/^Sync zakończony\.?\s*/i, "Sync finished. "],
    [/^Nie udało się odświeżyć żadnego konta Gmail\.?\s*/i, "Could not refresh any Gmail account. "],
    [/^Start skanowania historycznego$/i, "Starting historical invoice scan"],
    [/^Szukam wiadomości dla (.+)$/i, provider => `Searching messages for ${provider}`],
    [/^Znaleziono (\d+) wiadomości dla (.+)$/i, (count, provider) => `Found ${count} messages for ${provider}`],
    [/^Przetwarzam (.+)$/i, id => `Processing ${id}`],
    [/^Skanowanie zakończone\.?\s*/i, "Scan finished. "],
    [/^Ustaw najpierw główny folder archiwum faktur\.$/i, "Set the main invoice archive folder first."],
    [/^Konto (.+?) wymaga ponownego podłączenia do Google\.$/i, account => `Account ${account} needs to be reconnected to Google.`],
    [/^Ponownie podłącz konta Gmail w Ustawienia > Gmail: (.+)$/i, accounts => `Reconnect Gmail accounts in Settings > Gmail: ${accounts}`],
    [/^Nie udało się odświeżyć konta (.+?): (.+)$/i, (account, error) => `Could not refresh account ${account}: ${error}`],
    [/^Nie udało się zeskanować konta (.+?): (.+)$/i, (account, error) => `Could not scan account ${account}: ${error}`],
    [/^Oznaczono jako przeczytane: (.+)$/i, subject => `Marked as read: ${subject}`],
    [/^Oznaczono (\d+) widocznych maili jako przeczytane$/i, count => `Marked ${count} visible messages as read`],
    [/^Brakuje widocznych maili do oznaczenia\.$/i, "No visible mail to mark."],
    [/^Brakuje accountId albo messageId$/i, "Missing accountId or messageId."],
    [/^Brakuje accountId, messageId albo attachmentId$/i, "Missing accountId, messageId, or attachmentId."],
    [/^Nie znaleziono ważnego maila$/i, "Important mail was not found."],
    [/^Nie znaleziono maila$/i, "Mail was not found."],
    [/^Nie znaleziono konta pocztowego$/i, "Mail account was not found."],
    [/^Nie znaleziono profilu$/i, "Profile was not found."],
    [/^Nie znaleziono operacji$/i, "Operation was not found."],
    [/^Tej operacji nie da się jeszcze cofnąć\.$/i, "This operation cannot be undone yet."],
    [/^Wpisz pytanie do czatu\.$/i, "Enter a chat question."],
    [/^Wiadomość przypisana ręcznie do kategorii\.$/i, "Message manually assigned to a category."],
    [/^Wiadomość może wymagać uwagi\.$/i, "Message may need attention."],
    [/^Sprawdź wiadomość od tego nadawcy\.$/i, "Review the message from this sender."],
    [/^Sprawdź płatność albo transakcję\.$/i, "Check the payment or transaction."],
    [/^Sprawdź status zamówienia\.$/i, "Check order status."],
    [/^Sprawdź komunikat bankowy\.$/i, "Check the banking message."],
    [/^Sprawdź, czy wymaga działania\.$/i, "Check whether this requires action."],
    [/^Sprawdź termin płatności lub archiwum faktur\.$/i, "Check the payment due date or invoice archive."],
    [/^Sprawdź, czy wymaga odpowiedzi lub płatności\.$/i, "Check whether this requires a reply or payment."],
    [/^Sprawdź termin płatności\.$/i, "Check the payment due date."],
    [/^Sprawdź, czy to znana aktywność\.$/i, "Check whether this is known activity."],
    [/^Sprawdź, czy wymaga odpowiedzi\.$/i, "Check whether this requires a reply."],
    [/^Lokalny serwer LLM nie zwrócił żadnego załadowanego modelu\. Załaduj model ręcznie w serwerze LLM i spróbuj ponownie\.$/i, "The local LLM server did not return any loaded model. Load the model manually in the LLM server and try again."],
    [/^Nie mogę sprawdzić załadowanego modelu przez (.+?): HTTP (\d+)$/i, (url, status) => `Could not check the loaded model through ${url}: HTTP ${status}`],
    [/^Timeout IMAP dla konta (.+?)(?: podczas: .+)?\. Serwer poczty nie odpowiedział w czasie\.$/i, account => `IMAP timeout for account ${account}. The mail server did not respond in time.`],
    [/^Nie znaleziono załącznika$/i, "Attachment was not found."],
    [/^Załącznik nie zawiera danych$/i, "Attachment does not contain data."]
  ];

  let result = message;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, (...args) => {
      const matches = args.slice(1, -2).map(String);
      return typeof replacement === "function" ? replacement(...matches) : replacement;
    });
  }
  return result;
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

function displayCategoryLabel(category: string, language: UiLanguage) {
  if (language !== "en") return category;
  return CATEGORY_LABELS_EN[category.toLowerCase()] || category;
}

function buildReadableMailHtml(html: string, text: string, t: typeof TEXT[UiLanguage]) {
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
    parts.push(`<p>${escapeMailHtml(t.readableEmpty)}</p>`);
  }

  if (links.length > 0) {
    parts.push("<section class=\"reader-links\">");
    parts.push(`<h4>${escapeMailHtml(t.links)}</h4>`);
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
