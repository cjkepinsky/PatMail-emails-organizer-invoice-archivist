# Invoice Archivist MVP

Lokalna aplikacja do archiwizacji faktur z Gmaila i cichego, konwersacyjnego podsumowywania ważnej poczty.

## Co działa w MVP

- Podpinanie wielu kont Gmail przez przeglądarkowy OAuth.
- Historyczny backfill faktur, domyślnie 4 lata wstecz.
- Reguły dostawców dla Suno, Setapp, Leonardo AI, OpenAI, ElevenLabs, Udio, Google AI Studio, Canva, Perplexity, JetBrains i Wispr Flow.
- Zapisywanie PDF-ów do folderów nazwanych domeną dostawcy.
- Nazwa faktury zaczyna się od `YYYY-MM`; jeśli nie uda się odczytać daty faktury, używana jest data maila.
- Indeks SQLite dla deduplikacji po Gmail message id, attachment id i SHA-256.
- Ekstrakcja daty faktury, terminu płatności, kwoty i numeru faktury w prostym parserze tekstowym.
- Ustawienie OpenAI-compatible LLM w LAN, domyślnie `http://192.168.1.90:1234`.
- Cichy feed ważnych maili i prosty chat nad ostatnio pobraną pocztą.

## Uruchomienie

```bash
npm install
cp .env.example .env
npm run dev
```

Otwórz:

```text
http://127.0.0.1:5181
```

## Google OAuth

W Google Cloud Console utwórz OAuth client i dodaj redirect URI:

```text
http://127.0.0.1:8797/api/auth/google/callback
```

Do `.env` wpisz:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

MVP używa tylko zakresu Gmail read-only. Aplikacja nie zna hasła do poczty.

## Dane lokalne

Domyślnie stan aplikacji trafia do:

```text
.local/app.sqlite
```

Tokeny OAuth są w MVP zapisane lokalnie w SQLite. W docelowej wersji desktopowej warto przenieść je do systemowego keychaina.
