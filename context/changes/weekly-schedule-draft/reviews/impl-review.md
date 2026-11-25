<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Weekly schedule draft Implementation Plan

- **Plan**: context/changes/weekly-schedule-draft/plan.md
- **Scope**: Full plan (Phase 4 of 4)
- **Reviewed phases**: 1, 2, 3, 4
- **Reviewed state**: head of PR #8, commit `559eb2c` (base `86aa045`), read with `git show`; today's `master` already contains the later S-04 changes in some of the same files
- **Date**: 2026-11-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Success criteria

- `npx astro sync`, `npm test` (899/899, of which 223 in `schedule.test.ts`), `npm run lint`, `npx astro check` (91 files, 0/0/0) run on current `master`: pass.
- Build and smoke (`db reset`, RPC, API, pages) are evidenced by CI: PR #8 head `559eb2c` (`ci` and `smoke` green) and every push to `master` since (`0425ce6`, `87d6434`, `b7e4360`, `67edd26`) are green.
- Manual rows 1.4, 2.4, 4.4, 4.5 were approved by the author during implementation; rows 4.6 and 4.7 (hosted migration and deploy) were confirmed by the author on 2026-11-25 after the S-04 deploy.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Gwarancje atomowości i niezmienników grafiku są konwencją aplikacji, a plan i dokumenty obiecują więcej

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261106120157_schedules.sql:3-4, 64-66, 83, 86, 88-91; plan.md:21; scripts/smoke.mjs:1725-1734
- **Detail**: Plan (Desired End State) mówi, że usuwanie wierszy podrzędnych (obsada, skład) jest możliwe "tylko jako część zapisu", a ten sam plan wymaga w smoke kroku "usunięcie pojedynczej komórki przez planistę dozwolone". Migracja nadaje `select, insert, delete` na `schedule_staffing` i `schedule_employees`, więc przy `security invoker` token planisty może przez PostgREST zostawić nagłówek bez żadnej komórki i bez pracowników. Aplikacja nigdy by tego nie zapisała (co najmniej 1 komórka, co najmniej 1 pracownik, limit 350 komórek, kształt JSON w `p_staffing` i `p_employee_ids`), ale baza tych niezmienników nie ma. `CLAUDE.md` i `README.md` mówią "everything or nothing", co jest prawdą tylko dla ścieżki przez aplikację, a komentarz w migracji (linie 3-4) wylicza granice liczbowe, nie wspominając o tych niezmiennikach. Skutek dla S-04 (na dzisiejszym `master`): potwierdzenie usunięcia przypisań (`PT409`) działa tylko w `save_schedule`, więc bezpośrednie `DELETE` na obsadzie lub składzie przez PostgREST kaskadą kasuje przypisania bez potwierdzenia. Dotyczy wyłącznie zaufanego planisty omijającego aplikację.
- **Fix A ⭐ Recommended**: Poprawić sformułowania w dokumentacji (`CLAUDE.md`, `README.md`) na "przez aplikację", a w planie dopisać addendum, że niezmienniki (co najmniej 1 komórka i 1 pracownik, limit 350, kształt JSON, potwierdzenie usunięcia przypisań) są po stronie aplikacji
  - Strength: Tanie i prawdziwe; nie zmienia zachowania ani migracji (applied, edycja przez nową migrację byłaby kosztowna).
  - Tradeoff: Gwarancja pozostaje konwencją, nie wymuszeniem bazy.
  - Confidence: HIGH — plan świadomie wybrał `security invoker` i brak wykrywania równoległych edycji.
  - Blind spot: Czy ktoś poza autorem pisze klienta omijającego aplikację (wtedy to by nie wystarczało).
- **Fix B**: Przenieść zapis dzieci wyłącznie do `save_schedule` jako `security definer` z kontrolą `is_planner()` w środku, odebrać `insert` i `delete` na tabelach podrzędnych i dodać w funkcji kontrole niepustej obsady i składu
  - Strength: Baza wymusza niezmienniki i potwierdzenie usunięcia przypisań z S-04, także dla klienta omijającego aplikację.
  - Tradeoff: Zmienia decyzję planu (`security invoker`), wymaga nowej migracji i zmian w smoke (kroki z bezpośrednim `delete` dzieci), a S-04 ma własne bezpośrednie `insert` i `delete` przypisań.
  - Confidence: MED — `is_planner()` jest dostępne w `security definer`, ale pełny wpływ na RLS i smoke nie był sprawdzany.
  - Blind spot: Zachowanie PostgREST przy odebraniu grantów na tabele, które aplikacja czyta osadzeniem.
- **Decision**: FIX A (apply): popraw sformułowania w CLAUDE.md i README na 'przez aplikację' i dopisz addendum o niezmiennikach po stronie aplikacji

### F2 — Gwarancja "e-mail nigdy nie trafia do wyspy" nie ma żadnego testu

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/schedule-options.ts:18-20; scripts/smoke.mjs:1411-1439
- **Detail**: `toEmployeeOptions` zwraca tylko `id` i nazwisko z imieniem, ale strony `new.astro` i `[id].astro` pobierają pełne `listEmployees` (z e-mailem i etatem), a wyspa serializuje propsy do HTML. `CLAUDE.md` deklaruje "never an employee's e-mail address", a żaden test tego nie pilnuje: nie ma testu jednostkowego `toEmployeeOptions`, a kroki smoke dla stron używają tylko `bodyCheck` i `bodyIncludes`. Regresja w rodzaju `employees.map((e) => e)` przeszłaby cały pipeline. Ta sama gwarancja dotyczy wyspy obsadzania z S-04.
- **Fix**: Test jednostkowy sprawdzający, że obiekt z `toEmployeeOptions` ma dokładnie klucze `id` i `name` (`toStrictEqual`), oraz w smoke `bodyExcludes` z adresem e-mail pracownika na `/schedules/new`, `/schedules/<id>` i `/schedules/<id>/assign` (precedens `bodyExcludes` jest w smoke).
- **Decision**: FIX NOW (queued): test jednostkowy toEmployeeOptions (dokładnie klucze id i name) i bodyExcludes z e-mailem w smoke na stronach grafików i obsadzania

### F3 — `parseEmployeeIds` nie ma górnego limitu, obsada ma

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/schedule.ts:242-254 (porównaj :225)
- **Detail**: `parseStaffing` odrzuca więcej niż `STAFFING_MAX_CELLS` (350) komórek, a `parseEmployeeIds` sprawdza tylko pustą listę, po czym iteruje, deduplikuje i sortuje bez limitu. `readJsonBody` nie ogranicza rozmiaru ciała. Body ze 100 tys. UUID (ok. 3,8 MB) kosztuje parsowanie, regex, `Set` i sortowanie i może przekroczyć 10 ms CPU Workers Free (błąd 1102 zamiast czytelnego 422). Wykorzystać to może tylko zalogowany planista (samouszkodzenie).
- **Fix**: Stała (np. `EMPLOYEE_IDS_MAX = 1000`) sprawdzana przed pętlą z własnym komunikatem po polsku i przypadkiem w teście.
- **Decision**: FIX NOW (queued): EMPLOYEE_IDS_MAX przed pętlą w parseEmployeeIds, komunikat po polsku i test

### F4 — Kroki smoke dla odmów na poziomie bazy dowodzą klasy statusu, nie przyczyny

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: scripts/smoke.mjs:691-698, 701-708, 711-736, 745, 755, 760, 1688-1722; supabase/migrations/20261106120157_schedules.sql:92-94
- **Detail**: Odmowy RPC, wstawień, aktualizacji i usunięć dla pracownika, konta bez roli i anonima używają `{ statusNotClass: 2 }` lub `{ statusNotClass: 5 }`, więc przejdzie je każdy błąd 4xx (np. 404 PGRST202 po literówce w nazwie argumentu albo nieodświeżony schema cache). Ratuje je identyczne wywołanie planisty, które wcześniej zwróciło 200, i późniejszy odczyt planisty, ale ten odczyt dotyczy wiersza po id, a nie wiersza utworzonego z etykietą `Smoke-…-employee-rpc-create`. Dobre dowody przyczyny są w innych miejscach (planista z nieistniejącym id: `PT404`; odrzucenia z nazwą ograniczenia; odmowy API z dokładnym 401 i 403). Do tego komentarz w migracji (92-94) o wspólnym 404 dotyczy tylko ścieżki update, a create przez nie-planistę zatrzymuje polityka `insert` (42501, w PostgREST 403). Ten sam wzorzec wykazała w S-04 kontrola celowego uszkodzenia (`revoke execute` dla `anon` nie zmieniał żadnego kroku, bo 401 dawał też brak uprawnień do tabeli).
- **Fix**: Dla pracownika i konta bez roli asercje przyczyny (create RPC: 403 z `code` `42501`; replace RPC: 404 z `PT404`), dla anonima 401 z `code` `42501` i komunikatem o funkcji, plus odczyt planisty po etykiecie `Smoke-${runId}-*rpc*` oczekujący listy pustej; konkretne kody sprawdzić na działającym stosie.
- **Decision**: FIX NOW (queued): asercje przyczyny w krokach odmów bazy (kody 42501 i PT404) i odczyt planisty po etykiecie rpc; kody sprawdzić na działającym stosie

### F5 — Testy "zmiany czasu" nie mogą zawieść w workerd, a idempotencja normalizacji nie jest przypięta

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/schedule.test.ts:146-147, 245; src/components/hooks/useScheduleForm.ts:230-231
- **Detail**: Testy "the spring clock change (2026-03-29)" i "one day over the autumn clock change (2026-10-25)" chodzą w workerd, gdzie strefa lokalna to zawsze UTC, więc implementacja na `setDate()` lub `getHours()` przeszłaby je tak samo; kod jest poprawny z konstrukcji (`Date.UTC`, `getUTC*`), ale testy nie dowodzą niezależności od strefy, a nazwy to sugerują. Hook wysyła wartość znormalizowaną przez klienta, a serwer normalizuje ją ponownie; idempotencja `validate(validate(x).value)` wynika z analizy kodu, nie z testu.
- **Fix**: Komentarz o ograniczeniu przy tych testach albo test szpiegujący lokalne gettery (`vi.spyOn(Date.prototype, "getDate")` itp.), oraz jeden test idempotencji walidacji.
- **Decision**: FIX NOW (queued): szpiegowanie lokalnych getterów Date w testach zmiany czasu i test idempotencji walidacji

### F6 — Komentarz twierdzi, że niewidoczne znaki są zapisane jako escape, a są dosłowne; klasa niewidocznych znaków jest niepełna

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/schedule.ts:40-42; src/lib/services/schedule.test.ts:373, 381, 412-415
- **Detail**: Komentarz (40-41) mówi, że wypełniacze są zapisane jako escape, bo nie da się ich odróżnić w edytorze, a linia 42 ma dosłowne znaki U+115F, U+1160, U+2800, U+3164, U+FFA0 (to samo w testach). To fałszywe zapewnienie i realne ryzyko, że edytor lub formater zgubi niewidoczne znaki (linie 412-415 działają jak tripwire, linia 381 nie). Klasa niewidocznych znaków nie łapie etykiety z samego U+034F, selektorów wariantów U+FE00-FE0F, U+180B-180D ani U+17B4/17B5, a dozwolone Cf obejmuje znaki dwukierunkowe (U+202A-202E, U+2066-2069), które mogą wizualnie przestawić sąsiedni tekst np. w `aria-label` "Edytuj: …". Dane wpisuje zaufany planista, więc to kosmetyka, a nie podatność. Ten sam wzorzec jest w `shift.ts:18`.
- **Fix**: Zapisać znaki jako `\u`-escape w kodzie i testach (albo poprawić komentarz) i rozważyć dodanie niewidocznych `\p{Mn}` do klasy oraz odrzucenie Cf z zakresu bidi.
- **Decision**: FIX NOW (queued): znaki jako escape w kodzie i testach, rozszerzenie klasy niewidocznych znaków (Mn) i odrzucenie Cf z zakresu bidi; wzorzec wspólny z shift.ts

### F7 — Lista grafików jest nieograniczona, a przy limicie `max_rows` ucina po cichu

- **Severity**: 👁 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/schedules.ts:9, 93-99
- **Detail**: `listSchedules` robi jedno zapytanie (brak N+1) bez `.order()` i `.limit()`, a każdy grafik osadza wszystkie swoje komórki tylko po to, by je zsumować w aplikacji (`toSummaries`). Plan zaakceptował brak stronicowania "jak w S-01 i S-02", ale tamte listy rosną z liczbą pracowników i zmian, a ta z tygodniami (ok. 52 rocznie, każdy do 350 komórek). Przy `max_rows` 1000 (domyślnie w Supabase; ustawienia hostowanego projektu nie sprawdzone) PostgREST zwróci po cichu dowolne 1000 wierszy, a nie 1000 najnowszych. W S-04 dla przypisań dodano już strażnik, który rzuca błąd zamiast po cichu obciąć.
- **Fix A ⭐ Recommended**: `.order("start_date", { ascending: false })` i `.limit(N)` (np. 100) z komunikatem o obcięciu na liście, a sumę obsady liczyć po stronie bazy (widok lub funkcja SQL) zamiast osadzać komórki
  - Strength: Ogranicza koszt i zachowuje najnowsze grafiki; spójne ze strażnikiem z S-04.
  - Tradeoff: Wymaga nowej migracji (widok lub funkcja) albo zostaje osadzanie komórek z limitem.
  - Confidence: MED — realna skala (liczba grafików rocznie) nie jest znana.
  - Blind spot: Faktyczne `max_rows` hostowanego projektu.
- **Decision**: FIX NOW (queued): order po start_date malejąco i limit z komunikatem o obcięciu, suma obsady po stronie bazy; wybór widoku lub funkcji SQL do rozstrzygnięcia przy implementacji poprawek

### F8 — Odporność formularza: `isWellFormed()` bez zabezpieczenia, obcinanie etykiety przed zwinięciem spacji, parsowanie liczb, duplikat po utraconej odpowiedzi

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/schedule.ts:177; src/components/hooks/useScheduleForm.ts:70, 138, 179-212, 219-224
- **Detail**: (1) `!value.isWellFormed()` jest wołane z `submit` poza `try`; w przeglądarce bez `String.prototype.isWellFormed` (Chrome przed 111, Safari przed 16.4, Firefox przed 119) formularz milknie bez komunikatu. (2) Formularz obcina surowe wejście do 60 punktów kodowych przed zwinięciem spacji, więc nie pozwoli wpisać ważnej etykiety z podwójnymi spacjami (serwer ją przyjmuje po zwinięciu) i kopiuj-wklej jest obcinany po cichu. (3) `Number(... .trim())` przyjmuje `"0x10"`, `"1e1"`, `"+5"` jako 16, 10, 5, a niedokończony wpis (`"1e"`, `"-"`) z `input type="number"` liczy się cicho jako pusta komórka. (4) Przy utraconej odpowiedzi po zapisie ponowienie `POST` tworzy duplikat szkicu (okres nie jest unikalny z założenia, a koszt nie jest nazwany w planie).
- **Fix**: Zweryfikować docelową macierz przeglądarek albo owinąć `validateScheduleInput` w `submit` w `try/catch` z `SAVE_ERROR`; limit etykiety liczyć po zwinięciu spacji; wąskie wyrażenie dla liczby (tylko cyfry); po błędzie sieci zablokować ponowne wysłanie do odświeżenia listy albo generować `id` po stronie klienta.
- **Decision**: FIX NOW (queued): try/catch wokół walidacji w submit, limit etykiety po zwinięciu spacji, liczba tylko z cyfr, blokada ponownego wysłania po błędzie sieci

### F9 — Brak testów jednostkowych mapowania błędów bazy; zduplikowana reguła porządku

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/schedules.ts:38-46, 60-71, 78-87; src/lib/services/schedule.ts:190-193, 216-218
- **Detail**: `saveFailure` (`PT404` na `not_found`, `23503` na `unknown_reference`) i `toSchedules` z sortowaniem są jedynym miejscem mapującym błędy bazy i nie mają testów jednostkowych (tylko pośrednio smoke); wzorzec S-01 i S-02 jest taki sam. Reguła porządku komórek (`compareText`, `compareCells`) istnieje w dwóch kopiach (`schedules.ts` i `schedule.ts`), a komentarz przyznaje, że kolejność musi być ta sama; kopię w `schedules.ts` testuje tylko smoke. W S-04 dochodzi trzecia podobna reguła w `assignment.ts` (lokalny `compareText`).
- **Fix**: Wyeksportować jeden komparator z `services/schedule.ts` i użyć go w `toSchedules` (w S-04 także w `assignment.ts`), a mapowanie błędów przenieść do czystej funkcji z testem.
- **Decision**: FIX NOW (queued): jeden wyeksportowany komparator (także dla assignment.ts) i mapowanie błędów bazy w czystej funkcji z testem

### F10 — Drobne odchylenia kodu od planu i nieprawdziwe zdania w samym planie

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md:11, 21, 88, 185, 231, 292; src/pages/api/schedules/index.ts:33-34; src/components/schedules/StaffingGrid.tsx:57-59, 186-194; src/components/schedules/ScheduleForm.tsx:57
- **Detail**: Wszystkie wpisy "Changes Required" faz 1 do 4 są zgodne z planem (MATCH), nie ma brakujących elementów ani naruszeń sekcji "What We're NOT Doing", a zmienione pliki spoza planu (`FormField.tsx` z opcjonalnymi `min` i `max`, nowy `schedule-options.ts`, rozszerzony `rpc` w smoke) są uzasadnionymi konsekwencjami. Drobne odchylenia: `POST` tłumaczy `not_found` na 500 (gałąź nieosiągalna, plan mówił o 404); wiersze siatki dodaje wybór z listy plus osobny przycisk "Dodaj", a nie sama lista rozwijana (powód w komentarzu); smoke nie ćwiczy 415 przy całkowitym braku `Content-Type`. Wady planu: zdanie "w `src/` nie ma użycia `Date`" jest nieprawdziwe (`Date.parse` w `shift.ts:135` i `employee.ts:130`); limit 350 komórek nie ma uzasadnienia w danych (komentarz zakłada 50 zmian, słownik zmian takiego limitu nie ma); plan zakłada, że `min` i `max` na polu daty pilnuje przeglądarka, a formularz ma `noValidate`, więc zakres 2020-2099 egzekwuje tylko walidacja, a komunikat "Podaj poprawną datę początkową." go nie podaje; "po jednym lub dwóch zapytaniach" nie zgadza się z `[id].astro` (trzy); plan każe jednocześnie zaktualizować opis `npm run smoke` i nie dotykać fragmentów o service-role, które leżą w tych samych liniach.
- **Fix**: Dopisać addendum z tymi korektami (np. do tego raportu albo do planu przed archiwizacją), a ewentualnie dodać do pola daty podpowiedź z zakresem.
- **Decision**: FIX NOW (addendum written below; queued: podpowiedź zakresu przy polu daty)

## Addendum: korekty planu i odchylenia (F10)

Plan jest po archiwizacji tylko do odczytu, więc korekty są tutaj. Kod S-03 jest zgodny z planem we wszystkich wpisach "Changes Required"; poniższe rzeczy to nieprecyzyjne zdania planu albo drobne odstępstwa.

- `plan.md:11` ("w `src/` nie ma użycia `Date`") jest nieprawdziwe: `Date.parse` jest w `src/lib/services/shift.ts:135` i `employee.ts:130`. Chodziło o arytmetykę dat i kolumny `date`.
- `plan.md:21` ("usuwanie wierszy podrzędnych jest możliwe tylko jako część zapisu") jest sprzeczne z Fazą 2 (smoke: usunięcie pojedynczej komórki przez planistę dozwolone) i z migracją (grant `delete` na tabelach podrzędnych). Zob. F1.
- Limit 350 komórek (`plan.md:88`, `schedule.ts:12-13`) nie ma uzasadnienia w danych: komentarz zakłada 50 zmian, a słownik zmian takiego limitu nie ma. Dla poprawnej siatki z ponad 50 zmianami walidacja zwróci `staffingTooMany`.
- Kontrakt Fazy 3 ("422 z dokładnym zbiorem pól": zła data, etykieta 61, pusta obsada, powtórzona para, pusta lista pracowników) liczy pięć warunków na cztery pola; pusta obsada i powtórzona para dotyczą tego samego pola `staffing`, więc kod rozdziela je na dwa kroki smoke.
- Plan zakłada, że `min` i `max` na polu daty pilnuje przeglądarka (komunikat "Podaj poprawną datę początkową." miał być krótki). Formularz ma `noValidate` (`ScheduleForm.tsx:57`), więc zakres 2020-2099 egzekwuje tylko `validateScheduleInput`, a komunikat zakresu nie podaje.
- `POST` tłumaczy `not_found` na 500 (`api/schedules/index.ts:33-34`); plan mówił o 404 dla obu tras, ale gałąź jest nieosiągalna, bo przy tworzeniu `id` jest `null`.
- Wiersze siatki dodaje wybór z listy plus osobny przycisk "Dodaj" (`StaffingGrid.tsx:57-59, 186-194`), a nie sama lista rozwijana; powód jest w komentarzu (lista zamknięta zmienia wartość przy każdej strzałce).
- Smoke nie ćwiczy 415 przy całkowitym braku nagłówka `Content-Type` dla grafików (tylko ciało formularzowe), jak w S-01 i S-02.
- "Strony i trasy wykonują po jednym lub dwóch zapytaniach" (Performance): `[id].astro` wykonuje trzy (`getSchedule`, potem `listShifts` i `listEmployees` równolegle).
- Faza 4 każe zaktualizować opis `npm run smoke` i jednocześnie nie dotykać fragmentów o service-role, które leżą w tych samych liniach; PR zmienił te linie bez zmiany treści o service-role.
- Uzasadnione dodatki poza planem: opcjonalne `min` i `max` w `src/components/auth/FormField.tsx`, nowy `src/lib/schedule-options.ts` (wyspa dostaje tylko `id` i nazwisko z imieniem), rozszerzony `rpc(name, token, args)` i pole `bodyCheck` w smoke.