# Manual shift assignment Implementation Plan

## Overview

Czwarty wycinek domenowy Shiftly (S-04 z roadmapy, FR-011 w części ręcznej, US-01): planista ręcznie przypisuje pracowników do zmian w szkicu grafiku tygodniowego z S-03 i poprawia te wpisy. Przypisanie to cztery wartości: grafik, zmiana, dzień (0 do 6 od daty początkowej) i pracownik, plus znacznik pochodzenia `source` (`manual` albo `generated`), który od pierwszej migracji odróżnia wpis ręczny od przyszłego wygenerowanego (S-09). Widok obsadzania to osobna strona `/schedules/<id>/assign` z tabelą pracownicy × dni, a pod nią podsumowanie obsady zmiana × dzień ("x z y"). Każde dodanie i zdjęcie zmiany zapisuje się od razu jednym żądaniem. Plan wymusza zmianę w kodzie S-03: `save_schedule` usuwał i wstawiał obsadę oraz skład od nowa przy każdym zapisie, więc przy przypisaniach z kluczami obcymi kasowałby je nawet po zmianie samej etykiety. Zapis staje się różnicowy, a usunięcie komórki lub osoby, która ma przypisania, wymaga jawnego potwierdzenia wymuszanego przez bazę. Reguły (S-05), godziny (S-06), nieobecności (S-07), zatwierdzanie (S-08) i generowanie (S-09) są poza zakresem.

## Current State Analysis

- Model S-03 (`supabase/migrations/20261106120157_schedules.sql`): `schedules` (bez `delete`), `schedule_staffing` z kluczem głównym `(schedule_id, shift_id, day_offset)` (`:42`) i `schedule_employees` z kluczem `(schedule_id, employee_id)` (`:56`). Oba klucze nadają się na cel złożonych kluczy obcych. Tabele podrzędne mają polityki `select`, `insert`, `delete` dla planisty i grant bez `update` (`:64-86`).
- `public.save_schedule(uuid, date, text, jsonb, jsonb)` (`:95-139`): przy edycji aktualizuje nagłówek, potem bezwarunkowo usuwa wszystkie wiersze obsady i składu (`:125-126`) i wstawia je od nowa. `PT404` dla nieistniejącego grafiku (`:121-123`), `security invoker`, `set search_path = ''`, `execute` odebrane `public` i `anon` (`:144-145`).
- Warstwa danych `src/lib/schedules.ts`: `saveSchedule` (`:122-144`) wysyła pięć nazwanych parametrów, `saveFailure` (`:78-87`) mapuje `PT404` i `23503`. Trasa `src/pages/api/schedules/[id].ts:11-44` (415/400, 503, 404, 422, zapis). Hook `src/components/hooks/useScheduleForm.ts:179-212` zapisuje całość jednym `fetch` i po sukcesie przechodzi na `/schedules`.
- Strony: `src/pages/schedules/{index,new,[id]}.astro`, `PlannerLayout.astro:15` ze sztywnym `max-w-4xl` (S-03 zostawiło poszerzenie dla S-04), `StaffingGrid.tsx:30` z przyklejoną kolumną (`sticky`, nieprzezroczyste tło). Odnośniki "Edytuj" na liście: `index.astro:94-100` (tabela) i `:116-122` (karty).
- W repo nie ma jeszcze: zapisu różnicowego (`upsert`, `on conflict`), złożonych kluczy obcych, polityki i grantu `update` na tabelach podrzędnych grafiku, drugiej funkcji RPC, kolumny pochodzenia wpisu. Dostęp do nowych tras załatwia domyślna odmowa w `access.ts`; wystarczy dopisać ścieżki do listy w `access.test.ts:165-169`.
- Smoke `scripts/smoke.mjs` (płaska tablica `steps`, aktorzy `anonymous`, `noRole`, `employee`, `planner`): pomocniki tabel `restTable` (`:177-195`), `scheduleTables` i `plannerRejectsScheduleRow` (`:660-669`), `notPlannerScheduleSteps` (`:674-767`), kroki bazy grafików (`:1587-1769`), sprzątanie service-role (`:1783-1801`). Numery linii liczone na gałęzi S-03; po scaleniu z S-10 przesuwają się, więc w implementacji szukać po nazwach.
- PRD nie rozstrzyga nadmiaru obsady, dwóch zmian jednego dnia, pracownika spoza składu ani osieroconych wpisów; rozstrzygnięcia z wywiadu są w "Implementation Approach". `context/foundation/lessons.md` nie istnieje. Reguły z review S-01 do S-02: osobny krok smoke na każdy kod odpowiedzi, `no-store` na stronach z danymi osobowymi, `window.location.replace` po zapisie, `aria-invalid` i `aria-describedby`, nazwane ograniczenia, jawne `revoke` i `grant`, funkcje czyste zwracające nowe tablice.
- Stan bazy w chwili rozpoczęcia implementacji (2026-11-24): S-03 (PR #8) i pin CLI (PR #9) są na `master`, a gałąź S-04 stoi na głowie S-10 (`59f3bef`, S-03 + S-10 scalone), więc kod i migracje S-10 (`20261123100833`, `20261123194030`) są już w jej bazie; PR #7 czeka na scalenie (zob. "Parallel Work Notes"). Numery linii z S-03 w tym planie dotyczą stanu przed S-10 i po scaleniu się przesuwają, więc w implementacji szukać po nazwach.

## Desired End State

- Na liście `/schedules` każdy grafik ma odnośnik "Obsadź" do `/schedules/<id>/assign`, a na stronie edycji jest odnośnik do tego widoku.
- Widok w szerokim wariancie `PlannerLayout`: wiersz na pracownika ze składu grafiku, kolumna na dzień (nagłówki z `dayColumns`), w komórce przyciski zmian, które mają w tym dniu obsadę (`aria-pressed`, nazwa i godziny). Kliknięcie dodaje albo zdejmuje przypisanie od razu, z natychmiastową aktualizacją widoku i wycofaniem przy błędzie. Pod tabelą podsumowanie zmiana × dzień z "x z y" i tekstowym oznaczeniem braku (`−n`) lub nadmiaru (`+n`) jako informacją, nie błędem. Ta sama osoba może mieć kilka zmian jednego dnia.
- Przypisać można tylko w komórce z obsadą 1 do 99 i tylko osobę ze składu grafiku; gwarantuje to baza (złożone klucze obce), nie tylko aplikacja. Każdy wpis zapisany przez S-04 ma `source = 'manual'`.
- Zapis grafiku (S-03) jest różnicowy: zmiana etykiety, daty lub liczby osób w komórce zachowuje przypisania. Usunięcie komórki lub osoby z przypisaniami kończy się odpowiedzią 409 z liczbą przypisań, formularz pokazuje ją i po jawnym potwierdzeniu ponawia zapis; wtedy przypisania znikają razem z komórką lub osobą. Zmiana daty początkowej grafiku z przypisaniami pokazuje nieblokującą informację, że przypisania przesuną się razem z datą.
- Pracownik, konto bez roli i anonim nie widzą ani nie zmieniają przypisań (RLS w bazie, bramka w aplikacji).
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, a smoke z nowymi krokami (baza, RPC, API, strony) przechodzi lokalnie i w CI.

### Key Discoveries:

- Złożone klucze obce `(schedule_id, shift_id, day_offset)` i `(schedule_id, employee_id)` są możliwe bez zmiany S-03, bo klucze główne obu tabel mają dokładnie te kolumny (`20261106120157_schedules.sql:42,56`). To przenosi integralność do bazy: przypisanie nie wskaże komórki ani osoby spoza grafiku.
- Przy `on delete cascade` kasowanie wszystkich wierszy obsady w `save_schedule` (`:125-126`) skasowałoby wszystkie przypisania przy każdym zapisie formularza. Dlatego zapis musi być różnicowy, a zmiana `required_count` musi iść przez `update` (usunięcie i wstawienie komórki skasowałoby jej przypisania), co wymaga polityki i grantu `update (required_count)` na `schedule_staffing` (dziś ich nie ma, `:83`).
- Kontrole spójności i akcje referencyjne baza wykonuje z pominięciem RLS, więc kaskada z `schedule_staffing` i `schedule_employees` działa także bez polityki `delete` na tabeli przypisań; smoke ma to dowieść na prawdziwym tokenie planisty.
- PostgREST rozwiązuje osadzanie przez bezpośredni klucz obcy, a przypisania mają tylko złożone klucze do tabel podrzędnych, więc nie da się ich osadzić w zapytaniu o `schedules`; czyta je osobne zapytanie po `schedule_id`. Limit `max_rows = 1000` (`supabase/config.toml:18`) ucina odczyt po cichu, więc moduł danych ma odmówić, gdy odpowiedź dobije do limitu.
- `PT404` z S-03 pokazuje wzorzec: własny SQLSTATE `PTxyz` jest mapowany przez PostgREST na status HTTP, a `detail` wyjątku wraca jako `details` w błędzie. Ten sam mechanizm przenosi `PT409` z liczbą przypisań.
- Zmiana daty początkowej przesuwa kalendarzowe daty przypisań, bo wpis trzyma `day_offset` (decyzja S-03: zmiana daty nie przepisuje siatki). Dla S-05 i S-07, które liczą po datach, jest to spójne, o ile planista wie, co robi; stąd informacja w formularzu.

## What We're NOT Doing

- Reguł i wskazań: brak kadrowy, nadmiar, kolizje zmian jednego dnia, odpoczynek, limity godzin to S-05. Licznik "x z y" jest informacją o obsadzie, nie naruszeniem i nie ma wagi ani koloru błędu.
- Godzin pracownika względem normy (S-06), nieobecności (S-07), zatwierdzania i zamrażania grafiku (S-08), generowania (S-09), wersji (S-12). S-04 rezerwuje tylko wartość `generated` w ograniczeniu i nigdy jej nie zapisuje.
- Polityki ani grantu `update` na przypisaniach: wpis ma tożsamość w kluczu, więc "poprawianie" to zdjęcie i dodanie. Zmianę `source` doda S-09 własną migracją.
- Zamiany osoby, przeniesienia wpisu na inną zmianę lub dzień jednym ruchem, przeciągania, kopiowania poprzedniego tygodnia, masowego wypełniania.
- Przypisywania w komórce bez obsady albo osoby spoza składu: baza to odrzuca (kod `23503`), a widok nie oferuje takich przycisków.
- Pokazywania `source` w widoku i w liście (wszystkie wpisy S-04 są ręczne), liczników przypisań na liście grafików, wskaźników obciążenia osoby w tygodniu.
- Usuwania grafików (FR-018), wykrywania równoległych edycji (ostatni zapis wygrywa; zapis przy każdej zmianie zawęża okno konfliktu do jednego przycisku), synchronizacji między kartami przeglądarki.
- Widoku planisty na telefonie poza przewijaniem poziomym z przyklejoną kolumną (NFR o telefonie dotyczy widoku pracownika, S-11) oraz testów komponentów i hooków (jak w S-01 do S-03; weryfikuje je przegląd w przeglądarce).
- Edycji migracji S-03 (jest w PR #8 i może trafić na hostowany projekt przed tą): zmiany idą nową migracją.
- Zmian w `access.ts`, `middleware.ts`, `ci.yml`, `package.json`, nowych zmiennych środowiskowych, nowych aktorów smoke i klucza service-role w Workerze.
- Wydzielania wspólnego kodu formularzy i tras (dług z S-03 czeka na po S-10); stały fragment przyklejonej kolumny jest świadomie skopiowany z `StaffingGrid.tsx`.

## Implementation Approach

Od środka na zewnątrz, jak w S-03: czyste reguły (Faza 1), baza z różnicowym zapisem dowiedziona w smoke na tokenach czterech aktorów (Faza 2), warstwa danych i API (Faza 3), zmiany w formularzu grafiku (Faza 4), widok obsadzania z dokumentacją (Faza 5). Wszystkie fazy trafiają do jednego pull requesta; wiersze zależne od PR i wdrożenia wykonuje się po scaleniu.

Decyzje z wywiadu: osobna strona w układzie pracownicy × dni (klasyczny grafik; wskazania S-05 i godziny S-06 mają w nim naturalne miejsce w wierszu i dniu osoby); usunięcie komórki lub osoby z przypisaniami przez kaskadę po potwierdzeniu; znacznik `source` w kolumnie z `CHECK`; nadmiar obsady dozwolony z licznikiem; kilka zmian jednego dnia dozwolone (ocenia S-05); zapis przy każdej zmianie zwykłym insertem i deletem z RLS, bez drugiej funkcji RPC; zmiana daty z nieblokującą informacją.

Rozstrzygnięte w planowaniu: potwierdzenie usunięcia wymusza serwer, nie tylko formularz. Funkcja `save_schedule` dostaje szósty parametr `p_confirm_removals` i przed usunięciem liczy przypisania, które by znikły; gdy jest ich więcej niż zero, a potwierdzenia nie ma, przerywa całość błędem `PT409` z liczbą w `detail`. Dzięki temu nieaktualny widok (ktoś dodał przypisanie po załadowaniu strony) i klient pomijający formularz nie gubią wpisów po cichu. Zapisy przypisań są idempotentne: dodanie istniejącego i zdjęcie nieistniejącego nie dają błędu, co upraszcza podwójne kliknięcia i wyścigi. Nowa tabela nie ma klucza obcego do `schedules`: przypisania wiszą na obsadzie i składzie, a te kaskadują z grafiku.

## Critical Implementation Details

- **Kolejność w `save_schedule`**: liczenie przypisań do usunięcia i ewentualne `PT409` poprzedzają jakiekolwiek `delete` w tej samej funkcji; sam wyjątek wycofuje też aktualizację nagłówka. Usunięcia (kaskada kasuje przypisania) poprzedzają `insert ... on conflict`, a nie odwrotnie. `p_confirm_removals` równe `null` znaczy `false`.
- **Sygnatura funkcji**: `create or replace` nie zmieni listy parametrów, a drugie przeciążenie byłoby dla PostgREST niejednoznaczne. Migracja robi `drop function public.save_schedule(uuid, date, text, jsonb, jsonb)`, tworzy wersję z sześcioma parametrami i ponawia `revoke execute ... from public, anon` oraz `grant execute ... to authenticated` na nowej sygnaturze. Aplikacja zawsze wysyła wszystkie sześć nazwanych parametrów.
- **Odczyt przypisań**: gdy zapytanie zwróci tyle wierszy, ile wynosi limit `max_rows` (1000), moduł danych rzuca błąd zamiast zwracać obcięty zbiór, bo S-05 liczyłby na obciętych danych.
- **Widok i żądania**: kliknięcie jest ignorowane, dopóki żądanie dla tej samej pary pracownik i zmiana w danym dniu jest w toku; aktualizacja widoku jest natychmiastowa, a przy błędzie wraca do stanu sprzed kliknięcia z komunikatem w `role="alert"`.

## Phase 1: Reguły przypisań

### Overview

Dodać typy i czyste funkcje: walidację wejścia przypisania, sortowanie, grupowanie przypisań po pracowniku i dniu oraz podsumowanie obsady komórek, wraz z testami. Żadne zachowanie aplikacji się jeszcze nie zmienia.

### Changes Required:

#### 1. Typy współdzielone

**File**: `src/types.ts`

**Intent**: Typy przypisania i podsumowania obsady obok typów grafiku. Plik zmienia też S-10, więc dopisywać w środku (po `ScheduleFieldErrors`, przed `ShiftOption`), nie na końcu.

**Contract**: `AssignmentSource = "manual" | "generated"`; `AssignmentInput { shiftId: string; dayOffset: number; employeeId: string }` (`dayOffset` 0 do 6); `Assignment extends AssignmentInput { source: AssignmentSource }`; `AssignmentField = "shiftId" | "dayOffset" | "employeeId"`; `AssignmentFieldErrors = Partial<Record<AssignmentField, string>>`; `CoverageCell { shiftId: string; dayOffset: number; required: number; assigned: number; missing: number; surplus: number }`.

#### 2. Reguły przypisań

**File**: `src/lib/services/assignment.ts` (nowy)

**Intent**: Jedno źródło prawdy o tym, co jest poprawnym wejściem przypisania i jak je zgrupować i podsumować, jako czyste funkcje bez importów `astro:*` i `cloudflare:workers` (dopuszczalne importy `isUuid` z `src/lib/postgrest.ts` i `PERIOD_DAYS` z `schedule.ts`). Wejście nie jest mutowane, wyniki to nowe tablice w kanonicznej kolejności.

**Contract**:

- `validateAssignmentInput(raw: unknown): { ok: true; value: AssignmentInput } | { ok: false; errors: AssignmentFieldErrors }`. `shiftId` i `employeeId` to UUID (zapisane małymi literami w wyniku), `dayOffset` całkowity 0 do 6 (`-0` z JSON-a daje `0`). Błędne pola zwracane razem, po jednym komunikacie po polsku na pole; argument niebędący obiektem daje błędy wszystkich pól. Nie sprawdza istnienia komórki ani osoby: to klucze obce w bazie.
- `sortAssignments<T extends AssignmentInput>(list: readonly T[]): T[]`: nowa tablica, klucze `shiftId`, `dayOffset`, `employeeId` (porządek kodowych jednostek tekstu, jak `compareText` w `schedules.ts`).
- `employeeDayKey(employeeId: string, dayOffset: number): string` i `groupByEmployeeDay(assignments: readonly AssignmentInput[]): Record<string, string[]>`: dla każdej pary pracownik i dzień lista identyfikatorów zmian, bez powtórzeń, posortowana.
- `summarizeCoverage(staffing: readonly Pick<StaffingCell, "shiftId" | "dayOffset" | "requiredCount">[], assignments: readonly AssignmentInput[]): CoverageCell[]`: jeden element na komórkę obsady, posortowane po `shiftId`, `dayOffset`; `assigned` to liczba różnych przypisań tej komórki (powtórzony klucz liczony raz), `missing = max(required − assigned, 0)`, `surplus = max(assigned − required, 0)`; przypisania bez komórki są pomijane.

#### 3. Testy reguł

**File**: `src/lib/services/assignment.test.ts` (nowy), `src/lib/services/access.test.ts`

**Intent**: Udowodnić granice walidacji, normalizację, liczenie obsady i powtarzalność oraz zablokować przypadkowe otwarcie nowych tras.

**Contract**: Przypadki (nazwane, tabele `it.each` jak w `schedule.test.ts`): (a) walidacja: poprawne wejście, UUID wielkimi literami zapisane małymi, `dayOffset` 0 i 6 przyjęte, `-1`, `7`, `1.5`, `"2"`, `null` odrzucone, `-0` daje `0`, `shiftId` i `employeeId` niebędące UUID odrzucone, wszystkie błędne pola zwracane razem, argument niebędący obiektem; komunikaty różne dla różnych przyczyn; (b) `sortAssignments`: kolejność po kluczach, wejście niezmienione (`structuredClone` i `Object.freeze`); (c) `groupByEmployeeDay`: jedna osoba z dwiema zmianami w dniu, dwie osoby w tej samej komórce, powtórzony klucz zliczony raz, lista zmian posortowana; (d) `summarizeCoverage`: brak przypisań daje `missing = required`, komplet daje zera, nadmiar 3 przy 2 daje `surplus = 1`, przypisanie bez komórki pominięte, kolejność wyniku niezależna od kolejności wejścia; (e) powtarzalność przez `expectDeterministic` z wariantami z `seededShuffle` dla `sortAssignments`, `groupByEmployeeDay` i `summarizeCoverage`. W `access.test.ts` lista domyślnej odmowy dostaje `/schedules/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90/assign` i `/api/schedules/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90/assignments`.

### Success Criteria:

#### Automated Verification:

- Testy reguł przypisań i polityki dostępu przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Komunikaty błędów po polsku oraz reguły podsumowania obsady (brak, komplet, nadmiar) z testów zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Baza: tabela przypisań i różnicowy zapis

### Overview

Dodać migrację z tabelą `schedule_assignments`, polityką i grantem `update` dla liczby osób w komórce oraz nową wersją `save_schedule` (zapis różnicowy, potwierdzenie usunięcia przypisań). Dostosować wywołanie w `schedules.ts` do nowej sygnatury i w smoke udowodnić na prawdziwych tokenach, że baza pilnuje integralności, że zapis nie gubi przypisań i że pozostali aktorzy nie mają dostępu.

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_schedule_assignments.sql` (nowy; utworzyć poleceniem `npx supabase migration new schedule_assignments` w chwili implementacji, żeby znacznik był późniejszy niż migracje S-03 i S-10, w tym `20261123194030`)

**Intent**: Model przypisań według wzorca z migracji S-03, z integralnością w bazie, uprawnieniami ściśle takimi, jakich używa aplikacja, i funkcją zapisu, która nie traci przypisań po cichu.

**Contract**:

- `public.schedule_assignments`: `schedule_id uuid not null`, `shift_id uuid not null`, `day_offset smallint not null`, `employee_id uuid not null`, `source text not null default 'manual'`, `primary key (schedule_id, shift_id, day_offset, employee_id)`. Nazwane ograniczenia: `schedule_assignments_cell_fkey` (klucz obcy `(schedule_id, shift_id, day_offset)` do `public.schedule_staffing (schedule_id, shift_id, day_offset)` `on delete cascade`), `schedule_assignments_employee_fkey` (`(schedule_id, employee_id)` do `public.schedule_employees (schedule_id, employee_id)` `on delete cascade`), `schedule_assignments_source_valid` (`source in ('manual', 'generated')`). Indeks `schedule_assignments_employee_idx` na `(schedule_id, employee_id)` obsługuje drugi klucz (początek klucza głównego obsługuje pierwszy). Brak klucza obcego do `schedules`, `shifts` i `employees`: wiszą pośrednio przez obsadę i skład.
- RLS włączone; polityki `planner can select / insert / delete schedule_assignments` z `(select public.is_planner())`, bez `update`; `revoke all ... from anon, authenticated; grant select, insert, delete ... to authenticated;` z komentarzem `-- non-obvious:` (domyślne uprawnienia Supabase) i komentarzem wyjaśniającym brak `update` (tożsamość wpisu to klucz; zmianę `source` doda S-09).
- `public.schedule_staffing`: nowa polityka `planner can update schedule_staffing` (`using` i `with check` z `is_planner()`) i `grant update (required_count) on public.schedule_staffing to authenticated;`. Uprawnienie kolumnowe, bo zapis zmienia tylko liczbę osób; identyfikator zmiany i dzień pozostają niezmienne.
- `public.save_schedule(p_schedule_id uuid, p_start_date date, p_label text, p_staffing jsonb, p_employee_ids jsonb, p_confirm_removals boolean) returns uuid`: te same atrybuty co dotychczas (`plpgsql`, `security invoker`, `set search_path = ''`), poprzedzona `drop function public.save_schedule(uuid, date, text, jsonb, jsonb)`; `revoke execute ... from public, anon` i `grant execute ... to authenticated` na nowej sygnaturze. Tworzenie (`p_schedule_id is null`) wstawia nagłówek, obsadę i skład jak dotąd. Edycja: aktualizuje nagłówek (`PT404`, gdy żaden wiersz), liczy przypisania grafiku, które znikną (komórka spoza nowego `p_staffing` albo osoba spoza nowego `p_employee_ids`); gdy jest ich więcej niż zero i `coalesce(p_confirm_removals, false)` jest fałszem, podnosi `raise sqlstate 'PT409' using message = 'Assignments would be removed', detail = <liczba jako tekst>`. Następnie usuwa tylko wiersze obsady i składu spoza nowych list (kaskada kasuje ich przypisania), wstawia nowe komórki i osoby, a istniejącym komórkom aktualizuje `required_count` (`insert ... on conflict (schedule_id, shift_id, day_offset) do update set required_count = excluded.required_count`; skład `on conflict do nothing`). Zwraca `id`. Komentarz przy funkcji opisuje zapis różnicowy, kontrakt `PT409` i to, że wcześniejszy komentarz S-03 o zastępowaniu całości już nie obowiązuje.

#### 2. Dostosowanie wywołania

**File**: `src/lib/schedules.ts`

**Intent**: Aplikacja działa z nową sygnaturą funkcji w tej samej fazie, żeby gałąź pozostała spójna, bez nowego zachowania dla użytkownika.

**Contract**: `saveSchedule(supabase, id, input)` wysyła szósty parametr `p_confirm_removals: false`. Reszta funkcji, `SaveFailure` i trasy bez zmian (potwierdzenie i obsługa `PT409` dochodzą w Fazie 3).

#### 3. Smoke: baza i RPC

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić po stronie bazy, kto widzi i zmienia przypisania, że integralność trzyma, że zapis różnicowy zachowuje przypisania i że potwierdzenie usunięcia jest wymuszane.

**Contract**: Pomocnik `assignmentsTable` oparty na `restTable`, dopisany do listy `scheduleTables`, żeby istniejące kroki odmów dla trzech aktorów (`plannerRejectsScheduleRow`, `notPlannerScheduleSteps`) objęły nową tabelę. Pomocnik `saveScheduleArgs` wysyła sześć parametrów (domyślnie `p_confirm_removals: false`); istniejące kroki zapisu zachowują znaczenie. Dane smoke: osobny grafik `Smoke-<runId>-assign` utworzony przez `save_schedule` (dwie zmiany z komórkami w dwóch dniach, dwaj pracownicy). Kroki planisty, każdy jako osobny krok z kontrolnym odczytem: dodanie przypisania, odczyt pokazuje `source = 'manual'`; powtórzony klucz odrzucony (`schedule_assignments_pkey`); przypisanie do komórki spoza obsady odrzucone (`schedule_assignments_cell_fkey`); osoba spoza składu odrzucona (`schedule_assignments_employee_fkey`); `source = 'bogus'` odrzucone (`schedule_assignments_source_valid`); `PATCH` przypisania odrzucony (brak grantu), a odczyt dowodzi braku zmiany; zapis grafiku zmieniający tylko etykietę zachowuje wszystkie przypisania; zapis zmieniający `required_count` komórki zachowuje jej przypisania; zapis bez komórki z przypisaniami i bez potwierdzenia kończy się błędem `PT409` z liczbą w `details`, a odczyt dowodzi, że nagłówek, obsada i przypisania się nie zmieniły (atomowość); ten sam zapis z `p_confirm_removals = true` usuwa przypisania tej komórki (kaskada jako planista), a przypisania innych komórek zostają; analogicznie dla osoby usuniętej ze składu; `PATCH` `required_count` na `schedule_staffing` przez planistę dozwolony, `PATCH` `shift_id` odrzucony; wywołanie starej sygnatury (pięć parametrów) odrzucone (funkcja usunięta). Pracownik, konto bez roli i anonim: odczyt `[]` lub odmowa, wstawienie i usunięcie odmowa, RPC odmowa, `PATCH` `required_count` odmowa, kontrolny odczyt planisty dowodzi braku zmian. Sprzątanie service-role grafików (`DELETE ... schedules?label=like.Smoke-*`) kaskaduje przez obsadę i skład do przypisań i pozostaje przed krokami zmian i pracowników; w razie potrzeby dopisać krok kontrolny, że po sprzątaniu tabela nie zawiera wierszy smoke.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke z krokami bazy i RPC przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env` i `.dev.vars` wskazującymi ten sam lokalny stos, ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`): `npm run smoke`

#### Manual Verification:

- Polityki RLS, uprawnienia (w tym kolumnowy `update` i `execute` funkcji), klucze obce z kaskadą, ograniczenia, kontrakt `PT409` i komentarze w migracji zostały przejrzane przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Dostęp do danych i API

### Overview

Dodać moduł danych przypisań, trasy `POST` i `DELETE` dla pojedynczego przypisania oraz obsługę potwierdzenia usunięcia w `PUT` grafiku, i udowodnić je w smoke na prawdziwej sesji planisty.

### Changes Required:

#### 1. Dostęp do danych przypisań

**File**: `src/lib/assignments.ts` (nowy)

**Intent**: Jedyny moduł znający tabelę i kolumny przypisań, bez logiki biznesowej; każda funkcja dostaje klienta z sesji użytkownika, jak `schedules.ts`.

**Contract**: `listAssignments(supabase, scheduleId): Promise<Assignment[]>` (zapytanie o `shift_id, day_offset, employee_id, source` po `schedule_id`, wynik przez `sortAssignments`; `[]` dla nie-UUID bez zapytania; przy błędzie bazy loguje przez `logDatabaseError` i rzuca; gdy odpowiedź liczy tyle wierszy co limit odczytu 1000, rzuca błąd zamiast zwracać obcięty zbiór). `countAssignments(supabase, scheduleId): Promise<number>` (zapytanie `head` z liczeniem, `0` dla nie-UUID). `addAssignment(supabase, scheduleId, input: AssignmentInput): Promise<{ ok: true } | { ok: false; error: "unknown_reference" | "failed" }>` (insert z ignorowaniem duplikatów, więc powtórka nie jest błędem; nie wysyła `source`, domyślnie `manual`; `23503` to `unknown_reference`, reszta `failed` z logiem bez danych wejściowych). `removeAssignment(supabase, scheduleId, input)` (usunięcie po pełnym kluczu; brak wiersza nie jest błędem; błąd bazy to `failed`).

#### 2. Potwierdzenie usunięcia w zapisie grafiku

**File**: `src/lib/schedules.ts`, `src/pages/api/schedules/[id].ts`

**Intent**: Przenieść kontrakt `PT409` z bazy do aplikacji i API, bez zmiany reszty zachowania `PUT`.

**Contract**: `saveSchedule(supabase, id, input, confirmRemoval = false)` wysyła `p_confirm_removals: confirmRemoval`. `SaveFailure` dostaje wariant `removal_unconfirmed`, a wynik `{ ok: false; error: "removal_unconfirmed"; removed: number }` z liczbą odczytaną z `details` błędu (`PT409`); gdy liczby nie da się odczytać, wynik to `failed`. Trasa `PUT` czyta z surowego ciała opcjonalne `confirmRemoval` (tylko dokładnie `true` liczy się jako potwierdzenie; każda inna wartość to brak potwierdzenia), nie przekazując go do `validateScheduleInput`. Przy `removal_unconfirmed` odpowiada 409 `{ error: "assignments_would_be_removed", removed }`. Trasa `POST` (tworzenie) nie przyjmuje potwierdzenia.

#### 3. Trasy API przypisań

**File**: `src/pages/api/schedules/[id]/assignments.ts` (nowy)

**Intent**: Trasy JSON dla dodania i zdjęcia jednego przypisania, w tej samej kolejności kontroli co pozostałe trasy grafików.

**Contract**: `export const prerender = false`. `POST` i `DELETE` na `/api/schedules/[id]/assignments`, ciało `{ shiftId, dayOffset, employeeId }`. Kolejność: `readJsonBody` (415 `unsupported_media_type`, 400 `invalid_json`), brak klienta (503 `not_configured`), `isUuid` na `id` (404 `not_found`), `validateAssignmentInput` (422 `{ errors }`), zapis: `unknown_reference` to 422 `{ error: "unknown_reference" }` (komórka nie ma już obsady albo osoba nie należy do grafiku, także gdy grafik nie istnieje), `failed` to 500 `{ error: "failed" }`, sukces to 200 `{ ok: true }` zarówno dla `POST`, jak i `DELETE` (oba idempotentne). Odpowiedzi przez `jsonResponse` (`no-store`). Współistnienie pliku `src/pages/api/schedules/[id].ts` i katalogu `src/pages/api/schedules/[id]/` sprawdzić buildem; w razie konfliktu przenieść `[id].ts` do `[id]/index.ts` (adres bez zmian).

#### 4. Smoke: API

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić kontrakt tras na prawdziwej sesji planisty i odmowy dla pozostałych aktorów, w tym potwierdzenie usunięcia.

**Contract**: Kroki między `signIn(planner)` a `signOut(planner)`, wstawione w środku bloku API grafików (nie na końcu, żeby nie kolidować z S-10): `POST` poprawnego przypisania zwraca 200, a odczyt bazy pokazuje wiersz z `source = 'manual'`; powtórny `POST` zwraca 200 i nadal jest jeden wiersz; `DELETE` zwraca 200 i wiersz znika; powtórny `DELETE` zwraca 200; 422 z dokładnym zbiorem pól (zły `shiftId`, `dayOffset` 7, zły `employeeId`); 422 `unknown_reference` dla komórki spoza obsady i dla osoby spoza składu; 415 bez `Content-Type: application/json`; 400 `invalid_json`; 404 dla `not-a-uuid`. `PUT` grafiku bez komórki, która ma przypisania, zwraca 409 `assignments_would_be_removed` z dokładną liczbą, a odczyt dowodzi braku zmian; `PUT` z `confirmRemoval: true` zwraca 200 i przypisania znikają; `PUT` z `confirmRemoval: "yes"` traktowany jak brak potwierdzenia (409). Pracownik, konto bez roli (403) i anonim (401) dostają odmowę na `POST` i `DELETE` (JSON pod `/api/`).

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke z krokami API przechodzi lokalnie (jak w Fazie 2): `npm run smoke`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Formularz grafiku: potwierdzenie usunięcia i zmiana daty

### Overview

Dostosować formularz edycji grafiku z S-03 do przypisań: po odpowiedzi 409 pokazać liczbę przypisań, które znikną, i pozwolić je potwierdzić albo wrócić do edycji, a przy zmianie daty grafiku z przypisaniami pokazać nieblokującą informację.

### Changes Required:

#### 1. Strona edycji

**File**: `src/pages/schedules/[id].astro`

**Intent**: Przekazać wyspie liczbę przypisań grafiku, potrzebną do informacji o zmianie daty.

**Contract**: Dla znalezionego grafiku, równolegle z `listShifts` i `listEmployees`, wywołanie `countAssignments`; wynik trafia do `ScheduleForm` jako prop `assignmentCount: number` (opcjonalny, domyślnie 0; `new.astro` go nie przekazuje).

#### 2. Hook i formularz

**File**: `src/components/hooks/useScheduleForm.ts`, `src/components/schedules/ScheduleForm.tsx`

**Intent**: Obsłużyć dwuetapowe usunięcie i informację o dacie na wzorcu istniejącego hooka, bez zmiany walidacji ani kolejności pól.

**Contract**: Hook przyjmuje `assignmentCount`. `save(value, confirmRemoval = false)` dołącza `confirmRemoval: true` do ciała tylko przy ponowieniu. Odpowiedź 409 z `error: "assignments_would_be_removed"` ustawia stan `removal = { count, value }` i kończy oczekiwanie bez komunikatu błędu; każda późniejsza zmiana wartości w formularzu zeruje `removal` (serwer i tak zapyta ponownie, gdy liczba się zmieni). Formularz pokazuje wtedy blok `role="alert"` z tekstem o liczbie przypisań, które zostaną usunięte razem z komórką lub osobą, oraz przyciski "Zapisz i usuń przypisania" (ponawia zapis z potwierdzeniem) i "Wróć do edycji" (zeruje `removal`). Informacja o dacie: gdy `assignmentCount > 0` i `startDate` różni się od zapisanej, pod polem daty pojawia się nieblokujący tekst, że przypisania przesuną się razem z datą (zostają przy tych samych dniach siatki, a dni tygodnia dostaną inne daty); zapis nie jest blokowany.

#### 3. Smoke: strony

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść, że strona edycji nadal działa dla grafiku z przypisaniami.

**Contract**: Krok między `signIn(planner)` a `signOut(planner)`: `/schedules/<id>` grafiku z przypisaniami zwraca 200, `no-store`, zawiera etykietę grafiku. Blok potwierdzenia i informacja o dacie są stanem klienta, więc w smoke ich nie ma; dowodzi ich przegląd w przeglądarce.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami stron przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- W przeglądarce, na grafiku z przypisaniami: usunięcie komórki lub odznaczenie osoby i zapis pokazuje blok z liczbą przypisań; "Wróć do edycji" zostawia dane bez zmian, "Zapisz i usuń przypisania" zapisuje i usuwa dokładnie te przypisania
- Zmiana samej etykiety, liczby osób w komórce i dodanie osoby lub komórki zapisują się bez bloku i zachowują przypisania
- Zmiana daty początkowej grafiku z przypisaniami pokazuje informację bez blokowania zapisu; bez przypisań informacji nie ma

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 5: Widok obsadzania

### Overview

Dodać stronę `/schedules/<id>/assign` z tabelą pracownicy × dni i podsumowaniem obsady, szeroki wariant układu, odnośniki z listy i z edycji, smoke stron i dokumentację.

### Changes Required:

#### 1. Szeroki wariant układu

**File**: `src/layouts/PlannerLayout.astro`

**Intent**: Dać tabeli pracownicy × dni miejsce, bez zmiany pozostałych stron.

**Contract**: Opcjonalny prop `wide?: boolean` (domyślnie `false`); przy `true` kontener ma `max-w-7xl` zamiast `max-w-4xl` (`:15`). Strony bez propa renderują się jak dotąd.

#### 2. Strona obsadzania

**File**: `src/pages/schedules/[id]/assign.astro` (nowy)

**Intent**: Strona w `PlannerLayout wide` według wzorca `[id].astro`, z `Cache-Control: no-store` (nazwiska).

**Contract**: Guard `locals.supabase` jak w pozostałych stronach. `getSchedule` (null dla nie-UUID i nieistniejącego daje `Astro.response.status = 404` i komunikat "Nie znaleziono grafiku" z odnośnikiem do listy); dla znalezionego równolegle `listShifts`, `listEmployees`, `listAssignments`. Nagłówek z okresem (`formatPeriod`) i etykietą, `ScheduleNotice`, odnośniki "Edytuj grafik" i "Lista grafików". Wyspa `AssignmentGrid` dostaje `schedule`, opcje zmian (`toShiftOptions`), opcje pracowników (`toEmployeeOptions`) i przypisania jako dane serializowalne (ręcznie, bez `source`). Współistnienie `src/pages/schedules/[id].astro` i katalogu `src/pages/schedules/[id]/` sprawdzić buildem; w razie konfliktu przenieść edycję do `[id]/index.astro` (adres bez zmian, `git mv`).

#### 3. Wyspa i hook

**File**: `src/components/schedules/AssignmentGrid.tsx`, `src/components/hooks/useAssignments.ts` (nowe)

**Intent**: Interaktywna tabela zapisująca każdą zmianę od razu, zbudowana na wzorcach `StaffingGrid.tsx` (przyklejona kolumna, przewijanie poziome) i `useScheduleForm.ts` (komunikaty o sesji, 404 i `unknown_reference`).

**Contract**: Wiersze to pracownicy ze składu grafiku w kolejności przekazanej przez stronę (kolejność listy pracowników), kolumny to `dayColumns(startDate)`. Komórka (pracownik, dzień) zawiera po jednym przycisku `aria-pressed` dla każdej zmiany, która ma w tym dniu obsadę, w kolejności słownika zmian; przycisk pokazuje nazwę i godziny, a `aria-label` brzmi "<pracownik>, <dzień>, <zmiana>". Dzień bez żadnej zmiany z obsadą pokazuje myślnik. Kliknięcie wysyła `POST` (dodanie) albo `DELETE` (zdjęcie) na `/api/schedules/<id>/assignments`; stan zmienia się natychmiast i wraca przy błędzie, z komunikatem w `role="alert"`: 401 i 403 komunikat o sesji, 404 o braku grafiku, 422 `unknown_reference` "Ta zmiana nie obowiązuje już tego dnia albo osoba nie należy do grafiku. Odśwież stronę.", reszta ogólny komunikat o nieudanym zapisie. Kliknięcie jest ignorowane, gdy żądanie dla tej samej pary pracownik i zmiana w tym dniu jest w toku. Pod tabelą podsumowanie zmiana × dzień z `summarizeCoverage`: "x z y" oraz oznaczenie tekstowe `−n` (brak) lub `+n` (nadmiar), niezależne od koloru; liczniki aktualizują się razem z widokiem. Przyklejona kolumna z nazwiskiem (stała skopiowana z `StaffingGrid.tsx:30` wraz z komentarzem o świadomym powieleniu), kontener `overflow-x-auto`.

#### 4. Odnośniki

**File**: `src/pages/schedules/index.astro`, `src/pages/schedules/[id].astro`

**Intent**: Dojście do widoku z listy i z edycji.

**Contract**: Na liście obok "Edytuj" (tabela `:94-100` i karty `:116-122`) odnośnik "Obsadź" do `/schedules/<id>/assign` z `aria-label` zawierającym okres, jak `editLabel`. Na stronie edycji odnośnik "Obsadź pracowników" nad formularzem.

#### 5. Smoke: strony

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść strony i odnośników w smoke na prawdziwej sesji planisty.

**Contract**: Kroki między `signIn(planner)` a `signOut(planner)`: `/schedules/<id>/assign` zwraca 200, `no-store`, zawiera okres, nazwisko pracownika ze składu, tekst D6 i `aria-pressed="true"` dla istniejącego przypisania oraz `aria-pressed="false"` dla zmiany bez przypisania; `/schedules/<losowy UUID>/assign` zwraca 404 z komunikatem; lista `/schedules` zawiera odnośnik `/schedules/<id>/assign`; pracownik, konto bez roli i anonim dostają odmowę strony (zgodnie z istniejącymi krokami).

#### 6. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Utrzymać dokumentację zgodną z kodem.

**Contract**: `CLAUDE.md` sekcja "Data access": akapit o przypisaniach (tabela `schedule_assignments` ze znacznikiem `source`, trasy `/api/schedules/[id]/assignments`, widok `/schedules/<id>/assign`, reguły w `src/lib/services/assignment.ts`, różnicowy `save_schedule` z potwierdzeniem `PT409`) dodany po akapicie o stronach grafików, nie obok akapitu S-10; uzupełnienie opisu `npm run smoke` o przypisania. `AGENTS.md` (Project Structure, Commands) i `README.md` (tabela tras, opis migracji bez liczebników, opis smoke) o nowe strony, trasy i tabelę; po przeformatowaniu tabeli przez S-10 uruchomić `prettier --write README.md`. Nie dotykać fragmentów o service-role.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami stron przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- W przeglądarce na desktopie: dodanie i zdjęcie zmiany w komórce zmienia przycisk i licznik od razu; kilka zmian jednego dnia dla jednej osoby; brak, komplet i nadmiar w podsumowaniu (z tekstowym `−n` i `+n`); komunikat i wycofanie przy błędzie (np. po zatrzymaniu serwera lub usunięciu zmiany z obsady w innej karcie); obsługa klawiaturą i odczyt `aria-pressed`; przyklejona kolumna przy przewijaniu poziomym
- Na telefonie (lub emulacji): strona się ładuje, tabela przewija się poziomo, przyciski dają się nacisnąć bez rozjeżdżania strony
- Migracja jest zastosowana na hostowanym projekcie (`npx supabase db push`) przed wdrożeniem kodu, a po niej od razu wdrożenie, bo stara wersja aplikacji wywołuje usuniętą sygnaturę `save_schedule`
- Po wdrożeniu (`npm run build` i `npx wrangler deploy`) przypisanie da się dodać i zdjąć na produkcji; nie uruchamiać `npm run smoke` na produkcji

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Reguły przypisań (`assignment.test.ts`): walidacja i normalizacja wejścia, sortowanie, grupowanie po pracowniku i dniu, podsumowanie obsady (brak, komplet, nadmiar, pominięcie przypisań bez komórki), powtarzalność przez `expectDeterministic` z wariantami z `seededShuffle`, wejście niezmienione.
- Lista domyślnej odmowy dla nowych tras w `access.test.ts`.

### Integration Tests:

- Smoke przez PostgREST i RPC (Faza 2): RLS dla czterech aktorów, złożone klucze obce, ograniczenie `source`, brak `update` na przypisaniach, kolumnowy `update` obsady, różnicowy zapis zachowujący przypisania, `PT409` bez potwierdzenia i atomowość, kaskada po potwierdzeniu, usunięta stara sygnatura.
- Smoke przez API (Faza 3): kody 200, 400, 404, 409, 415, 422, idempotencja `POST` i `DELETE`, potwierdzenie w `PUT`, odmowy dla pozostałych aktorów, `no-store`.
- Smoke stron (Fazy 4 i 5): strona edycji z przypisaniami, widok obsadzania, 404, tekst D6, odnośnik na liście, odmowy.
- Brak testów komponentów i hooków; blok potwierdzenia, informacja o dacie i widok sprawdza przegląd w przeglądarce.

### Manual Testing Steps:

1. Mając grafik z dwiema zmianami (06:00–14:00 i 22:00–06:00) na tydzień od środy i trzema pracownikami, wejść w "Obsadź", przypisać kilka osób, w tym jedną osobę do dwóch zmian jednego dnia, i sprawdzić liczniki "x z y" (brak, komplet, nadmiar).
2. Odświeżyć stronę i sprawdzić, że stan jest zapisany; zdjąć przypisanie i sprawdzić, że znika po odświeżeniu.
3. W edycji grafiku zmienić tylko etykietę i liczbę osób w komórce i sprawdzić, że przypisania zostały.
4. Usunąć z siatki komórkę z przypisaniami i zapisać: pojawia się blok z liczbą; "Wróć do edycji" nic nie zmienia, "Zapisz i usuń przypisania" usuwa je razem z komórką. To samo dla odznaczonej osoby.
5. Zmienić datę początkową grafiku z przypisaniami i sprawdzić informację oraz to, że przypisania zostają przy tych samych dniach siatki.
6. Zalogować się jako pracownik (po S-10 lub kontem z admin API) i sprawdzić odmowę `/schedules/<id>/assign`.

## Performance Considerations

Strona obsadzania wykonuje cztery zapytania (grafik, zmiany, pracownicy, przypisania), z czego trzy równolegle; edycja dodaje jedno zapytanie z liczeniem. Przypisania jednego grafiku mieszczą się w kilkuset wierszach (np. 30 pracowników × 7 dni × 2 zmiany), więc limit odczytu 1000 jest zapasem, a nie budżetem; przekroczenie kończy się błędem. Każdy klik to jedno żądanie do Supabase (czas oczekiwania na sieć nie liczy się do limitu 10 ms CPU na żądanie w Workers Free). Tabela ma do kilkuset przycisków; w Fazie 5 sprawdzić płynność na desktopie i telefonie. Brak stronicowania, świadomie.

## Migration Notes

Migracja zmienia funkcję `save_schedule` (usuwa starą sygnaturę, tworzy nową), więc wdrożenie wymaga kolejności: `npx supabase db push`, zaraz potem `npm run build` i `npx wrangler deploy`. Między tymi krokami wdrożona wersja aplikacji z S-03 wywołuje usuniętą sygnaturę i zapis grafiku zawodzi; okno jest krótkie, a S-04 wdraża się po S-03. Znacznik czasu migracji tworzy się w chwili implementacji Fazy 2 poleceniem `npx supabase migration new schedule_assignments`, żeby był późniejszy niż migracje S-03 (`20261106120157`) i S-10 (`20261123194030`); wcześniejszy znacznik rozbiłby `db push` na hostowanym projekcie. Migracja S-03 zostaje nietknięta; jej komentarze o zastępowaniu całości są zastąpione komentarzem w nowej migracji. Istniejące grafiki nie mają przypisań, więc nie ma danych do przeniesienia.

## Parallel Work Notes

Stan na 2026-11-24: PR #9 (pin CLI) i #8 (S-03) są scalone do `master` merge commitami, a PR #7 (S-10) ma zielone CI na `59f3bef` (S-03 + S-10) i czeka na scalenie (token `gh` nie ma zakresu `workflow`). Gałąź `change/manual-shift-assignment` stoi na `59f3bef`, więc S-10 jest już w jej bazie; przed otwarciem pull requesta S-04 trzeba zrobić `git merge origin/master` (pin CLI i merge commity #8 i #7), a PR kierować na `master` po scaleniu #7. Konflikty ze S-10 nie wystąpią, bo jego zmiany są w bazie; poniższe wskazówki mówią, gdzie wstawiać zmiany w plikach, w których bloki S-03 i S-10 już leżą obok siebie. Wspólne punkty styku: `scripts/smoke.mjs`, `src/types.ts`, `README.md`, `CLAUDE.md`, `AGENTS.md`. Żeby kolejne scalenie było tanie: typy S-04 w środku `types.ts` (po `ScheduleFieldErrors`), kroki smoke API w środku bloku grafików (nie tuż po `PUT /api/schedules/<id>` w krokach anonima i konta bez roli, bo S-10 wstawia tam zaproszenia), kroki bazy w środku bloku grafików (po kroku usunięcia pojedynczej komórki, nie na końcu przed krokiem "forged role"), pomocniki smoke dopisane po `notPlannerScheduleSteps`, akapity dokumentacji dodane po akapicie o stronach grafików i bez dotykania fragmentów o service-role. Testy S-04 nie budują pełnego `Employee` (S-10 dodał mu trzy wymagane pola): typy parametrów są wąskie (`Pick`, `AssignmentInput`). S-04 nie rusza `access.ts`, `ci.yml`, `package.json`, `employees.ts` ani `FormField.tsx` (S-03 dopisał do niego `min` i `max`, S-10 `readOnly` i `describedBy`).

## References

- Roadmap: `context/foundation/roadmap.md` (S-04, ryzyko znacznika wpisu ręcznego; S-05, S-06, S-08, S-09, S-11 jako konsumenci przypisań), PRD: `context/foundation/prd.md` (FR-009, FR-010, FR-011, FR-019, US-01), reguły: `context/foundation/work-time-rules.md` (doba, tydzień, zmiany przez północ, D6)
- Model i zapis S-03: `supabase/migrations/20261106120157_schedules.sql:37-86,95-145`, `context/changes/weekly-schedule-draft/plan.md` i `plan-brief.md`
- Dane i trasy: `src/lib/schedules.ts:13-15,78-87,122-144`, `src/pages/api/schedules/[id].ts:11-44`, `src/lib/postgrest.ts:6-15`, `src/lib/json-response.ts`
- UI: `src/components/hooks/useScheduleForm.ts:179-212`, `src/components/schedules/StaffingGrid.tsx:30`, `src/pages/schedules/[id].astro`, `src/pages/schedules/index.astro:94-100,116-122`, `src/layouts/PlannerLayout.astro:15`
- Reguły i testy: `src/lib/services/schedule.ts:190-254,303-313`, `src/lib/services/schedule.test.ts`, `src/lib/services/access.test.ts:165-169`, `src/lib/testing/determinism.ts`
- Smoke: `scripts/smoke.mjs` (pomocniki tabel `restTable`, `scheduleTables`, `notPlannerScheduleSteps`, kroki bazy i API grafików, sprzątanie); konfiguracja `supabase/config.toml:18` (`max_rows`)
- Połączenie z S-10: `context/changes/employee-invitation/plan-brief.md`, gałąź `merge/s10-on-s03` (przykład rozwiązania konfliktów)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguły przypisań

#### Automated

- [x] 1.1 Testy reguł przypisań i polityki dostępu przechodzą w workerd: `npm test` — 83dbe2f
- [x] 1.2 Linting przechodzi: `npm run lint` — 83dbe2f
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 83dbe2f

#### Manual

- [x] 1.4 Komunikaty błędów po polsku oraz reguły podsumowania obsady (brak, komplet, nadmiar) z testów zostały przejrzane i zatwierdzone przez autora — 83dbe2f

### Phase 2: Baza: tabela przypisań i różnicowy zapis

#### Automated

- [x] 2.1 Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset` — e42717f
- [x] 2.2 Linting przechodzi: `npm run lint` — e42717f
- [x] 2.3 Sprawdzanie typów przechodzi: `npx astro check` — e42717f
- [x] 2.4 Build przechodzi: `npm run build` — e42717f
- [x] 2.5 Smoke z krokami bazy i RPC przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env` i `.dev.vars` wskazującymi ten sam lokalny stos, ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`): `npm run smoke` — e42717f

#### Manual

- [x] 2.6 Polityki RLS, uprawnienia (w tym kolumnowy `update` i `execute` funkcji), klucze obce z kaskadą, ograniczenia, kontrakt `PT409` i komentarze w migracji zostały przejrzane przez autora — e42717f

### Phase 3: Dostęp do danych i API

#### Automated

- [x] 3.1 Testy przechodzą: `npm test` — 37bf313
- [x] 3.2 Linting przechodzi: `npm run lint` — 37bf313
- [x] 3.3 Sprawdzanie typów przechodzi: `npx astro check` — 37bf313
- [x] 3.4 Build przechodzi: `npm run build` — 37bf313
- [x] 3.5 Smoke z krokami API przechodzi lokalnie (jak w Fazie 2): `npm run smoke` — 37bf313

### Phase 4: Formularz grafiku: potwierdzenie usunięcia i zmiana daty

#### Automated

- [x] 4.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [x] 4.2 Smoke z krokami stron przechodzi lokalnie: `npm run smoke`

#### Manual

- [x] 4.3 W przeglądarce, na grafiku z przypisaniami: usunięcie komórki lub odznaczenie osoby i zapis pokazuje blok z liczbą przypisań; "Wróć do edycji" zostawia dane bez zmian, "Zapisz i usuń przypisania" zapisuje i usuwa dokładnie te przypisania
- [x] 4.4 Zmiana samej etykiety, liczby osób w komórce i dodanie osoby lub komórki zapisują się bez bloku i zachowują przypisania
- [x] 4.5 Zmiana daty początkowej grafiku z przypisaniami pokazuje informację bez blokowania zapisu; bez przypisań informacji nie ma

### Phase 5: Widok obsadzania

#### Automated

- [ ] 5.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 5.2 Smoke z krokami stron przechodzi lokalnie: `npm run smoke`
- [ ] 5.3 CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual

- [ ] 5.4 W przeglądarce na desktopie: dodanie i zdjęcie zmiany w komórce zmienia przycisk i licznik od razu; kilka zmian jednego dnia dla jednej osoby; brak, komplet i nadmiar w podsumowaniu (z tekstowym `−n` i `+n`); komunikat i wycofanie przy błędzie (np. po zatrzymaniu serwera lub usunięciu zmiany z obsady w innej karcie); obsługa klawiaturą i odczyt `aria-pressed`; przyklejona kolumna przy przewijaniu poziomym
- [ ] 5.5 Na telefonie (lub emulacji): strona się ładuje, tabela przewija się poziomo, przyciski dają się nacisnąć bez rozjeżdżania strony
- [ ] 5.6 Migracja jest zastosowana na hostowanym projekcie (`npx supabase db push`) przed wdrożeniem kodu, a po niej od razu wdrożenie, bo stara wersja aplikacji wywołuje usuniętą sygnaturę `save_schedule`
- [ ] 5.7 Po wdrożeniu (`npm run build` i `npx wrangler deploy`) przypisanie da się dodać i zdjąć na produkcji; nie uruchamiać `npm run smoke` na produkcji
