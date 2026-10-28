# Employee roster Implementation Plan

## Overview

Dodajemy pierwszy wycinek domenowy Shiftly (S-01 z roadmapy, FR-001 i FR-003): planista dodaje pracownika (imię, nazwisko, opcjonalny e-mail, etat jako ułamek) i edytuje jego dane na liście `/employees`, dostępnej z panelu `/planner`. Pracownik istnieje bez konta, więc zaproszenia, hasła i powiązanie z kontem są poza zakresem (S-10). Dane trafiają do nowej tabeli `public.employees` z RLS tylko dla planisty. To pierwsza tabela z danymi osobowymi, więc ustawia wzorzec modelu danych, polityk i dostępu do danych dla kolejnych wycinków (S-02, S-03, S-10, S-11). Plan rozstrzyga też niewiadomą z roadmapy: wymagane są imię i nazwisko, e-mail jest opcjonalny.

## Current State Analysis

- Dostęp do nowych tras jest już załatwiony: `OPEN_PATHS` w `src/lib/services/access.ts:10-17` nie zawiera `/employees*` ani `/api/employees*`, więc reguła domyślna (`access.ts:44-56`) czyni je tylko dla planisty (401 dla anonima, 403 dla pracownika i konta bez roli, także dla `/api/*` w formie JSON, `src/middleware.ts:28-33`).
- Middleware tworzy klienta Supabase i woła `getUser()` (`src/middleware.ts:6-15`), ale klienta nie udostępnia: `Locals` ma tylko `user` i `role` (`src/env.d.ts:2-5`). Strona, która założy własnego klienta z ciasteczek żądania, po odświeżeniu tokenu w middleware przeczyta ciasteczko sprzed odświeżenia i odświeży je drugi raz.
- Baza nie ma tabel domenowych: jedyna migracja `supabase/migrations/20261020131134_role_helpers.sql` definiuje `public.current_app_role()` i `public.is_planner()` (`:6-33`) i zawiera wzorzec polityk RLS w komentarzu (`:35-57`). `supabase/config.toml:13` wystawia schemat `public` przez PostgREST, `:36` ustawia Postgres 17 (`gen_random_uuid()` jest wbudowane).
- `/planner` to placeholder z komentarzem, że S-01 zastąpi go nawigacją (`src/pages/planner/index.astro:4`); `/dashboard` linkuje do niego tylko dla planisty (`src/pages/dashboard.astro:24-30`).
- Brakuje elementów, których wymaga `CLAUDE.md`: `zod` nie ma w `package.json`, katalogu `src/components/hooks/` nie ma, `AGENTS.md:31` zapisuje to jako "not yet present". Formularz logowania to wyspa React z natywnym POST i przekierowaniem z `?error=` (`src/components/auth/SignInForm.tsx:12-87`); `SubmitButton` zależy od `useFormStatus` (`src/components/auth/SubmitButton.tsx:12`), które działa tylko z akcją formularza, nie z `fetch`.
- Smoke zakłada, że `/employees` daje planiście 404 (`scripts/smoke.mjs:256`), `request()` zna tylko ciało formularzowe (`:56-75`), a porównanie `json` działa wyłącznie dla wartości prostych przez `===` (`:295`). Klient PostgREST z tokenami (`accessToken`, `rpc`) już istnieje (`:120-148`), a migracje stosują się przy `supabase start` w CI (`.github/workflows/ci.yml:42`), na czym polega krok RPC z F-01.
- Testy: Vitest w workerd, pliki `src/**/*.test.ts` obok kodu, nigdy w `src/pages/` (`vitest.config.ts:17`, `AGENTS.md:25`); logika reguł jako czyste funkcje w `src/lib/services/` bez `astro:*`; `expectDeterministic` i `seededShuffle` w `src/lib/testing/determinism.ts:17,44`.
- Sprawdzone przed planem (jednorazowy test w workerd, usunięty): `Intl.Collator("pl")` układa polskie litery poprawnie (Cybulski, Ćma, Lis, Łukasz, Mak, Osiński, Ósmy, Sowa, Śliwa, Zając, Żak).
- Kontrola `checkOrigin` w Astro obejmuje wyłącznie żądania z typami `application/x-www-form-urlencoded`, `multipart/form-data` i `text/plain` (`node_modules/astro/dist/core/app/origin-check.js:3-5`); żądanie JSON z innej domeny wymaga preflightu CORS, którego aplikacja nie obsługuje.
- Decyzje nadrzędne: PRD FR-001 (konto opcjonalne) i FR-003; `work-time-rules.md` D4 (norma niepełnego etatu to norma pełna razy ułamek etatu, proporcja w jednym miejscu kodu); guardrail PRD "te same dane, ten sam wynik". `context/foundation/lessons.md` nie istnieje.

## Desired End State

- Planista wchodzi z `/dashboard` do `/planner`, stamtąd kafelkiem "Pracownicy" na `/employees`: widzi listę posortowaną po nazwisku, potem imieniu (polska kolejność liter), z kolumnami: nazwisko i imię, e-mail (lub "—"), etat (np. "1/2 etatu", "pełny etat"), odnośnik "Edytuj". Przycisk "Dodaj pracownika" prowadzi do `/employees/new`; `/employees/<id>` edytuje istniejącego.
- Formularz waliduje dane tą samą funkcją po stronie klienta i serwera i pokazuje błędy przy polach po polsku; zajęty e-mail zwraca błąd przy polu E-mail bez utraty wpisanych danych.
- Dane: imię i nazwisko wymagane (do 100 znaków), e-mail opcjonalny (małe litery, unikalny, do 254 znaków), etat jako ułamek `1 ≤ licznik ≤ mianownik ≤ 100` zapisany w postaci nieskracalnej (2/4 daje 1/2).
- Tabela `public.employees` ma RLS: planista czyta, dodaje i edytuje; pracownik, konto bez roli i anonim nie widzą ani nie zmieniają niczego; nikt przez API nie usuwa wierszy.
- Strony i trasy API używają jednego klienta Supabase na żądanie (`Astro.locals.supabase`) z sesją użytkownika, więc RLS egzekwuje dostęp; klucz service-role nie trafia do Workera.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, a smoke z nowymi krokami (baza przez PostgREST, API JSON, strony) przechodzi lokalnie i w CI.

### Key Discoveries:

- Reguła domyślna `decideAccess` chroni nowe trasy bez zmiany `OPEN_PATHS`; wystarczy dopisać je do testów domyślnej odmowy, żeby nikt nie otworzył ich przez przypadek.
- `Locals` nie niesie klienta Supabase (`src/env.d.ts:2-5`), a drugi klient na stronie odświeżałby token podwójnie, więc klient trafia do `locals` w middleware (jedna zmiana, korzystają wszystkie kolejne wycinki).
- Supabase nadaje domyślnie `anon` i `authenticated` wszystkie prawa do nowych tabel w `public` (tak samo jak dla funkcji, zob. komentarz `non-obvious` w `role_helpers.sql:28`). RLS bez polityki `delete` już blokuje usuwanie; jawny `revoke`/`grant` jest drugą warstwą, żeby przyszła pomyłkowa polityka nie otworzyła usuwania ani dostępu dla `anon`.
- Etat jako para liczb całkowitych daje S-06 dokładną normę (176 h × 1/3 = 58,67 h; zapis 33% dałby 58,08 h) i odpowiada polskiej mowie o etacie.
- `Intl.Collator("pl")` jest dostępny i poprawny w workerd, więc sortowanie może być czystą, testowalną funkcją w aplikacji, a nie zależeć od ustawień sortowania bazy.

## What We're NOT Doing

- Usuwania, blokowania ani archiwizowania pracowników: PRD parkuje blokowanie (FR-015), a FR-018 dotyczy grafików i zmian, nie pracowników. Konsekwencja: omyłkowo dodany pracownik zostaje na liście (można go edytować i użyć ponownie); autor usuwa go ręcznie w panelu Supabase, dopóki żaden wycinek nie doda tej funkcji. To dotyczy też pracownika, który odszedł z zespołu: zostaje na liście na stałe, a wycinki wybierające pracowników (S-03, S-05) będą go widzieć, dopóki nie dojdzie blokowanie (FR-015, zaparkowane); ryzyko jest w S-01 świadomie zaakceptowane. Uprawnienie `delete` jest odebrane w bazie, nie tylko pominięte w UI.
- Kont, zaproszeń, haseł i kolumny `user_id` (S-10), polityki "pracownik widzi własny wiersz" (S-11, dojdzie razem z `user_id`). Do tego czasu pracownik nie ma żadnego dostępu do tabeli.
- Historii etatu (daty obowiązywania): edycja zmienia bieżącą wartość. Zatwierdzone grafiki z S-08 nie mogą zmieniać norm wstecz po edycji etatu, więc S-06 i S-08 muszą zapisać normę lub wskazania w chwili zatwierdzenia; ten plan tylko to odnotowuje.
- Wyliczania norm godzin z etatu (S-06): kod zna ułamek, nie liczy godzin.
- Stronicowania, wyszukiwania, filtrów i przełączników sortowania (zespół do kilkudziesięciu osób), importu CSV, ostrzeżeń o tych samych imionach i nazwiskach (dwie osoby o tym samym nazwisku są normalne; unikalny jest tylko e-mail), wykrywania równoczesnych edycji (ostatni zapis wygrywa), kolumn audytowych i wyzwalaczy (`updated_at`).
- Zmian w `OPEN_PATHS`, w przekierowaniu po zalogowaniu (zostaje `/`) ani w `src/pages/dashboard.astro`.
- Generowanych typów bazy (`supabase gen types`): wystarczy ręczny typ `Employee` i jedna funkcja mapująca wiersz.
- Klucza service-role w Workerze, nowych zmiennych środowiskowych, nowych zasobów Cloudflare.
- Zmiany `lang="en"` w `src/layouts/Layout.astro:14`: nowe strony są po polsku jak `/access-denied` z F-01, a poprawka deklaracji języka dotyczy wszystkich stron naraz i należy do osobnej zmiany.
- Testów e2e w przeglądarce i testów jednostkowych hooka React (w repozytorium nie ma biblioteki do testowania komponentów); logika hooka jest cienka, a reguły żyją w czystych funkcjach.

## Implementation Approach

Od środka na zewnątrz, tak jak w F-01: najpierw czyste reguły (Faza 1), potem tabela z RLS dowiedziona na prawdziwych tokenach (Faza 2), potem warstwa dostępu do danych i API z wymuszeniem JSON (Faza 3), na końcu strony i formularz (Faza 4). Każda faza kończy się zielonym CI i własnym dowodem (testy jednostkowe, smoke przez PostgREST, smoke przez API, przegląd w przeglądarce), więc awaria wskazuje jedną warstwę. Fazy mogą trafić do jednego lub kilku PR; wdrożenie na produkcję dopiero po Fazie 4, z migracją przed kodem (zob. Migration Notes). Migracja jest addytywna, więc samo wdrożenie Fazy 2 niczego nie psuje.

Jedna funkcja `validateEmployeeInput` obsługuje formularz w przeglądarce i trasy API: te same reguły i komunikaty po obu stronach, a baza powtarza granice w ograniczeniach `check`, żeby wiersz zapisany z pominięciem aplikacji też je spełniał. Aplikacja normalizuje dane (spacje, małe litery e-maila, postać nieskracalna etatu), baza tylko pilnuje granic i unikalności.

## Critical Implementation Details

**State sequencing (wdrożenie na produkcję):** najpierw migracja (`npx supabase db push`), potem build i wdrożenie kodu. Odwrotna kolejność daje stronę `/employees` bez tabeli. Migracja jest addytywna (nowa tabela), więc `npx wrangler rollback` kodu pozostaje bezpieczny.

**Security:** trasy API przyjmują wyłącznie `Content-Type: application/json` i odpowiadają 415 na pozostałe. To druga warstwa obok `checkOrigin`: typy formularzowe, które przeglądarka wysyła z innej domeny bez preflightu, odrzuca już kontrola Astro, a żądanie JSON z innej domeny wymaga preflightu CORS, którego aplikacja nie obsługuje. Dzięki temu bezpieczeństwo nie zależy od jednej warstwy ani od konfiguracji `checkOrigin`. Dostęp do danych idzie zawsze przez klienta z sesją użytkownika (`Astro.locals.supabase`), nigdy przez klucz service-role, żeby RLS było jedyną bramką do wierszy.

## Phase 1: Reguły pracownika

### Overview

Dodać zależność `zod`, typy współdzielone oraz czyste funkcje: walidację z normalizacją, redukcję etatu, etykietę etatu i sortowanie listy, wraz z testami. Żadne zachowanie aplikacji się jeszcze nie zmienia.

### Changes Required:

#### 1. Zależność zod

**File**: `package.json`, `package-lock.json`

**Intent**: `CLAUDE.md` wymaga walidacji wejścia zod w trasach API; to pierwsze użycie.

**Contract**: `npm install zod` jako zależność produkcyjną (`^4.6.7`, stan rejestru npm z 2026-10-21); zmieniają się wyłącznie te dwa pliki.

#### 2. Typy współdzielone

**File**: `src/types.ts`

**Intent**: Miejsce typów encji i DTO wymagane przez `CLAUDE.md`; dochodzą typy pracownika obok istniejącego `Role`.

**Contract**: `Fte { numerator: number; denominator: number }` (zawsze w postaci nieskracalnej); `EmployeeInput { firstName: string; lastName: string; email: string | null; fte: Fte }`; `Employee extends EmployeeInput { id: string; createdAt: string }` (`createdAt` to ISO z bazy); `EmployeeField = "firstName" | "lastName" | "email" | "fte"`; `EmployeeFieldErrors = Partial<Record<EmployeeField, string>>`.

#### 3. Reguły pracownika

**File**: `src/lib/services/employee.ts` (nowy)

**Intent**: Jedno źródło prawdy o tym, co jest poprawnym pracownikiem i jak go wyświetlić i uporządkować, jako czyste funkcje bez importów `astro:*` i `cloudflare:workers`, używane przez formularz, trasy API i testy.

**Contract**: Wyeksportowane stałe granic (`NAME_MAX_LENGTH = 100`, `EMAIL_MAX_LENGTH = 254`, `FTE_DENOMINATOR_MAX = 100`), z których korzysta też formularz. Funkcje:

- `validateEmployeeInput(raw: unknown): { ok: true; value: EmployeeInput } | { ok: false; errors: EmployeeFieldErrors }`. Wejście to obiekt z kluczami `firstName`, `lastName`, `email`, `fteNumerator`, `fteDenominator` (liczby lub ciągi cyfr; brak, `null` i niebędący obiektem argument traktowane jak puste pola). Zwraca wszystkie błędne pola naraz, jeden komunikat po polsku na pole. Imię i nazwisko: bez znaków sterujących (`\p{Cc}`, także tabulator i znak nowej linii), sprawdzanych na surowym wejściu przed przycięciem i zwinięciem białych znaków; dalej przycięte, ciągi białych znaków zwinięte do jednej spacji, 1 do 100 znaków (dozwolone m.in. `Nowak-Kowalska`, `O'Brien`, `Łukasz`). E-mail: pusty lub same białe znaki daje `null`; w przeciwnym razie przycięty, zapisany małymi literami, do 254 znaków i poprawny wg `z.email()`. Etat: licznik i mianownik to liczby całkowite (cyfry bez znaku, kropki i wykładnika), `1 ≤ licznik ≤ mianownik ≤ 100` sprawdzane przed skróceniem, wynik skrócony przez największy wspólny dzielnik; jeden komunikat dla całej pary.
- `reduceFte(fte: Fte): Fte` (skracanie ułamka).
- `formatFteLabel(fte: Fte): string`: `"pełny etat"` dla 1/1, w pozostałych przypadkach `"<licznik>/<mianownik> etatu"` (np. `"3/4 etatu"`).
- `sortEmployees(employees: readonly Employee[]): Employee[]`: nowa tablica (wejście nie jest zmieniane), klucze: nazwisko, imię (jeden `Intl.Collator("pl")`), potem `createdAt` rosnąco (porównanie przez `Date.parse`, nie jako tekst), na końcu `id`. Wynik nie zależy od kolejności wejścia.

#### 4. Testy reguł

**File**: `src/lib/services/employee.test.ts` (nowy), `src/lib/services/access.test.ts`

**Intent**: Udowodnić granice, normalizację i powtarzalność oraz zablokować ewentualne przypadkowe otwarcie nowych tras.

**Contract**: Przypadki (nazwane): (a) poprawne dane są normalizowane (spacje, małe litery e-maila, pusty e-mail jako `null`, 2/4 jako 1/2, ten sam wynik dla liczb i ciągów cyfr); (b) granice etatu: 1/1 i 1/100 poprawne, 100/100 daje 1/1, odrzucone 0/2, 3/2, 1/101, 1/0, `"1.5"`/2, `"-1"`/2, `"1e1"`/2, puste, brak, `NaN`, `Infinity`; (c) e-mail: `Anna@Firma.pl` daje `anna@firma.pl`, odrzucone `anna`, `a@b`, `a b@c.pl` i adres dłuższy niż 254 znaki, same spacje to `null`; (d) imiona i nazwiska: puste, same spacje, ponad 100 znaków i znak sterujący (także `Jan\tKowalski` z tabulatorem w środku) odrzucone, `Nowak-Kowalska`, `O'Brien`, `Łukasz` przyjęte, podwójna spacja zwinięta; (e) wszystkie błędne pola zwracane razem, argument niebędący obiektem daje błędy pól wymaganych; (f) kolejność polska (`Cybulski`, `Ćma`, `Lis`, `Łukasz`, `Mak`, `Osiński`, `Ósmy`, `Sowa`, `Śliwa`, `Zając`, `Żak`), nazwisko przed imieniem (`Kowalski Anna` przed `Kowalski Jan`), dwie osoby o tym samym imieniu i nazwisku uporządkowane po `createdAt`, a przy równym `createdAt` po `id`, w tym `createdAt` o różnej liczbie cyfr ułamka sekundy; (g) powtarzalność: `expectDeterministic(sortEmployees, lista, { variants })` z permutacjami z `seededShuffle`, wejście niezmienione po sortowaniu, to samo dla `validateEmployeeInput`; (h) `reduceFte` i `formatFteLabel` (pełny etat, `1/2 etatu`). W `access.test.ts` lista domyślnej odmowy (`decideAccess default deny`) dostaje `/employees/new`, `/employees/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90`, `/api/employees`, `/api/employees/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90`.

### Success Criteria:

#### Automated Verification:

- Testy reguł pracownika i polityki dostępu przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`
- Zależność zod jest zadeklarowana: `Select-String -Path package.json -Pattern '"zod"'` zwraca dopasowanie

#### Manual Verification:

- Komunikaty błędów po polsku i granice etatu (1 ≤ licznik ≤ mianownik ≤ 100) zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Tabela employees i RLS

### Overview

Dodać migrację z tabelą `public.employees`, ograniczeniami zgodnymi z regułami z Fazy 1 i politykami RLS tylko dla planisty, a w smoke udowodnić przez PostgREST, na prawdziwych tokenach, że planista czyta, dodaje i edytuje, a pracownik, konto bez roli i anonim nie mają dostępu i nikt nie usuwa wierszy.

### Changes Required:

#### 1. Migracja tabeli

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_employees.sql` (nowy; znacznik czasu z chwili utworzenia, późniejszy niż `20261020131134`)

**Intent**: Tabela pracowników jako pierwszy zastosowany wzorzec RLS z komentarza w `role_helpers.sql:35-57`, z ograniczeniami powtarzającymi granice aplikacji i uprawnieniami ściśle takimi, jakich używa aplikacja.

**Contract**: `public.employees`: `id uuid primary key default gen_random_uuid()`, `first_name text not null`, `last_name text not null`, `email text` (puste dozwolone), `fte_numerator smallint not null`, `fte_denominator smallint not null`, `created_at timestamptz not null default now()`. Nazwane ograniczenia: `employees_first_name_valid` i `employees_last_name_valid` (wartość równa swojemu `btrim` i `char_length` od 1 do 100), `employees_email_valid` (`email is null` albo równy `lower(btrim(email))` i `char_length` od 1 do 254), `employees_email_key unique (email)` (wiele wartości `null` jest dozwolone), `employees_fte_valid` (`fte_denominator between 1 and 100` i `fte_numerator between 1 and fte_denominator`). Baza nie wymusza postaci nieskracalnej ani zwijania spacji w środku (to normalizacja aplikacji). `enable row level security` oraz trzy polityki dla `authenticated` według wzorca F-01, każda z `(select public.is_planner())`: `planner can select employees` (`select`), `planner can insert employees` (`with check`), `planner can update employees` (`using` i `with check`). Brak polityki `delete`. Komentarz na końcu: polityka "pracownik widzi własny wiersz" dojdzie razem z kolumną `user_id` w S-10 i S-11. Uprawnienia (kod niewidoczny na ścieżce plików):

```sql
-- non-obvious: Supabase default privileges give anon and authenticated every right on a new public table
revoke all on table public.employees from anon, authenticated;
grant select, insert, update on table public.employees to authenticated;
```

#### 2. Smoke: baza przez PostgREST

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić po stronie bazy to samo, co F-01 sprawdza dla funkcji roli, ale dla danych: kto widzi i zmienia wiersze, na prawdziwych tokenach.

**Contract**: Pomocnik wysyłający żądania do `{SUPABASE_URL}/rest/v1/employees` z `apikey` = anon i `Authorization: Bearer <token>` (ponowne użycie `accessToken`, `:120-133`; bez tokenu sam klucz anon). Runner dostaje oczekiwanie `check` (predykat `expected.check(parsedBody) => boolean`; w komunikacie błędu wypisywane jest `got`), bo tablica `steps` ma statyczne `expected`, a wiersz z bazy zawiera losowe `id` i `created_at`, więc równość JSON wyrazi tylko `[]`; dziś `json` działa tylko dla wartości prostych, `:295`. Kroki dzielą id utworzonego wiersza przez zmienną w zasięgu skryptu (odczytywaną w `run`, nie w `expected`). Oczekiwania: planista dodaje wiersz (`Prefer: return=representation`) i dostaje go z powrotem; ten sam adres e-mail dodany drugi raz jest odrzucony (kod 409); adres z wielkimi literami odrzucony przez `employees_email_valid` (status spoza 2xx); etat 3/2 odrzucony (spoza 2xx); planista edytuje etat (PATCH) i odczyt pokazuje nową wartość; DELETE planisty odrzucony (spoza 2xx), a wiersz nadal istnieje. Pracownik i konto bez roli: odczyt zwraca `[]` (status 200), dodanie odrzucone (spoza 2xx), PATCH nie zmienia wiersza (potwierdza ponowny odczyt planisty), DELETE odrzucony. Anonim (sam klucz anon): odczyt odrzucony (spoza 2xx). Brak twardego oczekiwania konkretnego kodu tam, gdzie PostgREST może odpowiedzieć 200 z pustą listą albo 4xx; dowodem jest skutek (wiersz niezmieniony, lista pusta). Wiersze smoke mają unikalne dane z `runId` (e-mail `Smoke-<runId>@Example.com`, nazwisko z tym samym `runId`; ten sam wzorzec w Fazach 3 i 4), a ostatni krok przebiegu usuwa je kluczem service-role (`DELETE /rest/v1/employees?email=like.smoke-*`; service-role zachowuje uprawnienia, bo migracja odbiera je tylko `anon` i `authenticated`). Dzięki temu kolejny lokalny przebieg bez `db reset` nie kończy się 409, a lista w aplikacji wraca do stanu sprzed smoke.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- Linting przechodzi: `npm run lint`
- Smoke z krokami bazy przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos (wartości z `supabase status -o env`), ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z tego stosu): `npm run smoke`

#### Manual Verification:

- Migracja zastosowana na hostowanym projekcie przez autora (`npx supabase db push`) i widoczna jako zastosowana w `npx supabase migration list`
- Polityki RLS i uprawnienia w migracji zostały przejrzane przez autora jako wzorzec dla kolejnych tabel
- Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki bazy)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Dostęp do danych i API

### Overview

Udostępnić klienta Supabase przez `Astro.locals`, dodać funkcje odczytu i zapisu pracowników oraz dwie trasy API z walidacją, kodami odpowiedzi i wymuszeniem JSON, a smoke rozszerzyć o kroki API.

### Changes Required:

#### 1. Klient Supabase w locals

**File**: `src/env.d.ts`, `src/middleware.ts`

**Intent**: Jeden klient na żądanie dla middleware, stron i tras API, żeby token nie był odświeżany dwa razy i żeby wszystkie zapytania szły na sesji użytkownika (RLS).

**Contract**: `Locals` zyskuje `supabase: import("@supabase/supabase-js").SupabaseClient | null`. Middleware ustawia `context.locals.supabase` na klienta utworzonego na początku `onRequest` (`src/middleware.ts:6`), przed decyzją o dostępie; `null`, gdy zmienne środowiskowe nie są ustawione, jak dziś dla użytkownika. Istniejące trasy `signin` i `signout` zostają bez zmian (zakładają własnych klientów).

#### 2. Funkcje dostępu do danych

**File**: `src/lib/employees.ts` (nowy)

**Intent**: Jedyne miejsce, które zna nazwy kolumn tabeli i mapuje wiersz bazy na `Employee`; strony i trasy API nie piszą zapytań same.

**Contract**: Funkcje przyjmują `SupabaseClient` jako pierwszy argument (import wyłącznie typu, bez `astro:*`). `listEmployees(supabase): Promise<Employee[]>` zwraca wynik `sortEmployees`; `getEmployee(supabase, id): Promise<Employee | null>`; `createEmployee(supabase, input: EmployeeInput)` i `updateEmployee(supabase, id, input)` zwracają `{ ok: true; employee: Employee } | { ok: false; error: "email_taken" | "not_found" | "failed" }` (`not_found` tylko dla aktualizacji). Odczyty rzucają `Error` przy awarii bazy (strona kończy się statusem 500). Każda awaria bazy (rzucony odczyt i wynik `failed`) jest logowana przez `console.error` z samym `code` i `message` błędu PostgREST, bez danych wejściowych (dane osobowe), ze świadomym wyjątkiem lintu `no-console` (komentarz `eslint-disable-next-line`); logi widać w `wrangler tail`. `id` niebędący UUID daje `null` albo `not_found` bez zapytania (inaczej Postgres odpowiada błędem 22P02). Kod błędu bazy `23505` oznacza zajęty e-mail (to jedyne ograniczenie unikalności poza kluczem głównym). Aktualizacja bez widocznego wiersza (brak id albo ukryty przez RLS) to `not_found`. Wybierane są jawne kolumny `id, first_name, last_name, email, fte_numerator, fte_denominator, created_at`.

#### 3. Trasy API

**File**: `src/pages/api/employees/index.ts` (nowy, `POST`), `src/pages/api/employees/[id].ts` (nowy, `PUT`)

**Intent**: Przyjąć dane z formularza jako JSON, zwalidować `validateEmployeeInput` i zapisać przez `src/lib/employees.ts`, z przewidywalnymi kodami odpowiedzi.

**Contract**: Obie trasy eksportują `prerender = false`; dostęp rozstrzyga bramka (planner-only z reguły domyślnej, odpowiedzi 401 i 403 w JSON jak dziś). Każda odpowiedź ma `content-type: application/json` i `cache-control: no-store`. Kolejność sprawdzeń i kody:

| Sytuacja | Odpowiedź |
| --- | --- |
| `Content-Type` inny niż `application/json` | 415 `{ "error": "unsupported_media_type" }` |
| Ciało niebędące poprawnym JSON | 400 `{ "error": "invalid_json" }` |
| `locals.supabase` jest `null` | 503 `{ "error": "not_configured" }` |
| `PUT` z `id` niebędącym UUID albo nieistniejącym | 404 `{ "error": "not_found" }` |
| Walidacja nie przechodzi | 422 `{ "errors": EmployeeFieldErrors }` |
| Zajęty e-mail | 409 `{ "errors": { "email": "Ten adres e-mail jest już przypisany do innego pracownika." } }` |
| Sukces `POST` | 201 `{ "employee": Employee }` |
| Sukces `PUT` | 200 `{ "employee": Employee }` |
| Inna awaria zapisu | 500 `{ "error": "failed" }` |

`PUT` wymaga wszystkich pól (pełna zamiana), tak jak wysyła je formularz.

#### 4. Smoke: API

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić trasy na działającej aplikacji, razem z bramką i kodami odpowiedzi, na prawdziwych kontach.

**Contract**: `request()` dostaje opcję `json` (nagłówek `Content-Type: application/json`, ciało `JSON.stringify`). Kroki: planista `POST /api/employees` z poprawnymi danymi (imię i nazwisko z polskimi literami, e-mail z wielkimi literami, etat 2/4) daje 201, a ciało zawiera e-mail małymi literami i etat `numerator: 1`, `denominator: 2`; ten sam e-mail w innej wielkości liter daje 409; niepoprawne dane (etat 3/2, puste nazwisko) dają 422 z błędami pól; `POST` z ciałem formularzowym (urlencoded) daje 415; `PUT /api/employees/<id>` zmienia etat i daje 200; `PUT` dla nieistniejącego UUID i dla `not-a-uuid` daje 404. Pracownik: `POST` i `PUT` dają 403 z JSON. Anonim: `POST /api/employees` daje 401 z JSON. Kroki API planisty wykonują się między `signIn(planner)` a `signOut(planner)` (`:252-257`), bo używają sesji z ciasteczek.

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami API przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`

#### Manual Verification:

- Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki API)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Strony planisty

### Overview

Zbudować wspólny układ planisty i panel `/planner`, listę `/employees` oraz formularze dodawania i edycji (wyspa React z hookiem), zaktualizować smoke o kroki stron i opisać nowy model w dokumentacji.

### Changes Required:

#### 1. Układ planisty i panel

**File**: `src/layouts/PlannerLayout.astro` (nowy), `src/pages/planner/index.astro`

**Intent**: Wspólna rama stron planisty (nagłówek z odnośnikiem powrotnym do panelu, adresem e-mail, wylogowaniem) i prawdziwy panel w miejsce placeholdera z F-01.

**Contract**: `PlannerLayout` opakowuje `Layout`, przyjmuje `title: string` i `showBackLink?: boolean` (domyślnie `true`), treść po polsku, styl zgodny z istniejącymi stronami (`bg-cosmic`, karty `border-white/10 bg-white/10`); wylogowanie to `POST /api/auth/signout`. `/planner` pokazuje nagłówek "Panel planisty" (ten tekst sprawdza smoke dla `//planner`, więc zostaje), kafelek "Pracownicy" z odnośnikiem do `/employees` i krótkim opisem, bez odnośnika powrotnego; komentarz placeholdera znika.

#### 2. Lista pracowników

**File**: `src/pages/employees/index.astro` (nowy)

**Intent**: Pokazać, kto jest w zespole i na jakim etacie, z drogą do dodania i edycji.

**Contract**: Dane z `listEmployees(Astro.locals.supabase)`; gdy klienta brak (niemożliwe po bramce), strona kończy się błędem 500. Nagłówek z liczbą pracowników, przycisk "Dodaj pracownika" (`/employees/new`), a na szerokim ekranie tabela, na wąskim (telefon) ułożone karty, z polami: nazwisko i imię (w tej kolejności, zgodnie z sortowaniem), e-mail albo "—", `formatFteLabel`, odnośnik "Edytuj" do `/employees/<id>`. Pusta lista pokazuje komunikat "Nie dodano jeszcze żadnego pracownika." Odpowiedź ma `Cache-Control: no-store` (dane osobowe).

#### 3. Dodawanie i edycja

**File**: `src/pages/employees/new.astro`, `src/pages/employees/[id].astro` (nowe), `src/components/employees/EmployeeForm.tsx` (nowy), `src/components/hooks/useEmployeeForm.ts` (nowy), `src/components/auth/FormField.tsx` (zmiana addytywna)

**Intent**: Formularz, który waliduje tą samą funkcją co serwer, pokazuje błędy przy polach i zachowuje wpisane dane po odmowie serwera.

**Contract**: Strony renderują `EmployeeForm` jako wyspę `client:load` w `PlannerLayout`; `[id].astro` waliduje UUID, pobiera `getEmployee` i dla nieistniejącego pracownika albo `id` niebędącego UUID ustawia status 404 i pokazuje komunikat "Nie znaleziono pracownika" z odnośnikiem do listy (projekt nie ma strony 404). Statyczna trasa `/employees/new` ma pierwszeństwo przed `[id]`. `[id].astro` (imię, nazwisko i e-mail pracownika) ustawia `Cache-Control: no-store` jak lista, a `new.astro` dla spójności. `useEmployeeForm({ employee? })` zwraca wartości pól jako ciągi, błędy pól, błąd serwera, stan oczekiwania i funkcje `setField`/`submit`; `submit` waliduje `validateEmployeeInput` i przy braku błędów wysyła `fetch` JSON (`POST /api/employees` albo `PUT /api/employees/<id>`), po 201 i 200 przechodzi na `/employees`, przy 409 i 422 przenosi `errors` do pól, przy 401 i 403 pokazuje "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.", przy pozostałych kodach i błędach sieci "Nie udało się zapisać. Spróbuj ponownie."; podczas oczekiwania przycisk jest wyłączony (brak podwójnego zapisu). Formularz: Imię, Nazwisko, E-mail (podpowiedź: "Opcjonalny. Potrzebny dopiero do zaproszenia do konta."), Etat jako dwa pola liczbowe licznik i mianownik pod jedną etykietą i jednym komunikatem błędu (nowy pracownik zaczyna od 1/1, podpowiedź "np. 1/1 to pełny etat, 1/2 to pół etatu"), długości z `NAME_MAX_LENGTH` i `EMAIL_MAX_LENGTH`, przycisk "Zapisz" i odnośnik "Anuluj". Ponownie używa `FormField` bez przenoszenia, rozszerzonego addytywnie o opcjonalne `maxLength` i `inputMode` oraz opcjonalne `icon` (dotychczasowy konsument, `SignInForm`, działa bez zmian). Pole Etat nie przechodzi przez `FormField` (renderuje on jeden `<input>`), tylko jest osobną kompozycją w `EmployeeForm.tsx`: dwa pola liczbowe, wspólna etykieta i wspólny komunikat błędu. Zamiast `SubmitButton` używa `Button` z `@/components/ui/button` (ten zależy od `useFormStatus`, które nie działa z `fetch`).

#### 4. Smoke: strony

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić strony planisty i bramkę dla stron danych na prawdziwych kontach.

**Contract**: `visit()` dostaje oczekiwanie `bodyIncludes`. Zmiany: krok `visit(planner, "/employees", 404)` (`:256`) staje się 200 z nazwiskiem utworzonego wcześniej pracownika w treści, `/planner` planisty zawiera "Pracownicy"; planista: `/employees/new` 200, `/employees/<id>` 200 (formularz z danymi), `/employees/<nieistniejący UUID>` i `/employees/not-a-uuid` 404; pracownik: `/employees/new` i `/employees/<id>` 403; anonim: `/employees/new` 401. Kroki stron planisty wykonują się przed jego wylogowaniem.

#### 5. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Opisać nowy model: dostęp do danych przez `locals.supabase` z RLS, walidację zod, hooki, nowe trasy i zakres smoke.

**Contract**: `CLAUDE.md`: w Architecture krótka reguła "dostęp do danych przez `Astro.locals.supabase` (sesja użytkownika, RLS), funkcje zapytań w `src/lib/`, walidacja wejścia jedną funkcją współdzieloną przez formularz i trasę (wzorzec `validateEmployeeInput`)" oraz w Commands zakres smoke (baza, API, strony pracowników). `AGENTS.md`: usunąć z linii 31 "hooks" i "zod" z listy "not yet present", dopisać `src/layouts/PlannerLayout.astro`, `src/pages/employees/`, `src/components/employees/` i `src/components/hooks/` do Project Structure. `README.md`: tabela tras (okolice `README.md:150-157`) dostaje `/planner`, `/employees`, `/employees/new`, `/employees/[id]`, `/api/employees`, `/api/employees/[id]`, a opis smoke wzmiankę o danych pracowników.

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami stron przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`
- Placeholder z F-01 został usunięty: `Get-ChildItem src -Recurse -File | Select-String -Pattern 'Placeholder behind'` nie zwraca dopasowań

#### Manual Verification:

- Przeglądarka, planista: `/dashboard` → `/planner` → kafelek "Pracownicy" → pusta lista z komunikatem (na bazie bez wierszy smoke: po jego sprzątaniu albo po `npx supabase db reset`); dodanie pracownika z etatem 2/4 pokazuje na liście "1/2 etatu"; dodani Ćma, Cybulski, Żak i Zając są w polskiej kolejności; edycja zmienia etat; zajęty e-mail w innej wielkości liter pokazuje błąd przy polu E-mail i zachowuje pozostałe wpisane dane
- Telefon (szerokość około 375 px w narzędziach przeglądarki): lista i formularz są czytelne bez poziomego przewijania
- Przeglądarka, pracownik i anonim: `/employees` pokazuje "Brak dostępu" (403 dla pracownika, 401 dla anonima, bez przekierowania)
- Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`)
- Po ręcznym wdrożeniu (migracja przed kodem, zob. Migration Notes) planista na `https://shiftly.mto-astro.workers.dev` dodaje i edytuje pracownika (wykonuje autor)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `employee.test.ts`: normalizacja i granice walidacji (imię, nazwisko, e-mail, etat), skracanie i etykieta etatu, polska kolejność liter, remisy (to samo imię i nazwisko: `createdAt`, potem `id`), niezależność wyniku od kolejności wejścia (`expectDeterministic` z permutacjami), niemutowanie wejścia.
- `access.test.ts`: nowe trasy pracowników są tylko dla planisty (domyślna odmowa).

### Integration Tests:

- Smoke w CI (lokalny Supabase): RLS tabeli na tokenach planisty, pracownika, konta bez roli i anonima (PostgREST), kody odpowiedzi tras API (201, 200, 404, 409, 415, 422, 401, 403) oraz status stron planisty i odmów dla pozostałych aktorów.

### Manual Testing Steps:

1. Jako planista dodać, edytować i obejrzeć pracowników na komputerze i w szerokości telefonu, w tym przypadek zajętego e-maila i pracownika bez e-maila.
2. Jako pracownik i anonim otworzyć `/employees` i `/employees/new` i sprawdzić status oraz brak przekierowania.
3. Po wdrożeniu wykonać kroki z "Migration Notes" w podanej kolejności i powtórzyć krok 1 na produkcji.

## Performance Considerations

Strona listy to jedno zapytanie do PostgREST na żądanie (obok `getUser()` w middleware), bez stronicowania dla zespołu do kilkudziesięciu osób; sortowanie i walidacja to proste operacje w pamięci. Walidator z `zod` trafia do paczki wyspy formularza (kilkanaście kB po kompresji), co jest akceptowane w zamian za jedną definicję reguł po obu stronach. Środowisko testowe workerd nie egzekwuje limitu 10 ms CPU z planu Workers Free, więc pomiar na wdrożeniu zostaje poza tą zmianą (jak w F-01).

## Migration Notes

Kolejność wdrożenia na produkcję (wykonuje autor): (1) `npx supabase db push` (nowa tabela, bez wpływu na obecny kod), (2) `npm run build` i `npx wrangler deploy`. Tabela startuje pusta; pierwsi pracownicy powstają z poziomu aplikacji. Wycofanie: `npx wrangler rollback` cofa kod, tabela zostaje nieszkodliwie; usunięcie samej tabeli wymaga nowej migracji, nie edycji istniejącej. Omyłkowo dodanego pracownika autor usuwa w panelu Supabase (Table Editor) albo SQL-em z rolą administracyjną, bo przez aplikację i API nie da się go usunąć.

## References

- Roadmapa: `context/foundation/roadmap.md` (S-01, `employee-roster`; niewiadoma "jakie dane pracownika są wymagane" rozstrzygnięta w tym planie)
- PRD: `context/foundation/prd.md` (FR-001, FR-003, Access Control, NFR: pracownik widzi wyłącznie własne dane, Guardrails: powtarzalność) oraz `context/foundation/shape-notes.md`
- Etat jako ułamek: `context/foundation/work-time-rules.md` (D4, przykłady norm 176 h / 168 h)
- Poprzednia zmiana: `context/archive/2026-10-20-role-based-access/plan.md` (wzorzec bramki, migracji, smoke i faz) oraz `supabase/migrations/20261020131134_role_helpers.sql` (wzorzec RLS)
- Obecny kod: `src/lib/services/access.ts`, `src/middleware.ts`, `src/env.d.ts`, `src/components/auth/SignInForm.tsx`, `src/components/auth/FormField.tsx`, `scripts/smoke.mjs`, `src/lib/testing/determinism.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguły pracownika

#### Automated

- [x] 1.1 Testy reguł pracownika i polityki dostępu przechodzą w workerd: `npm test` — 4d9016c
- [x] 1.2 Linting przechodzi: `npm run lint` — 4d9016c
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 4d9016c
- [x] 1.4 Zależność zod jest zadeklarowana: `Select-String -Path package.json -Pattern '"zod"'` zwraca dopasowanie — 4d9016c

#### Manual

- [x] 1.5 Komunikaty błędów po polsku i granice etatu (1 ≤ licznik ≤ mianownik ≤ 100) zostały przejrzane i zatwierdzone przez autora — 4d9016c

### Phase 2: Tabela employees i RLS

#### Automated

- [x] 2.1 Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- [x] 2.2 Linting przechodzi: `npm run lint`
- [x] 2.3 Smoke z krokami bazy przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos (wartości z `supabase status -o env`), ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z tego stosu): `npm run smoke`

#### Manual

- [x] 2.4 Migracja zastosowana na hostowanym projekcie przez autora (`npx supabase db push`) i widoczna jako zastosowana w `npx supabase migration list`
- [x] 2.5 Polityki RLS i uprawnienia w migracji zostały przejrzane przez autora jako wzorzec dla kolejnych tabel
- [ ] 2.6 Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki bazy)

### Phase 3: Dostęp do danych i API

#### Automated

- [ ] 3.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 3.2 Smoke z krokami API przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`

#### Manual

- [ ] 3.3 Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki API)

### Phase 4: Strony planisty

#### Automated

- [ ] 4.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.2 Smoke z krokami stron przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`
- [ ] 4.3 Placeholder z F-01 został usunięty: `Get-ChildItem src -Recurse -File | Select-String -Pattern 'Placeholder behind'` nie zwraca dopasowań

#### Manual

- [ ] 4.4 Przeglądarka, planista: `/dashboard` → `/planner` → kafelek "Pracownicy" → pusta lista z komunikatem (na bazie bez wierszy smoke: po jego sprzątaniu albo po `npx supabase db reset`); dodanie pracownika z etatem 2/4 pokazuje na liście "1/2 etatu"; dodani Ćma, Cybulski, Żak i Zając są w polskiej kolejności; edycja zmienia etat; zajęty e-mail w innej wielkości liter pokazuje błąd przy polu E-mail i zachowuje pozostałe wpisane dane
- [ ] 4.5 Telefon (szerokość około 375 px w narzędziach przeglądarki): lista i formularz są czytelne bez poziomego przewijania
- [ ] 4.6 Przeglądarka, pracownik i anonim: `/employees` pokazuje "Brak dostępu" (403 dla pracownika, 401 dla anonima, bez przekierowania)
- [ ] 4.7 Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`)
- [ ] 4.8 Po ręcznym wdrożeniu (migracja przed kodem, zob. Migration Notes) planista na `https://shiftly.mto-astro.workers.dev` dodaje i edytuje pracownika (wykonuje autor)
