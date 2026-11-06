# Weekly schedule draft Implementation Plan

## Overview

Trzeci wycinek domenowy Shiftly (S-03 z roadmapy, FR-008, FR-009 bez generowania, FR-013, FR-019): planista tworzy szkic grafiku tygodniowego, znajduje go na liście `/schedules` i edytuje. Szkic to: dowolna data początkowa (grafik obejmuje 7 dni od niej), opcjonalna etykieta, siatka zmiana × 7 dni z wymaganą liczbą osób (FR-019) i skład pracowników objętych grafikiem. Zmiany i pracownicy pochodzą z istniejących słowników S-02 i S-01 i są wskazywane po `id`. Zapis idzie jedną transakcją przez funkcję SQL wywoływaną przez RPC. Plan powiela architekturę S-01 i S-02 (czyste reguły, tabele z RLS dowiedzione w smoke, warstwa danych, trasy JSON, strony z wyspą React), ale to pierwszy zasób relacyjny: klucze obce, kolumna daty i zapis wielu wierszy naraz nie mają jeszcze precedensu w repo. Obsadzanie (S-04), reguły (S-05) i zatwierdzanie (S-08) są poza zakresem.

## Current State Analysis

- Dostęp do nowych tras jest już załatwiony: `OPEN_PATHS` w `src/lib/services/access.ts:10-17` nie zawiera `/schedules*` ani `/api/schedules*`, więc reguła domyślna czyni je tylko dla planisty (401 dla anonima, 403 dla pracownika i konta bez roli, JSON pod `/api/`). Lista domyślnej odmowy w teście to `src/lib/services/access.test.ts:153-174`.
- Wzorzec z S-01 i S-02: czyste reguły `src/lib/services/shift.ts` (`validateShiftInput` `:91-116`, `sortShifts` `:129-138`), warstwa danych `src/lib/shifts.ts` (`createShift`, `updateShift`, `getShift` zwracające `null` dla nie-UUID), `src/lib/postgrest.ts` (`isUuid`, `logDatabaseError`), `src/lib/json-response.ts` (`jsonResponse`, `readJsonBody`), trasy `src/pages/api/shifts/index.ts` i `[id].ts` (kolejność: 415/400, guard klienta 503, `isUuid` 404, walidacja 422, zapis), strony `src/pages/shifts/*`, wyspa `src/components/shifts/ShiftForm.tsx` z hookiem `src/components/hooks/useShiftForm.ts` (kopiować ten, nie `useEmployeeForm`) i `FormField`. Wieloelementowe pola trzeba budować ręcznie, jak etat w `EmployeeForm.tsx:17-47,92-127`.
- Migracje: `20261020131134_role_helpers.sql` (szablon RLS `:35-57`), `20261028085831_employees.sql`, `20261102071038_shifts.sql` (nazwane ograniczenia `<tabela>_<pole>_valid`, trzy polityki planisty bez `delete`, `revoke all` i `grant` z komentarzem `-- non-obvious:`; komentarz `:34-36` zapowiada, że S-03 odwołuje się do zmiany po `id`). Brak kluczy obcych, kolumn dat, triggerów `updated_at`, funkcji RPC i `seed.sql`; w `src/` nie ma użycia `Date`.
- Panel `/planner` (`src/pages/planner/index.astro:9-26`) ma kafelki "Pracownicy" i "Zmiany"; `PlannerLayout.astro` ma `max-w-4xl` (`:15`) i nie ma menu. Strony pracowników ustawiają `Cache-Control: no-store` (`employees/index.astro:14-15`), bo pokazują dane osobowe; strony zmian nie.
- Smoke `scripts/smoke.mjs`: płaska tablica `steps`, aktorzy `anonymous`, `noRole`, `employee`, `planner`, pomocnik `restTable` (z S-02), kroki API i stron wykonują się między `signIn(planner)` a `signOut(planner)`, sprzątanie service-role na końcu (`DELETE ... ?name=like.Smoke-*` dla zmian, `?email=like.smoke-*` dla pracowników). Kafelki panelu mają osobny krok na każdy napis.
- Dziedzina: PRD wymaga okresu "tydzień od daty początkowej" (FR-009) i obsady na zmianę w dniu (FR-019). Art. 128 § 3 liczy tydzień od pierwszego dnia okresu rozliczeniowego, nie od poniedziałku. Decyzja D6 (`work-time-rules.md`): UI i dokumentacja mają informować, że grafik tygodniowy nie zastępuje formalnego rozkładu czasu pracy (art. 129 § 3). S-02 ustaliło: słownik zmian jest edytowalny, szkice czytają go na żywo, S-08 skopiuje nazwę i godziny przy zatwierdzeniu. Pracownicy nie mają usuwania ani blokowania (FR-015 zaparkowane), więc ci, którzy odeszli, zostają na liście wyboru. `context/foundation/lessons.md` nie istnieje.
- Równolegle powstaje plan S-10 (`employee-invitation`), który zmienia `employees` (kolumny `user_id`, `invited_at`), `src/types.ts`, `scripts/smoke.mjs`, dokumentację i `ci.yml` (zob. "Parallel Work Notes").

## Desired End State

- Planista z `/planner` kafelkiem "Grafiki" wchodzi na `/schedules`: lista posortowana od najnowszego okresu (remisy po dacie utworzenia, potem `id`) z kolumnami: okres (np. `11.11–17.11.2026`), etykieta (jeśli jest), liczba pracowników, suma wymaganej obsady, data utworzenia, odnośnik "Edytuj"; przycisk "Nowy grafik" prowadzi do `/schedules/new`, `/schedules/<id>` edytuje istniejący. Nad listą i formularzem widnieje informacja D6.
- Formularz: data początkowa (pole daty) z podglądem okresu ("Okres: 11.11–17.11.2026, 7 dni"), opcjonalna etykieta (do 60 znaków), siatka zmiana × 7 dni (kolumny to kolejne daty z nazwą dnia liczoną od dnia startu, wiersze to wybrane zmiany z godzinami i znacznikiem "następnego dnia", komórki to liczby od 0 do 99, gdzie 0 oznacza brak zmiany tego dnia, z sumą), lista pracowników z polami wyboru (domyślnie wszyscy zaznaczeni, "Zaznacz wszystkich" i "Odznacz wszystkich"). Siatka przewija się poziomo w kontenerze `max-w-4xl` z przyklejoną kolumną zmian. Walidacja tą samą funkcją po stronie klienta i serwera, błędy po polsku przy polach.
- Zapis jest atomowy: albo grafik z obsadą i składem istnieje w całości, albo nie powstaje nic. Edycja zastępuje całość (data, siatka, skład). Nikt nie usuwa grafików; usuwanie wierszy podrzędnych (obsada, skład) jest możliwe tylko dla planisty i tylko jako część zapisu.
- Pracownik, konto bez roli i anonim nie widzą ani nie zmieniają niczego (RLS w bazie, bramka w aplikacji).
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, a smoke z nowymi krokami (baza, RPC, API, strony) przechodzi lokalnie i w CI.

### Key Discoveries:

- PostgREST zapisuje jedną tabelę na żądanie, a RLS nie ma polityki `delete` na nagłówku, więc kompensacja niedokończonego zapisu nie jest możliwa: tylko funkcja SQL daje atomowość. Funkcja jest `security invoker`, więc polityki planisty nadal obowiązują.
- Zmiana nocna liczy się do dnia, w którym się zaczyna (komórka siatki to para zmiana i dzień startu). Zmiana z ostatniego dnia, która kończy się w następnym tygodniu, jest zaznaczona znacznikiem "następnego dnia"; odpoczynki między tygodniami należą do S-05.
- Kolumny siatki zależą od daty początkowej (dzień tygodnia nie jest pierwszą kolumną z kalendarza), więc nazwy dni trzeba liczyć z daty. Do tego wystarczy arytmetyka UTC na ciągach `YYYY-MM-DD`; to deterministyczne i niezależne od strefy czasowej przeglądarki.
- Obsada jest zapisywana rzadko: wiersz tylko dla komórek z liczbą od 1 do 99, klucz główny to (grafik, zmiana, `day_offset` 0 do 6). `day_offset` zamiast daty bezwzględnej pozwala zmienić datę początkową bez przepisywania obsady i daje ograniczenie `check` bez zapytań między tabelami.
- Dzisiejsze granty `update` obejmują cały wiersz (review S-02 F8, pominięty). Tabele podrzędne dostają tylko `select`, `insert`, `delete`, bo zapis zastępuje całość i nie potrzebuje `update`.
- Smoke S-01 i S-02 dały reguły do powielenia: dane z `runId` i prefiksem `Smoke-`, sprzątanie service-role na końcu (tu kolejność ma znaczenie przez klucze obce), osobny krok na każdy kod odpowiedzi i osobny na każdy kafelek.

## What We're NOT Doing

- Usuwania grafików (FR-018 zaparkowane): omyłkowy szkic zostaje na liście (można go edytować albo zignorować); autor usuwa go ręcznie w panelu Supabase. Uprawnienie `delete` na nagłówku `schedules` jest odebrane w bazie, nie tylko pominięte w UI.
- Statusu grafiku, zatwierdzania i kopii nazwy oraz godzin zmiany (S-08), wersjonowania (S-12): w S-03 każdy grafik jest szkicem, a kolumny statusu nie ma (S-08 doda to, czego potrzebuje).
- Przypisywania pracowników do zmian (S-04), reguł i braków obsady (S-05), obciążenia (S-06), nieobecności (S-07), generowania (S-09). Obsada to liczba osób; wskazania nie są liczone.
- Walidacji, że wymagana obsada mieści się w składzie lub że suma godzin pasuje do etatu: to wskazania S-05, nie błędy formularza.
- Zamrażania etatu, nazw i godzin w szkicu: szkic czyta słownik zmian i dane pracowników na żywo; zamrożenie robi S-08.
- Unikalności okresu: wiele szkiców na ten sam okres jest dozwolonych (S-12 i tak tworzy wiele wersji).
- Wydzielania wspólnych części (hook formularza, helpery tras API, kroki RLS w smoke), mimo że to trzeci zasób planisty. Powody: formularz grafiku (siatka i wielokrotny wybór) jest strukturalnie inny, a równoległe S-10 zmienia `employees.ts`, `EmployeeForm.tsx` i `scripts/smoke.mjs`, więc dotykanie kodu S-01 i S-02 zwiększa ryzyko konfliktów. Dług jest zapisany: wydzielenie po S-10 (hook transportu formularza, trasy API, kroki RLS w smoke); wzorzec zapowiedziany w review S-02 F3 pozostaje otwarty.
- Zmiany `PlannerLayout` (szerszy wariant) i układu mobilnego z kartami dni: siatka przewija się poziomo; widok obsadzania z S-04 (pracownicy × dni) poszerzy layout wtedy, gdy będzie potrzebny. NFR o telefonie dotyczy widoku pracownika (S-11).
- Domyślnej daty początkowej w formularzu (np. najbliższy poniedziałek), stronicowania, wyszukiwania, filtrów, wykrywania równoczesnych edycji (ostatni zapis wygrywa), kolumny `updated_at`.
- Zmian w `OPEN_PATHS`, w bramce dostępu, w `shifts.ts`, `employees.ts` i ich trasach, poza dopisaniem nowych ścieżek do testu domyślnej odmowy.
- Generowanych typów bazy, nowych zmiennych środowiskowych i klucza service-role w Workerze.

## Implementation Approach

Od środka na zewnątrz, jak w S-01 i S-02: czyste reguły (Faza 1), tabele i funkcja zapisu z RLS dowiedzione na prawdziwych tokenach (Faza 2), warstwa danych i API (Faza 3), strony i formularz (Faza 4). Każda faza kończy się własnym dowodem (testy jednostkowe, smoke przez PostgREST i RPC, smoke przez API, smoke stron i przegląd w przeglądarce). Wszystkie fazy trafiają do jednego pull requesta; wiersze zależne od PR i wdrożenia (4.3, 4.6, 4.7) wykonuje się po scaleniu.

Jedna funkcja `validateScheduleInput` obsługuje formularz i trasy API; baza powtarza granice w ograniczeniach `check`, a funkcja SQL przyjmuje już zwalidowany JSON i polega na ograniczeniach i kluczach obcych. Aplikacja normalizuje etykietę, deduplikuje i sortuje pracowników oraz sortuje komórki obsady, żeby ten sam zestaw danych dawał ten sam payload niezależnie od kolejności (wymóg deterministyczności z PRD i `CLAUDE.md`). Odwołania do zmian i pracowników są po `id`; klucze obce `on delete restrict` pilnują integralności, a usuwania i tak nie ma.

## Critical Implementation Details

- **Uprawnienia funkcji**: PostgreSQL nadaje `execute` rolom `PUBLIC` przy tworzeniu funkcji, a PostgREST wystawia funkcje schematu `public` jako RPC. Migracja musi odebrać `execute` roli `PUBLIC` i `anon` oraz nadać je `authenticated`; sama polityka RLS nie wystarczy, jeśli ktoś wywoła funkcję innym trybem. Funkcja ma `security invoker` i `set search_path = ''` z w pełni kwalifikowanymi nazwami.
- **Kolejność sprzątania w smoke**: klucze obce do `shifts` i `employees` są `on delete restrict`, więc końcowe usuwanie wierszy `Smoke-*` musi najpierw usunąć grafiki (kaskada czyści tabele podrzędne), potem zmiany i pracowników. Kroki sprzątania dla grafików stoją przed krokami z S-01 i S-02.

## Phase 1: Reguły grafiku

### Overview

Dodać typy współdzielone oraz czyste funkcje: arytmetykę dat, etykiety dni, walidację z normalizacją, sortowanie listy i sumę obsady, wraz z testami. Żadne zachowanie aplikacji się jeszcze nie zmienia.

### Changes Required:

#### 1. Typy współdzielone

**File**: `src/types.ts`

**Intent**: Typy encji i DTO grafiku obok typów pracownika i zmiany (plik jest też zmieniany przez S-10; dopisywać na końcu).

**Contract**: `StaffingCell { shiftId: string; dayOffset: number; requiredCount: number }` (`dayOffset` 0 do 6, `requiredCount` 1 do 99); `ScheduleInput { startDate: string; label: string | null; staffing: StaffingCell[]; employeeIds: string[] }` (`startDate` to `YYYY-MM-DD`); `Schedule extends ScheduleInput { id: string; createdAt: string }`; `ScheduleSummary { id: string; startDate: string; label: string | null; createdAt: string; employeeCount: number; totalRequired: number }`; `ScheduleField = "startDate" | "label" | "staffing" | "employeeIds"`; `ScheduleFieldErrors = Partial<Record<ScheduleField, string>>`.

#### 2. Reguły grafiku

**File**: `src/lib/services/schedule.ts` (nowy)

**Intent**: Jedno źródło prawdy o tym, co jest poprawnym grafikiem tygodniowym i jak go wyświetlić i uporządkować, jako czyste funkcje bez importów `astro:*` i `cloudflare:workers` (dopuszczalny jest import `isUuid` z `src/lib/postgrest.ts`, o ile ten moduł nie ma importów uruchomieniowych spoza czystych funkcji; sprawdzić przy implementacji).

**Contract**: Stałe `SCHEDULE_LABEL_MAX_LENGTH = 60`, `STAFFING_MAX = 99`, `PERIOD_DAYS = 7`, zakres dat 2020-01-01 do 2099-12-31. Funkcje:

- `parseIsoDate(text: string): { year; month; day } | undefined`: dokładnie `RRRR-MM-DD` z prawdziwą datą kalendarzową (odrzuca `2026-02-30`, `2026-13-01`, `2026-1-5`, spacje) i rokiem w zakresie.
- `addDays(isoDate: string, days: number): string`: arytmetyka UTC (`Date.UTC`), wynik w `YYYY-MM-DD`; poprawnie przechodzi przez granice miesięcy, lat i lutego przestępnego.
- `periodEnd(startDate)`: `addDays(startDate, 6)`.
- `dayColumns(startDate): { offset: number; date: string; weekday: string; label: string }[]`: 7 kolumn od dnia startu; `weekday` z `getUTCDay` w skrótach `niedz.`, `pon.`, `wt.`, `śr.`, `czw.`, `pt.`, `sob.`; `label` to np. `śr. 11.11`.
- `formatPeriod(startDate): string`: `11.11–17.11.2026` w obrębie roku, `29.12.2026–04.01.2027` przez granicę roku (półpauza U+2013).
- `validateScheduleInput(raw: unknown): { ok: true; value: ScheduleInput } | { ok: false; errors: ScheduleFieldErrors }`. Wejście: `startDate`, `label` (ciąg, `null` lub brak), `staffing` (tablica obiektów `shiftId`, `dayOffset`, `requiredCount`), `employeeIds` (tablica). Błędne pola zwracane razem, po jednym komunikacie po polsku na pole. Data: `parseIsoDate`. Etykieta: opcjonalna; znaki sterujące `\p{Cc}` sprawdzane na surowym wejściu przed przycięciem, `isWellFormed()`, odrzucenie etykiet z samych niewidocznych znaków, przycięcie i zwinięcie białych znaków, pusta po normalizacji to `null`, długość do 60 w punktach kodowych (logika jak nazwa zmiany w `shift.ts:67-79`, skopiowana lokalnie; dług zapisany w "What We're NOT Doing"). Obsada: tablica; każda komórka z `shiftId` będącym UUID, `dayOffset` całkowitym 0 do 6, `requiredCount` całkowitym 1 do 99; powtórzona para (`shiftId`, `dayOffset`) to błąd; co najmniej jedna komórka; górny limit 350 komórek. Pracownicy: tablica UUID, co najmniej jeden, duplikaty zdeduplikowane po cichu. Wynik znormalizowany: `staffing` posortowane po `shiftId`, potem `dayOffset`; `employeeIds` posortowane i unikalne.
- `totalRequired(staffing): number`: suma `requiredCount`.
- `sortSchedules(list: readonly { id; startDate; createdAt }[])`: nowa tablica, klucze: `startDate` malejąco, `createdAt` malejąco (przez `Date.parse`, nie jako tekst), `id` rosnąco; wynik niezależny od kolejności wejścia (generyczna po polach kluczy, by obsłużyć `Schedule` i `ScheduleSummary`).

#### 3. Testy reguł

**File**: `src/lib/services/schedule.test.ts` (nowy), `src/lib/services/access.test.ts`

**Intent**: Udowodnić granice dat, arytmetykę tygodnia, normalizację i powtarzalność oraz zablokować przypadkowe otwarcie nowych tras.

**Contract**: Przypadki (nazwane): (a) `parseIsoDate`: przyjęte `2026-11-11`, `2024-02-29`, `2020-01-01`, `2099-12-31`; odrzucone `2026-02-30`, `2025-02-29`, `2026-13-01`, `2026-11-31`, `2026-1-5`, ` 2026-11-11`, `2019-12-31`, `2100-01-01`, pusty ciąg, liczba; (b) `addDays`: `2026-11-11` plus 6 to `2026-11-17`; `2026-12-29` plus 6 to `2027-01-04`; `2028-02-27` plus 3 to `2028-03-01`; `2026-03-29` plus 6 to `2026-04-04` (granica czasu letniego nie wpływa na wynik); (c) `dayColumns('2026-11-11')`: pierwsza kolumna `śr. 11.11`, ostatnia `wt. 17.11`; start w niedzielę zaczyna od `niedz.`; (d) `formatPeriod`: `11.11–17.11.2026`, przez rok `29.12.2026–04.01.2027`, przez miesiąc `28.10–03.11.2026`; (e) walidacja etykiety: brak, `null`, pusty ciąg i same spacje dają `null`; 60 znaków przyjęte, 61 odrzucone; znak sterujący (też tabulator w środku) i same niewidoczne znaki odrzucone; podwójna spacja zwinięta; (f) walidacja obsady: `requiredCount` 0, 100, 1.5, `"2"` odrzucone; `dayOffset` -1, 7 odrzucone; powtórzona para odrzucona; pusta tablica odrzucona; `shiftId` niebędący UUID odrzucony; (g) pracownicy: pusta lista odrzucona, duplikaty zdeduplikowane, nie-UUID odrzucony; (h) wszystkie błędne pola zwracane razem, a argument niebędący obiektem daje błędy pól wymaganych; (i) normalizacja: ten sam zestaw komórek i pracowników w różnej kolejności daje identyczny `value`; (j) `sortSchedules`: najnowszy okres pierwszy, remis po `createdAt` malejąco (też o różnej liczbie cyfr ułamka sekundy), potem `id`; (k) powtarzalność: `expectDeterministic` na `sortSchedules`, `validateScheduleInput` (warianty kolejności kluczy i elementów tablic z `seededShuffle`) i `dayColumns`, wejście niezmienione po wywołaniu. W `access.test.ts` lista domyślnej odmowy dostaje `/schedules`, `/schedules/new`, `/schedules/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90`, `/api/schedules`, `/api/schedules/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90`.

### Success Criteria:

#### Automated Verification:

- Testy reguł grafiku i polityki dostępu przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Komunikaty błędów po polsku, nazwy dni, format okresu (w tym przez granicę miesiąca i roku) oraz reguły obsady z testów zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Tabele, RLS i funkcja zapisu

### Overview

Dodać migrację z trzema tabelami (`schedules`, `schedule_staffing`, `schedule_employees`), ograniczeniami zgodnymi z regułami z Fazy 1, politykami RLS tylko dla planisty i funkcją `save_schedule`, a w smoke udowodnić przez PostgREST i RPC, na prawdziwych tokenach, że planista czyta i zapisuje atomowo, a pozostali aktorzy nie mają dostępu.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_schedules.sql` (nowy; utworzyć poleceniem `npx supabase migration new schedules` w chwili implementacji, żeby znacznik był późniejszy niż migracje już istniejące i migracja S-10)

**Intent**: Model grafiku tygodniowego według wzorca z `20261102071038_shifts.sql`, z ograniczeniami powtarzającymi granice aplikacji, uprawnieniami ściśle takimi, jakich używa aplikacja, i funkcją zapisującą całość w jednej transakcji.

**Contract**: 

- `public.schedules`: `id uuid primary key default gen_random_uuid()`, `start_date date not null`, `label text null`, `created_at timestamptz not null default now()`. Ograniczenia: `schedules_start_date_valid` (`start_date between '2020-01-01' and '2099-12-31'`), `schedules_label_valid` (`label is null or (label = btrim(label) and char_length(label) between 1 and 60)`). RLS: `planner can select schedules`, `planner can insert schedules`, `planner can update schedules` (`using` i `with check`), brak `delete`. Uprawnienia jak w `shifts.sql`: `revoke all ... from anon, authenticated; grant select, insert, update ... to authenticated;`.
- `public.schedule_staffing`: `schedule_id uuid not null references public.schedules (id) on delete cascade`, `shift_id uuid not null references public.shifts (id) on delete restrict`, `day_offset smallint not null`, `required_count smallint not null`, `primary key (schedule_id, shift_id, day_offset)`. Ograniczenia `schedule_staffing_day_offset_valid` (0 do 6) i `schedule_staffing_required_count_valid` (1 do 99). Indeks `schedule_staffing_shift_id_idx` na `shift_id` (wyszukiwanie przy `restrict`).
- `public.schedule_employees`: `schedule_id uuid not null references public.schedules (id) on delete cascade`, `employee_id uuid not null references public.employees (id) on delete restrict`, `primary key (schedule_id, employee_id)`, indeks `schedule_employees_employee_id_idx`.
- Obie tabele podrzędne: RLS włączone, polityki `planner can select / insert / delete ...` z `(select public.is_planner())` (bez `update`), `revoke all ... from anon, authenticated; grant select, insert, delete ... to authenticated;`. Komentarz `-- non-obvious:` wyjaśnia, dlaczego `delete` istnieje tu, a nie na nagłówku: zapis zastępuje całość, a nagłówek nigdy nie jest usuwany.
- `public.save_schedule(p_schedule_id uuid, p_start_date date, p_label text, p_staffing jsonb, p_employee_ids jsonb) returns uuid`: `language plpgsql`, `security invoker`, `set search_path = ''`. Dla `p_schedule_id is null` wstawia nagłówek; w przeciwnym razie aktualizuje `start_date` i `label` i, gdy żaden wiersz nie został zmieniony (nie istnieje albo RLS go ukrywa), podnosi wyjątek z kodem `PT404` (PostgREST mapuje go na HTTP 404). Następnie usuwa wiersze podrzędne grafiku i wstawia je z `jsonb_to_recordset(p_staffing)` (`shiftId`, `dayOffset`, `requiredCount`) oraz `jsonb_array_elements_text(p_employee_ids)`; zwraca `id`. Naruszenia ograniczeń i kluczy obcych przerywają całą transakcję. `revoke execute ... from public, anon; grant execute ... to authenticated;` z komentarzem `-- non-obvious:` (domyślny `execute` dla `PUBLIC`).
- Komentarz końcowy utrwala model: grafik jest szkicem czytającym słownik zmian i pracowników na żywo, S-04 doda obsadzenia, S-08 doda status i kopię nazwy oraz godzin, pracownik nie ma polityk do tych tabel.

#### 2. Smoke: baza i RPC

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić po stronie bazy, kto widzi i zmienia dane, na prawdziwych tokenach, oraz że zapis jest atomowy, a ograniczenia i klucze obce działają.

**Contract**: Pomocnicy `schedulesTable`, `scheduleStaffingTable`, `scheduleEmployeesTable` oparte na `restTable`. Dane smoke: etykiety `Smoke-<runId>-...`; zmiana i pracownik użyte w grafiku to wiersze utworzone wcześniej w tym przebiegu (ich `id` przechwycone w domknięciu) albo dedykowane wiersze `Smoke-*`. Kroki planisty: RPC `save_schedule` bez `p_schedule_id` zwraca UUID; odczyt nagłówka, komórek (np. 3 komórki dwóch zmian) i składu (2 osoby) zgadza się z wejściem; RPC z istniejącym `id` zmienia datę, usuwa komórkę i pracownika, dodaje inną komórkę, a odczyt pokazuje dokładnie nowy stan; **atomowość**: RPC z poprawnym nagłówkiem i jedną komórką naruszającą ograniczenie (`required_count` 0 albo nieistniejący `shiftId`) zwraca błąd, a liczba grafików z tą etykietą pozostaje zero; RPC z nieistniejącym `p_schedule_id` zwraca błąd 404; odrzucone bezpośrednie dodania (komunikat błędu nazywa ograniczenie): `start_date` 2019-12-31 (`schedules_start_date_valid`), etykieta pusta i z wiodącą spacją (`schedules_label_valid`), `day_offset` 7, `required_count` 100, powtórzony klucz główny; usunięcie nagłówka przez planistę odrzucone, a wiersz nadal istnieje; usunięcie pojedynczej komórki przez planistę dozwolone; usunięcie zmiany użytej w grafiku przez service-role odrzucone przez klucz obcy (`restrict`). Pracownik, konto bez roli i anonim: odczyt zwraca `[]` lub jest odrzucony, RPC odrzucone, bezpośrednie dodania odrzucone, a kontrolny odczyt planisty dowodzi, że dane się nie zmieniły. Kroki sprzątania dla grafików (service-role `DELETE /rest/v1/schedules?label=like.Smoke-*`) stoją przed istniejącymi krokami sprzątania zmian i pracowników.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- Linting przechodzi: `npm run lint`
- Smoke z krokami bazy i RPC przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos, ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`): `npm run smoke`

#### Manual Verification:

- Polityki RLS, uprawnienia (w tym `execute` funkcji), ograniczenia i komentarze w migracji zostały przejrzane przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Dostęp do danych i API

### Overview

Dodać warstwę danych grafików oraz dwie trasy JSON (tworzenie i edycja), z tą samą walidacją co formularz, i udowodnić je w smoke na prawdziwej sesji planisty.

### Changes Required:

#### 1. Dostęp do danych

**File**: `src/lib/schedules.ts` (nowy)

**Intent**: Jedyny moduł znający nazwy tabel i kolumn grafiku, bez logiki biznesowej; każda funkcja dostaje klienta `SupabaseClient` z sesji użytkownika, tak jak `shifts.ts`.

**Contract**: `listSchedules(supabase): Promise<ScheduleSummary[]>` (jedno zapytanie z osadzonymi `schedule_employees(count)` i `schedule_staffing(required_count)`; suma obsady liczona w aplikacji; wynik przez `sortSchedules`; przy błędzie bazy loguje przez `logDatabaseError` i rzuca, jak `listShifts`). `getSchedule(supabase, id): Promise<Schedule | null>` (`null` dla nie-UUID bez zapytania i dla nieistniejącego; osadzone `schedule_staffing` i `schedule_employees`; wynik znormalizowany jak w walidacji). `saveSchedule(supabase, id: string | null, input: ScheduleInput): Promise<{ ok: true; id: string } | { ok: false; error: "not_found" | "unknown_reference" | "failed" }>` wywołuje RPC `save_schedule` z `camelCase` w JSON-ie; kod `PT404` mapuje na `not_found`, kod `23503` (klucz obcy) na `unknown_reference`, resztę na `failed` z logiem (`code`, `message`, bez danych wejściowych).

#### 2. Trasy API

**File**: `src/pages/api/schedules/index.ts` (nowy), `src/pages/api/schedules/[id].ts` (nowy)

**Intent**: Trasy JSON dla tworzenia i zastępowania grafiku, w tej samej kolejności kontroli co trasy zmian.

**Contract**: `export const prerender = false`. `POST /api/schedules` (201 `{ id }`) i `PUT /api/schedules/[id]` (200 `{ id }`; ciało zastępuje cały zasób). Kolejność: `readJsonBody` (415 `unsupported_media_type`, 400 `invalid_json`), brak klienta (503 `not_configured`), `isUuid` na `id` (404 `not_found`), `validateScheduleInput` (422 `{ errors }`), `saveSchedule`: `not_found` to 404, `unknown_reference` to 422 `{ error: "unknown_reference" }` (zmiana lub pracownik już nie istnieje), `failed` to 500 `{ error: "failed" }`. Odpowiedzi przez `jsonResponse` (`no-store`).

#### 3. Smoke: API

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić kontrakt tras na prawdziwej sesji planisty i odmowy dla pozostałych aktorów.

**Contract**: Kroki między `signIn(planner)` a `signOut(planner)`: `POST` poprawnego grafiku (etykieta `Smoke-<runId>-api`, 2 zmiany, 3 komórki, 2 pracowników) zwraca 201 z UUID, a odczyt bazy (planista przez PostgREST) potwierdza nagłówek, komórki i skład; `PUT` zmienia datę i obsadę, odczyt potwierdza stan, `no-store`; 422 z dokładnym zbiorem pól (zła data, etykieta 61 znaków, pusta obsada, powtórzona para, pusta lista pracowników); 422 `unknown_reference` dla losowego UUID zmiany; 415 bez `Content-Type: application/json`; 400 `invalid_json`; 404 dla nieznanego UUID i dla `not-a-uuid` w `PUT`. Pracownik, konto bez roli (403) i anonim (401) dostają odmowę na `POST` i `PUT` (JSON pod `/api/`).

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke z krokami API przechodzi lokalnie (jak w Fazie 2): `npm run smoke`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Strony planisty

### Overview

Dodać listę, formularz tworzenia i edycji z siatką obsady i wyborem pracowników, kafelek w panelu, informację D6, smoke stron i dokumentację.

### Changes Required:

#### 1. Strony

**File**: `src/pages/schedules/index.astro`, `src/pages/schedules/new.astro`, `src/pages/schedules/[id].astro` (nowe)

**Intent**: Lista i formularze w `PlannerLayout` według wzorca stron zmian, z nagłówkiem `Cache-Control: no-store` jak na stronach pracowników (strony pokazują imiona i nazwiska).

**Contract**: Lista: guard `locals.supabase` (jak `shifts/index.astro:6-10`), `listSchedules`; pusty stan; tabela od `md` (okres z `formatPeriod`, etykieta lub "—", liczba pracowników, suma obsady, data utworzenia, "Edytuj" z `aria-label` zawierającym okres) i karty na telefonie; przycisk "Nowy grafik". `new.astro` i `[id].astro` ładują zmiany (`listShifts`, posortowane) i pracowników (`listEmployees`, posortowani funkcją z `employee.ts`) i przekazują je wyspie jako dane serializowalne (godziny zmian jako gotowy tekst z `formatShiftTimes`, `endsNextDay`, `formatDuration`); gdy brak zmian lub pracowników, zamiast formularza pokazują komunikat z odnośnikiem do `/shifts/new` lub `/employees/new`. `[id].astro`: `getSchedule` zwraca `null` dla nie-UUID i nieistniejącego, wtedy `Astro.response.status = 404` i komunikat "Nie znaleziono grafiku". Wspólny element `ScheduleNotice.astro` w `src/components/schedules/` z informacją D6: "To szkic grafiku tygodniowego. Nie zastępuje rozkładu czasu pracy, który zgodnie z art. 129 § 3 Kodeksu pracy obejmuje co najmniej miesiąc i powinien być przekazany pracownikowi z tygodniowym wyprzedzeniem." (treść do zatwierdzenia przez autora), pokazany nad listą i nad formularzem.

#### 2. Formularz

**File**: `src/components/schedules/ScheduleForm.tsx`, `src/components/schedules/StaffingGrid.tsx`, `src/components/schedules/EmployeePicker.tsx`, `src/components/hooks/useScheduleForm.ts` (nowe)

**Intent**: Wyspa React i hook zbudowane na wzorcu `ShiftForm.tsx` i `useShiftForm.ts` (w tym `focusFirstInvalid`, czyszczenie błędu pola zależnego, `window.location.replace` po sukcesie, obsługa 401/403 komunikatem o sesji, limit znaków etykiety w punktach kodowych), z walidacją tą samą `validateScheduleInput`.

**Contract**: Pola: data (`type="date"` z `min="2020-01-01"` i `max="2099-12-31"`, żeby zakres pilnowała przeglądarka, a komunikat walidacji mógł być krótki: "Podaj poprawną datę początkową."), etykieta, siatka, pracownicy. Siatka: wiersze to zmiany dodane z listy rozwijanej "Dodaj zmianę" (opcja pokazuje nazwę i godziny, np. `Nocna 22:00–06:00, następnego dnia, 8 h`; już dodane nie są oferowane), wiersz usuwa się przyciskiem "Usuń"; kolumny to `dayColumns(startDate)` (przed wpisaniem poprawnej daty nagłówki są ogólne, "Dzień 1" do "Dzień 7"); komórki to `input` numeryczne 0 do 99 z `aria-label` "<zmiana>, <dzień>", pusta komórka znaczy 0; kolumna zmian przyklejona (`sticky`), kontener `overflow-x-auto`; podsumowanie sumy. Pracownicy: `fieldset` z polami wyboru, na `/new` wszyscy zaznaczeni; przyciski "Zaznacz wszystkich" i "Odznacz wszystkich"; wspólny komunikat błędu z `aria-describedby`. Zapis: `POST /api/schedules` albo `PUT /api/schedules/<id>`, po sukcesie przejście na `/schedules`. Tryb edycji wypełnia stan z `Schedule`, a zmiany i pracownicy zapisani w grafiku, których już nie ma na liście wyboru, są pokazane jako "(niedostępne)", żeby zapis nie gubił ich po cichu.

#### 3. Panel i smoke stron

**File**: `src/pages/planner/index.astro`, `scripts/smoke.mjs`

**Intent**: Dodać kafelek "Grafiki" i udowodnić strony w smoke.

**Contract**: Trzeci kafelek "Grafiki" z odnośnikiem do `/schedules` w siatce panelu; w smoke osobny krok na kafelek (nie podmieniać istniejących). Kroki stron między `signIn(planner)` a `signOut(planner)`: `/schedules` 200, `no-store`, zawiera etykietę grafika z API, okres i "Edytuj", zawiera tekst D6; `/schedules/new` 200 z nagłówkiem formularza i tekstem D6; `/schedules/<id>` 200 z etykietą; `/schedules/<losowy UUID>` 404 z komunikatem; pracownik, konto bez roli i anonim: odmowa stron (403 `/access-denied` lub przekierowanie zgodne z istniejącymi krokami).

#### 4. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Utrzymać dokumentację zgodną z kodem (review S-02 F3 poprawiał to po fakcie).

**Contract**: `CLAUDE.md` sekcja "Data access": akapit o stronach grafików (`src/pages/schedules/`, wyspa `ScheduleForm.tsx`, hook `useScheduleForm`, trasy `/api/schedules`, funkcja SQL `save_schedule`, reguły w `src/lib/services/schedule.ts`) i uzupełnienie opisu `npm run smoke` o dane i trasy grafików; `AGENTS.md` (Project Structure) i `README.md` (tabela tras od `:151`, opis migracji, opis smoke) o nowe strony, trasy i tabele. Nie dotykać fragmentów o service-role (zmienia je S-10).

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami stron przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- W przeglądarce na desktopie: lista, tworzenie i edycja grafiku, siatka z przewijaniem poziomym i przyklejoną kolumną, zmiana daty zmienia nagłówki dni, błędy przy polach i fokus na pierwszym błędnym polu, obsługa klawiaturą, informacja D6
- Na telefonie (lub emulacji): formularz da się wypełnić, pole daty działa, siatka przewija się poziomo bez rozjeżdżania strony
- Migracja jest zastosowana na hostowanym projekcie (`npx supabase db push`) przed wdrożeniem kodu
- Po wdrożeniu (`npm run build` i `npx wrangler deploy`) grafik da się utworzyć i edytować na produkcji; nie uruchamiać `npm run smoke` na produkcji

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Reguły grafiku (`schedule.test.ts`): daty i granice kalendarza, dni od dnia startu, okres przez granicę miesiąca i roku, walidacja etykiety, obsady i składu, normalizacja niezależna od kolejności, sortowanie listy, powtarzalność przez `expectDeterministic`.
- Lista domyślnej odmowy dla nowych tras w `access.test.ts`.

### Integration Tests:

- Smoke przez PostgREST i RPC (Faza 2): RLS dla czterech aktorów, ograniczenia, atomowość zapisu, klucze obce, brak usuwania nagłówka.
- Smoke przez API (Faza 3): kody 201, 200, 400, 404, 415, 422, odmowy dla pozostałych aktorów, `no-store`.
- Smoke stron (Faza 4): lista, formularze, 404, tekst D6, kafelek, odmowy.
- Brak testów komponentów i hooków (jak w S-01 i S-02); formularz sprawdza przegląd w przeglądarce.

### Manual Testing Steps:

1. Utworzyć dwie zmiany (`06:00–14:00` i `22:00–06:00`) i dwóch pracowników, dodać grafik od środy z siatką 2 × 7 i sprawdzić listę (okres, liczba pracowników, suma obsady).
2. Zmienić datę początkową szkicu na niedzielę i sprawdzić, że nagłówki dni się przesuwają, a obsada zostaje przypisana do tych samych pozycji (1. do 7. dzień).
3. Edytować grafik: odznaczyć pracownika, usunąć wiersz zmiany, zapisać i sprawdzić, że lista i edycja pokazują dokładnie nowy stan.
4. Wywołać błąd walidacji (pusta obsada, data poza zakresem) i sprawdzić fokus oraz komunikaty.
5. Zalogować się jako pracownik (po S-10 lub kontem z admin API) i sprawdzić odmowę `/schedules`.

## Performance Considerations

Lista pobiera nagłówki z osadzonymi licznikami jednym zapytaniem; przy dziesiątkach grafików to niewielka ilość danych (każdy grafik ma najwyżej 350 komórek). Zapis to jedno wywołanie RPC. Workers Free ma 10 ms CPU na żądanie; strony i trasy wykonują po jednym lub dwóch zapytaniach do Supabase (czas oczekiwania na sieć nie liczy się jako CPU). Brak stronicowania, świadomie (jak w S-01 i S-02).

## Migration Notes

Migracja jest addytywna (trzy nowe tabele, funkcja), więc można ją zastosować na hostowanym projekcie przed wdrożeniem kodu: `npx supabase db push`, potem `npm run build` i `npx wrangler deploy`. Zmiany w migracji po scaleniu robi się nową migracją, nie edycją. Jeśli S-10 scali się pierwsze i jego migracja trafi na hostowany projekt przed tą, `db push` zgłosi migrację lokalną wcześniejszą niż ostatnia zdalna; znacznik czasu migracji S-03 tworzy się w chwili implementacji Fazy 2 i w razie potrzeby zmienia nazwę pliku przed pierwszym `db push` (migracja nie była jeszcze zastosowana zdalnie).

## Parallel Work Notes

S-10 (`employee-invitation`) jest planowane i może być implementowane równolegle. Wspólne punkty styku: `scripts/smoke.mjs` (oba plany dopisują kroki; S-03 dopisuje sekcje grafików, S-10 sekcje zaproszeń i sprzątanie kont; konflikty są mechaniczne, drugi do scalenia robi rebase i uruchamia pełny smoke), `src/types.ts` (S-03 dopisuje typy grafiku, S-10 rozszerza `Employee`), `src/lib/services/access.test.ts`, dokumentacja (`CLAUDE.md`, `AGENTS.md`, `README.md`; S-10 zmienia fragmenty o service-role, S-03 sekcję danych) oraz kolejność migracji. S-03 tylko czyta pracowników przez `listEmployees` i nie zależy od nowych kolumn S-10; S-10 nie dotyka niczego z grafików.

## References

- Roadmap: `context/foundation/roadmap.md` (S-03), PRD: `context/foundation/prd.md` (FR-008, FR-009, FR-013, FR-019), reguły: `context/foundation/work-time-rules.md` (D2, D6)
- Wzorzec: `context/archive/2026-10-29-shift-dictionary/plan.md` oraz `reviews/plan-review.md`, `reviews/impl-review.md`; `context/archive/2026-10-21-employee-roster/plan.md`
- Reguły i dane: `src/lib/services/shift.ts:91-138`, `src/lib/shifts.ts`, `src/lib/postgrest.ts:6-15`
- API i strony: `src/pages/api/shifts/index.ts:9-30`, `src/pages/api/shifts/[id].ts:11-40`, `src/pages/shifts/index.astro`, `src/components/shifts/ShiftForm.tsx:36-103`, `src/components/hooks/useShiftForm.ts`
- Baza: `supabase/migrations/20261102071038_shifts.sql`, `supabase/migrations/20261020131134_role_helpers.sql:35-57`
- Smoke: `scripts/smoke.mjs`; testy deterministyczne: `src/lib/testing/determinism.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguły grafiku

#### Automated

- [x] 1.1 Testy reguł grafiku i polityki dostępu przechodzą w workerd: `npm test` — 73ff014
- [x] 1.2 Linting przechodzi: `npm run lint` — 73ff014
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 73ff014

#### Manual

- [x] 1.4 Komunikaty błędów po polsku, nazwy dni, format okresu (w tym przez granicę miesiąca i roku) oraz reguły obsady z testów zostały przejrzane i zatwierdzone przez autora — 73ff014

### Phase 2: Tabele, RLS i funkcja zapisu

#### Automated

- [x] 2.1 Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset` — c633a0a
- [x] 2.2 Linting przechodzi: `npm run lint` — c633a0a
- [x] 2.3 Smoke z krokami bazy i RPC przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos, ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`): `npm run smoke` — c633a0a

#### Manual

- [x] 2.4 Polityki RLS, uprawnienia (w tym `execute` funkcji), ograniczenia i komentarze w migracji zostały przejrzane przez autora — c633a0a

### Phase 3: Dostęp do danych i API

#### Automated

- [ ] 3.1 Testy przechodzą: `npm test`
- [ ] 3.2 Linting przechodzi: `npm run lint`
- [ ] 3.3 Sprawdzanie typów przechodzi: `npx astro check`
- [ ] 3.4 Build przechodzi: `npm run build`
- [ ] 3.5 Smoke z krokami API przechodzi lokalnie (jak w Fazie 2): `npm run smoke`

### Phase 4: Strony planisty

#### Automated

- [ ] 4.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.2 Smoke z krokami stron przechodzi lokalnie: `npm run smoke`
- [ ] 4.3 CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual

- [ ] 4.4 W przeglądarce na desktopie: lista, tworzenie i edycja grafiku, siatka z przewijaniem poziomym i przyklejoną kolumną, zmiana daty zmienia nagłówki dni, błędy przy polach i fokus na pierwszym błędnym polu, obsługa klawiaturą, informacja D6
- [ ] 4.5 Na telefonie (lub emulacji): formularz da się wypełnić, pole daty działa, siatka przewija się poziomo bez rozjeżdżania strony
- [ ] 4.6 Migracja jest zastosowana na hostowanym projekcie (`npx supabase db push`) przed wdrożeniem kodu
- [ ] 4.7 Po wdrożeniu (`npm run build` i `npx wrangler deploy`) grafik da się utworzyć i edytować na produkcji; nie uruchamiać `npm run smoke` na produkcji
