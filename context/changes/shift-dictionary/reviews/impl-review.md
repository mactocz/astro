<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Shift dictionary Implementation Plan (S-02)

- **Plan**: context/changes/shift-dictionary/plan.md
- **Scope**: Full plan (4 of 4 phases; wiersze 4.6–4.8 zależą od scalenia i wdrożenia, więc nie podlegały ocenie)
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-11-03
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

- Zakres: `git diff f0dec7d..HEAD` (8 commitów, 21 plików poza `context/`), wszystkie wymienione w planie. `package.json`, `access.ts`, middleware, `Layout.astro`, CI i `FormField` bez zmian; brak ścieżki usuwania, unikalności nazw i `no-store` na stronach zmian.
- Automatyczne kryteria ponownie uruchomione na `HEAD`: `npx supabase db reset` (trzy migracje), `npx astro sync`, `npm run lint`, `npx astro check` (58 plików, 0/0/0), `npm test` (416/416), `npm run build` oraz `npm run smoke` (132/132, lokalny stos, env podmieniony tymczasowo i przywrócony z weryfikacją haszem).
- Manualne 1.4, 2.4, 4.3–4.5 odhaczone po potwierdzeniu autora; 4.6–4.8 oczekują na PR i wdrożenie.
- Pominięte jako zgodne z planem lub poza zakresem zmiany: ostatni zapis wygrywa (plan, "What We're NOT Doing"), etykieta "następnego dnia" przy końcu 00:00 (decyzja planu, przykład 14:00–00:00), `<html lang="en">` w `Layout.astro` (poza zmianą), brak strony 500 (jak `/employees`), konta smoke niekasowane i sprzątanie po przerwanym przebiegu (smoke z S-01), brak logu przy udanym zapisie bez zwróconego wiersza (jak w `employees.ts`).

## Findings

### F1 — Błąd "równe godziny" zostaje pod polem po zmianie godziny rozpoczęcia

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/hooks/useShiftForm.ts:39-42
- **Detail**: Błąd "Godzina zakończenia musi być inna niż godzina rozpoczęcia" jest zapisany pod `endTime`, ale zależy od obu pól, a `setField` czyści tylko błąd edytowanego pola. Planista wpisuje 08:00 i 08:00, klika "Zapisz", poprawia początek na 07:00: czerwony błąd pod końcem zostaje, a podgląd pod polami już mówi "Czas trwania: 1 h". Sprzeczność znika dopiero po ponownym zapisie. `useEmployeeForm` ma na wspólny błąd etatu `errorKey` (`useEmployeeForm.ts:22-24`), hook zmian nie ma odpowiednika dla jedynej reguły dwupolowej.
- **Fix**: W `setField` przy zmianie `startTime` lub `endTime` czyść także błąd `endTime`.
- **Decision**: FIXED (Fix now: `setField` czyści też błąd `endTime` przy zmianie godziny rozpoczęcia)

### F2 — Po zapisie i "Wstecz" formularz może wrócić zablokowany

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/hooks/useShiftForm.ts:56, src/pages/shifts/new.astro, src/pages/shifts/[id].astro
- **Detail**: Po sukcesie hook woła `window.location.assign("/shifts")` i celowo nie zdejmuje `pending`. Strony formularzy pracowników mają `Cache-Control: no-store` (`employees/new.astro:6`, `employees/[id].astro:21`), co w praktyce wyklucza je z cache wstecz/dalej. Strony zmian nagłówka nie mają (decyzja planu, `plan.md:43`, bo dane nie są osobowe), więc po "Wstecz" przeglądarka może przywrócić zamrożoną stronę z zachowanym stanem React: przycisk "Zapisywanie..." jest wyłączony, pola mają stare wartości, do ręcznego odświeżenia. Skutek uboczny decyzji o braku `no-store` nie jest w planie opisany. Nie zweryfikowano w przeglądarce.
- **Fix**: Zamień `window.location.assign("/shifts")` na `window.location.replace("/shifts")`, żeby "Wstecz" omijało nieaktualny formularz.
  - Strength: Jedna linia, nie zmienia decyzji o nagłówkach.
  - Tradeoff: Odchodzi od wzorca `useEmployeeForm` (`assign`), a po zapisie w historii nie ma wpisu formularza.
  - Confidence: MED — mechanizm znany, ale zachowanie bfcache nie sprawdzone w przeglądarce.
  - Blind spot: Nie wiadomo, czy używane przeglądarki w ogóle przywracają tę stronę z bfcache.
- **Decision**: FIXED (Fix now: `window.location.replace("/shifts")` w `useShiftForm`)

### F3 — Przykłady w CLAUDE.md i AGENTS.md wymieniają tylko pracowników

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md:37-38, AGENTS.md:31
- **Detail**: Zasady "funkcje zapytań w `src/lib/`" i "jedna funkcja walidacji dla formularza i trasy" podają za przykład wyłącznie `src/lib/employees.ts` i `validateEmployeeInput`. Nowy punkt w `CLAUDE.md:40` opisuje strony zmian, ale nie wskazuje `src/lib/shifts.ts` ani `validateShiftInput` (`src/lib/services/shift.ts`). Plan tego nie wymagał, ale agent czytający te pliki przy S-03 dostanie tylko jeden wzorzec.
- **Fix**: Dopisz `src/lib/shifts.ts` i `validateShiftInput` do przykładów w tych trzech zdaniach.
- **Decision**: FIXED (Fix now: `shifts.ts` i `validateShiftInput` dopisane w CLAUDE.md:37-38 i AGENTS.md:31)

### F4 — Nazwa złożona z niewidocznych znaków i pojedynczy surogat przez API

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/shift.ts:14,60-68
- **Detail**: Zakaz obejmuje tylko `\p{Cc}`, a `\s` nie łapie U+200B, U+2800 ani U+3164. Nazwa złożona wyłącznie z takich znaków przechodzi aplikację i bazę (`btrim` obcina tylko U+0020), a lista pokaże pusty wiersz z `aria-label="Edytuj: "`. Pojedynczy surogat wysłany do API (JSON `"\ud800"`) przechodzi `Array.from(name).length`, ale Postgres go odrzuca, więc odpowiedź to 500 `failed` zamiast 422. Dotyczy tylko planisty i spreparowanych wywołań API.
- **Fix**: Zaakceptuj ryzyko albo dodaj `\p{Cf}` i znaki bez glifu do kontroli nazwy oraz `isWellFormed()` przed zapisem.
- **Decision**: FIXED (Fix now, wbrew rekomendacji pominięcia: `isWellFormed()` oraz odrzucenie nazwy bez widocznego znaku; `\p{Cf}` nie zakazany w całości, żeby zostały emoji ze złączką ZWJ; 8 nowych przypadków testowych)

### F5 — Błędy formularza nie są ogłaszane ani powiązane z polami

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/components/shifts/ShiftForm.tsx:78-80, src/components/auth/FormField.tsx, src/components/auth/ServerError.tsx
- **Detail**: `FormField` nie ustawia `aria-invalid` ani `aria-describedby`, akapit błędu nie ma `role="alert"`, `ServerError` też nie, a formularz ma `noValidate` i nie przenosi fokusu na pierwsze błędne pole, więc użytkownik czytnika ekranu po błędnym zapisie niczego nie usłyszy. Pola etatu w formularzu pracownika ustawiają `aria-invalid` i `aria-describedby` (`EmployeeForm.tsx:35-36`). Dodatkowo jedna strefa `aria-live="polite"` przełącza się między podglądem czasu trwania a długą podpowiedzią o północy, więc wyczyszczenie pola ogłasza całe zdanie podpowiedzi. `FormField` i `ServerError` są wcześniejszym kodem, a plan zabrania zmian w `FormField`.
- **Fix**: Osobna zmiana ponad S-02: `aria-invalid` i `aria-describedby` w `FormField`, `role="alert"` w `ServerError`, fokus na pierwsze błędne pole przy nieudanym zapisie, podgląd samodzielnie w strefie live.
  - Strength: Naprawia klasę problemu dla wszystkich formularzy naraz.
  - Tradeoff: Rusza współdzielony `FormField` i formularz pracownika, poza zakresem S-02.
  - Confidence: HIGH — brak atrybutów widoczny w kodzie.
  - Blind spot: Nie sprawdzono z prawdziwym czytnikiem ekranu.
- **Decision**: FIXED (Fix now: `aria-invalid`, `aria-describedby` i `role="alert"` w `FormField`, `role="alert"` w `ServerError`, fokus na pierwsze błędne pole oraz sam podgląd w strefie live w formularzu zmian; formularz pracownika i logowanie dostają zmiany aria przez wspólne komponenty, fokus tylko w formularzu zmian)

### F6 — Drobiazgi pól: autouzupełnianie, limit znaków, ikona wyboru godziny

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/shifts/ShiftForm.tsx:42-76
- **Detail**: Pole nazwy ma `id` i `name` równe "name" bez `autoComplete`, więc Chrome może proponować dane osobowe dla nazwy zmiany. `maxLength=50` liczy jednostki UTF-16, serwer punkty kodowe, więc nazwy z wieloma emoji da się wpisać na serwerze, ale nie w polu. Natywna ikona wyboru godziny na ciemnym tle może być słabo widoczna (autor przeszedł 4.3–4.4 bez zgłoszenia). `FormField` nie przyjmuje `autoComplete` ani `className`, więc poprawka wymaga zmiany `FormField`, której plan zabrania.
- **Fix**: Przy okazji F5 dodaj do `FormField` opcjonalny `autoComplete` i ustaw `off` w polu nazwy.
- **Decision**: FIXED via Fix differently (autor wybrał: `autoComplete="off"` w polu nazwy z nowym opcjonalnym propsem `FormField`, `[color-scheme:dark]` w klasie pola oraz liczenie limitu 50 w punktach kodowych w `onChange` zamiast atrybutu `maxLength`; dopisek autora o UTF-8 zinterpretowany jako zgodność z liczeniem znaków po stronie serwera i bazy, bez limitu w bajtach)

### F7 — Przestarzała rola w tokenie po awansie na planistę

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/middleware.ts:11-14, src/lib/shifts.ts:72-91
- **Detail**: Bramka używa `auth.getUser()` (świeże `app_metadata`), a RLS czyta rolę z claimów tokenu sesji, które bywają nieaktualne do około godziny. Użytkownik awansowany przez `create-planner.mjs` w trakcie żywej sesji przechodzi bramkę, ale `/shifts` pokazuje pustą listę (ten sam tekst co dla naprawdę pustego słownika), a `POST`/`PUT` kończą się 42501, mapowanym na 500 `failed`, więc formularz pokazuje ogólne "Nie udało się zapisać". Mechanizm pochodzi z S-01 i działa tak samo dla pracowników. Skutek w czasie wykonania nie zweryfikowany.
- **Fix**: Mapuj kod 42501 na wynik `forbidden` w `writeFailure` (zmiany i pracownicy) i na 403 w trasach, żeby formularz pokazał komunikat o sesji.
  - Strength: Użytkownik dostaje wskazówkę "zaloguj się ponownie" zamiast ogólnego błędu.
  - Tradeoff: Zmiana dwóch modułów i czterech tras, a pusta lista pozostaje niezmieniona.
  - Confidence: MED — mechanizm tokenu znany, nie odtworzony.
  - Blind spot: Czas odświeżenia tokenu w konfiguracji tego projektu.
- **Decision**: SKIPPED (zaakceptowane: rzadki awans w trakcie sesji, mechanizm z S-01)

### F8 — `grant update` obejmuje całą tabelę

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261102071038_shifts.sql:32
- **Detail**: Planista wołający PostgREST bezpośrednio może zmienić `id` i `created_at`. `created_at` jest kluczem sortowania, a `id` będzie referencją w S-03 (klucz obcy z domyślnym NO ACTION blokuje zmianę id już użytego, ale nie nieużytego). Tak samo jest w `employees`; tabela nie została jeszcze zastosowana na hostowanym projekcie, więc zmiana jest dziś najtańsza.
- **Fix**: Zamień na `grant update (name, start_minute, end_minute) on table public.shifts to authenticated;` (kroki smoke zmieniają tylko `end_minute`).
- **Decision**: SKIPPED (zostaje jak w `employees`, planista jest zaufanym użytkownikiem)

## Triage summary

- Fixed: F1, F2, F3, F4, F5, F6 (6)
- Skipped: F7, F8 (2)
- Gates after the fixes: lint, astro check 0/0/0, tests 424/424, build, smoke 132/132; the F4 break-check turned 6 new tests red.
- Not covered by any automated test: the behaviour of the React island (F1, F2, F5, F6 in the browser).
