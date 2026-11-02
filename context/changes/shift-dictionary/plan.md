# Shift dictionary Implementation Plan

## Overview

Drugi wycinek domenowy Shiftly (S-02 z roadmapy, FR-013): planista definiuje zmiany we wspólnym słowniku (nazwa, godzina rozpoczęcia, godzina zakończenia) i edytuje je na liście `/shifts`, dostępnej z panelu `/planner`. Zmiany będą potem wybierane w grafikach (S-03), a ich godziny zasilą reguły odpoczynku i limitów (S-05). Dane trafiają do nowej tabeli `public.shifts` z RLS tylko dla planisty. Plan powiela architekturę S-01 (reguły jako czyste funkcje, tabela z RLS dowiedziona w smoke, warstwa danych, trasy JSON, strony z wyspą React) i rozstrzyga niewiadomą z roadmapy o zmianach przechodzących przez północ: koniec wcześniejszy niż początek oznacza następny dzień, a koniec równy początkowi jest odrzucany.

## Current State Analysis

- Dostęp do nowych tras jest już załatwiony: `OPEN_PATHS` w `src/lib/services/access.ts` nie zawiera `/shifts*` ani `/api/shifts*`, więc reguła domyślna czyni je tylko dla planisty (401 dla anonima, 403 dla pracownika i konta bez roli, także dla `/api/*` w formie JSON). Lista domyślnej odmowy w teście to `src/lib/services/access.test.ts:153-168`.
- S-01 dostarczyło wzorzec do powielenia: czyste reguły `src/lib/services/employee.ts` (walidacja `:86`, sortowanie `:125`), warstwa danych `src/lib/employees.ts` (funkcje `:74-119`), `jsonResponse` i `readJsonBody` w `src/lib/json-response.ts:4,15`, trasy `src/pages/api/employees/index.ts` i `[id].ts`, `src/layouts/PlannerLayout.astro`, strony `src/pages/employees/*`, wyspa `src/components/employees/EmployeeForm.tsx` (145 linii) z hookiem `src/components/hooks/useEmployeeForm.ts` (96 linii) i `FormField` z opcjonalnymi `icon`, `maxLength`, `inputMode`. Klient Supabase na sesji użytkownika jest w `Astro.locals.supabase` (`src/middleware.ts`).
- Z `src/lib/employees.ts` trzeba wydzielić trzy drobne elementy współdzielone: `isUuid` (`:29`, importowane też przez `src/pages/api/employees/[id].ts`) i `logDatabaseError` (`:55`, z prefiksem `employees` w komunikacie). `UNIQUE_VIOLATION` (`:9`) zostaje lokalnie, bo słownik zmian nie ma ograniczenia unikalności.
- Baza ma dwie migracje: `supabase/migrations/20261020131134_role_helpers.sql` (funkcje `public.is_planner()` i `public.current_app_role()`) oraz `20261028085831_employees.sql` (wzorzec tabeli: ograniczenia `check` nazwane `<tabela>_<pole>_valid`, trzy polityki planisty bez `delete`, `revoke`/`grant` z komentarzem `-- non-obvious:`).
- Smoke `scripts/smoke.mjs` (668 linii) ma pomocnika `employeesTable` (`:161`), predykat `check` z opisem (`describe`), oczekiwania `bodyIncludes` i `cacheControl`, opcję `jsonText` w `request()`, dane z `runId` i ostatni krok sprzątający service-role (`:625-629`, `DELETE /rest/v1/employees?email=like.smoke-*`). Kroki planisty API i stron wykonują się między `signIn(planner)` (`:436`) a `signOut(planner)` (`:537`), kroki bazy w regionie po `rpcStep(planner, ...)` (`:542`).
- Panel `/planner` (`src/pages/planner/index.astro:9-17`) ma jeden kafelek w siatce `sm:grid-cols-2`; drugi kafelek dołoży się obok.
- Dokumentacja do aktualizacji: `CLAUDE.md` (sekcja `### Data access`, punkt o stronach pracowników w `:39`), `AGENTS.md:15` (Project Structure), `README.md` (tabela tras od `:151`, opis migracji w `:115`, opis smoke).
- Dziedzina: `context/foundation/work-time-rules.md` liczy dobę od godziny rozpoczęcia pracy (art. 128 § 3), uznaje limit 8 godzin na dobę za regułę MVP z komunikatem, że systemy równoważne nie są obsługiwane (D3), a interpretację doby przy zmianach przechodzących przez północ zostawia do potwierdzenia na przykładach. PRD (FR-013) wymaga, żeby edycja zmiany nie zmieniała po cichu zatwierdzonych grafików. `context/foundation/lessons.md` nie istnieje.

## Desired End State

- Planista wchodzi z `/planner` kafelkiem "Zmiany" na `/shifts`: widzi listę posortowaną chronologicznie po godzinie rozpoczęcia (potem nazwa w polskiej kolejności), z kolumnami: nazwa, godziny (np. `22:00–06:00` ze znacznikiem "następnego dnia" przy zmianach przechodzących przez północ), czas trwania (np. `8 h`), odnośnik "Edytuj". Przycisk "Dodaj zmianę" prowadzi do `/shifts/new`; `/shifts/<id>` edytuje istniejącą.
- Formularz waliduje dane tą samą funkcją po stronie klienta i serwera, pokazuje błędy przy polach po polsku i na żywo pokazuje czas trwania wpisanej zmiany ("Czas trwania: 8 h, kończy się następnego dnia"), żeby literówka typu 14:00–08:00 była widoczna.
- Dane: nazwa wymagana (1 do 50 znaków, bez znaków sterujących), godziny w formacie `HH:MM` (00:00 do 23:59). Koniec wcześniejszy niż początek oznacza następny dzień (22:00–06:00 trwa 8 h, 14:00–00:00 trwa 10 h), a koniec równy początkowi (np. 08:00–08:00) jest odrzucany. Zmiany dłuższe niż 8 godzin są dozwolone (ocenia je S-05). Nazwy mogą się powtarzać.
- Tabela `public.shifts` ma RLS: planista czyta, dodaje i edytuje; pracownik, konto bez roli i anonim nie widzą ani nie zmieniają niczego; nikt przez API nie usuwa wierszy.
- Zmiana jest edytowalna, a jej `id` jest stabilne: S-03 będzie się do niej odwoływać po `id`, a S-08 skopiuje nazwę i godziny do zatwierdzonego grafiku w chwili zatwierdzenia, więc edycja słownika nie zmieni zatwierdzonych grafików (zob. "What We're NOT Doing").
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, a smoke z nowymi krokami (baza przez PostgREST, API JSON, strony) przechodzi lokalnie i w CI.

### Key Discoveries:

- Czas trwania `(koniec − początek + 1440) mod 1440` obsługuje jednym wzorem zmiany w obrębie dnia i przechodzące przez północ; przy odrzuconych równych godzinach wynik jest zawsze od 1 do 1439 minut. Zmiana kończąca się o północy (14:00–00:00) mieści się w tej samej regule bez dodatkowego pola.
- Godziny jako minuty od północy (`smallint` 0 do 1439) w bazie dają S-05 prostą arytmetykę bez analizy typu `time` i strefy czasowej; w API i formularzu godziny są ciągiem `HH:MM`.
- Pracownik (S-11) nie ma i nie będzie miał dostępu do słownika; zobaczy godziny z kopii zapisanej w zatwierdzonym grafiku. To dodatkowy powód wyboru modelu "edytowalny słownik plus kopia przy zatwierdzeniu" zamiast wersjonowania wierszy.
- Smoke z S-01 pokazał trzy pułapki, które ten plan wbudowuje od początku: dane testowe muszą być unikalne (`runId`) i sprzątane kluczem service-role, każdy kod odpowiedzi z tabeli kontraktu ma mieć własny krok (w tym 400 i `PUT` 422), a nagłówki odpowiedzi warto sprawdzać tam, gdzie decyzja jest świadoma.
- Jedyne współdzielone elementy do wydzielenia z S-01 to `isUuid` i logowanie błędów bazy; reszta (`jsonResponse`, `readJsonBody`, `PlannerLayout`, `FormField`, `Button`, `ServerError`) jest gotowa do ponownego użycia bez zmian.

## What We're NOT Doing

- Usuwania i archiwizowania zmian: FR-018 jest zaparkowane w PRD. Konsekwencja: omyłkowo dodana zmiana zostaje na liście (można ją edytować i użyć ponownie); autor usuwa ją ręcznie w panelu Supabase, dopóki żaden wycinek nie doda tej funkcji. Uprawnienie `delete` jest odebrane w bazie, nie tylko pominięte w UI. Zmiana, która przestała obowiązywać, zostaje w selektorze S-03; to ryzyko jest w S-02 świadomie zaakceptowane.
- Unikalności nazw (decyzja autora): dwie zmiany o tej samej nazwie są dozwolone. Konsekwencja dla S-03: selektor zmian musi pokazywać godziny obok nazwy, inaczej dwie "Nocne" o różnych godzinach będą nie do odróżnienia.
- Egzekwowania ochrony zatwierdzonych grafików: grafików jeszcze nie ma. S-02 tylko ustala model i zobowiązania dla kolejnych wycinków: S-03 odwołuje się do zmiany po `id`, S-08 kopiuje nazwę, godzinę rozpoczęcia i zakończenia do zatwierdzonego grafiku, S-11 czyta tę kopię (pracownik nie ma dostępu do słownika).
- Oceny reguł czasu pracy: dozwolone są zmiany dłuższe niż 8 godzin, a ich ocenę (limit 8 godzin na dobę, odpoczynek 11 godzin, komunikat o niewspieranych systemach równoważnych, decyzja D3) robi S-05. Słownik nie ostrzega o długości zmiany.
- Przerw w zmianie, minut nieodpłatnych i godzin pracy różnych od różnicy godzin zegarowych (PRD definiuje zmianę tylko przez godziny rozpoczęcia i zakończenia). W noc zmiany czasu (marzec, październik) faktyczny czas pracy zmiany nocnej bywa o godzinę inny niż różnica zegarowa; uwzględnia to S-05, słownik zapisuje czas zegarowy.
- Wykrywania nakładających się, zduplikowanych lub podobnych zmian, stronicowania, wyszukiwania, filtrów, importu, kolumn audytowych i wykrywania równoczesnych edycji (ostatni zapis wygrywa).
- Nagłówka `Cache-Control: no-store` na stronach zmian: nie zawierają danych osobowych (odpowiedzi API mają `no-store` jak w S-01).
- Zmian w `OPEN_PATHS`, w `src/layouts/Layout.astro`, w bramce dostępu i w trasach pracowników poza wydzieleniem `isUuid` i logowania błędów do wspólnego modułu (zachowanie bez zmian).
- Generowanych typów bazy, klucza service-role w Workerze, nowych zmiennych środowiskowych i zasobów Cloudflare.
- Uogólniania kroków RLS w smoke na wiele tabel: dla drugiej tabeli powielamy kroki obok kroków pracowników, dokładając tylko wspólnego pomocnika zapytań `restTable`; trzecia tabela będzie sygnałem do uogólnienia.
- Wydzielania wspólnego hooka formularza, tras API i stron listy: powielamy wzorzec S-01 (`useShiftForm` obok `useEmployeeForm`, trasy i strony obok tras i stron pracowników). Trzeci taki formularz (S-03) będzie sygnałem do wydzielenia wspólnego hooka i pomocników.
- Testów e2e w przeglądarce i testów jednostkowych hooka React (jak w S-01).

## Implementation Approach

Od środka na zewnątrz, tak jak w S-01: najpierw czyste reguły (Faza 1), potem tabela z RLS dowiedziona na prawdziwych tokenach (Faza 2), potem warstwa danych i API z wymuszeniem JSON (Faza 3), na końcu strony i formularz (Faza 4). Każda faza kończy się zielonym CI i własnym dowodem (testy jednostkowe, smoke przez PostgREST, smoke przez API, przegląd w przeglądarce). Fazy mogą trafić do jednego lub kilku PR; wdrożenie na produkcję po Fazie 4, z migracją przed kodem (zob. Migration Notes). Migracja jest addytywna, więc samo wdrożenie Fazy 2 niczego nie psuje.

Jedna funkcja `validateShiftInput` obsługuje formularz w przeglądarce i trasy API; baza powtarza granice w ograniczeniach `check`, żeby wiersz zapisany z pominięciem aplikacji też je spełniał. Aplikacja normalizuje nazwę (przycięcie, zwinięcie białych znaków) i zamienia `HH:MM` na minuty; baza pilnuje granic, w tym warunku `start ≠ koniec`.

W odróżnieniu od S-01 CI i wdrożenie mają po jednym wierszu na końcu (Faza 4), zamiast powtarzać wiersz CI w każdej fazie: wszystkie fazy trafiają do tego samego pull requesta. Wiersze zależne od PR i wdrożenia (4.6 do 4.8) da się wykonać dopiero po scaleniu, więc odhaczamy je osobnym commitem potwierdzającym przed archiwizacją (twarda bramka `/10x-archive` blokuje niezatwierdzone zmiany w folderze zmiany) albo archiwizujemy zmianę z nimi jako oczekującymi (miękkie ostrzeżenie o punktach ręcznych).

## Phase 1: Reguły zmiany

### Overview

Dodać typy współdzielone oraz czyste funkcje: parsowanie i formatowanie godzin, czas trwania z obsługą przejścia przez północ, etykiety, sortowanie i walidację z normalizacją, wraz z testami. Żadne zachowanie aplikacji się jeszcze nie zmienia.

### Changes Required:

#### 1. Typy współdzielone

**File**: `src/types.ts`

**Intent**: Typy encji i DTO zmiany obok istniejących typów pracownika.

**Contract**: `ShiftInput { name: string; startMinute: number; endMinute: number }` (minuty od północy, 0 do 1439); `Shift extends ShiftInput { id: string; createdAt: string }` (`createdAt` to ISO z bazy); `ShiftField = "name" | "startTime" | "endTime"`; `ShiftFieldErrors = Partial<Record<ShiftField, string>>`.

#### 2. Reguły zmiany

**File**: `src/lib/services/shift.ts` (nowy)

**Intent**: Jedno źródło prawdy o tym, co jest poprawną zmianą i jak ją wyświetlić i uporządkować, jako czyste funkcje bez importów `astro:*` i `cloudflare:workers`, używane przez formularz, trasy API i testy.

**Contract**: Wyeksportowane stałe `SHIFT_NAME_MAX_LENGTH = 50` i `MINUTES_PER_DAY = 1440`. Funkcje:

- `parseTime(text: string): number | undefined`: dokładnie `GG:MM` z dwiema cyframi w każdej części, godzina 00 do 23, minuta 00 do 59 (wzorzec `^([01]\d|2[0-3]):([0-5]\d)$`, bez przycinania spacji, bez sekund); wynik to minuty od północy.
- `formatTime(minute: number): string`: `GG:MM` z zerami wiodącymi.
- `shiftDurationMinutes(shift: { startMinute: number; endMinute: number }): number`: `(endMinute − startMinute + 1440) mod 1440`; dla równych wartości zwraca 0 (równe godziny odrzuca walidacja, funkcja nie rzuca).
- `endsNextDay(shift): boolean`: `endMinute < startMinute`.
- `formatDuration(minutes: number): string`: `"8 h"`, `"7 h 30 min"`, `"45 min"` (godziny i minuty, pomijając zerową część).
- `formatShiftTimes(shift): string`: `"22:00–06:00"` (półpauza U+2013 między godzinami).
- `validateShiftInput(raw: unknown): { ok: true; value: ShiftInput } | { ok: false; errors: ShiftFieldErrors }`. Wejście to obiekt z kluczami `name`, `startTime`, `endTime` (ciągi znaków; brak, `null`, liczba i niebędący obiektem argument traktowane jak puste pola). Zwraca wszystkie błędne pola naraz, jeden komunikat po polsku na pole. Nazwa: bez znaków sterujących (`\p{Cc}`, także tabulator i znak nowej linii), sprawdzanych na surowym wejściu przed przycięciem i zwinięciem białych znaków; dalej przycięta, ciągi białych znaków zwinięte do jednej spacji, 1 do 50 znaków liczonych w punktach kodowych. Godziny: `parseTime` na surowym ciągu. Równe godziny dają błąd przy polu `endTime`; koniec wcześniejszy niż początek jest poprawny (następny dzień).
- `sortShifts(shifts: readonly Shift[]): Shift[]`: nowa tablica (wejście nie jest zmieniane), klucze: `startMinute` rosnąco, nazwa (jeden `Intl.Collator("pl")`), `endMinute` rosnąco, `createdAt` rosnąco (przez `Date.parse`, nie jako tekst), na końcu `id`. Wynik nie zależy od kolejności wejścia.

#### 3. Testy reguł

**File**: `src/lib/services/shift.test.ts` (nowy), `src/lib/services/access.test.ts`

**Intent**: Udowodnić granice, regułę północy, normalizację i powtarzalność oraz zablokować przypadkowe otwarcie nowych tras.

**Contract**: Przypadki (nazwane): (a) `parseTime` i `formatTime`: `00:00` daje 0, `23:59` daje 1439, `06:05` daje 365, powrót `formatTime(parseTime(x))` równy `x`; odrzucone `24:00`, `7:00`, `07:60`, `07:00:00`, ` 07:00`, pusty ciąg, `abc`; (b) czas trwania i następny dzień: `06:00–14:00` to 480 minut w tym samym dniu, `22:00–06:00` to 480 minut następnego dnia, `14:00–00:00` to 600 minut następnego dnia, `23:30–00:30` to 60, `00:00–23:59` to 1439, `08:00–07:59` to 1439 następnego dnia, `12:00–12:01` to 1; (c) `formatDuration`: 480 daje `8 h`, 450 daje `7 h 30 min`, 45 daje `45 min`, 600 daje `10 h`, 1439 daje `23 h 59 min`; `formatShiftTimes` daje `22:00–06:00`; (d) walidacja nazwy: pusta, same spacje, 51 znaków i znak sterujący (także `Noc\tna` z tabulatorem w środku) odrzucone, 50 znaków, `Nocna 12h`, `Łąka`, `O'Brien` przyjęte, podwójna spacja zwinięta, spacje na brzegach przycięte; (e) walidacja godzin: równe godziny dają błąd przy `endTime` i nie przy `startTime`, `22:00`/`06:00` daje `startMinute 1320` i `endMinute 360`, liczba zamiast ciągu odrzucona; (f) wszystkie błędne pola zwracane razem, argument niebędący obiektem daje błędy pól wymaganych; (g) sortowanie: kolejność `06:00`, `14:00`, `22:00`, przy równej godzinie rozpoczęcia nazwa w polskiej kolejności (`Cyk`, `Ćma`, `Łąka`, `Mak`), przy równej nazwie `endMinute`, potem `createdAt` (w tym o różnej liczbie cyfr ułamka sekundy), potem `id`; (h) powtarzalność: `expectDeterministic(sortShifts, lista, { variants })` z permutacjami z `seededShuffle`, wejście niezmienione po sortowaniu, to samo dla `validateShiftInput`. W `access.test.ts` lista domyślnej odmowy (`decideAccess default deny`) dostaje `/shifts`, `/shifts/new`, `/shifts/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90`, `/api/shifts`, `/api/shifts/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90`.

### Success Criteria:

#### Automated Verification:

- Testy reguł zmiany i polityki dostępu przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Komunikaty błędów po polsku, reguła północy (koniec wcześniejszy niż początek to następny dzień, koniec równy początkowi jest odrzucany) i przykłady z testów zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Tabela shifts i RLS

### Overview

Dodać migrację z tabelą `public.shifts`, ograniczeniami zgodnymi z regułami z Fazy 1 i politykami RLS tylko dla planisty, a w smoke udowodnić przez PostgREST, na prawdziwych tokenach, że planista czyta, dodaje i edytuje, a pracownik, konto bez roli i anonim nie mają dostępu i nikt nie usuwa wierszy.

### Changes Required:

#### 1. Migracja tabeli

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_shifts.sql` (nowy; znacznik czasu z chwili utworzenia, późniejszy niż `20261028085831`)

**Intent**: Tabela zmian według wzorca z `20261028085831_employees.sql`, z ograniczeniami powtarzającymi granice aplikacji, uprawnieniami ściśle takimi, jakich używa aplikacja, i komentarzem utrwalającym model edycji.

**Contract**: `public.shifts`: `id uuid primary key default gen_random_uuid()`, `name text not null`, `start_minute smallint not null`, `end_minute smallint not null`, `created_at timestamptz not null default now()`. Nazwane ograniczenia: `shifts_name_valid` (wartość równa swojemu `btrim` i `char_length` od 1 do 50), `shifts_start_minute_valid` (`start_minute between 0 and 1439`), `shifts_end_minute_valid` (`end_minute between 0 and 1439`), `shifts_times_differ` (`start_minute <> end_minute`). Brak ograniczenia unikalności nazwy (decyzja autora). Baza nie wymusza zwijania spacji w środku nazwy ani zakazu znaków sterujących (to normalizacja aplikacji). `enable row level security` oraz trzy polityki dla `authenticated` według wzorca z `role_helpers.sql`, każda z `(select public.is_planner())`: `planner can select shifts`, `planner can insert shifts`, `planner can update shifts` (`using` i `with check`). Brak polityki `delete`. Uprawnienia jak w tabeli pracowników (kod niewidoczny na ścieżce plików): `revoke all on table public.shifts from anon, authenticated;` i `grant select, insert, update on table public.shifts to authenticated;`, z komentarzem `-- non-obvious:` o domyślnych uprawnieniach Supabase. Komentarz na końcu utrwala model: wiersz jest edytowalny, S-03 odwołuje się do niego po `id`, S-08 kopiuje nazwę i godziny do zatwierdzonego grafiku, a pracownik nie ma polityki do tej tabeli (S-11 czyta kopię).

#### 2. Smoke: baza przez PostgREST

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić po stronie bazy to samo, co dla pracowników: kto widzi i zmienia wiersze, na prawdziwych tokenach, a do tego ograniczenia specyficzne dla zmian.

**Contract**: Z `employeesTable` (`:161`) wydzielić pomocnika `restTable(table, method, opts)` i oprzeć na nim `employeesTable` (bez zmiany wywołań pracowników) oraz nowy `shiftsTable`. Dane smoke mają unikalne nazwy z `runId` o prefiksie `Smoke-` (`Smoke-<runId>-db` i podobne), a ostatni krok przebiegu (obok istniejącego sprzątania pracowników, przed nim lub po nim) usuwa je kluczem service-role (`DELETE /rest/v1/shifts?name=like.Smoke-*`; service-role zachowuje uprawnienia, bo migracja odbiera je tylko `anon` i `authenticated`). Kroki w regionie po `rpcStep(planner, ...)` (`:542`), z predykatem `check` i opisem tam, gdzie wiersz ma losowe `id`: planista dodaje wiersz (`Prefer: return=representation`, np. 22:00–06:00, czyli `start_minute` 1320 i `end_minute` 360, co dowodzi, że schemat dopuszcza zmianę przechodzącą przez północ) i dostaje go z powrotem; dodanie drugiej zmiany o tej samej nazwie przechodzi (201, brak unikalności); odczyt pokazuje oba wiersze; PATCH zmienia godzinę zakończenia i odczyt pokazuje nową wartość; odrzucone dodania (status spoza 2xx, komunikat błędu nazywa ograniczenie, jak w krokach pracowników): równe godziny (`shifts_times_differ`), `start_minute` 1440 (`shifts_start_minute_valid`), pusta nazwa (`shifts_name_valid`), nazwa ze spacją na początku (`shifts_name_valid`); DELETE planisty odrzucony (spoza 2xx), a wiersz nadal istnieje. Pracownik i konto bez roli: odczyt zwraca `[]` (status 200), dodanie odrzucone (spoza 2xx), PATCH nie zmienia wiersza (potwierdza ponowny odczyt planisty), DELETE odrzucony. Anonim (sam klucz anon): odczyt odrzucony (spoza 2xx). Tam, gdzie PostgREST może odpowiedzieć 200 lub 204 z pustym skutkiem albo 4xx, dowodem jest skutek (wiersz niezmieniony, lista pusta), nie konkretny kod.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- Linting przechodzi: `npm run lint`
- Smoke z krokami bazy przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos (wartości z `supabase status -o env`), ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z tego stosu): `npm run smoke`

#### Manual Verification:

- Polityki RLS, uprawnienia i komentarz o modelu edycji w migracji zostały przejrzane przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Dostęp do danych i API

### Overview

Wydzielić współdzielone drobiazgi z modułu pracowników, dodać funkcje odczytu i zapisu zmian oraz dwie trasy API z walidacją, kodami odpowiedzi i wymuszeniem JSON, a smoke rozszerzyć o kroki API, w tym o każdy kod z tabeli kontraktu.

### Changes Required:

#### 1. Wspólny moduł dostępu do danych

**File**: `src/lib/postgrest.ts` (nowy), `src/lib/employees.ts`, `src/pages/api/employees/[id].ts`

**Intent**: Moduł zmian nie powinien importować z modułu pracowników; `isUuid` i logowanie błędów bazy przechodzą do wspólnego pliku bez zmiany zachowania pracowników.

**Contract**: `src/lib/postgrest.ts` eksportuje `isUuid(value: string): boolean` (kanoniczny zapis 8-4-4-4-12, bez względu na wielkość liter, jak dotąd) oraz `logDatabaseError(scope: string, action: string, error: PostgrestError): void` (`console.error` z samym `code` i `message`, bez danych wejściowych; ze świadomym wyjątkiem lintu `no-console` i komentarzem uzasadniającym, jak w `employees.ts:55`; tekst komunikatu zaczyna się od `scope`, więc dla pracowników pozostaje `employees <action> failed: ...`). `employees.ts` importuje oba elementy z nowego pliku i traci lokalne definicje (`UNIQUE_VIOLATION` zostaje); trasa `[id].ts` pracowników importuje `isUuid` z nowego pliku.

#### 2. Funkcje dostępu do danych zmian

**File**: `src/lib/shifts.ts` (nowy)

**Intent**: Jedyne miejsce, które zna nazwy kolumn tabeli zmian i mapuje wiersz bazy na `Shift`; strony i trasy API nie piszą zapytań same.

**Contract**: Funkcje przyjmują `SupabaseClient` jako pierwszy argument (import wyłącznie typu, bez `astro:*`). `listShifts(supabase): Promise<Shift[]>` zwraca wynik `sortShifts`; `getShift(supabase, id): Promise<Shift | null>`; `createShift(supabase, input: ShiftInput)` zwraca `{ ok: true; shift: Shift } | { ok: false; error: "failed" }`; `updateShift(supabase, id, input)` zwraca `{ ok: true; shift: Shift } | { ok: false; error: "not_found" | "failed" }`. Odczyty rzucają `Error` przy awarii bazy (strona kończy się statusem 500); każda awaria bazy jest logowana przez `logDatabaseError("shifts", ...)`. `id` niebędący UUID daje `null` albo `not_found` bez zapytania. Aktualizacja bez widocznego wiersza (brak id albo ukryty przez RLS) to `not_found`. Wybierane są jawne kolumny `id, name, start_minute, end_minute, created_at`; jedna funkcja mapuje wiersz na `Shift` (`start_minute` na `startMinute` itd.), a wynik zapytania jest rzutowany jawnie, żeby reguły ESLint nie widziały niebezpiecznego `any`.

#### 3. Trasy API

**File**: `src/pages/api/shifts/index.ts` (nowy, `POST`), `src/pages/api/shifts/[id].ts` (nowy, `PUT`)

**Intent**: Przyjąć dane z formularza jako JSON, zwalidować `validateShiftInput` i zapisać przez `src/lib/shifts.ts`, z przewidywalnymi kodami odpowiedzi; ten sam układ co trasy pracowników, bez gałęzi konfliktu.

**Contract**: Obie trasy eksportują `prerender = false`; dostęp rozstrzyga bramka (planner-only z reguły domyślnej, odpowiedzi 401 i 403 w JSON jak dziś). Każda odpowiedź ma `content-type: application/json` i `cache-control: no-store` (przez `jsonResponse`). Ciało to obiekt z kluczami `name`, `startTime`, `endTime`; odpowiedź z sukcesem niesie `Shift` (`id`, `name`, `startMinute`, `endMinute`, `createdAt`). Kolejność sprawdzeń i kody:

| Sytuacja | Odpowiedź |
| --- | --- |
| `Content-Type` inny niż `application/json` | 415 `{ "error": "unsupported_media_type" }` |
| Ciało niebędące poprawnym JSON | 400 `{ "error": "invalid_json" }` |
| `locals.supabase` jest `null` | 503 `{ "error": "not_configured" }` |
| `PUT` z `id` niebędącym UUID albo nieistniejącym | 404 `{ "error": "not_found" }` |
| Walidacja nie przechodzi | 422 `{ "errors": ShiftFieldErrors }` |
| Sukces `POST` | 201 `{ "shift": Shift }` |
| Sukces `PUT` | 200 `{ "shift": Shift }` |
| Inna awaria zapisu | 500 `{ "error": "failed" }` |

`PUT` wymaga wszystkich pól (pełna zamiana), tak jak wysyła je formularz.

#### 4. Smoke: API

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić trasy na działającej aplikacji, razem z bramką i każdym kodem odpowiedzi z tabeli kontraktu, na prawdziwych kontach.

**Contract**: Dane smoke z `runId` (nazwy o prefiksie `Smoke-<runId>-`, objęte istniejącym sprzątaniem po prefiksie). Kroki planisty (między `signIn(planner)` a `signOut(planner)`, bo używają sesji z ciasteczek): `POST /api/shifts` z poprawnymi danymi (nazwa z polskimi literami, podwójną spacją w środku i spacją na końcu, godziny `22:00` i `06:00`) daje 201, a ciało zawiera nazwę po normalizacji oraz `startMinute: 1320`, `endMinute: 360`; drugi `POST` z tą samą nazwą daje 201 (duplikaty dozwolone); niepoprawne dane (pusta nazwa, godzina `25:00`) dają 422 z błędami pól `name` i `startTime`; równe godziny dają 422 z błędem pola `endTime`; `POST` z ciałem formularzowym (urlencoded) daje 415; `POST` z ciałem `{` pod nagłówkiem JSON daje 400 `invalid_json` (opcja `jsonText` w `request()`); `PUT /api/shifts/<id>` zmienia godzinę zakończenia i daje 200; `PUT` z niepoprawnymi danymi daje 422; `PUT` dla nieistniejącego UUID i dla `not-a-uuid` daje 404. Pracownik (między `signIn(employee)` a `signOut(employee)`): `POST` i `PUT` dają 403 z JSON. Anonim: `POST /api/shifts` daje 401 z JSON. Kod 503 nie ma kroku (wymagałby zepsucia konfiguracji aplikacji pod testem).

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami API przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`

**Implementation Note**: After completing this phase and all automated verification passes, continue to the next phase (this phase has no manual verification; pause only if the human asks to review the API contract). Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Strony planisty

### Overview

Zbudować listę `/shifts`, formularze dodawania i edycji (wyspa React z hookiem i podglądem czasu trwania), kafelek w panelu `/planner`, zaktualizować smoke o kroki stron i opisać nowy model w dokumentacji.

### Changes Required:

#### 1. Kafelek w panelu

**File**: `src/pages/planner/index.astro`

**Intent**: Droga do słownika zmian z panelu planisty.

**Contract**: Drugi kafelek w istniejącej siatce, ten sam styl co kafelek "Pracownicy": nagłówek "Zmiany", odnośnik do `/shifts` i jedno zdanie opisu (słownik zmian: nazwa oraz godziny rozpoczęcia i zakończenia, używane w grafikach). Nagłówek "Panel planisty" i kafelek "Pracownicy" zostają bez zmian.

#### 2. Lista zmian

**File**: `src/pages/shifts/index.astro` (nowy)

**Intent**: Pokazać, jakie zmiany są zdefiniowane, z godzinami i czasem trwania, oraz drogę do dodania i edycji.

**Contract**: Dane z `listShifts(Astro.locals.supabase)`; gdy klienta brak (niemożliwe po bramce), strona kończy się błędem 500. Nagłówek z liczbą zmian ("Zmiany (3)"), przycisk "Dodaj zmianę" (`/shifts/new`), a na szerokim ekranie tabela, na wąskim (telefon) ułożone karty, w `PlannerLayout`, z polami: nazwa, godziny przez `formatShiftTimes` ze znacznikiem "następnego dnia" przy `endsNextDay`, czas trwania przez `formatDuration(shiftDurationMinutes(...))`, odnośnik "Edytuj" do `/shifts/<id>`. Pusta lista pokazuje komunikat "Nie zdefiniowano jeszcze żadnej zmiany." Bez nagłówka `no-store`.

#### 3. Dodawanie i edycja

**File**: `src/pages/shifts/new.astro`, `src/pages/shifts/[id].astro` (nowe), `src/components/shifts/ShiftForm.tsx` (nowy), `src/components/hooks/useShiftForm.ts` (nowy)

**Intent**: Formularz, który waliduje tą samą funkcją co serwer, pokazuje błędy przy polach, zachowuje wpisane dane po odmowie serwera i na żywo pokazuje, ile trwa wpisana zmiana.

**Contract**: Strony renderują `ShiftForm` jako wyspę `client:load` w `PlannerLayout`; `[id].astro` pobiera `getShift` i dla nieistniejącej zmiany albo `id` niebędącego UUID ustawia status 404 i pokazuje komunikat "Nie znaleziono zmiany" z odnośnikiem do listy. Statyczna trasa `/shifts/new` ma pierwszeństwo przed `[id]`. `useShiftForm({ shift? })` zwraca wartości pól jako ciągi (`name`, `startTime`, `endTime`; edycja startuje od `formatTime` zapisanych minut), błędy pól, błąd serwera, stan oczekiwania i funkcje `setField`/`submit`; `submit` waliduje `validateShiftInput` i przy braku błędów wysyła `fetch` JSON (`POST /api/shifts` albo `PUT /api/shifts/<id>`) z surowymi wartościami pól, po 201 i 200 przechodzi na `/shifts`, przy 422 przenosi `errors` do pól, przy 401 i 403 pokazuje "Sesja wygasła lub brak uprawnień. Zaloguj się ponownie.", przy pozostałych kodach i błędach sieci "Nie udało się zapisać. Spróbuj ponownie."; podczas oczekiwania przycisk jest wyłączony (brak podwójnego zapisu). Formularz: Nazwa (`FormField`, `maxLength` z `SHIFT_NAME_MAX_LENGTH`), Godzina rozpoczęcia i Godzina zakończenia (`FormField` z `type="time"`, wartość `GG:MM`), pod nimi wiersz podglądu: gdy obie godziny są poprawne i różne, "Czas trwania: 8 h, kończy się następnego dnia" (bez drugiej części, gdy `endsNextDay` jest fałszem), w przeciwnym razie podpowiedź "Zmiana kończąca się po północy: wpisz godzinę zakończenia wcześniejszą niż rozpoczęcia, np. 22:00–06:00."; podgląd korzysta z `parseTime`, `shiftDurationMinutes`, `endsNextDay` i `formatDuration`. Formularz ma `noValidate`, przycisk "Zapisz" (`Button`, nie `SubmitButton`) i odnośnik "Anuluj". `FormField` nie wymaga zmian.

#### 4. Smoke: strony

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić strony planisty i bramkę dla stron zmian na prawdziwych kontach.

**Contract**: Planista (kroki po krokach API, przed `signOut(planner)`): `/shifts` 200 z nazwą utworzonej wcześniej zmiany w treści, `/shifts/new` 200, `/shifts/<id>` 200 (formularz z danymi, nazwa w treści), `/shifts/<nieistniejący UUID>` i `/shifts/not-a-uuid` 404 z treścią "Nie znaleziono zmiany"; `/planner` planisty zawiera "Zmiany" (jako drugi krok `/planner` z `bodyIncludes: "Zmiany"`; istniejący krok z "Pracownicy" zostaje, bo `bodyIncludes` przyjmuje jeden ciąg). Pracownik: `/shifts`, `/shifts/new` i `/shifts/<id>` (id stałe, bramka odpowiada pierwsza) 403. Anonim: `/shifts` i `/shifts/new` 401.

#### 5. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Opisać słownik zmian obok pracowników.

**Contract**: `CLAUDE.md`: punkt o stronach pracowników w sekcji `### Data access` (`:39`) rozszerzyć o strony i wyspę zmian (`src/pages/shifts/`, `src/components/shifts/ShiftForm.tsx`, `useShiftForm`, trasy `/api/shifts`, `/api/shifts/[id]`) oraz o wspólny moduł `src/lib/postgrest.ts`; opis smoke (Commands) wymienia też zmiany. `AGENTS.md:15`: dopisać `src/pages/shifts/` i `src/components/shifts/` do Project Structure. `README.md`: tabela tras (od `:151`) dostaje `/shifts`, `/shifts/new`, `/shifts/[id]`, `/api/shifts`, `/api/shifts/[id]`; opis migracji w `:115` wymienia trzy migracje i dwie własne tabele (`employees`, `shifts`); opis smoke wspomina o danych zmian i sprzątaniu po prefiksie `Smoke-`.

### Success Criteria:

#### Automated Verification:

- Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami stron przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`

#### Manual Verification:

- Przeglądarka, planista: `/planner` → kafelek "Zmiany" → pusta lista z komunikatem (na bazie bez wierszy smoke: po jego sprzątaniu albo po `npx supabase db reset`); dodanie zmiany 22:00–06:00 pokazuje na liście "22:00–06:00", znacznik "następnego dnia" i "8 h", a podgląd w formularzu pokazuje "Czas trwania: 8 h, kończy się następnego dnia"; dodane 22:00–06:00, 06:00–14:00 i 14:00–22:00 są na liście w kolejności 06:00, 14:00, 22:00; równe godziny pokazują błąd przy polu "Godzina zakończenia" i zachowują pozostałe wpisane dane; edycja zmienia godzinę zakończenia; dwie zmiany o tej samej nazwie można dodać
- Telefon (szerokość około 375 px w narzędziach przeglądarki): lista i formularz są czytelne bez poziomego przewijania, a pola czasu da się wypełnić
- Przeglądarka, pracownik i anonim: `/shifts` pokazuje "Brak dostępu" (403 dla pracownika, 401 dla anonima, bez przekierowania)
- Migracja zastosowana na hostowanym projekcie przez autora przed wdrożeniem kodu (`npx supabase db push`) i widoczna jako zastosowana w `npx supabase migration list`
- Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki bazy, API i stron)
- Po ręcznym wdrożeniu (migracja przed kodem, zob. Migration Notes) planista na `https://shiftly.mto-astro.workers.dev` dodaje i edytuje zmianę (wykonuje autor)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `shift.test.ts`: parsowanie i formatowanie godzin, czas trwania i następny dzień (przypadki 22:00–06:00, 14:00–00:00, 23:30–00:30, granice), etykiety, walidacja nazwy i godzin z normalizacją, sortowanie z remisami (polska kolejność, `endMinute`, `createdAt`, `id`), niezależność wyniku od kolejności wejścia (`expectDeterministic` z permutacjami), niemutowanie wejścia.
- `access.test.ts`: nowe trasy zmian są tylko dla planisty (domyślna odmowa).

### Integration Tests:

- Smoke w CI (lokalny Supabase): RLS tabeli na tokenach planisty, pracownika, konta bez roli i anonima (PostgREST) wraz z ograniczeniami `check`, kody odpowiedzi tras API (201, 200, 400, 404, 415, 422, 401, 403; kod 503 pominięty świadomie) oraz status stron planisty i odmów dla pozostałych aktorów.

### Manual Testing Steps:

1. Jako planista dodać, edytować i obejrzeć zmiany na komputerze i w szerokości telefonu, w tym zmianę przechodzącą przez północ, zmianę kończącą się o północy (14:00–00:00), równe godziny i dwie zmiany o tej samej nazwie.
2. Jako pracownik i anonim otworzyć `/shifts` i `/shifts/new` i sprawdzić status oraz brak przekierowania.
3. Po wdrożeniu wykonać kroki z "Migration Notes" w podanej kolejności i powtórzyć krok 1 na produkcji.

## Performance Considerations

Strona listy to jedno zapytanie do PostgREST na żądanie (obok `getUser()` w middleware), bez stronicowania dla słownika kilku do kilkunastu zmian; sortowanie, walidacja i czas trwania to proste operacje w pamięci. Walidator trafia do paczki wyspy formularza razem z `zod` z S-01 (współdzielony fragment), bez nowych zależności. Środowisko testowe workerd nie egzekwuje limitu 10 ms CPU z planu Workers Free, więc pomiar na wdrożeniu zostaje poza tą zmianą (jak w S-01).

## Migration Notes

Kolejność wdrożenia na produkcję (wykonuje autor): (1) `npx supabase db push` (nowa tabela, bez wpływu na obecny kod), (2) `npm run build` i `npx wrangler deploy`. Tabela startuje pusta; pierwsze zmiany powstają z poziomu aplikacji. Wycofanie: `npx wrangler rollback` cofa kod, tabela zostaje nieszkodliwie; usunięcie samej tabeli wymaga nowej migracji, nie edycji istniejącej. Omyłkowo dodaną zmianę autor usuwa w panelu Supabase (Table Editor) albo SQL-em z rolą administracyjną, bo przez aplikację i API nie da się jej usunąć.

## References

- Roadmapa: `context/foundation/roadmap.md` (S-02, `shift-dictionary`; niewiadoma o zmianach przechodzących przez północ rozstrzygnięta w tym planie)
- PRD: `context/foundation/prd.md` (FR-013, FR-019, Business Logic, Guardrails: powtarzalność)
- Doba i limity: `context/foundation/work-time-rules.md` (art. 128 § 3, D3, uwaga o przejściu przez północ)
- Poprzednia zmiana (wzorzec): `context/archive/2026-10-21-employee-roster/plan.md` oraz `supabase/migrations/20261028085831_employees.sql` (wzorzec tabeli i RLS)
- Obecny kod: `src/lib/employees.ts`, `src/lib/json-response.ts`, `src/lib/services/employee.ts`, `src/lib/services/access.test.ts`, `src/components/employees/EmployeeForm.tsx`, `src/components/hooks/useEmployeeForm.ts`, `src/components/auth/FormField.tsx`, `src/pages/planner/index.astro`, `scripts/smoke.mjs`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguły zmiany

#### Automated

- [x] 1.1 Testy reguł zmiany i polityki dostępu przechodzą w workerd: `npm test` — 74a5582
- [x] 1.2 Linting przechodzi: `npm run lint` — 74a5582
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 74a5582

#### Manual

- [x] 1.4 Komunikaty błędów po polsku, reguła północy (koniec wcześniejszy niż początek to następny dzień, koniec równy początkowi jest odrzucany) i przykłady z testów zostały przejrzane i zatwierdzone przez autora — 74a5582

### Phase 2: Tabela shifts i RLS

#### Automated

- [x] 2.1 Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset` — 83942cf
- [x] 2.2 Linting przechodzi: `npm run lint` — 83942cf
- [x] 2.3 Smoke z krokami bazy przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos (wartości z `supabase status -o env`), ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z tego stosu): `npm run smoke` — 83942cf

#### Manual

- [x] 2.4 Polityki RLS, uprawnienia i komentarz o modelu edycji w migracji zostały przejrzane przez autora — 83942cf

### Phase 3: Dostęp do danych i API

#### Automated

- [x] 3.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [x] 3.2 Smoke z krokami API przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`

### Phase 4: Strony planisty

#### Automated

- [ ] 4.1 Cała bramka przechodzi lokalnie w kolejności CI: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.2 Smoke z krokami stron przechodzi lokalnie (te same warunki co w Fazie 2): `npm run smoke`

#### Manual

- [ ] 4.3 Przeglądarka, planista: `/planner` → kafelek "Zmiany" → pusta lista z komunikatem (na bazie bez wierszy smoke: po jego sprzątaniu albo po `npx supabase db reset`); dodanie zmiany 22:00–06:00 pokazuje na liście "22:00–06:00", znacznik "następnego dnia" i "8 h", a podgląd w formularzu pokazuje "Czas trwania: 8 h, kończy się następnego dnia"; dodane 22:00–06:00, 06:00–14:00 i 14:00–22:00 są na liście w kolejności 06:00, 14:00, 22:00; równe godziny pokazują błąd przy polu "Godzina zakończenia" i zachowują pozostałe wpisane dane; edycja zmienia godzinę zakończenia; dwie zmiany o tej samej nazwie można dodać
- [ ] 4.4 Telefon (szerokość około 375 px w narzędziach przeglądarki): lista i formularz są czytelne bez poziomego przewijania, a pola czasu da się wypełnić
- [ ] 4.5 Przeglądarka, pracownik i anonim: `/shifts` pokazuje "Brak dostępu" (403 dla pracownika, 401 dla anonima, bez przekierowania)
- [ ] 4.6 Migracja zastosowana na hostowanym projekcie przez autora przed wdrożeniem kodu (`npx supabase db push`) i widoczna jako zastosowana w `npx supabase migration list`
- [ ] 4.7 Przebieg CI na pull requeście jest zielony (job `ci` i job `smoke`, w tym kroki bazy, API i stron)
- [ ] 4.8 Po ręcznym wdrożeniu (migracja przed kodem, zob. Migration Notes) planista na `https://shiftly.mto-astro.workers.dev` dodaje i edytuje zmianę (wykonuje autor)
