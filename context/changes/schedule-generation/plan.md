# Schedule generation Implementation Plan

## Overview

Wycinek S-09 (FR-009, FR-011, US-01): na stronie obsadzania szkicu planista klika „Wygeneruj” i dostaje propozycję przypisań, która dopełnia brakującą obsadę, nie tworzy krytycznych naruszeń, wyrównuje obciążenie względem normy etatu i nie rusza istniejących wpisów. Generator jest czystą funkcją liczoną w przeglądarce (decyzja autora 2026-11-27: zostajemy na planie Cloudflare Workers Free, limit 10 ms CPU na żądanie), a serwer tylko sprawdza, że strona nie jest nieaktualna, i zapisuje wynik jednym zapytaniem. Bez migracji.

## Current State Analysis

- Reguły to czyste funkcje (`src/lib/services/rules.ts`: `evaluateSchedule`, wskazania z `severity`, `rule`, `anchors`), liczone już w wyspie po każdym kliknięciu (`useViolations`). Sumy i norma: `work-hours.ts` (`workedMinutesByEmployee`, `weeklyNormExcused`, `exceedsNorm`).
- `schedule_assignments` ma kolumnę `source` (`manual` domyślnie, `generated` zarezerwowane dla S-09; `20261124152716_schedule_assignments.sql:10-23`). Planista ma `select`, `insert`, `delete` (bez `update`); polityki `insert` i `delete` wymagają szkicu (`20261127084657_schedule_approval.sql:74-80`).
- `src/lib/assignments.ts` zapisuje po jednym wpisie bez `source`; `DELETE` zablokowany przez politykę to cichy brak operacji.
- Strona `assign.astro` przekazuje wyspie przypisania bez `source`, a dla szkicu skrót danych `basis` (`approvalBasis`); `sameAssignments` porównuje listy po kluczu (`src/lib/services/approval.ts`).
- Czas CPU po S-08: p50 7,19 ms, p99 41,55 ms dla żądań Workera (`context/deployment/deploy-plan.md`).

## Desired End State

Na szkicu pod siatką są przyciski „Wygeneruj” i „Usuń wygenerowane”. „Wygeneruj” liczy propozycję w przeglądarce i od razu ją zapisuje; wygenerowane wpisy mają w siatce własne oznaczenie, a komunikat mówi, ile dodano, ilu osób jeszcze brakuje, ile osób przekracza normę i ile przypisań przypada na niezatwierdzony wniosek. „Usuń wygenerowane” po potwierdzeniu usuwa tylko wpisy `generated`. Zatwierdzony grafik nie ma tych przycisków ani oznaczeń. Weryfikacja: testy generatora, smoke tras i stron, sprawdzenie w przeglądarce.

### Key Discoveries:

- Hurtowy `upsert` PostgREST to jedno zapytanie SQL, więc zapis propozycji jest atomowy bez funkcji w bazie; usunięcie wpisów `generated` to jeden `DELETE`.
- Każdego kandydata można ocenić tymi samymi regułami, uruchomionymi dla jednej osoby (`staffing: []`, jej przypisania i nieobecności), więc przepisy nie dostają drugiej implementacji.
- Mechanizm nieaktualnej strony z przeglądu S-08 (`basis`, `sameAssignments`) nadaje się do zapisu propozycji i nie kosztuje serwera liczenia reguł.
- Smoke porównuje dokładnie `aria-label` przycisków zmian i teksty wierszy siatki.

## What We're NOT Doing

- Optymalności: generator nie przestawia już dobranych osób, żeby zapełnić kolejny brak; nie ma losowości ani „innego wariantu”.
- Usuwania ani zmiany istniejących wpisów przez „Wygeneruj” (ani ręcznych, ani wygenerowanych); pamiętania odrzuconych propozycji (usunięty wpis może wrócić).
- Przekraczania wymaganej obsady, tworzenia krytycznych naruszeń, sprawdzania sąsiednich tygodni, preferencji pracowników (FR-016).
- Sprawdzania reguł na serwerze przy zapisie propozycji (zatwierdzenie i tak liczy je na serwerze).
- Migracji, Web Workera, podglądu przed zapisem, przenoszenia renderowania strony obsadzania do przeglądarki (osobna zmiana po pomiarze).

## Implementation Approach

Czysta funkcja `generateSchedule` w `src/lib/services/generator.ts`, potem dane i trasy, potem interfejs. Algorytm zachłanny w czterech przebiegach. Dla pary osoba i komórka obsady kandydat jest niedopuszczalny, gdy po dodaniu przypisania osoba ma krytyczne wskazanie o nowym kluczu, krytyczne wskazanie, którego kotwicą jest nowe przypisanie, albo `daily_hours`, `weekly_hours` lub `weekly_rest` (także już istniejące: dokładanie pracy pogłębia limity tygodniowe, a reguła dobowa pomija okna otwierające się wewnątrz już zgłoszonego, więc przy istniejącym `daily_hours` nowe przekroczenie mogłoby nie dać żadnego wskazania); osoba musi być w składzie grafiku, nie może być już w tej komórce, a zmiana musi być w słowniku. Dopuszczalny kandydat ma stopień:

| Stopień | Niezatwierdzony wniosek (`absence_requested`) | Ponad normę tygodniową (`weekly_norm`) |
| --- | --- | --- |
| 0 | nie | nie |
| 1 | nie | tak |
| 2 | tak | nie |
| 3 | tak | tak |

W przebiegu `t` (0 do 3) generator, dopóki to możliwe: wybiera komórkę z brakiem o najmniejszej nadwyżce kandydatów stopnia najwyżej `t` nad brakiem (remis: dzień, godzina rozpoczęcia, id zmiany), a w niej kandydata o najniższym stopniu, potem o najniższym wykorzystaniu normy (przepracowane przez normę, porównane dokładnie na liczbach całkowitych; norma 0 na końcu), potem o mniejszej liczbie minut, potem o mniejszym id.

## Critical Implementation Details

- **Performance**: ocenę kandydata liczyć leniwie (dopiero gdy komórka jest rozważana), trzymać w pamięci podręcznej i unieważniać tylko dla osoby, która dostała przypisanie. Jedna ocena `evaluateSchedule` dla jednej osoby to około 0,05 ms (pomiar w przeglądzie planu), więc 30 osób i 100 komórek to około 1 s, a skala 100 osób i 350 komórek nie jest celem.
- **State sequencing**: w trakcie generowania i usuwania siatka i zatwierdzanie są zablokowane (jak przy `approval.pending`), a „Wygeneruj” jest wyłączone, dopóki trwa zapis kliknięcia, bo skrót i lista muszą opisywać to, co jest w bazie.

## Phase 1: Generator

### Overview

Czysta funkcja generatora z testami. Aplikacja się nie zmienia.

### Changes Required:

#### 1. Generator

**File**: `src/lib/services/generator.ts` (nowy), `src/types.ts`

**Intent**: Policzyć propozycję przypisań z danych, które wyspa już ma.

**Contract**: `generateSchedule(input: RuleInput & { employeeIds: readonly string[] }): GenerationResult`, gdzie `GenerationResult { additions: AssignmentInput[]; missing: number; overNormEmployeeIds: string[]; onRequestedAbsence: AssignmentInput[] }`; bez `astro:*`; wejście tylko czytane; wynik niezależny od kolejności wejścia, `additions` posortowane (`sortAssignments`). `missing` to suma braków po dodaniu; `overNormEmployeeIds` i `onRequestedAbsence` dotyczą tylko dodanych przypisań. Zasady z „Implementation Approach”. `formatGenerationSummary(result)` daje polskie zdania komunikatu (dodano, brakuje, ponad normę, mimo wniosku; osobne zdania, gdy obsada już pełna i gdy nic nie da się dodać).

#### 2. Testy

**File**: `src/lib/services/generator.test.ts` (nowy)

**Intent**: Dowieść zasad i powtarzalności.

**Contract**: przypadki: pełna obsada bez przeszkód; brak, gdy jedyny kandydat miałby krytyczne naruszenie (odpoczynek dobowy, 8 h w dobie, 48 h, odpoczynek tygodniowy, zatwierdzona nieobecność); osoba z istniejącym krytycznym `daily_hours`, `weekly_hours` lub `weekly_rest` nie dostaje nic (w tym przypadek: 00:00-06:00 i 17:00-21:00 w dniu 0, kandydat 08:00-13:00 w dniu 1); kolejność czterech stopni (ponad normę przed wnioskiem); równe obciążenie dla etatu 1 i 1/2, remis po id; istniejące wpisy liczą się do obciążenia i nie pojawiają się w `additions`; nadmiar nie powstaje; zmiana spoza słownika zostaje brakiem; właściwość na zestawie wygenerowanym ze stałym ziarnem: wynik nie dodaje żadnego krytycznego klucza względem wejścia (`evaluateSchedule`), a dodatkowo, sprawdzane w teście niezależnie od reguł, żadne okno 24 h zawierające dodane przypisanie nie przekracza 8 h pracy; `expectDeterministic` i `seededShuffle`; brak mutacji; czas dla 30 osób i 100 komórek poniżej 3 s.

### Success Criteria:

#### Automated Verification:

- Testy generatora przechodzą: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Kolejność przebiegów, remisy i polskie zdania podsumowania zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Zapis

### Overview

Trasy zapisu i usuwania propozycji, dowiedzione w smoke.

### Changes Required:

#### 1. Dane

**File**: `src/lib/assignments.ts`, `src/lib/services/assignment.ts`

**Intent**: Hurtowo dodać wpisy `generated` i usunąć wszystkie wygenerowane z grafiku.

**Contract**: `addGeneratedAssignments(supabase, scheduleId, list)`: jeden `upsert` z `source: "generated"` i `ignoreDuplicates` (istniejący wpis, także ręczny, zostaje bez zmian); wynik `{ ok: true; added }` albo `unknown_reference` (23503), `schedule_approved` (42501 po sprawdzeniu statusu), `failed`. `removeGeneratedAssignments(supabase, scheduleId)`: jeden `delete` po `schedule_id` i `source`, zwraca liczbę; gdy usunięto 0 wierszy, sprawdza status (`isScheduleApproved`) i zwraca `schedule_approved`, jak `removeAssignment`. `readGenerationRequest(body)` (czysta, z testem): `{ basis, assignments, additions }` albo null; `additions` niepuste, każde przez `validateAssignmentInput`.

#### 2. Trasa

**File**: `src/pages/api/schedules/[id]/generated.ts` (nowy), `src/pages/api/schedules/[id]/approve.ts`, `src/lib/services/access.test.ts`

**Intent**: Zapisać propozycję tylko wtedy, gdy strona pokazuje aktualne dane. Blok „odczytaj dane, policz `basis`, porównaj ze stroną” z `approve.ts` wydzielić do jednego modułu w `src/lib/` i użyć w obu trasach.

**Contract**: `prerender = false`, `jsonResponse`. `POST` JSON `{ basis, assignments, additions }`: 415/400, 503 `not_configured`, 404, 422 `invalid_body` (także gdy `additions` jest więcej niż suma wymaganej obsady), 409 `schedule_approved`, odczyty jak w trasie zatwierdzania i 409 `schedule_changed` przy różnicy `basis` lub przypisań, 422 `unknown_reference`, 200 `{ added }`, 500 `failed`. Bez liczenia reguł. `DELETE` bez ciała: 404, 409 `schedule_approved` (najpierw usunięcie, a przy 0 wierszach sprawdzenie statusu), 200 `{ removed }`. Dostęp: domyślna odmowa, przypadki w teście.

#### 3. Smoke API

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść tras na prawdziwej bazie.

**Contract**: własny grafik `Smoke-<runId>-generate` (data startu przed 2026-11-15, etykieta niebędąca nadzbiorem istniejących); macierz ról z kodami błędów; kroki planisty: zapis dopisuje wpisy z `source = generated` (odczyt z bazy), istniejący wpis ręczny zostaje `manual`, nieaktualny `basis` lub lista dają 409 `schedule_changed` i nic nie zapisują, komórka bez obsady daje 422 i nic nie zapisuje (także dla pozostałych pozycji tej samej paczki), `DELETE` usuwa tylko `generated`, powtórzony `DELETE` daje `removed: 0`, zatwierdzony grafik daje 409 dla obu metod.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke z krokami tras przechodzi: `npm run smoke`

#### Manual Verification:

- Kolejność sprawdzeń w trasie i kody odpowiedzi zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Interfejs i dokumentacja

### Overview

Przyciski, oznaczenia i podsumowanie na stronie obsadzania szkicu.

### Changes Required:

#### 1. Dane wyspy

**File**: `src/pages/schedules/[id]/assign.astro`, `src/components/hooks/useAssignments.ts`

**Intent**: Wyspa musi wiedzieć, które wpisy są wygenerowane, i umieć przyjąć lub zdjąć wiele naraz.

**Contract**: przypisania szkicu idą do wyspy ze `source` (komentarz w `assign.astro` o pozostawaniu `source` na serwerze do zmiany); stan hooka trzyma `source` (kliknięcie dodaje `manual`), a cofnięcie nieudanego kliknięcia przywraca poprzedni wpis w całości, razem ze `source`; nowe operacje przyjęcia dodanej paczki (istniejący wpis zachowuje swój `source`) i zdjęcia wszystkich `generated` po udanej odpowiedzi (bez przeładowania strony). Zatwierdzony grafik bez zmian.

#### 2. Generowanie

**File**: `src/components/hooks/useGeneration.ts` (nowy), `src/components/schedules/GenerationSection.tsx` (nowy), `src/components/schedules/AssignmentGrid.tsx`

**Intent**: Jedno kliknięcie liczy i zapisuje; planista widzi, co się stało.

**Contract**: sekcja z nagłówkiem „Generowanie” nad tabelą osób, bez `<table>`, poza sekcją wskazań i sekcją obsady (ich pomocniki smoke tną HTML po tych sekcjach); wspólny ukryty opis wpisu wygenerowanego leży w tej sekcji, nigdy w tabeli (wiersze i komórki są porównywane tekstowo). „Wygeneruj” liczy `generateSchedule` z listy hooka, wysyła `POST` z `basis`, bieżącą listą i `additions`; gdy nie ma czego dodać, nie wysyła nic i pokazuje zdanie z podsumowania. „Usuń wygenerowane” (wyłączone, gdy takich nie ma) po potwierdzeniu z bezpiecznym przyciskiem z `autoFocus` wysyła `DELETE`. Komunikat w `role="status"`; błędy po polsku (409 `schedule_changed` z przyciskiem „Odśwież stronę”, `schedule_approved`, sesja, ogólny). Przyciski wyłączone, gdy reguł nie da się policzyć, trwa zapis kliknięcia, zatwierdzanie albo generowanie; w trakcie generowania siatka i zatwierdzanie są zablokowane. Przycisk zmiany z wpisem `generated` ma ikonę (`aria-hidden`) i `aria-describedby` na wspólny opis „wpis wygenerowany”; `aria-label` bez zmian; akapit pod siatką objaśnia oznaczenie.

#### 3. Smoke stron i dokumentacja

**File**: `scripts/smoke.mjs`, `CLAUDE.md`, `AGENTS.md`, `README.md`

**Intent**: Sprawdzić HTML i opisać zachowanie.

**Contract**: smoke: szkic ma sekcję „Generowanie” z dwoma przyciskami (drugi wyłączony bez wpisów `generated`, włączony z nimi), wpis `generated` ma opis, ręczny nie; zatwierdzony grafik nie ma sekcji ani oznaczeń; istniejące pomocniki siatki dalej przechodzą. Dokumentacja: nowe akapity o generatorze (reguły, stopnie, powtarzalność, zapis, brak gwarancji optymalności), wiersz trasy w `README.md`.

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke przechodzi: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual Verification:

- W przeglądarce: generowanie na pustym i częściowo obsadzonym grafiku, oznaczenia, podsumowanie, ponowne generowanie, usunięcie wygenerowanych, nieaktualna karta, klawiatura i czytnik
- Na telefonie (lub emulacji) sekcja i oznaczenia są czytelne

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Wdrożenie

### Overview

Wdrożyć i zmierzyć.

### Changes Required:

#### 1. Pomiar

**File**: `context/deployment/deploy-plan.md`

**Intent**: Sprawdzić, czy nowe trasy mieszczą się w limicie, i zebrać dane do decyzji o renderowaniu strony.

**Contract**: po `npm run build` i `npx wrangler deploy` z `master`: p50 i p99 czasu CPU, w miarę możliwości osobno dla trasy `generated` i strony obsadzania, liczba wyników `exceededCpu`, rozmiar użytego grafiku; zapis z decyzją.

### Success Criteria:

#### Manual Verification:

- Po wdrożeniu generowanie i usuwanie wygenerowanych działają na produkcji na grafiku testowym; nie uruchamiać `npm run smoke` na produkcji
- Pomiar CPU i decyzja są zapisane w `deploy-plan.md`

---

## Testing Strategy

### Unit Tests:

- `generator.test.ts`: zasady, stopnie, równe obciążenie, brak nowych krytycznych, powtarzalność, brak mutacji, czas.
- `assignment.test.ts`: `readGenerationRequest`.

### Integration Tests:

- Smoke: trasy `generated` (role, zapis, nieaktualna strona, atomowość, zatwierdzony grafik) i HTML strony obsadzania. Smoke nie uruchamia generatora (liczy się w przeglądarce).

### Manual Testing Steps:

1. Pusty grafik: „Wygeneruj”, sprawdzić brak krytycznych wskazań i rozkład godzin względem etatów.
2. Ręcznie obsadzić kilka komórek, wygenerować: wpisy ręczne bez zmian.
3. Usunąć jeden wygenerowany wpis i wygenerować ponownie; „Usuń wygenerowane” zostawia ręczne.
4. Dwie karty: zmiana w jednej, „Wygeneruj” w drugiej daje odmowę.

## Performance Considerations

Generator działa w głównym wątku przeglądarki; test pilnuje 3 s dla 30 osób i 100 komórek (około 1 s według pomiaru oceny jednej osoby). Znacznie większe grafiki mogą zająć kilkanaście sekund. Serwer robi te same odczyty co strona i skrót SHA-256, bez liczenia reguł i bez renderowania.

## Migration Notes

Brak migracji. Starsza wersja aplikacji ignoruje `source`.

## References

- Roadmapa S-09, PRD FR-009, FR-011, US-01 i „Business Logic”, `context/foundation/work-time-rules.md`
- Reguły: `src/lib/services/rules.ts`, `work-hours.ts`, `absence.ts`; zatwierdzanie: `src/lib/services/approval.ts`, `src/pages/api/schedules/[id]/approve.ts`
- Przegląd S-08: `context/archive/2026-11-26-schedule-approval/reviews/impl-review.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Generator

#### Automated

- [x] 1.1 Testy generatora przechodzą: `npm test` — 9f9f894
- [x] 1.2 Linting przechodzi: `npm run lint` — 9f9f894
- [x] 1.3 Sprawdzanie typów przechodzi: `npx astro check` — 9f9f894

#### Manual

- [x] 1.4 Kolejność przebiegów, remisy i polskie zdania podsumowania zostały przejrzane i zatwierdzone przez autora — 9f9f894

### Phase 2: Zapis

#### Automated

- [x] 2.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [x] 2.2 Smoke z krokami tras przechodzi: `npm run smoke`

#### Manual

- [x] 2.3 Kolejność sprawdzeń w trasie i kody odpowiedzi zostały przejrzane i zatwierdzone przez autora

### Phase 3: Interfejs i dokumentacja

#### Automated

- [ ] 3.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 3.2 Smoke przechodzi: `npm run smoke`
- [ ] 3.3 CI na pull requeście jest zielone (job `ci` i job `smoke`)

#### Manual

- [ ] 3.4 W przeglądarce: generowanie na pustym i częściowo obsadzonym grafiku, oznaczenia, podsumowanie, ponowne generowanie, usunięcie wygenerowanych, nieaktualna karta, klawiatura i czytnik
- [ ] 3.5 Na telefonie (lub emulacji) sekcja i oznaczenia są czytelne

### Phase 4: Wdrożenie

#### Manual

- [ ] 4.1 Po wdrożeniu generowanie i usuwanie wygenerowanych działają na produkcji na grafiku testowym; nie uruchamiać `npm run smoke` na produkcji
- [ ] 4.2 Pomiar CPU i decyzja są zapisane w `deploy-plan.md`
