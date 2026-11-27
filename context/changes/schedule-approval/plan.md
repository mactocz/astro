# Schedule approval Implementation Plan

## Overview

Ósmy wycinek domenowy Shiftly (S-08 z roadmapy, FR-012, FR-013, US-01) i zabezpieczenie z PRD: planista zatwierdza grafik, krytyczne naruszenie blokuje zatwierdzenie, ostrzeżenie wymaga jawnego potwierdzenia, a zatwierdzony grafik jest ostateczny, zablokowany do edycji i ma zapisane wskazania ("naruszenie jest widoczne i rejestrowane, nigdy zatwierdzane po cichu"). Zatwierdzenia nie da się cofnąć (PRD świadomie je odrzuciło); zmiana zatwierdzonego grafiku to nowa wersja (S-12). Blokada jest wymuszana w bazie (status, RLS na czterech tabelach, granty kolumnowe), a nie tylko w aplikacji. Ponieważ reguły są w TypeScripcie, trasa liczy je na serwerze z danych bazy, a funkcja bazy `approve_schedule` pod blokadą sprawdza, że trasa widziała dokładnie bieżące dane, i zapisuje zatwierdzenie z migawką zmian i pracowników, żeby późniejsza edycja słownika nie zmieniła po cichu zatwierdzonego grafiku (FR-013). Wycinek dostarcza dane, które odczyta S-11 (widok pracownika) i skopiuje S-12 (nowa wersja). Implementacja zaczyna się po scaleniu S-07 (`absence-entry`), żeby zatwierdzenie obejmowało nieobecności od pierwszego razu; planowanie jest równoległe.

## Current State Analysis

- **Cykl życia grafiku dziś** (z badania; migracje: S3 = `20261106120157_schedules.sql`, S4 = `20261124152716_schedule_assignments.sql`, VIEW = `20261125120000_schedule_summaries.sql`): `schedules` (id, start_date, label, created_at), polityki tylko dla planisty select/insert/update (S3:22-27), tabelowy `grant select, insert, update` (S3:31) bez delete; `schedule_staffing` i `schedule_employees` z kluczami do `schedules` z kaskadą, polityki select/insert/delete (S3:67-79), granty (S3:83, :86), od S4 także update `required_count` (S4:53-56); `schedule_assignments` (S4:12-24) z kluczem złożonym, złożonymi kluczami obcymi do obsady i składu z kaskadą, BEZ klucza do `schedules` (S4:8-9, więc wstawienie przypisania nie blokuje wiersza grafiku), polityki select/insert/delete, brak update. Pracownik nie ma polityki na żadnej z tych tabel (komentarze S3:147-150 i S4:32 obiecują "zatwierdzoną kopię" w S-11). Widok `schedule_summaries` (`security_invoker = true`, VIEW:14-32) ma kolumny id, start_date, label, created_at, employee_count, total_required i grant select.
- `save_schedule` (S4:79-169): `security invoker`, sześć parametrów, zapis różnicowy; zaczyna od `update schedules ... returning id`, null daje `PT404` (:106-109); liczy przypisania do usunięcia i bez `p_confirm_removals` zgłasza `PT409` z liczbą w `detail` (:114-134); `classifySaveFailure` (`src/lib/services/schedule.ts:344-365`) traktuje `PT409` jako `removal_unconfirmed` tylko przy `detail` będącym liczbą >= 1, w przeciwnym razie jako `failed`, więc nowy kod blokady nie może używać `PT409`.
- Wszystkie ścieżki zapisu do danych grafiku, które blokada musi objąć: `POST /api/schedules` (RPC, nowy grafik), `PUT /api/schedules/[id]` (RPC: nagłówek, obsada, skład, kaskada na przypisania), `POST` i `DELETE /api/schedules/[id]/assignments` (PostgREST upsert i delete), bezpośredni PostgREST planisty na czterech tabelach, kaskady referencyjne (omijają RLS), konto serwisowe (omija RLS; smoke usuwa nim grafiki), przyszłe S-09 (przypisania `generated`) i S-12 (nowy grafik jako kopia). Moduły danych nie znają blokady: `src/lib/schedules.ts` (`LIST_SELECT`, `DETAIL_SELECT`, unia `SaveFailure`, `getSchedule`, `saveSchedule`), `src/lib/assignments.ts` (`listAssignments` rzuca przy >= 1000 wierszy, `addAssignment` mapuje tylko `23503`, `removeAssignment` kasuje po kluczu).
- Reguły i dane: `evaluateSchedule`/`safeEvaluate` z S-05 (`RuleInput`: startDate, staffing, assignments, shifts jako `ShiftTimes`, employees `{ id, name, fte }`) plus `absences` po S-07; `Violation` ma `key`, `severity`, `rule`, `employeeId`, `anchors`, `reason`, `actual`, `limit`, `unit` (`src/types.ts`). Powody wskazań są tekstem z nazwiskami i godzinami zmian, więc muszą pozostać spójne z zamrożonymi danymi.
- Co dziś po cichu zmienia zatwierdzony grafik: `PUT /api/shifts/[id]` i bezpośredni `PATCH` na `shifts` (tabelowy update, `shifts.sql:32`) zmieniają nazwę i godziny (a z nimi sumy i wyniki reguł), `PUT /api/employees/[id]` i `PATCH` (granty kolumnowe `employee_accounts.sql:22-25`) zmieniają nazwiska i etat; zmiany kodu reguł lub kalendarza zmieniają ponowne przeliczenie; nieobecności z S-07 wpisane po zatwierdzeniu.
- Interfejs: `assign.astro:21-37` (ładowanie), `:62-67` (link "Edytuj grafik"), `:77-83` (propsy), sekcja obsady w `AssignmentGrid.tsx:282-334`, panel potwierdzenia w `ScheduleForm.tsx:148-177` (wzorzec: zdanie alarmowe, bezpieczny przycisk z `autoFocus`, przycisk potwierdzenia), przekierowanie po zapisie `window.location.replace` (`useScheduleForm.ts:236`), `[id].astro:63-72` zawsze renderuje `ScheduleForm`, `index.astro` ma linki "Edytuj" i karty, `ScheduleNotice.astro:5-6` mówi "To szkic grafiku" (kontrakt D6), `planner/index.astro:32` mówi "Szkice". `useAssignments.failureMessage` (`:43-55`) i `useScheduleForm.readErrorBody` (`:110-127`) nie mają przypadku 409 innego niż usunięcie przypisań.
- Dostęp: `access.ts` ma domyślną odmowę (nowa trasa `/api/schedules/<uuid>/approve` nie wymaga zmiany tabeli; `access.test.ts` ok. `:183-208` trzeba uzupełnić). Jedyną funkcją `security definer` w projekcie jest `mark_account_active` (`20261123194030_employee_account_activation.sql:18-29`, zgoda autora 2026-11-23); `approve_schedule` będzie drugą (zgoda autora z wywiadu 2026-11-26).
- Smoke: kruche pomocniki, które dotknie nowy status i sekcje: `listsApiSchedule` (`smoke.mjs:1453-1470`) wymaga dokładnie 6 komórek `<td>` w wierszu listy i `cells[5]` zgodnego z `Edytuj\s*Obsadź`; `SUMMARY_COLUMNS` i `isScheduleSummary` (`:1050-1061`) sprawdzają dokładnie sześć kolumn widoku; krok "dwóch najnowszych" (`:5268-5292`) zakłada, że dwa najnowsze początki grafików to 2026-11-15; `cutAtCoverage`, `gridHeadersOf` (jedna tabela przed obsadą), `bodyRowsOf`, `GRID_ROW_CELLS`, `violationSectionOf`/`violationItemsOf` (jedna lista `ul`), `explainsCoverageNote` (pierwszy `p` po sekcji obsady), `showsAssignHeading` (jeden `h1`), `linksBackFromAssignPage` (linki "Edytuj grafik" i "Lista grafików" na szkicu), `hasD6Notice` (tekst szkicu na listach, nowym, edycji i obsadzaniu); sprzątanie kontem serwisowym po etykiecie `Smoke-*` (`:5611-5615`) musi nadal działać dla zatwierdzonego grafiku; `deleteSmokeAccounts` (`:157-176`) usuwa konta.

## Desired End State

- Strona `/schedules/<id>/assign` szkicu ma po sekcji obsady sekcję "Zatwierdzanie": przycisk "Zatwierdź grafik" (wyłączony z podanym powodem przy krytycznym naruszeniu, przy niepoliczalnych regułach i w czasie zapisu), a po kliknięciu panel potwierdzenia z listą bieżących ostrzeżeń (albo informacją, że ich nie ma), zdaniem, że zatwierdzenie jest ostateczne i blokuje grafik, bezpiecznym przyciskiem "Wróć" i przyciskiem "Zatwierdź"; po sukcesie strona jest przeładowana już w trybie tylko do odczytu.
- Zatwierdzony grafik: `/schedules/<id>/assign` pokazuje baner "Grafik zatwierdzony dd.mm.rrrr, przez <e-mail>", siatkę z wyłączonymi przyciskami, zapisane wskazania (nie przeliczane), sumy godzin z migawki oraz wariant komunikatu D6; `/schedules/<id>` zamiast formularza pokazuje komunikat i link do widoku; lista `/schedules` ma kolumnę statusu z datą zatwierdzenia i dla zatwierdzonych tylko link do podglądu.
- Baza: status 'draft' albo 'approved' w `schedules`, sesja nie może go zapisać (granty kolumnowe); polityki wszystkich czterech tabel wymagają szkicu; zatwierdzenie robi wyłącznie funkcja `approve_schedule` (jedne drzwi), która sprawdza rolę planisty, blokuje grafik, porównuje dane wejściowe trasy z bieżącymi, odrzuca ładunek z krytycznym wskazaniem lub z niepotwierdzonym ostrzeżeniem i zapisuje niemodyfikowalny rekord (czas, zatwierdzający, wskazania, potwierdzone klucze, liczby) oraz migawki zmian i pracowników; każda próba zapisu do zatwierdzonego grafiku (przez aplikację i przez PostgREST) jest odrzucona z przyczyną.
- Trasa `POST /api/schedules/[id]/approve` przelicza reguły z danych bazy (nie ufa klientowi) i odpowiada precyzyjnymi kodami: 200, 404, 409 `critical_violations`, 409 `confirmation_required`, 409 `schedule_changed`, 409 `schedule_approved`, 503 `rules_unavailable`; trasy przypisań i zapisu grafiku odpowiadają 409 `schedule_approved` dla zatwierdzonego grafiku.
- Edycja zmiany lub pracownika po zatwierdzeniu nie zmienia zatwierdzonego grafiku (migawka); strona `/shifts/<id>` informuje, że zatwierdzone grafiki zachowują swoją kopię.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, smoke przechodzi lokalnie i w CI, a po wdrożeniu (z `db push` przed kodem) zatwierdzenie i tryb tylko do odczytu działają na produkcji, a pomiar CPU trasy zatwierdzania i strony obsadzania mieści się w limicie.

### Key Discoveries:

- Istniejące granty wymuszają przebudowę: tabelowy `grant insert, update` na `schedules` obejmuje każdą przyszłą kolumnę, więc planista mógłby przez PostgREST cofnąć status do szkicu. Precedens poprawki to granty kolumnowe (`employee_accounts.sql:16-25`); `save_schedule` działa dalej, bo jej listy kolumn się zgadzają.
- Samo sprawdzenie statusu w polityce nie wystarcza: zapis, który przeszedł politykę na stanie szkicu, może zatwierdzić się po odczytach zatwierdzenia. Zamyka to blokada w funkcji: `FOR UPDATE` na wierszu grafiku, potem `LOCK TABLE ... SHARE ROW EXCLUSIVE` na trzech tabelach dzieci (i na `absences`), bo przypisania nie mają klucza do `schedules`. Zachowanie PostgreSQL (uprawnienia do `LOCK TABLE`, migawka po oczekiwaniu na blokadę w rozszerzonym protokole PostgREST) było tylko z pamięci, więc Faza 2 ma test dwoma połączeniami.
- `DELETE` zablokowany przez RLS to cichy brak operacji (0 wierszy, status 200), więc trasa przypisań musi to wykryć (`.delete().select()` i przy 0 wierszach sprawdzenie statusu) i odpowiedzieć 409 `schedule_approved`; `INSERT` na zablokowanym grafiku daje 42501, dziś mapowane na 500 (`assignments.ts:111-115`).
- Baza nie powtórzy reguł, więc przy bezpośrednim wywołaniu RPC przez zaufanego planistę możliwa jest zafałszowana lista wskazań. Funkcja odrzuca ładunek z jakimkolwiek krytycznym wskazaniem i z ostrzeżeniami spoza potwierdzonych kluczy oraz zapisuje zatwierdzającego; reszta to ryzyko szczątkowe, które dokumentujemy (planista jest zaufanym decydentem).
- `approved_by` bez klucza do `auth.users`: klucz zepsułby sprzątanie kont w smoke i zgubił historię po usunięciu konta; zapisujemy uuid i e-mail.
- Migawka, a nie blokada edycji słownika: blokada użytej zmiany uniemożliwiłaby jej poprawę na zawsze, a pracownika nie da się zablokować (każdy jest na jakimś zatwierdzonym grafiku). Migawka tabel znormalizowanych pozwoli S-11 dodać polityki pracownika.
- Sumy godzin zatwierdzonego grafiku też są zamrożone: trasa liczy `summarizeWorkload` (z nieobecnościami) i funkcja zapisuje `worked_minutes` i `norm_minutes` w migawce pracowników, bo widok tylko do odczytu nie ładuje nieobecności i nie przelicza.
- Weryfikacja zbioru zamiast odcisku: porównanie zbiorów pod blokadą (styl `save_schedule`) mówi, co się różni, i nie wymaga identycznej kanonizacji w TypeScripcie i SQL.
- Tryb tylko do odczytu jest rozstrzygany na serwerze (te same strony), więc nie powstaje druga, kliencka ścieżka kodu; po zatwierdzeniu strona jest przeładowywana.

## What We're NOT Doing

- Cofania zatwierdzenia, wersji grafiku i unikalności okresu (S-12), widoku pracownika i polityk pracownika (S-11), generatora (S-09), nieobecności i ich zmian (S-07, S-15).
- Blokowania edycji słownika zmian lub pracowników (migawka wystarcza), zmian w regułach, wersji reguł zapisywanej z zatwierdzeniem, ponownego sprawdzania zatwierdzonego grafiku wobec późniejszych nieobecności (grafik zostaje taki, jaki zatwierdzono; reakcją jest nowa wersja w S-12, a dla urlopu wpływ pokazany w S-15).
- Potwierdzania pojedynczych ostrzeżeń (jedno potwierdzenie na wszystkie), wymogu minimalnej liczby przypisań (pusty grafik można zatwierdzić po potwierdzeniu ostrzeżeń o brakach), powiadomień, eksportu i druku.
- Usuwania grafików (nadal brak, FR-018 jest "mile widziane"), zmian w `access.ts`, `ci.yml`, `package.json`, nowych zmiennych środowiskowych i użycia klucza service-role w Workerze.
- Testów komponentów i hooków (konwencja repo): logika decyzji w czystych funkcjach.

## Implementation Approach

Od środka na zewnątrz: czyste funkcje decyzji i ładunku (Faza 1), baza z blokadą, funkcją i migawkami dowiedziona w smoke na tokenach czterech aktorów (Faza 2), dane i trasa zatwierdzania z mapowaniem 409 (Faza 3), interfejs i tryb tylko do odczytu (Faza 4), smoke stron i dokumentacja (Faza 5), wdrożenie (Faza 6). Zmiana wymaga S-07 w `master`: ładunek weryfikacji obejmuje `absences`, a migracja ma późniejszy znacznik niż migracja S-07.

Decyzje z wywiadu: blokada przez status + RLS + granty kolumnowe; druga funkcja `security definer` `approve_schedule`; ładunek `p_inputs` porównywany pod blokadą; migawka zamiast blokady edycji; jedno potwierdzenie z panelem zawsze pokazywanym; te same strony w trybie tylko do odczytu; zatwierdzić można każdy szkic o policzalnych regułach bez krytycznych; zatwierdzony grafik pozostaje zamrożony; wariant komunikatu D6; rekord zatwierdzenia z wskazaniami, potwierdzeniem, zatwierdzającym i czasem.

Rozstrzygnięte w planowaniu (do zakwestionowania przy zatwierdzaniu):
- Nazwy: tabele `schedule_approvals` (PK `schedule_id`), `schedule_approval_shifts`, `schedule_approval_employees`; pomocnik `public.schedule_is_draft(uuid)` (stable, `security invoker`, `set search_path = ''`, w stylu `is_planner`); funkcja `public.approve_schedule(p_schedule_id uuid, p_inputs jsonb, p_violations jsonb, p_confirmed_keys jsonb, p_workload jsonb) returns timestamptz`.
- Kody błędów bazy (nie `PT409`): `PT423` zablokowany lub już zatwierdzony grafik (trasy: 409 `schedule_approved`), `PT412` zmienione dane wejściowe (409 `schedule_changed`), `PT422` ładunek niezgodny (krytyczne wskazanie w ładunku albo ostrzeżenie bez potwierdzenia; trasa: 500, bo trasa tego nie wyśle), `PT404` brak grafiku, `23505` podwójne zatwierdzenie jako ostatnia siatka (409 `schedule_approved`).
- Ładunek `p_inputs`: `{ startDate, staffing: [{ shiftId, dayOffset, requiredCount }], employeeIds: [...], assignments: [{ shiftId, dayOffset, employeeId }], shifts: [{ id, name, startMinute, endMinute }], employees: [{ id, name, fte: { numerator, denominator } }], absences: [{ employeeId, type, status, startDate, endDate }] }`; funkcja porównuje zbiory z żywymi wierszami pod blokadą (obsada, skład, przypisania, użyte zmiany po `(id, nazwa, godziny)`, pracownicy składu po `(id, nazwisko i imię, etat)`, nieobecności nakładające się na okno `[start, start + 7 dni]` dla składu).
- Blokada: kolejność `schedules` (`FOR UPDATE`), potem `LOCK TABLE schedule_staffing, schedule_employees, schedule_assignments, absences IN SHARE ROW EXCLUSIVE MODE` (obsada pierwsza, bo każdy `save_schedule` zaczyna zapis od niej, a kaskada dochodzi do przypisań później; odwrotna kolejność groziłaby zakleszczeniem z zapisem innego szkicu), potem `FOR SHARE` na użytych zmianach i pracownikach składu; migawka kopiowana z zablokowanych wierszy.
- Rekord: `approved_at` (`now()`), `approved_by uuid` (`auth.uid()`) i `approved_by_email` (z tokenu), `violations jsonb` (kształt `Violation`), `confirmed_keys jsonb`, `critical_count`, `warning_count`; migawka zmian (`shift_id`, `name`, `start_minute`, `end_minute`) i pracowników (`employee_id`, `display_name` "Nazwisko Imię", `fte_numerator`, `fte_denominator`, `worked_minutes`, `norm_minutes`); wszystkie bez kluczy do `shifts`, `employees` i `auth.users`, z kaskadą z `schedules`; planista ma tylko `select`, pracownik nic.
- Trasa: kolejność sprawdzeń `readJsonBody` (`{ confirmedKeys: string[] }`) → 503 `not_configured` → 404 dla nie-UUID → odczyt danych sesją → `safeEvaluate` (porażka to 503 `rules_unavailable`, nigdy zatwierdzenie bez kontroli) → krytyczne > 0 to 409 `critical_violations` z listą → ostrzeżenia spoza `confirmedKeys` to 409 `confirmation_required` z bieżącymi ostrzeżeniami → wywołanie funkcji; sukces 200 `{ approvedAt }`.
- Widok `schedule_summaries` dostaje na końcu kolumny `status` i `approved_at` (`create or replace view` z ponownie podaną opcją `security_invoker`), a `ScheduleSummary` pola `status` i `approvedAt`.
- Wariant komunikatu D6 dla zatwierdzonych: "Zatwierdzony grafik tygodniowy. Nie zastępuje formalnego rozkładu czasu pracy (art. 129 § 3), który obejmuje co najmniej miesiąc i jest przekazywany pracownikowi z tygodniowym wyprzedzeniem."; wersja szkicu bez zmian.
- Widok zatwierdzonego: bez znaczników nieobecności i bez przeliczania wskazań (zapisane wskazania pokazują kolizje z nieobecnościami jako tekst); sumy godzin z migawki.

## Critical Implementation Details

- **Przebudowa grantów**: `revoke insert, update on public.schedules from authenticated`, potem `grant insert (start_date, label)` i `grant update (start_date, label)`; kolumna `status` ma domyślną 'draft' i jest zapisywana tylko przez funkcję `security definer`; polityka `update` na `schedules` wymaga `status = 'draft'`.
- **Polityki**: dla `schedule_staffing` (insert, update, delete), `schedule_employees` (insert, delete) i `schedule_assignments` (insert, delete) dodać warunek `public.schedule_is_draft(schedule_id)` (polityki select bez zmian, planista czyta zatwierdzone); pracownik nadal bez polityk. `save_schedule` jest przepisywana (drop i create, precedens S4:75-77): przed `update schedules` sprawdza status i rzuca `PT423`, a gdy `update` nie trafi w żaden wiersz (zapis czekał na blokadę zatwierdzenia i polityka odfiltrowała wiersz), sprawdza status ponownie i dla zatwierdzonego rzuca `PT423`, inaczej `PT404`; kolejność parametrów i działanie dla szkicu bez zmian.
- **Funkcja `security definer`**: `set search_path = ''`, w pełni kwalifikowane nazwy, `revoke execute ... from public, anon`, `grant execute ... to authenticated`, sprawdzenie `public.is_planner()` jako PIERWSZA instrukcja (inaczej każde zalogowane konto mogłoby zatwierdzać; smoke wywołuje funkcję jako pracownik, konto bez roli i anonim).
- **Odpowiedzi blokady w trasach**: `removeAssignment` używa `.delete().select()` i przy 0 skasowanych wierszach sprawdza status; `addAssignment` mapuje 42501 na `schedule_approved` po sprawdzeniu statusu; `PUT` mapuje `PT423` na 409 `schedule_approved`; `useAssignments.failureMessage` i `useScheduleForm.readErrorBody` dostają polskie komunikaty dla tego kodu.
- **CPU**: trasa nie renderuje Reacta, więc jest tańsza niż strona obsadzania (jedno `evaluateSchedule`, JSON do ok. 100 KB); mierzymy po wdrożeniu. Wszystko po stronie serwera używa tych samych czystych funkcji co wyspa (te same wskazania).
- **Smoke**: zatwierdzenie blokuje grafik, więc kroki zatwierdzania używają NOWEGO grafiku `Smoke-<runId>-approval` (data startu przed 2026-11-15, żeby krok "dwóch najnowszych" się nie zmienił), a grafik reguł `Smoke-<runId>-rules` (z krytycznymi) zostaje szkicem i służy tylko do odmowy; migawkę dowodzi edycja dedykowanej zmiany smoke (nie współdzielonych); sprzątanie kontem serwisowym działa przez kaskady (brak kluczy z tabel zatwierdzeń do `shifts`, `employees`, `auth.users`).
- **Smoke kruche pomocniki**: nowa kolumna statusu na liście wymaga zmiany `listsApiSchedule` (7 komórek) i `SUMMARY_COLUMNS` (osiem kolumn); sekcja zatwierdzania idzie PO sekcji obsady i nie używa `<table>`, wierszy z `th scope="row"` ani drugiej listy `ul` w sekcji wskazań; etykiety nowych grafików nie mogą być nadzbiorem istniejących.
- **Dane zdrowotne w zamrożonych powodach (ustalenie z przeglądu S-07)**: powód wskazania `absence` i `absence_requested` niesie rodzaj nieobecności, w tym "zwolnienie lekarskie (L4)", obok nazwiska (`rules.ts`, `absenceCollisions`). Zatwierdzenie zamraża `reason` jako tekst, a S-11 pokaże zatwierdzone grafiki pracownikom, więc inny pracownik mógłby poznać, że kolega jest na L4. Decyzja autora (2026-11-27): zamrożone wskazania są tylko dla planisty, bez redagowania; S-11 nie dostaje polityki na `schedule_approvals` (może czytać najwyżej tabele migawek), a smoke w Fazie 2 dowodzi, że pracownik czyta stamtąd pustą listę przy istniejącym rekordzie.
- **Potwierdzenie po kluczu (decyzja autora 2026-11-27)**: trasa porównuje same klucze wskazań. Ryzyko zaakceptowane: ostrzeżenie, które między pokazaniem panelu a zatwierdzeniem zmieniło liczby (np. brak 1 osoby urósł do 3) pod tym samym kluczem, przechodzi jako potwierdzone; rekord zapisuje wskazania przeliczone na serwerze. Dokumentacja (Faza 5) to opisuje.
- **Migracja**: znacznik późniejszy niż migracja S-07 (`supabase db push` odmawia starszego niż zastosowany); komentarz nagłówkowy opisuje ryzyko szczątkowe zafałszowanej listy i dlaczego jedyne drzwi to funkcja.

## Phase 1: Czyste funkcje zatwierdzania

### Overview

Dodać typy, decyzję o zatwierdzeniu i budowę ładunku jako czyste funkcje z testami deterministycznymi. Zachowanie aplikacji się nie zmienia.

### Changes Required:

#### 1. Typy

**File**: `src/types.ts`

**Intent**: Kontrakt zatwierdzenia dla trasy, bazy i interfejsu. Wstawić w środku pliku, w osobnym bloku.

**Contract**: `ScheduleStatus = "draft" | "approved"`; `Schedule` i `ScheduleSummary` dostają `status: ScheduleStatus` i `approvedAt: string | null` (aktualizacja fikstur testów); `ApprovalSnapshotShift { shiftId; name; startMinute; endMinute }`, `ApprovalSnapshotEmployee { employeeId; displayName; fte: Fte; workedMinutes; normMinutes }`, `ScheduleApproval { scheduleId; approvedAt; approvedByEmail; violations: Violation[]; confirmedKeys: string[]; criticalCount; warningCount; shifts: ApprovalSnapshotShift[]; employees: ApprovalSnapshotEmployee[] }`.

#### 2. Decyzja i ładunek

**File**: `src/lib/services/approval.ts` (nowy), `src/lib/services/approval.test.ts` (nowy)

**Intent**: Cała logika zatwierdzenia poza bazą jako czyste funkcje (bez `astro:*`, bez zoda).

**Contract**: `decideApproval(evaluation: { ok: true; violations: Violation[] } | { ok: false }, confirmedKeys: readonly string[]): { ok: true; warnings: Violation[] } | { ok: false; error: "rules_unavailable" } | { ok: false; error: "critical_violations"; critical: Violation[] } | { ok: false; error: "confirmation_required"; warnings: Violation[] }` (kolejność sprawdzeń jak w trasie: niepoliczalne reguły, krytyczne, ostrzeżenia spoza potwierdzonych; zbiór potwierdzonych kluczy może być nadzbiorem, ostrzeżenia przeliczone są źródłem prawdy); `buildApprovalPayload(input: { schedule; shifts; employees; assignments; absences; violations; workload }): { inputs: ApprovalInputs; violations: Violation[]; confirmedKeys: string[]; workload: { employeeId; workedMinutes; normMinutes }[] }` (zbiory posortowane `compareText`, użyte zmiany to te z komórek obsady, pracownicy składu, `displayName` "Nazwisko Imię" jak `toEmployeeOptions`, wynik niezależny od kolejności wejścia, wejście nie jest mutowane); `APPROVAL_MESSAGES` (polskie komunikaty dla kodów `critical_violations`, `confirmation_required`, `schedule_changed`, `schedule_approved`, `rules_unavailable`, jedno miejsce dla trasy i hooków). Testy tabelaryczne: wszystkie ścieżki `decideApproval` (brak wskazań, same ostrzeżenia potwierdzone i niepotwierdzone, nadzbiór potwierdzonych, krytyczne wygrywa z niepotwierdzonymi, porażka reguł), ładunek (zbiory posortowane, tylko użyte zmiany, pracownicy składu, nieobecności zachowane), determinizm przez `expectDeterministic` i `seededShuffle`, brak mutacji (`Object.freeze`, `structuredClone`), brak wywołań lokalnych metod `Date`.

### Success Criteria:

#### Automated Verification:

- Testy czystych funkcji przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Kolejność sprawdzeń zatwierdzenia, kody błędów i polskie komunikaty oraz kształt ładunku weryfikacji zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Baza: status, blokada i zatwierdzenie

### Overview

Dodać status, blokadę na czterech tabelach, rekord zatwierdzenia z migawkami i funkcję `approve_schedule`, z dowodem w smoke na tokenach czterech aktorów i testem współbieżności dwoma połączeniami. Aplikacja zmienia się tylko o to, czego wymaga przebudowa grantów (nic nie jest jeszcze zatwierdzane z aplikacji).

### Changes Required:

#### 1. Migracja

**File**: `supabase/migrations/<znacznik>_schedule_approval.sql` (nowy; znacznik z `npx supabase migration new schedule_approval`, późniejszy niż migracja S-07)

**Intent**: Wymusić blokadę zatwierdzonego grafiku w bazie i dać jedną drogę do zatwierdzenia.

**Contract**: nagłówek komentarza (po co status, dlaczego granty kolumnowe, dlaczego jedyne drzwi to funkcja, ryzyko szczątkowe zafałszowanej listy przy bezpośrednim RPC, migawka zamiast blokady edycji); `alter table public.schedules add column status text not null default 'draft'` z CHECK `schedules_status_valid` (`draft`, `approved`); przebudowa grantów jak w "Critical Implementation Details"; funkcja `public.schedule_is_draft(uuid)`; polityki z warunkiem szkicu na czterech tabelach (zastąpić istniejące polityki insert, update, delete; select bez zmian); tabele `schedule_approvals`, `schedule_approval_shifts`, `schedule_approval_employees` według "Rozstrzygnięte w planowaniu" (RLS, `revoke all`, `grant select` dla `authenticated` z polityką planisty, brak grantów zapisu); przepisanie `save_schedule` (drop starej, create nowej z tym samym podpisem i sprawdzeniem statusu `PT423`); funkcja `approve_schedule` (kolejność: rola planisty, `FOR UPDATE` na grafiku z `PT404` i `PT423`, blokady tabel, porównanie ładunku ze stanem żywym z `PT412`, kontrola ładunku `PT422`, zapis rekordu i migawek z zablokowanych wierszy, `update schedules set status = 'approved'`, zwrot `approved_at`); `create or replace view public.schedule_summaries` z dodanymi na końcu `status` i `approved_at` (z `with (security_invoker = true)` podanym ponownie i `grant select` jak dotąd).

#### 2. Smoke bazy

**File**: `scripts/smoke.mjs`

**Intent**: Udowodnić blokadę każdej ścieżki zapisu, jedne drzwi zatwierdzenia, migawkę i kaskadę, z asercjami przyczyny.

**Contract**: nowy grafik `Smoke-<runId>-approval` (przez konto serwisowe lub trasę, ze zmianą i pracownikami dedykowanymi do tego bloku) zatwierdzony funkcją z ładunkiem zbudowanym w skrypcie; kroki: planista nie może zapisać `status` (42501 na kolumnie), po zatwierdzeniu PATCH/DELETE/POST planisty na `schedules`, `schedule_staffing`, `schedule_employees`, `schedule_assignments` jest odrzucony (insert 403/42501 z polityki, update i delete ukryte jako 200 `[]` z `return=representation`), `save_schedule` na zatwierdzonym grafiku rzuca `PT423` (404/`PT423` w odpowiedzi PostgREST z dokładnym kodem), `approve_schedule` jako pracownik, konto bez roli i anonim odrzucone z dokładnym kodem i komunikatem (pracownik i konto bez roli: odmowa roli; anonim: 401 `42501`), jako planista: ładunek ze zmienionymi danymi `PT412`, ładunek z krytycznym wskazaniem i z ostrzeżeniem bez potwierdzenia `PT422`, podwójne zatwierdzenie `PT423`, poprawne zatwierdzenie zwraca czas i tworzy rekord z oczekiwanymi liczbami; rekordy i migawki czyta planista (dokładna treść), pracownik i konto bez roli mają listę pustą (przy istniejącym rekordzie, dowód RLS), anonim 401, brak zapisu przez sesję; migawka: po zatwierdzeniu edycja dedykowanej zmiany i pracownika nie zmienia rekordu migawki; widok `schedule_summaries` ma osiem kolumn i status zatwierdzonego; kaskada: usunięcie grafiku kontem serwisowym usuwa rekord i migawki (krok "brak rekordów" po sprzątaniu); zaktualizować `SUMMARY_COLUMNS` i `isScheduleSummary`.

#### 3. Test współbieżności

**File**: `context/changes/schedule-approval/reviews/lock-test.md` (notatka z wynikiem; skrypt w katalogu tymczasowym zadania, nie w repozytorium)

**Intent**: Potwierdzić dwoma połączeniami zachowania PostgreSQL, na których opiera się blokada (były tylko z pamięci).

**Contract**: dwie sesje psql na lokalnej bazie: (a) zapis (insert przypisania) rozpoczęty w trakcie `approve_schedule` czeka na blokadę i po jej zwolnieniu kończy się odmową polityki; (b) zapis zatwierdzony przed odczytami zatwierdzenia jest wykryty jako `PT412`; (c) `LOCK TABLE` w funkcji działa z uprawnieniami definera; (d) `save_schedule` rozpoczęty w trakcie zatwierdzania tego samego grafiku kończy się `PT423`, nie `PT404`. Jeśli (a) nie przejdzie, `schedule_is_draft` dostaje `volatile` i test jest powtarzany; dalsza porażka wraca do autora; wynik (w tym zachowania odmienne od założeń) zapisany w notatce przed zamknięciem fazy.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Migracja stosuje się na świeżej bazie: `npx supabase db reset`
- Smoke z krokami bazy przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- Treść migracji (granty kolumnowe, polityki, funkcja `approve_schedule`, kody błędów, kolejność blokad, brak kluczy do `auth.users`) została przejrzana i zatwierdzona przez autora, a wynik testu dwoma połączeniami jest zapisany w notatce

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Dane i trasa zatwierdzania

### Overview

Dodać moduł danych zatwierdzeń i trasę `POST /api/schedules/[id]/approve`, przepiąć trasy zapisu na kod blokady i dowieść wszystko w smoke API. Strony się nie zmieniają.

### Changes Required:

#### 1. Moduł danych

**File**: `src/lib/approvals.ts` (nowy), `src/lib/schedules.ts`, `src/lib/assignments.ts`, `src/lib/services/schedule.ts`

**Intent**: Jedyne miejsce, które zna tabele zatwierdzeń i wywołuje funkcję, oraz obsługa blokady w istniejących modułach.

**Contract**: `getApproval(supabase, scheduleId): Promise<ScheduleApproval | null>` (rekord z migawkami, null dla szkicu i nie-UUID, strażnik `READ_LIMIT`); `approveSchedule(supabase, scheduleId, payload): Promise<{ ok: true; approvedAt: string } | { ok: false; error: "not_found" | "schedule_approved" | "schedule_changed" | "invalid" | "failed" }>` (mapuje `PT404`, `PT423`, `23505`, `PT412`, `PT422`; log przez `logDatabaseError`); `getSchedule` i `LIST_SELECT` czytają `status` i `approved_at`; `SaveFailure` dostaje wariant `schedule_approved`, a `classifySaveFailure` mapuje `PT423` (czysto, z testem w `schedule.test.ts`); `addAssignment` mapuje 42501 na `schedule_approved` po sprawdzeniu statusu, `removeAssignment` używa `.delete().select()` i przy 0 wierszach sprawdza status (zatwierdzony to `schedule_approved`, inaczej idempotentne `ok`); aktualizacja fikstur testów `ScheduleSummary`; `listAssignments` czyta z `count: "exact"` i używa `assertCompleteRead` (przeniesionego z `absences.ts` do `src/lib/postgrest.ts`), żeby obcięty odczyt był błędem, a nie ciągłym `schedule_changed`.

#### 2. Trasy

**File**: `src/pages/api/schedules/[id]/approve.ts` (nowy), `src/pages/api/schedules/[id].ts`, `src/pages/api/schedules/[id]/assignments.ts`

**Intent**: Zatwierdzenie z przeliczeniem reguł na serwerze i precyzyjnymi kodami, oraz 409 dla zatwierdzonego grafiku w trasach zapisu.

**Contract**: trasa `approve` według "Rozstrzygnięte w planowaniu" (ładowanie `getSchedule`, `listAssignments`, `listShifts`, `listEmployees` zawężone do składu, `listAbsencesOverlapping` z modułu S-07; `safeEvaluate`; `decideApproval`; `summarizeWorkload` z nieobecnościami na zamrożone sumy; `buildApprovalPayload`; `approveSchedule`; odpowiedzi 200 `{ approvedAt }`, 404, 409 `critical_violations` z listą, 409 `confirmation_required` z ostrzeżeniami, 409 `schedule_changed`, 409 `schedule_approved`, 503 `rules_unavailable`, 500 `failed`; `export const prerender = false`, `jsonResponse`); `PUT /api/schedules/[id]` i trasy przypisań odpowiadają 409 `schedule_approved` zamiast 500 lub błędnego 200 dla zatwierdzonego grafiku; `access.test.ts` dostaje przypadki dla `/api/schedules/<uuid>/approve` (planista tak, pracownik 403, anonim 401, konto bez roli 403).

#### 3. Smoke API

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść trasy zatwierdzania i blokady w trasach na prawdziwych danych.

**Contract**: macierz ról dla trasy `approve` (anonim 401, pracownik i konto bez roli 403, JSON z dokładnym kodem), kroki planisty: grafik reguł (z krytycznymi) daje 409 `critical_violations` z dokładnymi kluczami i grafik pozostaje szkicem, grafik z samymi ostrzeżeniami daje 409 `confirmation_required` z dokładną listą, ze zbyt małym zbiorem potwierdzonych kluczy to samo, z kompletnym zbiorem 200 `{ approvedAt }` i rekord w bazie ma oczekiwane wskazania, liczby, potwierdzone klucze i zatwierdzającego; druga próba 409 `schedule_approved`; po zatwierdzeniu `PUT /api/schedules/<id>`, `POST` i `DELETE` przypisań dają 409 `schedule_approved` (i dane się nie zmieniły: odczyt z bazy), bez zmian dla szkiców; poprawne zatwierdzenie nie wymaga ręcznego ładunku.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami trasy zatwierdzania i blokady tras przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- Kolejność sprawdzeń w trasie zatwierdzania, kody odpowiedzi i mapowanie błędów bazy zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: Interfejs zatwierdzania i tryb tylko do odczytu

### Overview

Dodać sekcję i panel zatwierdzania w widoku obsadzania, tryb tylko do odczytu zatwierdzonego grafiku (obsadzanie, edycja, lista) z migawkami i wariant komunikatu D6. Kroki smoke dla istniejących stron zostają zielone dla szkiców.

### Changes Required:

#### 1. Sekcja i panel zatwierdzania

**File**: `src/components/hooks/useApproval.ts` (nowy), `src/components/schedules/ApprovalSection.tsx` (nowy), `src/components/schedules/AssignmentGrid.tsx`, `src/components/hooks/useAssignments.ts`

**Intent**: Zatwierdzenie jednym świadomym działaniem w miejscu, gdzie liczą się wskazania.

**Contract**: `ApprovalSection` jako `section` z `aria-labelledby="approval-heading"` PO sekcji obsady (bez `<table>`, wierszy z `th scope="row"` i drugiej listy w sekcji wskazań); przycisk "Zatwierdź grafik" wyłączony z widocznym powodem przy krytycznym naruszeniu (`counts.critical > 0`), przy `useViolations().failed`, w trakcie zapisu (`busy`); po kliknięciu panel w stylu `ScheduleForm.tsx:148-177`: zdanie alarmowe (zatwierdzenie jest ostateczne i blokuje grafik), lista bieżących ostrzeżeń z `useViolations` (albo informacja o braku), bezpieczny przycisk "Wróć" z `autoFocus` i przycisk "Zatwierdź"; `useApproval` wysyła `confirmedKeys` pokazanych ostrzeżeń, na 200 przeładowuje stronę (`window.location.replace`), na 409 `confirmation_required`, `schedule_changed` i `critical_violations` pokazuje komunikat z `APPROVAL_MESSAGES` i przycisk "Odśwież stronę" (pełne przeładowanie, bo wskazania liczą się z danych załadowanych przy otwarciu strony), na 409 `schedule_approved` przeładowuje stronę, na 401/403 komunikat o sesji, na błąd sieci komunikat z możliwością ponowienia; `useAssignments.failureMessage` dostaje komunikat dla 409 `schedule_approved`.

#### 2. Tryb tylko do odczytu i migawki

**File**: `src/pages/schedules/[id]/assign.astro`, `src/pages/schedules/[id].astro`, `src/pages/schedules/index.astro`, `src/components/schedules/AssignmentGrid.tsx`, `src/components/schedules/ViolationList.tsx`, `src/components/schedules/ScheduleNotice.astro`, `src/lib/schedule-options.ts`, `src/components/hooks/useScheduleForm.ts`

**Intent**: Zatwierdzony grafik jest czytelny i niezmienny na każdej stronie, a to, co pokazuje, pochodzi z zatwierdzenia.

**Contract**: `assign.astro` dla zatwierdzonego grafiku ładuje `getApproval`, buduje `ShiftOption[]` i `EmployeeOption[]` z migawki (adapter zachowujący kolejność i kształt, w `schedule-options.ts`), nie ładuje nieobecności, przekazuje wyspie `readOnly` z zapisanymi wskazaniami i sumami godzin z migawki; baner "Grafik zatwierdzony dd.mm.rrrr, przez <e-mail>" nad wyspą; `AssignmentGrid` w trybie tylko do odczytu: bez obsługi kliknięć, przyciski `disabled` z zachowanym `aria-pressed` i `aria-label`, bez akapitu podpowiedzi, `ViolationList` z zapisanych wskazań (bez przeliczania, bez sekcji zatwierdzania, bez znaczników nieobecności), kolumna "Godziny" z migawki; link "Edytuj grafik" ukryty; `[id].astro` dla zatwierdzonego grafiku zamiast `ScheduleForm` pokazuje komunikat i link do widoku obsadzania; `index.astro` dostaje kolumnę statusu ("Szkic" albo "Zatwierdzony dd.mm.rrrr") w tabeli i kartach, a dla zatwierdzonych link "Podgląd" zamiast "Edytuj" (szkice bez zmian); `ScheduleNotice` dostaje prop i wariant komunikatu D6 dla zatwierdzonych; `useScheduleForm.readErrorBody` mapuje 409 `schedule_approved`; `/shifts/<id>` dostaje notkę, że zatwierdzone grafiki zachowują swoją kopię danych zmiany (jedno zdanie, bez dodatkowego zapytania, jeśli to możliwe, albo z licznikiem z jednego zapytania); `planner/index.astro` bez zmian poza ewentualnym opisem karty ("Szkice" pozostaje prawdą).

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z istniejącymi krokami stron szkiców przechodzi lokalnie: `npm run smoke`

#### Manual Verification:

- W przeglądarce na desktopie: panel potwierdzenia (lista ostrzeżeń, bezpieczny przycisk, zatwierdzenie), po zatwierdzeniu baner i siatka tylko do odczytu z zapisanymi wskazaniami i sumami z migawki, strona edycji z komunikatem, lista ze statusem, komunikaty przy zmianie krytycznego wskazania między kliknięciami, klawiatura i czytnik
- Na telefonie (lub emulacji): sekcja i panel zatwierdzania oraz widok tylko do odczytu są czytelne, strona nie ma poziomego przewijania dokumentu

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 5: Smoke stron i dokumentacja

### Overview

Dowieść na prawdziwych danych stron zatwierdzania i trybu tylko do odczytu oraz opisać zatwierdzanie w dokumentacji.

### Changes Required:

#### 1. Smoke stron

**File**: `scripts/smoke.mjs`

**Intent**: Sprawdzić, że szkic ma sekcję zatwierdzania, a zatwierdzony grafik jest tylko do odczytu na każdej stronie, z dokładnymi tekstami.

**Contract**: dostosować `listsApiSchedule` (siedem komórek, kolumna statusu "Szkic"), `hasD6Notice` (oba warianty), `linksBackFromAssignPage` i pozostałe pomocniki z listy "Smoke kruche pomocniki"; kroki na grafiku `Smoke-<runId>-approval` (po zatwierdzeniu trasą z Fazy 3): lista pokazuje wiersz z "Zatwierdzony dd.mm.rrrr" i linkiem "Podgląd" bez "Edytuj"; `/schedules/<id>/assign` ma baner z datą i e-mailem zatwierdzającego, nagłówki tabeli bez zmian, wszystkie przyciski `disabled` z oczekiwanym `aria-pressed`, zapisane wskazania z dokładnym licznikiem i tekstami (identycznymi jak zapisane w rekordzie), kolumnę "Godziny" z tekstami z migawki, brak sekcji zatwierdzania, brak `role="alert"` w wskazaniach, wariant D6; `/schedules/<id>` pokazuje komunikat i link zamiast formularza; po edycji dedykowanej zmiany i pracownika strona zatwierdzonego grafiku pokazuje dalej stare nazwy i godziny (migawka); szkic ma sekcję "Zatwierdzanie" po sekcji obsady (nagłówek, przycisk, brak panelu w HTML początkowym), przycisk wyłączony na grafiku z krytycznymi z podanym powodem; `/shifts/<id>` ma notkę; asercje sprawdzają tekst, nie klasę.

#### 2. Dokumentacja

**File**: `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Dokumentacja zgodna z kodem.

**Contract**: nowe akapity (nie edycja istniejących długich linii) o zatwierdzaniu: status i blokada (granty kolumnowe, polityki, `schedule_is_draft`), jedna droga zatwierdzenia (`approve_schedule`, druga funkcja `security definer` z uzasadnieniem i ryzykiem szczątkowym), przeliczenie na serwerze i porównanie pod blokadą, rekord i migawki, kody błędów i odpowiedzi tras, tryb tylko do odczytu i wariant D6, brak cofnięcia i zależność od S-12, uwaga, że edycja zmiany lub pracownika nie zmienia zatwierdzonego grafiku; uzupełnienie opisu `npm run smoke`; `README.md`: opis zatwierdzania. Nie dotykać fragmentów o service-role.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami stron zatwierdzonego grafiku przechodzi lokalnie: `npm run smoke`

---

## Phase 6: Wdrożenie

### Overview

Wdrożyć (z `db push` przed kodem), sprawdzić zatwierdzanie na produkcji i zmierzyć CPU trasy zatwierdzania oraz strony obsadzania.

### Changes Required:

#### 1. Pomiar CPU i zapis wyniku

**File**: `context/deployment/deploy-plan.md`

**Intent**: Powtórzyć pomiar po dodaniu trasy zatwierdzania i danych zatwierdzenia na ścieżce renderu.

**Contract**: po wdrożeniu odczyt CPU trasy `POST /api/schedules/<id>/approve` i strony `/schedules/<id>/assign` (panel Cloudflare, mediana i p99, osobno pierwsze żądanie w nowym izolacie) na grafiku z kilkunastoma przypisaniami; zapis wyniku z decyzją, a przy wartościach blisko 10 ms zapis ryzyka dla S-09 (generator).

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- Migracja zatwierdzania została zastosowana na hostowanym projekcie (`npx supabase db push`, przed wdrożeniem kodu)
- Po wdrożeniu (`npm run build` i `npx wrangler deploy`) zatwierdzenie grafiku testowego i tryb tylko do odczytu działają na produkcji (zatwierdzenie jest nieodwracalne, więc użyć grafiku testowego, którego nie da się później usunąć); nie uruchamiać `npm run smoke` na produkcji
- Pomiar CPU trasy zatwierdzania i strony obsadzania po wdrożeniu mieści się w limicie 10 ms na żądanie albo wynik jest zapisany w `deploy-plan.md` razem z decyzją

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- `approval.test.ts`: wszystkie ścieżki decyzji, budowa ładunku (posortowane zbiory, użyte zmiany, pracownicy składu), determinizm (`expectDeterministic`, `seededShuffle`), brak mutacji (`Object.freeze`, `structuredClone`), niezależność od strefy (szpiegowanie lokalnych getterów `Date`); `schedule.test.ts`: mapowanie `PT423` przez `classifySaveFailure`.
- Brak testów komponentów i hooków (konwencja repo): decyzje i komunikaty w czystych funkcjach.

### Integration Tests:

- Smoke (Fazy 2, 3, 5): blokada każdej ścieżki zapisu na tokenach czterech aktorów, jedne drzwi funkcji z dokładnymi kodami, migawka niezmienna po edycji słownika, kaskada przy sprzątaniu, trasa zatwierdzania z dokładnymi 409, strony zatwierdzonego grafiku z dokładnymi tekstami.
- Test współbieżności dwoma połączeniami (Faza 2) zapisany w notatce.
- Kontrola celowego uszkodzenia w każdej fazie z testami lub smoke (np. polityka bez warunku szkicu, brak sprawdzenia roli w funkcji, brak porównania ładunku), test lub krok musi pójść na czerwono.

### Manual Testing Steps:

1. Na szkicu z ostrzeżeniami: kliknąć "Zatwierdź grafik", sprawdzić listę ostrzeżeń w panelu, "Wróć", a potem zatwierdzić i sprawdzić baner i tryb tylko do odczytu.
2. Na szkicu z krytycznym naruszeniem: przycisk wyłączony z powodem.
3. Po zatwierdzeniu: spróbować zmienić grafik (edycja, przypisanie, bezpośredni PostgREST) i sprawdzić odmowy; edytować zmianę i pracownika i sprawdzić, że zatwierdzony grafik się nie zmienił.
4. Sprawdzić sekcję i widok tylko do odczytu na telefonie, klawiaturą i czytnikiem.

## Performance Considerations

Trasa zatwierdzania wykonuje kilka odczytów PostgREST (czekanie na sieć, nie CPU), jedno `evaluateSchedule` i `summarizeWorkload`, buduje JSON do ok. 100 KB i woła funkcję; nie renderuje Reacta, więc ma być tańsza niż strona obsadzania. Strona zatwierdzonego grafiku czyta zapisane rekordy zamiast przeliczać reguły. Funkcja trzyma blokady tabel (`SHARE ROW EXCLUSIVE`) przez czas jednego zatwierdzenia, co blokuje zapisy do tych tabel przez ułamek sekundy (zespół 10-100 osób, rzadkie zatwierdzanie). Pomiar jest wierszem planu.

## Migration Notes

Jedna migracja z późniejszym znacznikiem niż migracja S-07; `npx supabase db push` przed wdrożeniem kodu: nowy kod czyta kolumnę `status` i tabele zatwierdzeń, więc bez migracji strony grafików zawiodą. Zmiana grantów kolumnowych na `schedules` jest niezgodna wstecz tylko z kodem, który zapisywałby kolumny spoza `start_date` i `label`; aplikacja ich nie zapisuje. Stara wersja aplikacji po `db push` nadal działa (nie zna statusu i nie zatwierdza).

## Parallel Work Notes

Planowany równolegle jest S-07 (`absence-entry`), implementowany PRZED tym wycinkiem. Wspólne pliki: `src/types.ts`, `rules.ts`, `assign.astro`, `AssignmentGrid.tsx`, `useViolations.ts`, `scripts/smoke.mjs` (w tym komentarz nagłówkowy), `CLAUDE.md`, `AGENTS.md`, `README.md`, roadmapa i numeracja migracji. Ten plan zakłada, że po S-07 istnieją `src/lib/absences.ts` (`listAbsencesOverlapping`), `AbsenceOption`, `RuleInput.absences` i `absence.ts`; przy implementacji sprawdzić nazwy w `master` i dostosować ładunek. Nowe typy w osobnym bloku `types.ts`; kroki smoke w środku bloków; w dokumentacji nowe akapity zamiast edycji linii; w roadmapie każdy wycinek zmienia tylko swoje wiersze.

## References

- Roadmap: `context/foundation/roadmap.md` (S-08, S-07, S-11, S-12), PRD: `context/foundation/prd.md` (FR-012, FR-013, FR-021, US-01, Guardrails), reguły: `context/foundation/work-time-rules.md` (D6)
- Baza: `supabase/migrations/20261106120157_schedules.sql`, `20261124152716_schedule_assignments.sql`, `20261125120000_schedule_summaries.sql`, `20261123194030_employee_account_activation.sql` (precedens `security definer`), `20261020131134_role_helpers.sql` (wzorzec `is_planner`)
- Dane i trasy: `src/lib/schedules.ts`, `assignments.ts`, `src/lib/services/schedule.ts:344-365`, `src/pages/api/schedules/*`, `src/pages/api/shifts/[id].ts`, `src/pages/api/employees/[id].ts`
- Silnik: `src/lib/services/rules.ts`, `safe-evaluate.ts`, `workload.ts`, `src/types.ts` (`Violation`)
- Interfejs: `src/pages/schedules/*`, `AssignmentGrid.tsx`, `useAssignments.ts`, `useScheduleForm.ts`, `ScheduleForm.tsx:148-177`, `ScheduleNotice.astro`, `schedule-options.ts`
- Smoke: `scripts/smoke.mjs` (`listsApiSchedule`, `SUMMARY_COLUMNS`, `hasD6Notice`, `cutAtCoverage`, macierz ról, sprzątanie), CPU: `context/deployment/deploy-plan.md`
- Poprzednie zmiany: `context/archive/2026-11-25-live-rule-violations/plan.md` i `reviews/impl-review.md` (silnik, klucze wskazań, potwierdzanie ostrzeżeń po kluczu), `context/archive/2026-11-24-manual-shift-assignment/plan.md` (`p_confirm_removals`, `PT409`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Czyste funkcje zatwierdzania

#### Automated

- [x] 1.1 Testy czystych funkcji przechodzą w workerd: `npm test` — 066dc86
- [x] 1.2 Linting przechodzi: `npm run lint` — 066dc86
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 066dc86

#### Manual

- [x] 1.4 Kolejność sprawdzeń zatwierdzenia, kody błędów i polskie komunikaty oraz kształt ładunku weryfikacji zostały przejrzane i zatwierdzone przez autora — 066dc86

### Phase 2: Baza: status, blokada i zatwierdzenie

#### Automated

- [x] 2.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` — 03523ce
- [ ] 2.2 Migracja stosuje się na świeżej bazie: `npx supabase db reset`
- [x] 2.3 Smoke z krokami bazy przechodzi lokalnie: `npm run smoke` — 03523ce

#### Manual

- [x] 2.4 Treść migracji (granty kolumnowe, polityki, funkcja `approve_schedule`, kody błędów, kolejność blokad, brak kluczy do `auth.users`) została przejrzana i zatwierdzona przez autora, a wynik testu dwoma połączeniami jest zapisany w notatce — 03523ce

### Phase 3: Dane i trasa zatwierdzania

#### Automated

- [x] 3.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [x] 3.2 Smoke z krokami trasy zatwierdzania i blokady tras przechodzi lokalnie: `npm run smoke`

#### Manual

- [x] 3.3 Kolejność sprawdzeń w trasie zatwierdzania, kody odpowiedzi i mapowanie błędów bazy zostały przejrzane i zatwierdzone przez autora

### Phase 4: Interfejs zatwierdzania i tryb tylko do odczytu

#### Automated

- [ ] 4.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.2 Smoke z istniejącymi krokami stron szkiców przechodzi lokalnie: `npm run smoke`

#### Manual

- [ ] 4.3 W przeglądarce na desktopie: panel potwierdzenia (lista ostrzeżeń, bezpieczny przycisk, zatwierdzenie), po zatwierdzeniu baner i siatka tylko do odczytu z zapisanymi wskazaniami i sumami z migawki, strona edycji z komunikatem, lista ze statusem, komunikaty przy zmianie krytycznego wskazania między kliknięciami, klawiatura i czytnik
- [ ] 4.4 Na telefonie (lub emulacji): sekcja i panel zatwierdzania oraz widok tylko do odczytu są czytelne, strona nie ma poziomego przewijania dokumentu

### Phase 5: Smoke stron i dokumentacja

#### Automated

- [ ] 5.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 5.2 Smoke z krokami stron zatwierdzonego grafiku przechodzi lokalnie: `npm run smoke`

### Phase 6: Wdrożenie

#### Automated

- [ ] 6.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 6.2 Smoke przechodzi lokalnie: `npm run smoke`
- [ ] 6.3 CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual

- [ ] 6.4 Migracja zatwierdzania została zastosowana na hostowanym projekcie (`npx supabase db push`, przed wdrożeniem kodu)
- [ ] 6.5 Po wdrożeniu (`npm run build` i `npx wrangler deploy`) zatwierdzenie grafiku testowego i tryb tylko do odczytu działają na produkcji (zatwierdzenie jest nieodwracalne, więc użyć grafiku testowego, którego nie da się później usunąć); nie uruchamiać `npm run smoke` na produkcji
- [ ] 6.6 Pomiar CPU trasy zatwierdzania i strony obsadzania po wdrożeniu mieści się w limicie 10 ms na żądanie albo wynik jest zapisany w `deploy-plan.md` razem z decyzją
