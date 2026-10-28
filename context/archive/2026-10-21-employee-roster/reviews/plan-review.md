<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Employee roster Implementation Plan (S-01)

- **Plan**: context/changes/employee-roster/plan.md
- **Mode**: Deep (inline, bez sub-agenta)
- **Date**: 2026-10-27
- **Verdict**: REVISE
- **Verdict after triage**: SOUND (wszystkie 7 ustaleń naprawionych w planie, briefie i roadmapie)
- **Findings**: 0 critical, 4 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

20/20 ścieżek ✓, ~25 odwołań plik:linia i symboli ✓, brief↔plan ✓, Progress↔Phase ✓ (1.1–4.8). Dodatkowo potwierdzone: zod@4.6.7 w rejestrze npm, checkOrigin (`node_modules/astro/dist/core/app/origin-check.js:3-5`), jeden klient trzyma spójną sesję (`@supabase/ssr`: `setItems`/`removedItems`). Brak `lessons.md` i `docs/reference/contract-surfaces.md` (pominięte).

## Findings

### F1 — Smoke: zaplanowane porównanie JSON nie wyrazi kroków na wierszach

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 2 §2 (i Faza 3 §4) — scripts/smoke.mjs
- **Detail**: Plan dodaje do runnera "porównanie JSON dla obiektów i tablic (JSON.stringify po obu stronach)". Tablica `steps` (smoke.mjs:202-282) ma statyczne obiekty `expected`, budowane przed uruchomieniem jakiegokolwiek kroku, a wiersz z bazy zawiera losowe `id` i `created_at`. Oczekiwań "dostaje wiersz z powrotem" i "odczyt pokazuje nową wartość" nie da się więc zapisać jako równość JSON; działa tylko dla `[]` (odczyt pracownika). Zmienna z id rozwiązuje adres, nie oczekiwanie. Faza 3 §4 nie mówi też, że kroki API planisty (sesja z ciasteczek) muszą wypaść między `signIn(planner)` a `signOut(planner)` (smoke.mjs:252-257); mówi to dopiero Faza 4.
- **Fix**: W runnerze dodać `expected.check(parsedBody) => boolean` (predykat, w komunikacie błędu wypisać `got`), użyć go dla wierszy, a równość JSON zostawić dla `[]`. W Fazie 3 §4 dopisać miejsce kroków API (między signIn a signOut planisty).
  - Strength: Predykat wyraża dowolny warunek na wierszu bez znajomości id.
  - Tradeoff: Runner dostaje jedną nową ścieżkę oceny (kilka linii).
  - Confidence: HIGH — wzorzec jest tuż obok: `bodyExcludes`, `json`.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix in plan: predykat `check` w Fazie 2 §2, miejsce kroków API w Fazie 3 §4)

### F2 — Smoke zostawia wiersze w `employees`; stały e-mail zepsuje drugi przebieg

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 2 §2, Faza 3 §4, kryterium 4.4
- **Detail**: Smoke tworzy konta z `runId` (smoke.mjs:12,78), ale niczego nie usuwa, a aplikacja pod testem czyta ten sam lokalny stos co codzienna praca (nagłówek smoke.mjs:3-4). Pracownika nie usunie `authenticated` (świadomie odebrane `delete`), a plan nie podaje e-maila w krokach ("e-mail z wielkimi literami"). Skutki: przy stałym adresie drugi lokalny przebieg bez `db reset` kończy się 409 już na pierwszym POST (krok oczekuje 201); po każdym lokalnym smoke lista na `/employees` nie jest pusta, więc ręczne 4.4 ("pusta lista z komunikatem") zawodzi.
- **Fix**: E-maile i nazwiska w smoke budować z `runId` (`Smoke-<runId>@Example.com`) i dodać krok końcowy sprzątający przez service-role (`DELETE /rest/v1/employees` z filtrem na prefiks e-maila). Service-role zachowuje uprawnienia, bo migracja odbiera je tylko `anon` i `authenticated`. Kryterium 4.4 wykonywać po sprzątaniu.
  - Strength: Smoke staje się idempotentny; klucz service-role już tam jest.
  - Tradeoff: Jeden dodatkowy krok i filtr, którego pomyłka mogłaby skasować cudze wiersze.
  - Confidence: HIGH — filtr po prefiksie `smoke-` jest ścisły, a smoke działa tylko lokalnie.
  - Blind spot: Przerwany przebieg zostawia wiersze (unikalne adresy to jednak tolerują).
- **Decision**: FIXED (Fix in plan: dane z `runId` i sprzątanie service-role w Fazie 2 §2; kryterium 4.4 po sprzątaniu)

### F3 — `FormField` nie obsłuży tego, czego wymaga Faza 4

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 4 §3 — EmployeeForm.tsx
- **Detail**: Plan: "długości z NAME_MAX_LENGTH i EMAIL_MAX_LENGTH", Etat jako dwa pola liczbowe "pod jedną etykietą i jednym komunikatem", "ponownie używa FormField bez przenoszenia". Tymczasem `FormFieldProps` (FormField.tsx:8-20) nie ma `maxLength` ani `inputMode`, `icon` jest wymagane (:18), a komponent renderuje dokładnie jeden `<input>` (:42-55). Pliku FormField.tsx nie ma na liście zmian, więc implementator odkryje to w trakcie.
- **Fix**: W Fazie 4 §3 dopisać `src/components/auth/FormField.tsx` do plików, ze zmianą addytywną (opcjonalne `maxLength`, `inputMode`, `icon`; jedyny dotychczasowy konsument to SignInForm), a Etat opisać jako osobną kompozycję w EmployeeForm.tsx (dwa pola, wspólna etykieta i błąd), nie przez FormField.
- **Decision**: FIXED (Fix in plan: FormField.tsx dopisany do plików Fazy 4 §3, Etat jako osobna kompozycja)

### F4 — `Cache-Control: no-store` tylko na liście, a strona edycji też pokazuje dane osobowe

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 4 §2 i §3
- **Detail**: Faza 4 §2 wymaga `no-store` dla `/employees` "(dane osobowe)", trasy API też je mają (Faza 3 §3), ale `/employees/[id]` renderuje imię, nazwisko i e-mail pracownika i nagłówka nie dostaje. Po wylogowaniu przycisk Wstecz może pokazać z cache stronę edycji z danymi. To ten sam powód, który plan podaje dla listy.
- **Fix**: Dopisać `Cache-Control: no-store` do `[id].astro` (w frontmatter, jak w liście; `new.astro` dla spójności).
- **Decision**: FIXED (Fix in plan: no-store w `[id].astro` i `new.astro`, Faza 4 §3)

### F5 — Awaria zapisu i odczytu nie zostawia żadnego śladu

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Faza 3 §2 i §3
- **Detail**: Każda awaria bazy sprowadza się do `"failed"` / 500 i komunikatu "Nie udało się zapisać". Baseline: logi Workera są włączone, ale kod aplikacji nic nie loguje (roadmapa, pytanie 4), a `no-console` to `warn` poza `scripts/`. Pierwsze wdrożenie z brakującą migracją albo błędem RLS będzie więc niediagnozowalne.
- **Fix**: W gałęzi `failed` i w odczytach logować `console.error` z samym `code` i `message` błędu PostgREST (bez danych wejściowych, to dane osobowe), ze świadomym wyjątkiem lintu.
- **Decision**: FIXED (Fix in plan: logowanie `code` i `message` w Fazie 3 §2)

### F6 — Znaki sterujące a zwijanie białych znaków: kolejność nie jest rozstrzygnięta

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Faza 1 §3 (validateEmployeeInput) i §4 przypadek (d)
- **Detail**: Plan każe zwijać "ciągi białych znaków do jednej spacji" i jednocześnie odrzucać "znaki sterujące". Tabulator i znak nowej linii są jednym i drugim. Przypadek (d) mówi tylko "znak sterujący odrzucone" bez przykładu, więc `Jan\tKowalski` zależy od tego, co implementator zrobi pierwsze.
- **Fix**: Zapisać w planie: znaki sterujące (`\p{Cc}`) są sprawdzane na surowym wejściu przed zwinięciem spacji, więc `Jan\tKowalski` jest odrzucone; dodać ten przypadek do testu (d).
- **Decision**: FIXED (Fix in plan: odrzucenie przed zwinięciem w Fazie 1 §3, przypadek `Jan\tKowalski` w teście (d))

### F7 — Brak usuwania opisany tylko jako "omyłka"; zwykły przypadek to pracownik, który odszedł

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: "What We're NOT Doing" (pierwszy punkt), Migration Notes, Open Risks w briefie
- **Detail**: Plan uzasadnia brak usuwania i archiwizacji tylko omyłkowo dodanym wpisem. Realniejszy przypadek to odejście pracownika: zostaje na liście na stałe, a S-03 (wybór pracowników do grafiku) i S-05 (obsada) będą go widzieć. Roadmapa wiąże blokowanie z FR-015 (zaparkowane), więc to nie błąd planu, ale konsekwencja nie jest nigdzie zapisana dla wycinków, które na niej ucierpią.
- **Fix A ⭐ Recommended**: Zaakceptować i zapisać w planie oraz w Risk wycinka S-03, że odejścia nie da się obsłużyć do czasu FR-015.
  - Strength: Zero kodu; zgodne z PRD (blokowanie parkowane), zakres S-01 bez zmian.
  - Tradeoff: Pilotaż z kilkudziesięcioma osobami zbierze nieaktualne wpisy.
  - Confidence: HIGH — PRD jawnie parkuje blokowanie.
  - Blind spot: Nie sprawdzono, jak długo trwa planowany pilotaż.
- **Fix B**: Dodać teraz kolumnę `archived_at timestamptz` (bez polityki delete) i przełącznik "Archiwizuj" w edycji.
  - Strength: Odejście obsłużone już w S-01, a S-03 filtruje od początku.
  - Tradeoff: Wchodzi w zakres FR-015, który PRD zaparkowało; rośnie Faza 4 i smoke.
  - Confidence: MED — nie wiadomo, czy "archiwizacja" to to samo co "blokowanie" w FR-015.
  - Blind spot: Wpływ na unikalność e-maila zarchiwizowanego pracownika (S-10).
- **Decision**: FIXED (Fix A: konsekwencja zapisana w "What We're NOT Doing", w Open Risks briefu i w Risk wycinka S-03 w roadmapie)
