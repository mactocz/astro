<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Shift dictionary Implementation Plan (S-02)

- **Plan**: context/changes/shift-dictionary/plan.md
- **Mode**: Deep (inline, bez sub-agenta)
- **Date**: 2026-10-29
- **Verdict**: SOUND
- **Verdict after triage**: SOUND (wszystkie 4 ustalenia naprawione w planie i briefie)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | PASS |
| Plan Completeness | WARNING |

## Grounding

19/19 ścieżek ✓, 21/21 odwołań plik:linia ✓, symbole (FormField `type`, `icon`, `maxLength`; `isUuid`: 5 użyć w 2 plikach; `logDatabaseError`: 3 wywołania w 1 pliku) ✓, Progress↔Phase ✓ (18 wierszy), brief↔plan: 1 sprzeczność (F1). Brak `lessons.md` i `docs/reference/contract-surfaces.md` (pominięte).

## Findings

### F1 — Reguła północy jest opisana sprzecznie

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Overview, Desired End State, Phase 1 (Manual), Progress 1.4, plan-brief (Key Decisions)
- **Detail**: Plan mówi w pięciu miejscach "koniec równy lub wcześniejszy niż początek oznacza następny dzień" (plan.md:5, :22, :108, :333; plan-brief.md:21) i jednocześnie "równe godziny są odrzucane". Równość nie może oznaczać obu rzeczy naraz. Kontrakt funkcji jest jednoznaczny (`endsNextDay` to `endMinute < startMinute`, równe godziny odrzuca walidacja, plan.md:83), więc implementator poradzi sobie, ale autor zatwierdza w kroku 1.4 zdanie, które samo sobie przeczy, a testy i podgląd w formularzu opierają się na tej regule.
- **Fix**: We wszystkich pięciu miejscach napisać: "koniec wcześniejszy niż początek oznacza następny dzień, a koniec równy początkowi jest odrzucany".
- **Decision**: FIXED (Fix in plan: nowe brzmienie reguły w Overview, Desired End State, Phase 1 Manual, Progress 1.4 i briefie)

### F2 — Krok smoke dla panelu nie zmieści dwóch kafelków

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §4 (Smoke: strony)
- **Detail**: Plan wymaga, żeby `/planner` planisty "zawierał 'Zmiany'". Istniejący krok (`visit(planner, "/planner", 200, "Pracownicy")`, smoke.mjs) przyjmuje jeden ciąg w `bodyIncludes`. Implementator może więc zastąpić sprawdzenie "Pracownicy" nowym i po cichu stracić pokrycie kafelka pracowników z S-01.
- **Fix**: Dopisać do planu, że dochodzi drugi krok `/planner` z `bodyIncludes: "Zmiany"`, a krok z "Pracownicy" zostaje.
- **Decision**: FIXED (Fix in plan: drugi krok /planner z bodyIncludes "Zmiany" w Phase 4 §4)

### F3 — Powielenie hooka, tras i stron nie jest nazwane jako świadoma decyzja

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: What We're NOT Doing
- **Detail**: Plan świadomie odkłada uogólnienie kroków RLS w smoke ("trzecia tabela będzie sygnałem"), ale nic nie mówi o pozostałych kopiach wzorca S-01: `useShiftForm` obok `useEmployeeForm` (96 linii), dwóch tras API (po ok. 35-45 linii), strony listy i formularza. Bez zapisu implementator może wydzielić wspólny hook "przy okazji" (poza zakresem i z ryzykiem dla kodu S-01), a późniejszy przegląd zgłosi powielenie.
- **Fix**: Dopisać do "What We're NOT Doing": powielamy wzorzec S-01 (hook, trasy, strony); trzeci taki formularz (S-03) będzie sygnałem do wydzielenia wspólnego hooka i pomocników.
- **Decision**: FIXED (Fix in plan: nowy punkt w "What We're NOT Doing" o powielaniu wzorca S-01)

### F4 — Uzasadnienie "jeden wiersz CI na końcu" obiecuje więcej, niż daje

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach (ostatni akapit), plan-brief (Key Decisions)
- **Detail**: Plan twierdzi, że jeden wiersz CI i wdrożenia na końcu zapobiegnie temu, co w S-01 blokowało archiwizację. Blokadą była jednak twarda bramka `/10x-archive` (niezatwierdzone zmiany w folderze zmiany), a nie liczba wierszy. Wiersze 4.6 do 4.8 nadal można wykonać dopiero po scaleniu PR-a i wdrożeniu, więc nadal wymagają albo osobnego commita potwierdzającego, albo archiwizacji z oczekującymi punktami ręcznymi (`/10x-archive` dopuszcza to jako ostrzeżenie).
- **Fix**: Przepisać zdanie w planie i briefie: "CI i wdrożenie mają po jednym wierszu na końcu, zamiast powtarzać wiersz CI w każdej fazie; wiersze zależne od PR i wdrożenia odhaczamy po scaleniu osobnym commitem albo archiwizujemy z nimi jako oczekującymi".
- **Decision**: FIXED (Fix in plan: przepisane uzasadnienie w Implementation Approach i briefie)
