# Role based access Implementation Plan

## Overview

Dodajemy do Shiftly rozróżnienie dwóch ról, planisty i pracownika (fundament F-01 z roadmapy): rola siedzi w `app_metadata` konta Supabase, middleware przechodzi z listy chronionych tras na politykę "domyślnie odmów", a osoba bez wystarczającej roli widzi stronę "Brak dostępu" (401 dla niezalogowanego, 403 dla zalogowanego bez roli lub z rolą pracownika na stronie planisty). Publiczna rejestracja zostaje zamknięta, pierwszego planistę tworzy skrypt administracyjny, a pierwsza migracja dodaje funkcje SQL `current_app_role()` i `is_planner()`, z których będą korzystać polityki RLS w S-01 i kolejnych wycinkach. To warunek dla każdego wycinka z danymi osobowymi (S-01, S-02, S-10, S-11). Tabele domenowe i polityki "pracownik widzi własne dane" nie należą do tej zmiany.

## Current State Analysis

- Brak ról: `src/middleware.ts:4,18-22` chroni tylko `PROTECTED_ROUTES = ["/dashboard"]` przez `startsWith`, a każdy zalogowany użytkownik przechodzi; `src/env.d.ts:1-5` ma w `Locals` wyłącznie `user`. Nie istnieje `src/types.ts` (`CLAUDE.md` każe tam trzymać typy współdzielone, `AGENTS.md:30` zapisuje to jako "not yet present").
- Anonimowy użytkownik na chronionej stronie jest przekierowywany 302 na `/auth/signin` (`src/middleware.ts:19-21`), a smoke to sprawdza (`scripts/smoke.mjs:40,58`); PRD (Access Control) i `shape-notes.md` mówią, że ma zobaczyć komunikat o braku dostępu, bez automatycznego odesłania do logowania.
- Rejestracja jest publiczna: `src/pages/api/auth/signup.ts`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SignUpForm.tsx`, odnośniki w `src/components/Topbar.astro:27-29`, `src/components/Welcome.astro:35-40` (oraz tekst w linii 64) i `src/pages/auth/signin.astro:15-20`; `supabase/config.toml:171` ma `enable_signup = true`. PRD mówi, że konto pracownika zakłada planista. Strona na produkcji (`https://shiftly.mto-astro.workers.dev`) ma tę rejestrację włączoną, a istniejące konta nie mają roli.
- `supabase/` zawiera tylko `config.toml`: nie ma migracji (`context/deployment/deploy-plan.md:30,79`), więc ta zmiana dodaje pierwszą. `CLAUDE.md` wymaga RLS na każdej nowej tabeli; `infrastructure.md` (Risk Register) wymaga migracji wstecznie zgodnych i wdrażanych osobno od kodu.
- Smoke (`scripts/smoke.mjs:38-59`) zakłada konto przez publiczną rejestrację, a job `smoke` w CI (`.github/workflows/ci.yml:28-56`) wyciąga z `supabase status -o env` tylko `API_URL` i `ANON_KEY` (linia 43). Plan wdrożenia (`context/deployment/deploy-plan.md:61`) zakazuje uruchamiania smoke na produkcji.
- Pliki statyczne (`/_astro/*`, `favicon.png`) obsługuje binding `ASSETS` przed Workerem (`wrangler.jsonc:7-11`, brak `run_worker_first`), więc nie przechodzą przez middleware i polityka nie musi ich wymieniać.
- Astro normalizuje ścieżkę przed routingiem (`node_modules/astro/dist/core/util/normalized-url.js:11-22`: pętla `decodeURI`, sklejanie podwójnych ukośników). Polityka ma mimo to być odporna sama z siebie: wszystko, czego nie rozpozna dokładnie, traktuje jako stronę planisty.
- Dostępne jest środowisko testowe z F-02: `vitest.config.ts`, `expectDeterministic` w `src/lib/testing/determinism.ts`; testy leżą obok kodu, nigdy w `src/pages/`, a kod testowany nie importuje `astro:*` ani `cloudflare:workers` (`AGENTS.md:24`).
- `eslint.config.js:73-78` ogranicza globale w `scripts/**/*.mjs` do `console`, `process`, `fetch`, `URLSearchParams`; nowy kod w skryptach może wymagać dopisania kolejnych (np. `URL`).
- `context/foundation/lessons.md` nie istnieje.

## Desired End State

- Konto ma rolę `planner` albo `employee` w `app_metadata.role`; middleware odczytuje ją z użytkownika zwróconego przez `getUser()` (bez dodatkowego zapytania) i udostępnia jako `Astro.locals.role`. Rolę ustawia wyłącznie API administracyjne z kluczem service-role; użytkownik nie może jej zmienić.
- Polityka dostępu jest czystą funkcją `decideAccess` w `src/lib/services/access.ts`, z trzema warstwami: publiczne (`/`, `/auth/signin`, `/api/auth/signin`, `/api/auth/signout`, `/access-denied`), dostępne dla obu ról (`/dashboard`) i wszystko pozostałe tylko dla planisty. Rozpoznanie jest dokładne (bez dopasowania prefiksów), więc nowa strona planisty z kolejnego wycinka jest chroniona automatycznie.
- Niezalogowany użytkownik na stronie niepublicznej dostaje stronę "Brak dostępu" ze statusem 401 i odnośnikiem do logowania (bez przekierowania); zalogowany bez roli lub z rolą pracownika na stronie planisty dostaje ją ze statusem 403; zapytania `/api/*` dostają ten sam status z ciałem JSON.
- `/planner` to minimalna strona planisty (zastępowana w S-01), `/dashboard` pokazuje rolę i dla planisty odnośnik do `/planner`.
- Rejestracja jest zamknięta w aplikacji (strony i trasa usunięte) i w Supabase (`enable_signup = false`), a `scripts/create-planner.mjs` tworzy pierwszego planistę lub awansuje istniejące konto.
- Pierwsza migracja definiuje `public.current_app_role()` i `public.is_planner()` (odczyt z `auth.jwt()`), z komentarzem pokazującym wzorzec polityk RLS dla S-01.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, a smoke z macierzą ról (planista, pracownik, konto bez roli, anonim) przechodzi lokalnie i w CI.

### Key Discoveries:

- `getUser()` jest już wywoływane w każdym żądaniu (`src/middleware.ts:12`), więc rola z `app_metadata` nie kosztuje dodatkowej rundy do bazy na planie Workers Free (limit 10 ms CPU, `infrastructure.md` Risk Register).
- `user_metadata` użytkownik może sam zapisać (`auth.updateUser({ data })`), a `app_metadata` tylko API administracyjne; autoryzacja czyta wyłącznie `app_metadata`.
- Wyłączenie rejestracji w Supabase nie blokuje API administracyjnego (`/auth/v1/admin/users`), więc ta sama ścieżka posłuży S-10 do zaproszeń.
- Role w JWT (RLS) odświeżają się wraz z tokenem (`jwt_expiry = 3600` w `supabase/config.toml:160`), a strony czytają rolę świeżo z `getUser()`; okno nieaktualności dotyczy tylko RLS i jest zaakceptowane.
- Smoke tworzy konta przez API administracyjne lokalnego Supabase, więc kluczy service-role nie przekazujemy do aplikacji, `.env` ani `.dev.vars`.
- Domyślna rejestracja Supabase jest przyczyną, dla której na produkcji istnieją konta bez roli; po wdrożeniu mają dostęp tylko do stron publicznych, dopóki nie zostaną awansowane skryptem.

## What We're NOT Doing

- Żadnych tabel domenowych ani polityk RLS "pracownik widzi własne dane" (to S-01, S-10, S-11); F-01 dostarcza funkcje pomocnicze i wzorzec w komentarzu migracji. W F-01 pracownik widzi tylko `/dashboard` z własnym adresem e-mail i rolą.
- Żadnych zaproszeń, linków do ustawienia hasła ani poczty (S-10); żadnej zmiany polityki haseł w `config.toml` (poza walidacją w skrypcie tworzącym planistę).
- Żadnego klucza service-role w Workerze: używają go wyłącznie skrypt `create-planner.mjs` (z powłoki autora) i smoke (lokalny Supabase).
- Żadnej tabeli `profiles`, niestandardowego hooka tokenu ani zapytania do bazy o rolę w każdym żądaniu.
- Żadnego zarządzania rolami w UI, blokowania kont (FR-015) ani cofania roli poza ponownym uruchomieniem skryptu administracyjnego.
- Żadnego dopasowania prefiksów w polityce: tabela zawiera ścieżki dokładne; prefiks (np. `/me/...` dla S-11) doda ten wycinek, który go pierwszy potrzebuje.
- Żadnej lokalizacji istniejących stron (zostają po angielsku); nowe strony `/access-denied` i `/planner` są po polsku, zgodnie z PRD.
- Żadnych zmian w `context/deployment/deploy-plan.md` (zapis historyczny wdrożenia z 2026-10-14, w którym kontrola 302 jest już nieaktualna) ani w `/` poza usunięciem odnośnika do rejestracji.
- Żadnych testów e2e w przeglądarce.

## Implementation Approach

Od środka na zewnątrz: najpierw czysta, przetestowana polityka (Faza 1), potem jej podłączenie do middleware wraz ze smoke'iem, który tworzy prawdziwe konta w trzech stanach (planista, pracownik, konto bez roli) i sprawdza macierz odpowiedzi (Faza 2), potem zamknięcie rejestracji i skrypt pierwszego planisty (Faza 3), na końcu warstwa bazy z weryfikacją przez RPC (Faza 4). Każda faza kończy się zielonym CI. Fazy 2 i 3 trafiają do jednego PR i jednego wdrożenia: po Fazie 2 bramka już blokuje trasy rejestracji, a odnośniki do nich prowadzą na „Brak dostępu” aż do Fazy 3, więc samej Fazy 2 nie wdrażamy.

Polityka "domyślnie odmów" zamienia pytanie "czy ta trasa jest chroniona?" na "czy ta trasa jest jawnie otwarta?": zapomniany wpis powoduje głośną odmowę (403), a nie wyciek danych. Konto z nieznaną wartością roli (np. `admin`) jest traktowane jak konto bez roli. Niezalogowany i zalogowany bez roli to dwa różne powody odmowy (401 i 403), a strona odmowy jest publiczna, aby dało się na nią wejść także bezpośrednio, bez kolejnej odmowy.

Smoke przechodzi z modelu "zarejestruj się przez publiczną trasę" na "utwórz konto przez API administracyjne lokalnego Supabase" i odmawia uruchomienia przeciw nielokalnemu `SUPABASE_URL`, bo tworzy konta i potrzebuje klucza service-role.

## Critical Implementation Details

**State sequencing (wdrożenie na produkcję):** kolejność ma znaczenie, bo konta na produkcji nie mają roli. Najpierw przejrzeć konta hostowanego projektu w panelu Supabase i usunąć te, których autor nie rozpoznaje, potem (z powłoki autora, przeciw hostowanemu projektowi) utworzyć lub awansować planistę skryptem, dopiero potem wdrożyć build z nową polityką (`npm run build`, `npx wrangler deploy`), na końcu wyłączyć rejestrację w panelu Supabase i zastosować migrację (`npx supabase db push`). Migracja jest addytywna, więc `wrangler rollback` kodu pozostaje bezpieczny.

**Security:** autoryzacja czyta wyłącznie `app_metadata.role` (i w SQL `auth.jwt() -> 'app_metadata'`); odczyt `user_metadata` byłby podatny na samodzielne nadanie roli przez użytkownika. Smoke ma to udowodnić próbą podrobienia (Faza 4).

## Phase 1: Polityka dostępu

### Overview

Dodać czystą logikę rozstrzygania dostępu i parsowania roli wraz z tabelarycznym zestawem testów. Żadne zachowanie aplikacji się jeszcze nie zmienia.

### Changes Required:

#### 1. Typ roli

**File**: `src/types.ts` (nowy)

**Intent**: Miejsce na typy współdzielone wymagane przez `CLAUDE.md`; zaczyna od roli.

**Contract**: `export type Role = "planner" | "employee";`. Zaktualizować `AGENTS.md:30` (usunąć `src/types.ts` z listy "not yet present").

#### 2. Polityka dostępu

**File**: `src/lib/services/access.ts` (nowy)

**Intent**: Jedno źródło prawdy o tym, kto może wejść na jaką ścieżkę, w postaci czystych funkcji (bez importów `astro:*` i `cloudflare:workers`), testowalnych bez serwera. Middleware (Faza 2) tylko wywołuje te funkcje.

**Contract**: `parseRole(value: unknown): Role | null` zwraca `"planner"` albo `"employee"` tylko dla dokładnie takich ciągów; każda inna wartość (`undefined`, `null`, `"Planner"`, `"admin"`, `""`, liczby, tablice, obiekty) daje `null`. `decideAccess(input: { pathname: string; signedIn: boolean; role: Role | null }): AccessDecision`, gdzie `AccessDecision = { allowed: true } | { allowed: false; reason: AccessDenial }`, a `AccessDenial = "unauthenticated" | "forbidden"` (oba typy eksportowane). Reguły:

| Warstwa | Ścieżki (dokładne) | Kto wchodzi |
| --- | --- | --- |
| public | `/`, `/auth/signin`, `/api/auth/signin`, `/api/auth/signout`, `/access-denied` | każdy |
| any-role | `/dashboard` | `planner` i `employee` |
| planner-only | wszystko inne | tylko `planner` |

Odmowa: `unauthenticated`, gdy `signedIn` jest fałszem; w przeciwnym razie `forbidden`. Zalogowany z `role === null` dostaje `forbidden` wszędzie poza warstwą public. Normalizacja przed dopasowaniem: pojedynczy końcowy `/` jest ignorowany (poza korzeniem `/`); dopasowanie jest dokładne i rozróżnia wielkość liter; ścieżka niezaczynająca się od `/` albo zawierająca `%`, `\`, znak sterujący, segment pusty (`//`) lub segment `.`/`..` nigdy nie pasuje do wpisu tabeli i wpada do warstwy planner-only. Tabela jest literałem obiektu (duplikat klucza jest błędem kompilacji), więc wynik nie zależy od kolejności wpisów. Nieznane ścieżki i wewnętrzne trasy Astro (`/_image`, `/_server-islands/*`) oraz ścieżki spoza tabeli (np. `/favicon.ico`, `/robots.txt`, usunięte trasy rejestracji) są tylko dla planisty, więc anonim dostaje na nich 401 zamiast 404; wycinek, który potrzebuje publicznej ścieżki (np. strona publiczna z `<Image>` albo `server:defer`), wpisuje ją do tabeli.

#### 3. Testy polityki

**File**: `src/lib/services/access.test.ts` (nowy)

**Intent**: Udowodnić zachowanie dla każdej warstwy i każdego stanu użytkownika oraz dla ścieżek, które łatwo zepsuć.

**Contract**: Przypadki (nazwane): (a) macierz warstwa × stan (anonim, konto bez roli, `employee`, `planner`) z oczekiwanym wynikiem i powodem odmowy; (b) higiena ścieżek: `/dashboard/` jak `/dashboard`; `/dashboardx`, `/dashboard/x`, `/auth/signin/extra`, `/Dashboard` wpadają do planner-only; `/%64ashboard`, `/dashboard%2F`, `//dashboard`, `/auth/signin/../../planner`, `/a\b`, `dashboard` (bez wiodącego `/`) i pusty ciąg nie dostają dostępu publicznego ani wspólnego; (c) domyślna odmowa: `/employees` (przyszła strona S-01) jest tylko dla planisty; (d) `parseRole` dla wartości z kontraktu, w tym nieznane `"admin"` i `"Planner"`; (e) nieznana rola z `parseRole` traktowana jak brak roli daje `forbidden` poza public. Ani testy, ani `access.ts` (także w komentarzach) nie zawierają literałów z wzorca kryterium 3.2 (`auth/signup`, `confirm-email`, `SignUpForm`, `PROTECTED_ROUTES`), bo to kryterium przeszukuje `src`.

### Success Criteria:

#### Automated Verification:

- Testy polityki dostępu przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Tabela ścieżek publicznych i wspólnych w `access.ts` została przejrzana i zatwierdzona przez autora (zgodna z PRD, sekcja Access Control)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Egzekwowanie w aplikacji i smoke z rolami

### Overview

Podłączyć politykę do middleware, dodać stronę odmowy, minimalną stronę planisty i wyświetlanie roli, a smoke przepisać tak, by tworzył prawdziwe konta w trzech stanach i sprawdzał macierz odpowiedzi. CI przekazuje klucz service-role wyłącznie do polecenia smoke.

### Changes Required:

#### 1. Typy `Astro.locals`

**File**: `src/env.d.ts`

**Intent**: Udostępnić rolę stronom i middleware w sposób typowany.

**Contract**: `Locals` zyskuje `role: import("./types").Role | null`. Powód odmowy nie jest polem `Locals`: strona odmowy wyprowadza status (401 lub 403) z `Astro.locals.user`, bo stan ustawiany przed przepisaniem żądania nie jest niezawodnym nośnikiem (zob. zmiana 2).

#### 2. Middleware

**File**: `src/middleware.ts`

**Intent**: Zastąpić listę `PROTECTED_ROUTES` wywołaniem `decideAccess` i obsłużyć odmowę.

**Contract**: Po wyznaczeniu `locals.user` ustawić `locals.role = parseRole(user?.app_metadata.role)` (wyłącznie `app_metadata`). Gdy `supabase` jest `null`, użytkownik to `null` (jak dziś). Dla odmowy: ścieżka zaczynająca się od `/api/` zwraca `Response` z JSON `{ "error": "<reason>" }`, statusem 401 (`unauthenticated`) lub 403 (`forbidden`) i `Cache-Control: no-store`; pozostałe ścieżki zwracają `next("/access-denied")` (przepisanie przez argument `next`, nie `context.rewrite()`: w Astro 7 `rewrite()` ponownie uruchamia middleware na wspólnym `locals`, dokłada drugie `getUser()` na ciasteczkach z nagłówka żądania i kasuje stan ustawiony w pierwszym przebiegu, a `next(payload)` nie wchodzi ponownie w middleware, zachowuje `Astro.locals` i ciasteczka ustawione przez `getUser()`). Decyzja zapada przed routingiem, więc nieistniejąca ścieżka planisty także daje 401/403, a nie 404. `PROTECTED_ROUTES` znika.

#### 3. Strona odmowy

**File**: `src/pages/access-denied.astro` (nowy)

**Intent**: Pokazać komunikat o braku dostępu zgodnie z PRD, bez przekierowania.

**Contract**: Strona publiczna (jest w tabeli polityki, więc dostępna także przy bezpośrednim wejściu). Ustawia `Astro.response.status` we frontmatterze na 403, gdy `Astro.locals.user` jest ustawiony, a w przeciwnym razie na 401 (także przy bezpośrednim wejściu: anonim 401, zalogowany 403), oraz `Cache-Control: no-store`. Treść po polsku: "Brak dostępu"; dla niezalogowanego odnośnik do `/auth/signin`; dla zalogowanego adres e-mail, rola (lub "brak roli") i formularz wylogowania `POST /api/auth/signout`. Styl jak istniejące strony auth (`src/pages/dashboard.astro`).

#### 4. Strona planisty i dashboard

**File**: `src/pages/planner/index.astro` (nowy), `src/pages/dashboard.astro`

**Intent**: Dać polityce prawdziwą stronę tylko dla planisty (cel dla smoke i strona dostępna z `/dashboard` dla planisty; logowanie nadal kieruje na `/`) oraz pokazać użytkownikowi jego rolę.

**Contract**: `/planner` nie występuje w tabeli polityki (chroni ją reguła domyślna); pokazuje po polsku "Panel planisty", adres e-mail i wylogowanie, z komentarzem, że S-01 zastępuje ją nawigacją. `/dashboard` pokazuje rolę (planista/pracownik) i tylko dla `planner` odnośnik do `/planner`.

#### 5. Smoke z macierzą ról

**File**: `scripts/smoke.mjs` (oraz ewentualnie `eslint.config.js`, jeśli potrzebne są nowe globale)

**Intent**: Zastąpić zakładanie konta publiczną rejestracją tworzeniem kont przez API administracyjne lokalnego Supabase i sprawdzić, że bramka dostępu działa dla każdego stanu użytkownika.

**Contract**: Wymaga zmiennych `SUPABASE_URL`, `SUPABASE_KEY` (anon) i `SUPABASE_SERVICE_ROLE_KEY`; kończy się błędem przed pierwszym żądaniem, gdy ich brakuje albo gdy host `SUPABASE_URL` nie jest `127.0.0.1` ani `localhost`. Strażnik widzi tylko własny `SUPABASE_URL`, a aplikacja pod testem czyta `.env`/`.dev.vars`, które muszą wskazywać ten sam lokalny stos (wartości z `supabase status -o env`, jak w `ci.yml:44-48`); gdy konto utworzone przez API administracyjne nie może się zalogować w pierwszym kroku logowania, smoke wypisuje „aplikacja pod testem nie używa SUPABASE_URL”. Konta tworzy `POST {SUPABASE_URL}/auth/v1/admin/users` (`email_confirm: true`, `app_metadata: { role }`, bez roli dla trzeciego konta) z nagłówkami `apikey` i `Authorization: Bearer <service key>`. Każdy aktor ma własny słoik ciasteczek. Oczekiwane statusy: anonim: `/` 200, `/dashboard` 401, `/planner` 401, `/employees` 401, `GET /api/employees` 401 z `content-type: application/json`; konto bez roli po zalogowaniu: `/dashboard` 403, `/planner` 403; pracownik: `/dashboard` 200, `/planner` 403, `/planner/` 403, `/%70lanner` 403, `//planner` 403, `/employees` 403; planista: `/dashboard` 200, `/planner` 200, `/planner/` 200, `/employees` 404 (bramka przepuszcza, strony nie ma); po wylogowaniu `/dashboard` znów 401; zły hasło nadal daje 302 na `/auth/signin?error=`. Krok z publiczną rejestracją znika (trasa jest już zablokowana bramką i zostaje usunięta w Fazie 3; smoke jej nie ćwiczy).

#### 6. CI: klucz service-role tylko dla smoke

**File**: `.github/workflows/ci.yml`

**Intent**: Dać smoke'owi klucz do tworzenia kont, nie dając go aplikacji.

**Contract**: W jobie `smoke` dopisać klucz service-role do wyciąganych zmiennych (`supabase.env`, linia 43; dokładną nazwę zmiennej odczytać z `supabase status -o env` w użytej wersji CLI, spodziewane `SERVICE_ROLE_KEY`). `.env` i `.dev.vars` (linia 47) nadal zawierają wyłącznie `SUPABASE_URL` i `SUPABASE_KEY`. Polecenie smoke dostaje `SUPABASE_URL`, `SUPABASE_KEY` i `SUPABASE_SERVICE_ROLE_KEY` jako prefiks zmiennych tylko tego polecenia, uruchamianego po starcie podglądu (podgląd nie dziedziczy klucza).

#### 7. Dokumentacja

**File**: `CLAUDE.md` (Auth flow, linia 29; Commands, linia 14), `AGENTS.md` (linie 15, 23), `README.md` (linie 58, 148, 150, 172, 179)

**Intent**: Opisać nowy model: middleware z polityką, role, nowe wymagania smoke.

**Contract**: Zastąpić opis `PROTECTED_ROUTES` opisem `decideAccess` w `src/lib/services/access.ts` (default-deny, role w `app_metadata`) i dopisać do opisu smoke potrzebne zmienne oraz zakaz uruchamiania na hostowanym projekcie. W `README.md`: linia 150 (zamiast tablicy `PROTECTED_ROUTES`: domyślna odmowa i tabela w `access.ts`), linia 148 (wiersz `/dashboard` nie przekierowuje już, tylko pokazuje „Brak dostępu”: 401 dla anonima, 403 dla konta bez roli), linie 58, 172 i 179 (smoke tworzy konta przez API administracyjne lokalnego Supabase, potrzebne zmienne, brak rejestracji).

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z macierzą ról przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos (wartości z `supabase status -o env`), ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z tego stosu): `npm run smoke`
- Smoke odmawia uruchomienia przeciw nielokalnemu adresowi, zanim wyśle jakiekolwiek żądanie: `$env:SUPABASE_URL = "https://example.supabase.co"; npm run smoke` kończy się kodem niezerowym

#### Manual Verification:

- Przegląd `ci.yml`: klucz service-role trafia wyłącznie do polecenia smoke (nie do `.env`, `.dev.vars`, kroku build ani podglądu)
- Przeglądarka, planista: `/dashboard` pokazuje rolę i odnośnik do `/planner`, a `/planner` się otwiera
- Przeglądarka, pracownik i anonim: pracownik na `/planner` widzi stronę "Brak dostępu" ze statusem 403, anonim na `/dashboard` widzi ją ze statusem 401 i odnośnikiem do logowania bez przekierowania, a strona logowania nadal się hydratuje (formularz działa)
- Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Zamknięcie rejestracji i pierwszy planista

### Overview

Usunąć publiczną rejestrację z aplikacji i z konfiguracji Supabase oraz dodać skrypt, którym autor tworzy pierwszego planistę (albo awansuje istniejące konto), z opisem w dokumentacji.

### Changes Required:

#### 1. Usunięcie rejestracji z aplikacji

**File**: `src/pages/api/auth/signup.ts`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`, `src/components/auth/SignUpForm.tsx` (usunięte); `src/components/Topbar.astro`, `src/components/Welcome.astro`, `src/pages/auth/signin.astro` (edytowane)

**Intent**: Nie zostawiać martwego kodu ani odnośników do funkcji, która nie istnieje.

**Contract**: Usunąć cztery pliki; z `Topbar.astro` (linie 27-29), `Welcome.astro` (przycisk w liniach 35-40 oraz słowa "sign up" w opisie, linia 64) i `signin.astro` (akapit "Don't have an account?", linie 15-20) usunąć odwołania do rejestracji. Komponenty współdzielone (`FormField`, `PasswordToggle`, `SubmitButton`, `ServerError`) zostają, bo korzysta z nich `SignInForm`.

#### 2. Wyłączenie rejestracji w Supabase

**File**: `supabase/config.toml`

**Intent**: Odrzucać rejestrację także wtedy, gdy ktoś wywoła API Supabase bezpośrednio (klucz anon jest jawny dla każdego klienta).

**Contract**: `[auth] enable_signup = false` (linia 171). `[auth.email] enable_signup` (linia 216) zostaje `true`, bo w Supabase steruje włączeniem dostawcy e-mail, a nie samą rejestracją; poprawność tego wyboru dowodzi smoke (logowanie kont z API administracyjnego nadal działa).

#### 3. Skrypt pierwszego planisty

**File**: `scripts/create-planner.mjs` (nowy; ewentualnie `eslint.config.js` jeśli potrzebne są nowe globale)

**Intent**: Dać autorowi bezpieczny, bezzależnościowy sposób utworzenia pierwszego planisty na hostowanym projekcie i awansowania istniejących kont (w tym kont testowych z produkcji).

**Contract**: Użycie `node scripts/create-planner.mjs <email>`; zmienne środowiskowe `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (zawsze) i `PLANNER_PASSWORD` (wymagana tylko dla nowego konta). Skrypt wypisuje docelowy host, sprawdza hasło względem NFR z PRD (co najmniej 8 znaków, duża litera, cyfra, znak specjalny) przed jakimkolwiek żądaniem, tworzy konto (`email_confirm: true`, `app_metadata: { role: "planner" }`) albo, gdy `POST /auth/v1/admin/users` odpowie `email_exists`, znajduje konto (nie zakładamy wyszukiwania po e-mailu) przez `GET /auth/v1/admin/users?page=N&per_page=1000`, kolejne strony, aż adres zgodzi się bez względu na wielkość liter, i `PUT /auth/v1/admin/users/{id}` ustawia `app_metadata: { role: "planner" }` bez zmiany hasła; brak dopasowania kończy się kodem niezerowym. Powtórne uruchomienie jest idempotentne (kod 0). Nigdy nie wypisuje hasła ani klucza; kody wyjścia niezerowe dla błędów wejścia i odpowiedzi API.

#### 4. Smoke: rejestracja zamknięta

**File**: `scripts/smoke.mjs`

**Intent**: Wykrywać przypadkowe ponowne otwarcie rejestracji.

**Contract**: Dodać kroki: `POST /api/auth/signup` jako anonim daje 401 z JSON (sprawdzenie bramki: ten krok przechodzi już po Fazie 2, a usunięcie trasy dowodzi kryterium 3.2), a bezpośrednie `POST {SUPABASE_URL}/auth/v1/signup` z kluczem anon jest odrzucone (status 4xx).

#### 5. Dokumentacja

**File**: `CLAUDE.md` (Auth flow, linie 30-31), `README.md` (linie 131-139 oraz tabela tras, linie 146-147), `AGENTS.md`

**Intent**: Usunąć opisy nieistniejących tras i opisać, jak utworzyć pierwszego planistę.

**Contract**: Usunąć `signup` i `confirm-email` z list tras oraz przepisać sekcję README „Email confirmation in local development” (linie 131-139), która opisuje logowanie po rejestracji (konta tworzy API administracyjne z `email_confirm: true`); dodać do sekcji Auth flow w `CLAUDE.md` krótki opis `scripts/create-planner.mjs` (zmienne, że klucz service-role nigdy nie trafia do `.env`/`.dev.vars`/sekretów Workera) oraz uwagę, że rejestracja jest zamknięta.

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Kod aplikacji i dokumentacja nie odwołują się już do usuniętych tras rejestracji ani do `PROTECTED_ROUTES`: `Get-ChildItem src,README.md,CLAUDE.md,AGENTS.md -Recurse -File | Select-String -Pattern 'auth/signup|confirm-email|SignUpForm|PROTECTED_ROUTES'` nie zwraca dopasowań
- Skrypt tworzy planistę na lokalnym Supabase, a ponowne uruchomienie dla tego samego adresu kończy się kodem 0 bez zmian: `node scripts/create-planner.mjs smoke-planner@example.com` (z `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PLANNER_PASSWORD`)
- Skrypt odrzuca hasło niespełniające reguł NFR przed wysłaniem żądania: `$env:PLANNER_PASSWORD = "weak"; node scripts/create-planner.mjs x@example.com` kończy się kodem niezerowym
- Smoke przechodzi razem z krokami zamkniętej rejestracji: `npm run smoke`

#### Manual Verification:

- Hostowany Supabase: opcja zezwalająca na rejestrację nowych użytkowników jest wyłączona, a `POST <SUPABASE_URL>/auth/v1/signup` z kluczem anon zwraca błąd (wykonuje autor)
- Hostowany Supabase: pierwszy planista utworzony (lub istniejące konto awansowane) skryptem przed wdrożeniem; po ręcznym wdrożeniu loguje się na `https://shiftly.mto-astro.workers.dev` i widzi `/planner` (wykonuje autor)
- Strona główna, logowanie i pasek górny nie zawierają już odnośników do rejestracji (przegląd wizualny)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Warstwa bazy

### Overview

Dodać pierwszą migrację z funkcjami pomocniczymi roli i udowodnić przez RPC, że czytają rolę z tokenu oraz że podrobienie roli w `user_metadata` nie daje dostępu.

### Changes Required:

#### 1. Migracja z funkcjami roli

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_role_helpers.sql` (nowy; znacznik czasu z chwili utworzenia)

**Intent**: Jedna definicja "kim jest planista" po stronie bazy, której będą używać wszystkie polityki RLS od S-01, odporna na nieznane wartości roli tak samo jak `parseRole`.

**Contract**: `public.current_app_role() returns text` (język `sql`, `stable`, `security invoker`, `set search_path = ''`) zwraca `auth.jwt() -> 'app_metadata' ->> 'role'` tylko gdy wartość to `planner` lub `employee`, w przeciwnym razie `null`. `public.is_planner() returns boolean` zwraca `coalesce(public.current_app_role() = 'planner', false)`. Uprawnienia: `execute` dla `authenticated`, odebrane `public` i `anon` (nowe funkcje w `public` dostają domyślnie prawa dla `anon`, więc trzeba je odebrać jawnie). Migracja nie tworzy tabel. Na końcu komentarz z wzorcem polityk dla S-01 (osobne polityki na operację i rolę, zgodnie z `CLAUDE.md`): planista pełny dostęp przez `public.is_planner()`, pracownik tylko własne wiersze przez `user_id = (select auth.uid())`.

```sql
-- non-obvious: explicit revoke from anon, because default privileges in Supabase grant execute on new public functions to it
revoke execute on function public.is_planner() from public, anon;
grant execute on function public.is_planner() to authenticated;
```

#### 2. Smoke: RPC i próba podrobienia roli

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić po stronie bazy to samo, co Faza 2 sprawdza po stronie aplikacji, na prawdziwych tokenach.

**Contract**: Dla każdego z trzech kont pobrać token (`POST {SUPABASE_URL}/auth/v1/token?grant_type=password`, nagłówek `apikey` = anon) i wywołać `POST {SUPABASE_URL}/rest/v1/rpc/is_planner` oraz `.../rpc/current_app_role` z `apikey` = anon i `Authorization: Bearer <token>`. Oczekiwane: planista `true` i `"planner"`; pracownik `false` i `"employee"`; konto bez roli `false` i `null`; wywołanie anonimowe (sam klucz anon, bez tokenu użytkownika) odrzucone (status inny niż 2xx). Próba podrobienia: pracownik wywołuje `PUT {SUPABASE_URL}/auth/v1/user` ze swoim tokenem i `{ "data": { "role": "planner" } }`, a po ponownym zalogowaniu `is_planner` nadal zwraca `false`, a `/planner` w aplikacji nadal daje 403.

#### 3. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md` (linia 30)

**Intent**: Wskazać miejsce definicji roli w SQL i wzorca polityk, żeby następny wycinek go nie wymyślał.

**Contract**: W `CLAUDE.md` (konwencje migracji) dopisać jedno zdanie o `public.is_planner()`/`public.current_app_role()` i o wzorcu w komentarzu migracji; w `AGENTS.md:30` usunąć migracje z listy "not yet present".

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami RPC i próbą podrobienia roli przechodzi: `npm run smoke`

#### Manual Verification:

- Migracja zastosowana na hostowanym projekcie przez autora (`npx supabase db push`) i widoczna jako zastosowana w `npx supabase migration list`
- Wzorzec polityk RLS w komentarzu migracji jest czytelny i wystarczający dla S-01 (przegląd przez autora)
- Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki RPC)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `access.test.ts`: macierz warstw i stanów użytkownika, higiena ścieżek (końcowy ukośnik, prefiksy, wielkość liter, kodowanie, `..`), domyślna odmowa dla przyszłych tras, `parseRole` dla wartości spoza kontraktu, w tym `"admin"`.

### Integration Tests:

- Smoke z macierzą ról w CI (job `smoke`, lokalny Supabase): statusy 401/403/200/404 dla anonima, konta bez roli, pracownika i planisty; odpowiedź JSON dla `/api/*`; zamknięta rejestracja; RPC `is_planner`/`current_app_role`; próba podrobienia roli przez `user_metadata`.

### Manual Testing Steps:

1. Zalogować się jako planista i jako pracownik (konta z `create-planner.mjs` i API administracyjnego) i obejrzeć `/dashboard`, `/planner`, stronę odmowy.
2. Jako anonim otworzyć `/dashboard` i sprawdzić w narzędziach przeglądarki status 401 oraz brak przekierowania.
3. Po wdrożeniu na produkcję wykonać kroki z "Migration Notes" w podanej kolejności.

## Performance Considerations

Brak dodatkowych zapytań do bazy w żądaniu: rola pochodzi z `getUser()`, które middleware już wykonuje, a `decideAccess` to wyszukanie w małej tabeli. Środowisko testowe workerd nie egzekwuje limitu 10 ms CPU z planu Workers Free, więc pomiar dla stron produkcyjnych zostaje poza tą zmianą.

## Migration Notes

Kolejność wdrożenia na produkcję (wykonuje autor): (1) przegląd kont w panelu Supabase (Authentication → Users) i usunięcie tych, których autor nie rozpoznaje (strona jest publiczna od 2026-10-14, a zaproszenie w S-10 po adresie, który ktoś już zarejestrował z własnym hasłem, trafiłoby na `email_exists`), (2) `create-planner.mjs` przeciw hostowanemu projektowi (utworzenie lub awans), (3) `npm run build` i `npx wrangler deploy`, (4) wyłączenie rejestracji w panelu Supabase, (5) `npx supabase db push`. Istniejące konta bez roli po wdrożeniu widzą tylko strony publiczne i "Brak dostępu"; awansuje się je ponownym uruchomieniem skryptu. Wycofanie: `npx wrangler rollback` cofa kod; migracja jest addytywna (dwie funkcje), więc poprzednia wersja kodu działa na nowym schemacie, a ponowne włączenie rejestracji wymaga ręcznej zmiany w panelu Supabase. Rola w JWT odświeża się z tokenem (do godziny), więc awans lub odebranie roli dociera do polityk RLS z opóźnieniem, a do stron aplikacji od razu.

## References

- Roadmapa: `context/foundation/roadmap.md` (F-01, `role-based-access`; niewiadome "pierwsze konto planisty" i "komunikat zamiast przekierowania" rozstrzygnięte w tym planie)
- PRD: `context/foundation/prd.md` (Access Control, NFR: pracownik widzi wyłącznie własne dane, polityka haseł) oraz `context/foundation/shape-notes.md` (zachowanie dla niezalogowanego)
- Ryzyka infrastruktury: `context/foundation/infrastructure.md` (migracje wstecznie zgodne, limit 10 ms CPU), `context/deployment/deploy-plan.md` (zakaz smoke na produkcji, `SUPABASE_KEY` to klucz anon)
- Wzorzec testów i helper z F-02: `src/lib/testing/determinism.ts`, `vitest.config.ts`, plan `context/archive/2026-10-16-rules-verification-harness/plan.md`
- Obecny kod: `src/middleware.ts`, `src/env.d.ts`, `scripts/smoke.mjs`, `.github/workflows/ci.yml`, `supabase/config.toml`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Polityka dostępu

#### Automated

- [x] 1.1 Testy polityki dostępu przechodzą w workerd: `npm test` — 34f8768
- [x] 1.2 Linting przechodzi: `npm run lint` — 34f8768
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 34f8768

#### Manual

- [x] 1.4 Tabela ścieżek publicznych i wspólnych w `access.ts` została przejrzana i zatwierdzona przez autora (zgodna z PRD, sekcja Access Control) — 34f8768

### Phase 2: Egzekwowanie w aplikacji i smoke z rolami

#### Automated

- [x] 2.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [x] 2.2 Smoke z macierzą ról przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos (wartości z `supabase status -o env`), ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z tego stosu): `npm run smoke`
- [x] 2.3 Smoke odmawia uruchomienia przeciw nielokalnemu adresowi, zanim wyśle jakiekolwiek żądanie: `$env:SUPABASE_URL = "https://example.supabase.co"; npm run smoke` kończy się kodem niezerowym

#### Manual

- [x] 2.4 Przegląd `ci.yml`: klucz service-role trafia wyłącznie do polecenia smoke (nie do `.env`, `.dev.vars`, kroku build ani podglądu)
- [x] 2.5 Przeglądarka, planista: `/dashboard` pokazuje rolę i odnośnik do `/planner`, a `/planner` się otwiera
- [x] 2.6 Przeglądarka, pracownik i anonim: pracownik na `/planner` widzi stronę "Brak dostępu" ze statusem 403, anonim na `/dashboard` widzi ją ze statusem 401 i odnośnikiem do logowania bez przekierowania, a strona logowania nadal się hydratuje (formularz działa)
- [ ] 2.7 Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`)

### Phase 3: Zamknięcie rejestracji i pierwszy planista

#### Automated

- [ ] 3.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 3.2 Kod aplikacji i dokumentacja nie odwołują się już do usuniętych tras rejestracji ani do `PROTECTED_ROUTES`: `Get-ChildItem src,README.md,CLAUDE.md,AGENTS.md -Recurse -File | Select-String -Pattern 'auth/signup|confirm-email|SignUpForm|PROTECTED_ROUTES'` nie zwraca dopasowań
- [ ] 3.3 Skrypt tworzy planistę na lokalnym Supabase, a ponowne uruchomienie dla tego samego adresu kończy się kodem 0 bez zmian: `node scripts/create-planner.mjs smoke-planner@example.com` (z `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PLANNER_PASSWORD`)
- [ ] 3.4 Skrypt odrzuca hasło niespełniające reguł NFR przed wysłaniem żądania: `$env:PLANNER_PASSWORD = "weak"; node scripts/create-planner.mjs x@example.com` kończy się kodem niezerowym
- [ ] 3.5 Smoke przechodzi razem z krokami zamkniętej rejestracji: `npm run smoke`

#### Manual

- [ ] 3.6 Hostowany Supabase: opcja zezwalająca na rejestrację nowych użytkowników jest wyłączona, a `POST <SUPABASE_URL>/auth/v1/signup` z kluczem anon zwraca błąd (wykonuje autor)
- [ ] 3.7 Hostowany Supabase: pierwszy planista utworzony (lub istniejące konto awansowane) skryptem przed wdrożeniem; po ręcznym wdrożeniu loguje się na `https://shiftly.mto-astro.workers.dev` i widzi `/planner` (wykonuje autor)
- [ ] 3.8 Strona główna, logowanie i pasek górny nie zawierają już odnośników do rejestracji (przegląd wizualny)

### Phase 4: Warstwa bazy

#### Automated

- [ ] 4.1 Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- [ ] 4.2 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.3 Smoke z krokami RPC i próbą podrobienia roli przechodzi: `npm run smoke`

#### Manual

- [ ] 4.4 Migracja zastosowana na hostowanym projekcie przez autora (`npx supabase db push`) i widoczna jako zastosowana w `npx supabase migration list`
- [ ] 4.5 Wzorzec polityk RLS w komentarzu migracji jest czytelny i wystarczający dla S-01 (przegląd przez autora)
- [ ] 4.6 Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki RPC)
