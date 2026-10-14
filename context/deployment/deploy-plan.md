---
project: Shiftly
status: approved
approved_at: 2026-10-13
platform: Cloudflare Workers (static assets)
worker_name: shiftly
inputs:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
executed: 2026-10-14
url: https://shiftly.mto-astro.workers.dev
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

## Result

Wykonano 2026-10-14. Adres produkcyjny: `https://shiftly.mto-astro.workers.dev`.

### Wersje (`wrangler deployments list --name shiftly`)

| Czas (UTC) | Źródło | Wersja |
|---|---|---|
| 05:19:40 | Upload (pierwsze wdrożenie, bez sekretów) | `e6165383` |
| 05:35:18 | Secret Change | `8722280a` |
| 05:35:32 | Secret Change (aktywna, 100%) | `724bac53` |

### Sekrety i zasoby

- Sekrety (tylko nazwy): `SUPABASE_URL`, `SUPABASE_KEY` (`wrangler secret list`).
- Namespace KV `shiftly-session` utworzony automatycznie przy pierwszym `wrangler deploy` (binding `SESSION`).
- Bindingi widoczne w dry-run i przy wdrożeniu: `env.SESSION` (KV), `env.IMAGES` (Images), `env.ASSETS`.
- Paczka: 2067 KiB, po kompresji 456 KiB (28 modułów).

### Kontrole

| Kontrola | Wynik |
|---|---|
| `wrangler deploy --dry-run` | bez błędów; **nie wypisuje nazwy Workera**, nazwę potwierdza `dist/server/wrangler.json` (`shiftly`) |
| `GET /` przed sekretami | 200, baner o braku konfiguracji Supabase (zgodnie z oczekiwaniem) |
| `GET /` po sekretach | 200, bez banera |
| `GET /dashboard` (anonim) | 302 na `/auth/signin` |
| `GET /auth/signin`, `/auth/signup` | 200 |
| Nieistniejąca ścieżka | 404 |
| Rejestracja, logowanie | wykonane przez użytkownika na adresie produkcyjnym (zgłoszone, nie weryfikowane przez agenta) |
| `wrangler tail` (15 żądań GET, wersja `724bac53`) | `outcome: ok` 15/15, 0 wyjątków |

### Czas CPU z `wrangler tail`

Próba 15 żądań: średnio 6,3 ms; wartości 1, 1, 1, 1, 2, 2, 2, 2, 2, 4, 4, 5, **17, 23, 28** ms.
Trzy wartości powyżej 10 ms to pierwsze renderowania stron `/auth/signin` i `/auth/signup` w nowym izolacie
(drugie wejście na tę samą stronę: 4 do 5 ms). Wszystkie zakończyły się `ok`.

Plan konta (Free czy Paid) nie został ustalony. Jeśli to Free, wartości 17 do 28 ms przekraczają nominalny limit
10 ms CPU, a mimo to nie dały błędu, więc ryzyko z `infrastructure.md` jest **niepotwierdzone i niewykluczone**.
Do sprawdzenia w dashboardzie (Workers & Pages, Plans) i do powtórzenia pomiaru dla strony z grafikiem.

### Ustalenia poza planem

- **Istnieje starszy Worker `10x-astro-starter`** (wdrożony 2026-09-01, 5 wersji, w tym 2 zmiany sekretów),
  odpowiada 200 pod `https://10x-astro-starter.mto-astro.workers.dev/`, z własnym KV `10x-astro-starter-session`.
  To pozostałość sprzed tego wdrożenia, publiczna i z włączonymi sekretami. Decyzja użytkownika: zostawić czy usunąć
  (`npx wrangler delete 10x-astro-starter`, osobno namespace KV).
- Subdomena `mto-astro.workers.dev` istniała już na koncie, więc rejestracja subdomeny nie była potrzebna.
- Tytuł strony nadal brzmi "10x Astro Starter"; `/sitemap-index.xml` zwraca 404 (brak `site` w konfiguracji).

### Wycofanie

Są trzy wersje, więc `npx wrangler rollback` ma cel (np. `e6165383`, wersja bez sekretów). Nie ćwiczone.
