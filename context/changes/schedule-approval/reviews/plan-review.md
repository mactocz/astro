<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Schedule approval

- **Plan**: context/changes/schedule-approval/plan.md
- **Mode**: Deep (weryfikacja kodu wykonana inline, bez sub-agenta)
- **Date**: 2026-11-27
- **Verdict**: REVISE
- **Findings**: 0 critical, 5 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
Ścieżki (assign.astro, assignments.ts, absences.ts, schedule-options.ts, migracje) ✓, symbole z S-07 (listAbsencesOverlapping, absencesOfRoster, safeEvaluate, summarizeWorkload) ✓, brief↔plan ✓. Brak lessons.md i contract-surfaces.md.

## Findings

### F1 — Kolejność blokad tabel grozi zakleszczeniem

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — oczywista, wąska poprawka
- **Dimension**: Blind Spots
- **Location**: Rozstrzygnięte w planowaniu, "Blokada"; Phase 2
- **Detail**: Plan blokuje `schedule_assignments`, potem `schedule_staffing`. `save_schedule` (20261124152716, linie 138-165) pisze najpierw do `schedule_staffing`, a kaskada dopiero potem do `schedule_assignments`. Zapis INNEGO szkicu w tym samym czasie może dać deadlock.
- **Fix**: Kolejność `LOCK TABLE schedule_staffing, schedule_employees, schedule_assignments, absences`.
- **Decision**: PENDING

### F2 — Zapis równoległy z zatwierdzeniem dostanie 404 zamiast 409

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — oczywista, wąska poprawka
- **Dimension**: Blind Spots
- **Location**: Critical Implementation Details, "Polityki" (`save_schedule`)
- **Detail**: Sprawdzenie statusu przed `update schedules` widzi jeszcze szkic. `update` czeka na blokadę, po zatwierdzeniu polityka odfiltrowuje wiersz, więc funkcja rzuca `PT404`, a nie `PT423`.
- **Fix**: Gdy `update` nie trafi w wiersz, sprawdzić status ponownie i dla zatwierdzonego rzucić `PT423`, inaczej `PT404`. Dodać ten przypadek do testu dwoma połączeniami.
- **Decision**: PENDING

### F3 — Wyspa nie ma jak odświeżyć wskazań po 409

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — oczywista, wąska poprawka
- **Dimension**: End-State Alignment
- **Location**: Phase 4, `useApproval`
- **Detail**: Plan mówi "przeładowuje listę wskazań", ale `useViolations` liczy z propsów załadowanych przy otwarciu strony (assign.astro:29-46). Po zmianie nieobecności, zmiany lub pracownika w innej karcie przycisk dawałby 409 w kółko.
- **Fix**: Na 409 `confirmation_required`, `schedule_changed` i `critical_violations` pokazać komunikat z przyciskiem "Odśwież stronę" (pełne przeładowanie).
- **Decision**: PENDING

### F4 — Potwierdzenie po samym kluczu przepuszcza zmienione ostrzeżenie

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — rzeczywisty kompromis
- **Dimension**: End-State Alignment
- **Location**: Phase 1 `decideApproval`; Phase 3 trasa
- **Detail**: Klucz wskazania celowo nie zawiera liczb. Brak 1 osoby może urosnąć do braku 3 przy tym samym kluczu i przejść jako potwierdzony, wbrew "nigdy po cichu".
- **Fix A ⭐ Recommended**: Wysyłać pary `{ key, reason }`; trasa wymaga zgodności obu, inaczej 409 `confirmation_required`.
  - Strength: Planista potwierdza dokładnie ten tekst, który zostanie zamrożony.
  - Tradeoff: Większe żądanie, nieco inna sygnatura `decideApproval`.
  - Confidence: HIGH — klient i serwer używają tych samych czystych funkcji.
  - Blind spot: Zgodność danych klienta i serwera potwierdzi dopiero smoke.
- **Fix B**: Zostawić same klucze i opisać ryzyko.
  - Strength: Bez zmian w planie.
  - Tradeoff: Możliwe zatwierdzenie gorszego stanu niż pokazany.
  - Confidence: HIGH — wynika z definicji klucza.
  - Blind spot: None significant.
- **Decision**: PENDING

### F5 — Nierozstrzygnięte dane zdrowotne w zamrożonych powodach

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — rzeczywisty kompromis
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details, "Dane zdrowotne"
- **Detail**: Plan zostawia decyzję otwartą ("do podjęcia i przetestowania"); żadna faza ani wiersz Progress jej nie obejmuje.
- **Fix A ⭐ Recommended**: Zapisane wskazania są tylko dla planisty; S-11 nie dostaje polityki na `schedule_approvals`.
  - Strength: RLS z planu już to wymusza i smoke tego dowodzi; planista widzi pełny powód.
  - Tradeoff: S-11 nie pokaże pracownikowi wskazań.
  - Confidence: HIGH — FR-014 mówi o własnych zmianach.
  - Blind spot: Przyszłe S-12 musi zachować tę zasadę.
- **Fix B**: Redagować rodzaj do "nieobecność" w zamrożonym tekście.
  - Strength: Bezpieczne także po błędzie w politykach.
  - Tradeoff: Zamrożony tekst różni się od pokazanego przed zatwierdzeniem; dodatkowa logika.
  - Confidence: MEDIUM — wymaga zmian w budowie powodów.
  - Blind spot: Teksty norm tygodniowych też wspominają nieobecność.
- **Decision**: PENDING

### F6 — `listAssignments` bez dokładnego licznika

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — oczywista, wąska poprawka
- **Dimension**: Blind Spots
- **Location**: Phase 3, moduł danych
- **Detail**: CLAUDE.md odnotowuje to jako uwagę dla S-08. Przy `max_rows` mniejszym niż 1000 obcięty odczyt dawałby ciągłe `schedule_changed` (bezpiecznie, ale mylnie).
- **Fix**: Czytać z `count: "exact"` i użyć `assertCompleteRead` (przenieść do `src/lib/postgrest.ts`).
- **Decision**: PENDING

### F7 — Brak planu B, gdy test blokady się nie powiedzie

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — dopisanie jednego zdania
- **Dimension**: Plan Completeness
- **Location**: Phase 2, test współbieżności
- **Detail**: Przypadek (a) zakłada, że zapis po odczekaniu na blokadę widzi nowy status; to założenie z pamięci.
- **Fix**: Jeśli test (a) nie przejdzie, zadeklarować `schedule_is_draft` jako `volatile` i powtórzyć test; dalsza porażka wraca do autora.
- **Decision**: PENDING
