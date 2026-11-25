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
   - Od S-10 trzeci sekret: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` (klucz service-role, tylko dla trasy zaproszenia;
     kolejność i bramka SMTP w sekcji "Zaproszenia pracowników (S-10)" na końcu pliku).
   - Nie używać `secret bulk .dev.vars`: plik zawiera wartości lokalnego Supabase, od S-10 także jego klucz service-role.
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
- Własny SMTP w Supabase (zaproszenia FR-001, FR-006); od S-10 jest bramką wdrożenia zaproszeń, zob. "Zaproszenia
  pracowników (S-10)" na końcu pliku.
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

### Decyzja o planie konta (2026-10-16)

Użytkownik zdecydował: konto zostaje na planie **Workers Free**; Paid nie jest wymagany do dalszych prac.
Obowiązują więc limity Free (10 ms CPU na żądanie, 100 000 żądań na dobę; odczyt ze strony limitów 2026-10-13).
Pomiar z 2026-10-14 (17 do 28 ms, wynik `ok`) nie wywołał błędu, ale to próba 15 żądań, a nie gwarancja.

Proponowany wyzwalacz powrotu do Paid: pierwszy wynik inny niż `ok` w `wrangler tail` (np. `exceededCpu`) albo błąd
1102 w odpowiedzi. Pomiar powtórzyć po dodaniu pierwszej strony z grafikiem lub walidatora reguł.

### Ustalenia poza planem

- **Istnieje starszy Worker `10x-astro-starter`** (wdrożony 2026-09-01, 5 wersji, w tym 2 zmiany sekretów),
  odpowiada 200 pod `https://10x-astro-starter.mto-astro.workers.dev/`, z własnym KV `10x-astro-starter-session`.
  To pozostałość sprzed tego wdrożenia, publiczna i z włączonymi sekretami. Decyzja użytkownika (zostawić czy usunąć:
  `npx wrangler delete 10x-astro-starter`, osobno namespace KV) jeszcze niepodjęta; stan na 2026-10-16: nadal odpowiada 200.
- Subdomena `mto-astro.workers.dev` istniała już na koncie, więc rejestracja subdomeny nie była potrzebna.
- Tytuł strony nadal brzmi "10x Astro Starter"; `/sitemap-index.xml` zwraca 404 (brak `site` w konfiguracji).
- **Formatowanie `wrangler.jsonc`:** `wrangler deploy` przepisuje ten plik w katalogu roboczym (tabulatory, bez końcowego
  newline) bez zmiany treści; zmianę formatowania należy odrzucić (`git restore wrangler.jsonc`), nie commitować.

### Wycofanie

Są trzy wersje, więc `npx wrangler rollback` ma cel (np. `e6165383`, wersja bez sekretów). Nie ćwiczone.

## Zaproszenia pracowników (S-10)

Dodatek po pierwszym wdrożeniu: kroki wdrożenia kodu zaproszeń (S-10) na produkcję, w tej kolejności. Kod wdrożony bez
migracji albo bez sekretu nie psuje reszty aplikacji (trasa zaproszenia odpowiada 503 `not_configured`), ale bez własnego
nadawcy SMTP (krok 4) zaproszenia nie dojdą do pracowników. Legenda jak wyżej: **[U]** użytkownik w terminalu z głównego
katalogu repozytorium, z dostępem do hostowanego projektu Supabase i do konta Cloudflare.

### Checklista

1. **[U]** Migracja: `npx supabase db push` (dwie migracje S-10). Dodaje `employees.user_id`, `invited_at` i `activated_at`,
   politykę "własny wiersz" pracownika, granty kolumnowe i funkcję `mark_account_active`. Jest addytywna (kolumny nullable), a kod S-01 zapisuje tylko pięć dozwolonych kolumn, więc starsza
   wersja kodu działa też na nowym schemacie (`npx wrangler rollback` cofa kod, nie schemat).
2. **[U]** Sekret Workera: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`. Wartość to klucz `service_role` hostowanego
   projektu (dashboard Supabase, Settings, API); wpisuje użytkownik, nie trafia do czatu, repozytorium ani logów. Używa go
   wyłącznie `src/lib/supabase-admin.ts` w trasie `src/pages/api/employees/[id]/invite.ts`.
3. **[U]** Ustawienia Auth hostowanego projektu: `otp_expiry` 604800 (link ważny 7 dni), minimalna długość hasła 8,
   `site_url` i adresy przekierowań ustawione na adres Workera (`https://shiftly.mto-astro.workers.dev` i
   `https://shiftly.mto-astro.workers.dev/**`), szablony maili `invite` i `recovery` z `supabase/templates/` wraz z tytułami
   z `supabase/config.toml`.
   - Sposób: `npx supabase config push`, ale dopiero po sprawdzeniu, że pokazana różnica obejmuje `otp_expiry`, szablony i
     `minimum_password_length`; w przeciwnym razie ustawić te wartości przez Management API (endpoint konfiguracji Auth
     projektu, nazwy pól według jego dokumentacji).
   - Uwaga: lokalny `config.toml` ma `site_url` i adresy przekierowań na `http://localhost:4321`, a `config push` stosuje
     wartości z pliku, więc różnicę trzeba przejrzeć przed zatwierdzeniem, żeby nie nadpisać adresów produkcji.
   - Uwaga: dokumentacja Supabase odradza `otp_expiry` powyżej 86400 s i dopuszcza dłuższy czas tylko przez Management API.
     Jeśli hostowany projekt odrzuci 604800, decyzja wraca do autora (24 godziny ze zmianą wymagania w PRD albo własny
     token).
4. **Bramka (przed wdrożeniem kodu S-10 na produkcję):** własny nadawca SMTP skonfigurowany w Supabase: dostawca, domena
   nadawcy i limit wysyłek podniesiony ponad domyślne 30 na godzinę (tyle Supabase ustawia po podłączeniu własnego SMTP).
   Domyślny SMTP Supabase wysyła wyłącznie do członków zespołu organizacji i ma limit 2 maile na godzinę, więc bez własnego
   nadawcy zaproszenia nie dojdą do pracowników (ryzyko "Zaproszenia e-mail nie docierają" z `infrastructure.md`). Wybór
   dostawcy i domeny nie jest częścią S-10; do czasu tego kroku nie wdrażać kodu S-10 ani wycinków, które na nim polegają
   (S-11 i dalsze).
5. **[U]** `npm run build`, potem `npx wrangler deploy`.
6. **[U]** Test zaproszenia na prawdziwym adresie: zaprosić z listy pracowników pracownika z adresem, do którego użytkownik
   ma dostęp, odebrać mail, otworzyć link z `/auth/set-password`, ustawić hasło, zalogować się i wejść na `/dashboard`;
   ponowne zaproszenie przed ustawieniem hasła wysyła nowy link, a pierwszy przestaje działać. Podczas zaproszenia
   `npx wrangler tail --format pretty`: wynik `ok`, brak `exceededCpu` (czas oczekiwania na Auth i bazę nie liczy się do
   limitu CPU; wyzwalacz powrotu do planu Paid jak w "Decyzja o planie konta"). **Nie uruchamiać `npm run smoke` na
   produkcji:** skrypt odmawia hosta innego niż lokalny, a poza tym tworzy konta `@example.com` i używa klucza service-role.

### Zaakceptowane ryzyka

- **Klucz service-role w Workerze.** Kompromitacja Workera albo jego sekretów daje pełny dostęp do bazy z pominięciem RLS.
  Ograniczenia: jeden moduł (`src/lib/supabase-admin.ts`), jedna trasa, reguła ESLint zakazująca importu gdzie indziej,
  sprawdzenie roli planisty i istnienia pracownika sesją planisty przed użyciem klucza, brak odczytów danych tym kluczem.
  Rotację klucza w dashboardzie Supabase zatwierdza człowiek.
- **Polityka haseł tylko w aplikacji.** Formularz i trasa sprawdzają regułę z PRD (co najmniej 8 znaków, wielka litera, cyfra,
  znak specjalny), a Supabase ma tylko minimum 8 znaków: sesja z linku zaproszenia mogłaby wywołać `updateUser` wprost i
  ustawić słabsze hasło.
- **Publiczny endpoint odzyskiwania hasła.** Ponowne zaproszenie służy jako reset hasła (brak samodzielnego resetu to brak
  UI, nie blokada serwera), a `/auth/v1/recover` w Supabase pozostaje otwarty. Link trafia wyłącznie do właściciela
  skrzynki.
- **Aktywacja konta zapisywana tylko przez trasę ustawiania hasła.** Lista pokazuje "Zarejestrowany dd.mm.rrrr" na
  podstawie `employees.activated_at`, który ustawia funkcja `mark_account_active` wołana po udanym ustawieniu hasła.
  Błąd tej funkcji jest tylko logowany (konto działa, ale lista nadal pokazuje "Zaproszony"), a konto potwierdzone
  inną drogą niż nasza strona nie zostanie oznaczone.
