---
project: Shiftly
status: approved
approved_at: 2026-10-13
platform: Cloudflare Workers (static assets)
worker_name: shiftly
inputs:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
executed: pending
---

# Plan pierwszego wdrożenia

## Cel

Shiftly (Astro 7 SSR + React 19 + Supabase auth) dostępny pod publicznym adresem `workers.dev`, z działającym
logowaniem, udokumentowanym wycofaniem i logami. Platforma i jej ryzyka: `context/foundation/infrastructure.md`.

Decyzje: nazwa Workera `shiftly`; hostowany projekt Supabase (URL + klucz anon) już istnieje.

## Stan wyjściowy (odczyt, 2026-10-13)

- Zainstalowane: Astro 7.3.2, `@astrojs/cloudflare` 14.3.1, wrangler 4.131.1.
- Adapter przy buildzie generuje `dist/server/wrangler.json` z `kv_namespaces: [{binding: SESSION}]` (bez `id`,
  więc wrangler auto-provisionuje) i `images: {binding: IMAGES}`; `.wrangler/deploy/config.json` wskazuje ten plik.
- Nazwa Workera jest zapisana w wygenerowanym `dist/server/wrangler.json`, więc po zmianie `name` w `wrangler.jsonc`
  **trzeba przebudować** (`npm run build`), inaczej deploy utworzy Workera o starej nazwie.
- `supabase/migrations/` jest puste: brak tabel do zabezpieczenia i brak schematu do cofania.
- `signUp` nie ustawia `emailRedirectTo`, a aplikacja nie ma trasy `/auth/callback`: link z maila idzie na Site URL
  z Supabase, a po potwierdzeniu użytkownik ląduje na `/` i loguje się hasłem.

## Kroki

Legenda: **[A]** agent w worktree (gałąź, commit, push; scala użytkownik), **[U]** użytkownik w terminalu
z głównego katalogu repozytorium.

1. **[A]** Gałąź `chore/deploy-shiftly`: `wrangler.jsonc` `"name": "shiftly"` oraz ten plik. **[U]** scalenie
   `git merge --ff-only chore/deploy-shiftly` w main i push `master`.
2. **[U]** Preflight (po scaleniu):
   - `npx wrangler whoami`; gdy wygasło, `npx wrangler login`.
   - `npm run build`.
   - `npx wrangler deploy --dry-run`: oczekiwane `name: shiftly` oraz bindingi `SESSION`, `IMAGES`, `ASSETS`.
3. **[U]** Pierwsze wdrożenie interaktywnie: `npx wrangler deploy`. Możliwe pytania: rejestracja subdomeny
   `workers.dev`, zgoda na utworzenie namespace KV dla `SESSION`. Zapisać adres
   `https://shiftly.<subdomena>.workers.dev`. Oczekiwane: baner o braku konfiguracji Supabase (jeszcze bez sekretów).
   - Awaryjnie, gdyby `IMAGES` zgłosił błąd na planie Free: `imagesBindingName: false` w `cloudflare()`.
4. **[U]** Sekrety (wartości wpisuje użytkownik, nie trafiają do czatu ani repozytorium):
   - `npx wrangler secret put SUPABASE_URL` i `npx wrangler secret put SUPABASE_KEY`.
   - `SUPABASE_KEY` to klucz anon / publishable, nigdy `service_role`.
   - Nie używać `secret bulk .dev.vars`: plik zawiera wartości lokalnego Supabase.
5. **[U]** Supabase, Authentication, URL Configuration: Site URL = adres Workera; Redirect URLs: ten adres i
   `<adres>/**`. Hostowany projekt domyślnie wymaga potwierdzenia e-mail (lokalny `config.toml` ma
   `enable_confirmations = false`), więc do testu użyć własnego adresu.
6. **[A + U]** Weryfikacja na adresie produkcyjnym:
   - `/` zwraca 200 bez banera konfiguracji, `/dashboard` zwraca 302 na `/auth/signin`.
   - Rejestracja własnym adresem, potwierdzenie z maila, logowanie, `/dashboard` 200, wylogowanie.
   - `npx wrangler tail --format pretty` podczas ok. 15 żądań: wynik `ok`, brak `exceededCpu`.
   - `npx wrangler kv namespace list` i `npx wrangler deployments list` (zapis ID wersji).
   - **Nie uruchamiać `npm run smoke` na produkcji:** rejestruje konta `@example.com` (odbicia maili szkodzą
     reputacji nadawcy i zjadają limit), a krok logowania padnie na niepotwierdzonym koncie.
7. **[A]** Zapis wyniku: sekcja `## Result` w tym pliku (adres, ID wersji, nazwy sekretów bez wartości, wyniki
   kontroli, data) oraz aktualizacja pozycji "do zweryfikowania" w Operational Story w `infrastructure.md`.

## Wycofanie

Pierwsze wdrożenie nie ma poprzedniej wersji, więc `wrangler rollback` nie ma do czego wrócić. Cofnięcie to
`npx wrangler delete shiftly` (destrukcyjne, tylko na polecenie użytkownika); namespace KV zostaje i trzeba go
usunąć osobno. Od drugiego wdrożenia: `npx wrangler rollback` (cofa kod, nie dane).

## Poza zakresem

- Automatyczne wdrożenie po scaleniu: Workers Builds albo job GitHub Actions z `CLOUDFLARE_API_TOKEN` i
  `CLOUDFLARE_ACCOUNT_ID` (`ci.yml` nie ma kroku wdrożenia). Decyzja po udanym ręcznym wdrożeniu.
- Plan Workers Paid ($5/mies.) przed pilotażem oraz pomiar generowania grafiku dla 25 do 30 osób.
- Własny SMTP w Supabase (zaproszenia FR-001, FR-006).
- `site` w `astro.config.mjs` (integracja sitemap) i własna domena.
- Migracje i RLS: dopiero z pierwszą tabelą.

## Kryteria ukończenia

- `wrangler deploy --dry-run` bez błędów, nazwa `shiftly`, trzy bindingi.
- `/` 200 bez banera; `/dashboard` 302 `/auth/signin`; pełny cykl rejestracji i logowania na własnym adresie.
- `wrangler tail`: brak `exceededCpu` i błędów 5xx w serii żądań.
- Żaden sekret nie trafił do repozytorium, czatu ani logów.
