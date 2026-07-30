# PatMail

**Polska wersja znajduje się poniżej.**

PatMail is a private macOS desktop app for turning several Gmail inboxes into a calmer, searchable, AI-assisted workspace. It combines automatic invoice archiving, unread-mail triage, rule-based and LLM-assisted classification, saved mail, operation history, and a conversational mailbox assistant.

The project was built as a practical personal tool and as a portfolio project showing how AI can be integrated into a real local productivity app without sending every mailbox decision to a large model.

## Screenshot Tour

Some account-specific values are intentionally blurred.

| Mail dashboard and AI mailbox chat | Archivizer invoice index |
| --- | --- |
| <img src="docs/screenshots/mail-dashboard-chat.png" alt="PatMail mail dashboard with category tabs, email preview, and mailbox chat" width="420"> | <img src="docs/screenshots/archivizer-recent-invoices.png" alt="PatMail Archivizer view with recent invoices and scan controls" width="420"> |
| Important-mail triage with category tabs, email preview, Gmail links, bulk read controls, and mailbox chat with Web Research. | Invoice archive overview sorted by scan date, with invoice metadata, file paths, and scan controls. |

| Change history and undo | General AI and app settings |
| --- | --- |
| <img src="docs/screenshots/change-history-undo.png" alt="PatMail change history with undo buttons" width="420"> | <img src="docs/screenshots/settings-general-ai.png" alt="PatMail general settings with language, theme, OpenAI, classifier, and Web Research defaults" width="420"> |
| Operation history for actions such as marking messages as read, with per-record undo. | Profile-scoped language, theme, auto-sync, OpenAI chat model, Web Research default, and local classifier settings. |

| Gmail account setup | Classification rules |
| --- | --- |
| <img src="docs/screenshots/settings-gmail-accounts.png" alt="PatMail Gmail account settings with IMAP and OAuth options" width="420"> | <img src="docs/screenshots/settings-classification-rules.png" alt="PatMail classification rule editor" width="420"> |
| Gmail connection through IMAP app passwords, with optional Google OAuth still available. | User-editable rules for routing senders, domains, subject phrases, and body phrases into categories. |

| Invoice provider rules | Invoice index repair |
| --- | --- |
| <img src="docs/screenshots/settings-invoice-providers.png" alt="PatMail invoice provider settings" width="420"> | <img src="docs/screenshots/settings-invoice-index-repair.png" alt="PatMail invoice index repair settings" width="420"> |
| Provider-specific invoice matching: sender fragments, exact From/Reply-To addresses, phrase filters, and email-as-PDF mode. | Maintenance tools for repairing the local invoice index after manual file deletion or provider configuration fixes. |

## Highlights

- macOS desktop app built with Electron, React, TypeScript, Express, SQLite, IMAP, Gmail OAuth, and OpenAI-compatible LLM APIs.
- Multiple Gmail accounts connected through either Google OAuth or Gmail IMAP app passwords.
- Profile-based workspaces: each profile has its own accounts, invoice providers, category rules, important senders, saved mail, ignored mail, invoice index, and local mailbox state.
- Bilingual interface with a Polish/English switch in Settings; on first launch PatMail chooses Polish for a Polish system locale and English otherwise, then stores the selected language per profile.
- Dark, light, and system appearance modes.
- Dedicated Mail, Archivizer, Change History, and Settings views.
- Automatic invoice archive scanner with historical backfill, duplicate detection, provider-specific folders, and invoice filenames starting with `YYYY-MM`.
- Quiet automatic important-mail refresh with a configurable interval, designed to avoid heavy background CPU usage.
- Important-mail dashboard with category tabs, unread-only sync, saved mail, message preview, attachment links, pagination, per-message and bulk "mark visible as read", declassification, and a reply composer.
- Resizable workspace/sidebar and mail columns, with the UI state stored locally per profile.
- AI mailbox chat using a configurable OpenAI chat model, currently designed around `gpt-4.1-mini`, with optional Web Research.
- Hybrid mail classification using manual rules first and a lightweight local LLM (`tinydolphin:latest`) only when rule confidence is not enough.
- Local-first state storage in SQLite under the app data directory.
- macOS release build generated as a DMG through `electron-builder`.

## AI Features

### Mailbox Chat

Mailbox chat sits next to the selected email preview and lets the user ask questions about recent and relevant mailbox content, for example:

- "What is important today?"
- "Do I have any unpaid invoices?"
- "What is this message from my accountant about?"
- "Show me recent AI-related mail."

Technical implementation:

- The chat endpoint is implemented in `src/server/llm.ts`.
- The chat model is configurable in Settings. The portfolio/default setup uses `gpt-4.1-mini`.
- Normal chat requests are sent to OpenAI Chat Completions at `https://api.openai.com/v1/chat/completions`.
- When Web Research is enabled for a question, PatMail uses the OpenAI Responses API at `https://api.openai.com/v1/responses` with the `web_search` tool.
- The OpenAI API token is configured in the app settings and stored locally in the app settings database.
- The prompt receives a bounded mailbox context generated by the backend, not the entire mailbox.
- The context is assembled from:
  - recent important messages,
  - focused SQLite text matches against cached mail,
  - dates, categories, sender names, action summaries, amounts, currencies, and due dates when available.
- The selected-mail actions "Summarize" and "Ask question" pass the current email as focused context to the chat.
- The system prompt tells the model to answer in the same language as the user's latest question, regardless of the interface language.
- The chat history is stored locally, shown newest-first in the app, and keeps the latest 10 turns from the last 7 days in the visible chat panel.

The chat is intentionally separated from the lightweight classifier. A larger hosted or OpenAI model is useful for conversational synthesis, but too expensive and unnecessary for every incoming-message classification decision.

### Hybrid Mail Classification

PatMail classifies unread messages into tabs such as AI, orders, payments, invoices, health, RD, job offers, banking, account/security, software, saved, and remaining mail.

Current classifier setup:

- Mode: `hybrid`
- Local classifier endpoint: `http://127.0.0.1:11434/v1`
- Default lightweight model: `tinydolphin:latest`
- Timeout: `2500 ms`
- API format: OpenAI-compatible `/chat/completions`

Classification pipeline:

1. Manual sender-to-category assignments from Settings are checked first.
2. User-editable category rules are checked next.
3. Built-in fallback rules handle common cases such as invoices, payments, security alerts, newsletters, orders, AI newsletters, banking, and health mail.
4. In hybrid mode, the local lightweight LLM is called only when the rule result is not confident.
5. A guard layer prevents the model from overriding strong deterministic rules in unsafe ways.
6. Only messages classified as `high` or `medium` priority are added to the "Important now" view.
7. Messages marked as ignored are skipped in future important-mail views.

The classifier prompt asks for strict JSON with:

- `priority`
- `category`
- `summary`
- `action_required`
- `due_date`
- `amount`
- `currency`

This is the main AI workflow in the project: a deterministic rules layer does the cheap and auditable work, while the local LLM handles ambiguous cases.

### Model Roles

| Function | Model | Location | Purpose |
| --- | --- | --- | --- |
| Mailbox chat | Configurable, portfolio/default setup: `gpt-4.1-mini` | OpenAI API | Conversational answers about mailbox context |
| Mailbox chat with Web Research | Same chat model through OpenAI Responses API + `web_search` | OpenAI API | Answers that can combine mailbox context with current web information |
| Mail classification fallback | `tinydolphin:latest` | Local OpenAI-compatible endpoint, default `http://127.0.0.1:11434/v1` | Lightweight categorization and summary JSON for ambiguous unread mail |
| Previously discussed LAN model | GPT-OSS-20B | Not active in the current chat implementation | Kept as an architectural option, but the current chat path uses OpenAI API |

## Invoice Archiving

The invoice scanner creates a local archive of commercial subscription invoices and receipts.

Main behavior:

- Scans connected Gmail accounts.
- Supports an initial historical backfill, defaulting to four years.
- Runs provider-specific searches.
- Saves files under one folder per provider domain, for example `provider-a.example`, `provider-b.example`, or `billing-service.example`.
- File names start with invoice month in `YYYY-MM` format.
- If the invoice issue month cannot be confidently extracted from the document, PatMail falls back to the email date.
- Tracks saved and duplicate attachments in SQLite.
- Provides an invoice index view and index repair tools.

Provider rules include:

- target archive domain,
- sender domain fragments,
- exact sender or reply-to addresses,
- search terms,
- sender-only matching,
- optional "save email body as PDF" behavior for providers that do not attach invoices directly.

The default provider templates cover common subscription, SaaS, app-store, payment-processor, and developer-tool invoice patterns, but the actual provider list is meant to be configured locally by each user.

Duplicate handling:

- Processed attachments are indexed locally.
- The deduplication key includes Gmail/IMAP message identity, attachment identity, and file hash where available.
- The app includes tools to repair the index when local invoice files are deleted manually.

## Important Mail Dashboard

The main PatMail window is designed as a quiet alternative to living inside Gmail.

Features:

- Category tabs with counts.
- A "remaining" tab for unread mail that was not classified as important.
- A "saved" tab for messages kept for later, independent of read/unread state.
- Split view: message list, selected mail preview, and mailbox chat.
- Draggable column dividers for resizing the list, preview, chat pane, and workspace sidebar.
- HTML mail preview with CSS normalization so long text wraps inside the preview area.
- Sender, recipient mailbox, exact received date/time, and Gmail link on list entries.
- Attachment section above the email body with open/download actions.
- Selected-mail AI actions: summarize the current message or use it as context for the next chat question.
- Reply composer below the selected message preview.
- Per-message mark-as-read control.
- Bulk "mark visible as read" for the currently visible page only.
- Pagination for large categories.
- "Not important" action for declassifying messages that should not appear in important categories.

Unread status behavior:

- On refresh, PatMail checks currently tracked messages against the mailbox source.
- If a message was marked as read by Gmail or another client, it is removed from unread important tabs.
- Saved messages remain visible even if read.
- Removing a read message from saved makes it disappear from active unread views.

## Operation History and Undo

PatMail keeps an operation history for recent mailbox actions.

Examples:

- Mark one message as read.
- Mark visible messages as read.
- Save a message.
- Remove a message from saved.
- Mark a message as not important.

The History view shows the latest operations and allows undoing supported actions, including read/unread changes where the mailbox backend supports it.

## Profiles

Profiles are independent workspaces.

Each profile owns:

- connected Gmail accounts,
- IMAP/OAuth account configuration,
- interface language,
- important senders,
- sender-to-category rules,
- editable category rules,
- invoice providers,
- archive settings,
- processed invoice index,
- important mail state,
- saved/ignored mail state,
- chat history,
- operation history.

This allows separate private, business, client, or test configurations without mixing rules and mail accounts.

## Gmail Connectivity

PatMail supports two Gmail connection methods.

### Gmail IMAP

Recommended for long-running personal use because it avoids Google OAuth testing-mode refresh-token expiration.

For Gmail accounts with two-factor authentication, use a Gmail app password, not the regular account password.

Default IMAP settings:

- host: `imap.gmail.com`
- port: `993`
- SSL/TLS: enabled

The IMAP layer uses `imapflow` and includes explicit connection, greeting, socket, operation, and logout timeouts. IMAP socket timeouts are converted into per-account status warnings instead of crashing the Electron process.

Replies for IMAP accounts are sent through SMTP. For Gmail IMAP, PatMail derives `smtp.gmail.com` from the IMAP configuration, uses port `465`, and authenticates with the same Gmail app password.

### Google OAuth

OAuth remains available for accounts connected through the browser.

Required redirect URI:

```text
http://127.0.0.1:8797/api/auth/google/callback
```

OAuth client settings can be entered in the app settings or provided through `.env`.

For replying through OAuth accounts, the Google client must include Gmail send permission (`gmail.send`). If that scope is missing, PatMail asks the user to reconnect that account.

## Local Storage and Privacy

PatMail is local-first.

Local state is stored in SQLite, usually under:

```text
.local/app.sqlite
```

Stored data includes:

- account records,
- OAuth token records or IMAP app-password configuration for connected accounts,
- profile settings,
- invoice provider rules,
- important-mail cache,
- saved and ignored message state,
- chat history,
- operation history,
- processed invoice attachment index.
- persisted UI state, including the active view, active category tab, selected message, and column widths.

Secrets and credentials are not committed to the repository. `.env` is intentionally excluded from Git. Release builds should be treated as local/private portfolio builds unless a production-grade signing and notarization workflow is added.

## Tech Stack

- Electron for the macOS desktop shell.
- React and TypeScript for the UI.
- Express for the local backend API.
- SQLite for local persistence.
- Gmail API and Google OAuth for browser-based account connection.
- IMAP via `imapflow` for durable Gmail mailbox access.
- `mailparser` for MIME parsing, message bodies, headers, and attachments.
- `pdf-parse` and custom parsing logic for invoice metadata extraction.
- OpenAI Chat Completions for mailbox chat.
- OpenAI Responses API with `web_search` for optional Web Research in mailbox chat.
- Local OpenAI-compatible LLM endpoint for lightweight classification.
- SMTP for replies from IMAP-connected accounts.
- `electron-builder` for macOS app and DMG packaging.

## Development

Install dependencies:

```bash
npm install
```

Create local environment config:

```bash
cp .env.example .env
```

Run web and API in the foreground:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5181
```

Run the dev server in the background:

```bash
npm run dev:start
npm run dev:status
npm run dev:stop
npm run dev:restart
```

Build web and server:

```bash
npm run build
npm run build:server
```

Build macOS desktop release:

```bash
npm run desktop:build
```

The macOS app and DMG are generated under:

```text
release/mac-arm64/PatMail.app
release/PatMail-0.1.2-arm64.dmg
```

## Release Notes

The current macOS build is intended for private portfolio and evaluation use. It is ad-hoc signed by the local build process and is not notarized by Apple. On a different Mac, Gatekeeper may require opening it manually through Finder or System Settings.

## License

This project is released under a custom source-available non-commercial evaluation license. It allows personal, educational, portfolio, and recruitment evaluation use, but prohibits commercial use, resale, SaaS use, redistribution for profit, or incorporation into commercial products.

See [LICENSE.md](LICENSE.md).

---

# PatMail - wersja polska

PatMail to prywatna aplikacja desktopowa na macOS, która zamienia kilka skrzynek Gmail w spokojniejsze, przeszukiwalne i wspierane przez AI centrum pracy z pocztą. Łączy automatyczne archiwizowanie faktur, selekcję nieprzeczytanych maili, klasyfikację regułową i LLM, zapisywanie maili na później, historię operacji oraz czat ze skrzynką.

Projekt powstał jako realne narzędzie do codziennego użytku oraz jako projekt portfolio pokazujący praktyczną integrację AI w lokalnej aplikacji produktywnościowej.

## Zrzuty ekranu

Część danych kont i ścieżek jest celowo zamazana.

| Poczta i czat ze skrzynką | Archivizer i indeks faktur |
| --- | --- |
| <img src="docs/screenshots/mail-dashboard-chat.png" alt="PatMail: widok poczty z kategoriami, podglądem maila i czatem ze skrzynką" width="420"> | <img src="docs/screenshots/archivizer-recent-invoices.png" alt="PatMail: Archivizer z listą ostatnich faktur" width="420"> |
| Selekcja ważnych maili z zakładkami kategorii, podglądem treści, linkami do Gmaila, akcjami zbiorczymi i czatem z opcją Web Research. | Przegląd archiwum faktur sortowany po dacie skanowania, z metadanymi faktur, ścieżkami plików i przyciskiem skanowania. |

| Historia zmian i cofanie | Ustawienia ogólne i AI |
| --- | --- |
| <img src="docs/screenshots/change-history-undo.png" alt="PatMail: historia zmian z przyciskami cofania" width="420"> | <img src="docs/screenshots/settings-general-ai.png" alt="PatMail: ustawienia ogólne, OpenAI, klasyfikator i Web Research" width="420"> |
| Historia operacji, takich jak oznaczanie maili jako przeczytane, z możliwością cofania wybranych rekordów. | Ustawienia per profil: język, motyw, auto-sync, model czatu OpenAI, domyślny Web Research i lokalny klasyfikator. |

| Konta Gmail | Reguły klasyfikacji |
| --- | --- |
| <img src="docs/screenshots/settings-gmail-accounts.png" alt="PatMail: ustawienia kont Gmail przez IMAP i OAuth" width="420"> | <img src="docs/screenshots/settings-classification-rules.png" alt="PatMail: edytor reguł klasyfikacji maili" width="420"> |
| Podłączanie Gmaila przez hasła aplikacji IMAP, z opcjonalnym Google OAuth. | Edytowalne reguły kierujące nadawców, domeny oraz frazy z tematu i treści maila do wybranych kategorii. |

| Dostawcy faktur | Naprawa indeksu faktur |
| --- | --- |
| <img src="docs/screenshots/settings-invoice-providers.png" alt="PatMail: ustawienia dostawców faktur" width="420"> | <img src="docs/screenshots/settings-invoice-index-repair.png" alt="PatMail: narzędzie naprawy indeksu faktur" width="420"> |
| Reguły dopasowania faktur per dostawca: fragmenty nadawcy, dokładne adresy From/Reply-To, frazy filtrujące i tryb zapisu maila jako PDF. | Narzędzia utrzymaniowe do naprawy lokalnego indeksu faktur po ręcznym usunięciu plików albo poprawkach konfiguracji dostawców. |

## Najważniejsze funkcje

- Aplikacja macOS zbudowana na Electron, React, TypeScript, Express, SQLite, IMAP, Gmail OAuth i OpenAI-compatible LLM API.
- Obsługa wielu kont Gmail przez Google OAuth albo hasła aplikacji Gmail IMAP.
- Profile/przestrzenie robocze: każdy profil ma osobne konta, dostawców faktur, reguły kategorii, ważnych nadawców, zapisane maile, ignorowane maile, indeks faktur i lokalny stan poczty.
- Dwujęzyczny interfejs z przełącznikiem polski/angielski w ustawieniach; przy pierwszym uruchomieniu PatMail wybiera polski dla polskiego języka systemu i angielski dla pozostałych, a potem zapisuje wybór per profil.
- Tryb ciemny, jasny oraz systemowy.
- Osobne widoki: Poczta, Archivizer, Historia zmian i Ustawienia.
- Automatyczny skaner faktur z historycznym backfillem, wykrywaniem duplikatów, folderami dla domen dostawców i nazwami faktur zaczynającymi się od `YYYY-MM`.
- Ciche automatyczne odświeżanie ważnej poczty z konfigurowalnym interwałem, zaprojektowane tak, żeby nie obciążało mocno CPU w tle.
- Widok ważnej poczty z zakładkami kategorii, synchronizacją tylko maili nieprzeczytanych, zapisanymi mailami, podglądem treści, linkami do załączników, stronicowaniem, pojedynczym i zbiorczym oznaczaniem widocznych maili jako przeczytane, deklasyfikacją oraz oknem odpowiedzi.
- Zmieniana szerokość panelu profili oraz kolumn poczty, z lokalnym zapisem stanu UI per profil.
- Czat ze skrzynką używający konfigurowalnego modelu OpenAI, obecnie projektowany wokół `gpt-4.1-mini`, z opcjonalnym Web Research.
- Hybrydowa klasyfikacja maili: najpierw reguły ręczne, potem lekki lokalny LLM `tinydolphin:latest` tylko dla niejednoznacznych przypadków.
- Lokalny zapis stanu w SQLite.
- Build macOS jako DMG przez `electron-builder`.

## Funkcje AI

### Czat ze skrzynką

Czat znajduje się obok podglądu wybranego maila i pozwala pytać o pocztę normalnym językiem, na przykład:

- "Co jest dzisiaj ważne?"
- "Czy mam jakieś nieopłacone faktury?"
- "O co chodzi w mailu od księgowej?"
- "Pokaż ostatnie maile związane z AI."

Rozwiązanie techniczne:

- Endpoint czatu znajduje się w `src/server/llm.ts`.
- Model czatu jest konfigurowalny w ustawieniach. Konfiguracja portfolio/domyślna używa `gpt-4.1-mini`.
- Zwykle zapytania idą do OpenAI Chat Completions pod `https://api.openai.com/v1/chat/completions`.
- Gdy dla pytania włączony jest Web Research, PatMail używa OpenAI Responses API pod `https://api.openai.com/v1/responses` z narzędziem `web_search`.
- Token OpenAI jest wpisywany w ustawieniach aplikacji i przechowywany lokalnie w bazie ustawień.
- Model nie dostaje całej skrzynki. Backend przygotowuje ograniczony kontekst.
- Kontekst składa się z:
  - ostatnich ważnych wiadomości,
  - dopasowań tekstowych z lokalnego cache SQLite,
  - dat, kategorii, nadawców, podsumowań akcji, kwot, walut i terminów płatności, jeżeli są dostępne.
- Akcje "Streść" i "Zadaj pytanie" przekazują aktualnie wybrany mail jako skoncentrowany kontekst do czatu.
- Prompt systemowy instruuje model, żeby odpowiadał w tym samym języku, w którym użytkownik zadał ostatnie pytanie, niezależnie od języka interfejsu.
- Historia czatu jest zapisywana lokalnie, wyświetlana od najnowszych wpisów i pokazuje w panelu ostatnie 10 tur z 7 dni.

Czat jest celowo oddzielony od klasyfikatora. Większy model jest sensowny do rozmowy i syntezy, ale nie ma sensu używać go do każdej prostej decyzji klasyfikacyjnej.

### Hybrydowa klasyfikacja maili

PatMail klasyfikuje nieprzeczytane maile do zakładek takich jak AI, zamówienia, płatności, faktury i rachunki, zdrowie, RD, oferty pracy, bankowe, konta i bezpieczeństwo, software, zapisane oraz pozostałe.

Obecna konfiguracja klasyfikatora:

- Tryb: `hybrid`
- Lokalny endpoint klasyfikatora: `http://127.0.0.1:11434/v1`
- Domyślny lekki model: `tinydolphin:latest`
- Timeout: `2500 ms`
- Format API: OpenAI-compatible `/chat/completions`

Kolejność klasyfikacji:

1. Najpierw sprawdzane są ręczne przypisania nadawców do kategorii.
2. Potem sprawdzane są edytowalne reguły kategorii.
3. Następnie działają wbudowane fallbacki dla typowych przypadków: faktury, płatności, alerty bezpieczeństwa, newslettery, zamówienia, AI, banki i zdrowie.
4. W trybie hybrydowym lokalny lekki LLM jest pytany tylko wtedy, gdy reguły nie dają pewnego wyniku.
5. Warstwa ochronna pilnuje, żeby model nie nadpisał mocnych reguł deterministycznych.
6. Do widoku "Teraz ważne" trafiają tylko maile z priorytetem `high` albo `medium`.
7. Maile oznaczone jako nieważne są pomijane przy kolejnych widokach ważnej poczty.

Prompt klasyfikatora wymaga ścisłego JSON-a z polami:

- `priority`
- `category`
- `summary`
- `action_required`
- `due_date`
- `amount`
- `currency`

To główny workflow AI w projekcie: tania i audytowalna warstwa reguł wykonuje większość pracy, a lokalny LLM pomaga w przypadkach niejednoznacznych.

### Role modeli

| Funkcja | Model | Lokalizacja | Cel |
| --- | --- | --- | --- |
| Czat ze skrzynką | Konfigurowalny, konfiguracja portfolio/domyślna: `gpt-4.1-mini` | OpenAI API | Odpowiedzi konwersacyjne na podstawie kontekstu poczty |
| Czat ze skrzynką z Web Research | Ten sam model czatu przez OpenAI Responses API + `web_search` | OpenAI API | Odpowiedzi łączące kontekst poczty z aktualnymi informacjami z sieci |
| Fallback klasyfikacji maili | `tinydolphin:latest` | Lokalny endpoint OpenAI-compatible, domyślnie `http://127.0.0.1:11434/v1` | Lekka klasyfikacja i podsumowanie JSON dla niejednoznacznych maili |
| Wcześniej planowany model LAN | GPT-OSS-20B | Nieaktywny w obecnej implementacji czatu | Opcja architektoniczna, ale obecny czat używa OpenAI API |

## Archiwizacja faktur

Skaner faktur tworzy lokalne archiwum faktur i potwierdzeń dla subskrypcji oraz narzędzi używanych komercyjnie.

Główne zachowanie:

- Skanuje podłączone konta Gmail.
- Obsługuje pierwszy historyczny backfill, domyślnie cztery lata wstecz.
- Uruchamia wyszukiwania per dostawca.
- Zapisuje pliki w folderach nazwanych domeną dostawcy, na przykład `provider-a.example`, `provider-b.example` albo `billing-service.example`.
- Nazwy plików zaczynają się od miesiąca faktury w formacie `YYYY-MM`.
- Jeżeli nie da się pewnie ustalić miesiąca wystawienia z dokumentu, aplikacja używa daty maila.
- Zapisane i zduplikowane załączniki są indeksowane w SQLite.
- Aplikacja ma widok indeksu faktur oraz narzędzia naprawy indeksu.

Reguły dostawców obejmują:

- docelową domenę archiwum,
- fragmenty domen nadawcy,
- konkretne adresy nadawcy lub reply-to,
- frazy wyszukiwania,
- tryb dopasowania tylko po nadawcy,
- opcjonalne zapisywanie treści maila jako PDF dla dostawców bez załączonych faktur.

Domyślne szablony dostawców obejmują typowe wzorce faktur dla subskrypcji, SaaS, zakupów przez app-store, pośredników płatności i narzędzi developerskich, ale konkretna lista dostawców jest konfiguracją lokalną użytkownika.

Obsługa duplikatów:

- Przetworzone załączniki są indeksowane lokalnie.
- Klucz deduplikacji uwzględnia identyfikator wiadomości Gmail/IMAP, identyfikator załącznika i hash pliku, gdy jest dostępny.
- Aplikacja ma narzędzia do naprawy indeksu po ręcznym usunięciu lokalnych plików faktur.

## Widok ważnej poczty

Główne okno PatMaila jest pomyślane jako spokojniejsza alternatywa dla ciągłego siedzenia w Gmailu.

Funkcje:

- Zakładki kategorii z licznikami.
- Zakładka "pozostałe" dla nieprzeczytanych maili, które nie zostały zaklasyfikowane jako ważne.
- Zakładka "zapisane" dla maili odłożonych na później, niezależnie od tego, czy są przeczytane.
- Widok dzielony: lista maili, podgląd wybranej wiadomości i czat ze skrzynką.
- Przeciągane separatory do zmiany szerokości listy, podglądu, panelu czatu i panelu profili.
- Podgląd HTML z normalizacją CSS, żeby długie linie zawijały się w oknie.
- Nadawca, skrzynka docelowa, dokładna data i godzina oraz link do Gmaila na liście.
- Sekcja załączników nad treścią maila z akcjami otwórz/pobierz.
- Akcje AI dla wybranego maila: streszczenie aktualnej wiadomości albo użycie jej jako kontekstu dla kolejnego pytania.
- Okno odpowiedzi pod podglądem wybranej wiadomości.
- Oznaczanie pojedynczego maila jako przeczytany.
- Zbiorcze "oznacz widoczne jako przeczytane" tylko dla aktualnie widocznej strony.
- Stronicowanie dużych kategorii.
- Akcja "Nieważne" do deklasyfikacji maili, które nie powinny wracać do ważnych zakładek.

Zachowanie statusu przeczytania:

- Przy odświeżaniu PatMail sprawdza obecnie śledzone maile w źródle poczty.
- Jeżeli mail został przeczytany w Gmailu albo innej aplikacji, znika z nieprzeczytanych ważnych zakładek.
- Zapisane maile pozostają widoczne nawet po przeczytaniu.
- Usunięcie przeczytanego maila z zapisanych sprawia, że znika z aktywnych widoków nieprzeczytanych.

## Historia operacji i cofanie

PatMail zapisuje historię ostatnich operacji na poczcie.

Przykłady:

- Oznaczenie jednego maila jako przeczytany.
- Oznaczenie widocznych maili jako przeczytane.
- Zapisanie maila.
- Usunięcie maila z zapisanych.
- Oznaczenie maila jako nieważny.

Widok historii pokazuje ostatnie operacje i pozwala cofać wspierane akcje, w tym zmiany przeczytane/nieprzeczytane, jeżeli backend pocztowy to obsługuje.

## Profile

Profile są niezależnymi przestrzeniami roboczymi.

Każdy profil ma osobne:

- konta Gmail,
- konfigurację IMAP/OAuth,
- język interfejsu,
- ważnych nadawców,
- reguły nadawca -> kategoria,
- edytowalne reguły kategorii,
- dostawców faktur,
- ustawienia archiwum,
- indeks przetworzonych faktur,
- stan ważnej poczty,
- zapisane i ignorowane maile,
- historię czatu,
- historię operacji.

Dzięki temu można rozdzielić konfigurację prywatną, firmową, kliencką albo testową.

## Łączenie z Gmail

PatMail obsługuje dwie metody połączenia z Gmail.

### Gmail IMAP

Rekomendowane do długotrwałego użytku prywatnego, bo omija wygasanie refresh tokenów Google OAuth w trybie testowym.

Dla kont Gmail z 2FA należy użyć hasła aplikacji Gmail, a nie głównego hasła do konta.

Domyślne ustawienia IMAP:

- host: `imap.gmail.com`
- port: `993`
- SSL/TLS: włączone

Warstwa IMAP używa `imapflow` i ma osobne timeouty dla połączenia, powitania serwera, socketu, operacji i wylogowania. Timeouty socketu IMAP są zamieniane na ostrzeżenia per konto zamiast wysypywać proces Electron.

Odpowiedzi z kont IMAP są wysyłane przez SMTP. Dla Gmail IMAP PatMail wyprowadza `smtp.gmail.com` z konfiguracji IMAP, używa portu `465` i loguje się tym samym hasłem aplikacji Gmail.

### Google OAuth

OAuth pozostaje dostępny dla kont podłączanych przez przeglądarkę.

Wymagany redirect URI:

```text
http://127.0.0.1:8797/api/auth/google/callback
```

Dane klienta OAuth można wpisać w ustawieniach aplikacji albo przekazać przez `.env`.

Do odpowiadania przez konta OAuth klient Google musi mieć uprawnienie wysyłania Gmail (`gmail.send`). Jeżeli tego zakresu brakuje, PatMail poprosi o ponowne podłączenie danego konta.

## Dane lokalne i prywatność

PatMail jest aplikacją local-first.

Lokalny stan jest przechowywany w SQLite, zwykle tutaj:

```text
.local/app.sqlite
```

Zapisywane dane obejmują:

- rekordy kont,
- tokeny OAuth albo konfigurację IMAP z hasłem aplikacji dla podłączonych kont,
- ustawienia profili,
- reguły dostawców faktur,
- cache ważnej poczty,
- stan zapisanych i ignorowanych maili,
- historię czatu,
- historię operacji,
- indeks przetworzonych faktur,
- zapisany stan UI, w tym aktywny widok, aktywna zakładka kategorii, wybrany mail i szerokości kolumn.

Sekrety i credentiale nie są commitowane do repozytorium. Plik `.env` jest celowo wykluczony z Git. Buildy release należy traktować jako lokalne/prywatne buildy portfolio, dopóki nie zostanie dodany produkcyjny proces podpisywania i notaryzacji.

## Stack technologiczny

- Electron jako desktopowa powłoka macOS.
- React i TypeScript dla UI.
- Express jako lokalne API backendowe.
- SQLite jako lokalna baza danych.
- Gmail API i Google OAuth dla połączenia przez przeglądarkę.
- IMAP przez `imapflow` dla trwałego dostępu do Gmail.
- `mailparser` do parsowania MIME, nagłówków, treści i załączników.
- `pdf-parse` oraz własna logika do ekstrakcji metadanych faktur.
- OpenAI Chat Completions dla czatu ze skrzynką.
- OpenAI Responses API z `web_search` dla opcjonalnego Web Research w czacie ze skrzynką.
- Lokalny endpoint OpenAI-compatible dla lekkiej klasyfikacji maili.
- SMTP dla odpowiedzi z kont podłączonych przez IMAP.
- `electron-builder` do pakowania aplikacji macOS i DMG.

## Development

Instalacja zależności:

```bash
npm install
```

Utworzenie lokalnej konfiguracji:

```bash
cp .env.example .env
```

Uruchomienie web + API w terminalu:

```bash
npm run dev
```

Otwórz:

```text
http://127.0.0.1:5181
```

Uruchomienie dev-serwera w tle:

```bash
npm run dev:start
npm run dev:status
npm run dev:stop
npm run dev:restart
```

Build web i serwera:

```bash
npm run build
npm run build:server
```

Build wersji desktopowej macOS:

```bash
npm run desktop:build
```

Artefakty macOS powstają tutaj:

```text
release/mac-arm64/PatMail.app
release/PatMail-0.1.2-arm64.dmg
```

## Uwagi o release

Obecny build macOS jest przeznaczony do prywatnego użytku portfolio i ewaluacji. Jest podpisany lokalnie/ad-hoc przez proces builda i nie jest znotaryzowany przez Apple. Na innym Macu Gatekeeper może wymagać ręcznego otwarcia przez Finder albo Ustawienia systemowe.

## Licencja

Projekt jest udostępniony na niestandardowej licencji source-available non-commercial evaluation. Zezwala ona na użytek osobisty, edukacyjny, portfolio oraz ewaluację rekrutacyjną, ale zabrania użytku komercyjnego, odsprzedaży, użycia jako SaaS, redystrybucji dla zysku oraz włączania do produktów komercyjnych.

Zobacz [LICENSE.md](LICENSE.md).
