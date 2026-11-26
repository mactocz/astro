# Workload vs norm — Plan Brief

> Full plan: `context/changes/workload-vs-norm/plan.md`

## What & Why

W widoku obsadzania planista widzi przy każdej osobie sumę godzin z siedmiu dni grafiku, normę tygodniową jej etatu i różnicę (wycinek S-06 z roadmapy, FR-020, US-01). Dzięki temu obciążenie jest mierzalne i widoczne, a równomierność widać przez porównanie wierszy. PRD mówi wprost: bez progu i bez blokady, więc kolumna jest neutralna, a ocenę przekroczenia normy robi S-05 jako ostrzeżenie na liście wskazań.

## Starting Point

Wyspa obsadzania nie ma dziś ani minut zmian, ani etatu, w repo nie ma kalendarza z normą i świętami, a hook obsadzania nie udostępnia listy przypisań. Wszystko to dostarcza Faza 1 planu S-05 (`live-rule-violations`): minuty i etat w opcjach wyspy, `calendar.ts`, `work-hours.ts` (`workedMinutesByEmployee`, `weeklyNorm`, `normMinutes`) i `list` z hooka. Format godzin istnieje już w `formatDuration` (`shift.ts`). Plan S-06 nie powiela tych fundamentów, więc jego implementacja zaczyna się po scaleniu Fazy 1 S-05; planowanie jest równoległe.

## Desired End State

W wierszu każdej osoby, po kolumnie "Wskazania", jest kolumna "Godziny" z dwoma liniami tekstu: `32 h z 40 h` i różnicą słowami (`mniej o 8 h`, `więcej o 2 h 30 min`, `równo z normą`). Liczby odświeżają się po każdym kliknięciu, także po wycofaniu przy błędzie. Pod siatką jest jeden akapit: norma tygodniowa (40 h pomniejszone o 8 h za święto w dzień inny niż niedziela, proporcjonalnie do etatu), nieobecności jeszcze nieuwzględnione, przekroczenie normy pokazuje lista wskazań.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Podstawa porównania | Norma tygodniowa tych siedmiu dni, ta sama co w S-05 | Jedna norma na ekranie, bez czytania innych grafików, które nie mają jeszcze statusu ani wersji. | Wywiad |
| Pokazanie sumy | Kolumna "Godziny" per osoba, neutralna, bez progu | Spełnia FR-020; komórka osoby i dni zostają bez zmian, co chroni kroki smoke. | Wywiad |
| Równomierność | Porównanie wierszy, bez wskaźnika zespołowego | PRD dopuszcza takie rozwiązanie; wskaźnik wymagałby definicji przy różnych etatach. | Plan |
| Kto ocenia przekroczenie | S-05 (`weekly_norm`), nie ta kolumna | Żadna liczba nie jest oceniana w dwóch miejscach. | Wywiad |
| Zmiana przez północ | Cała do dnia startu | Spójne z S-03 i z sumą godzin z S-05. | Plan |
| Nieobecności | Nieuwzględnione, jawnie w akapicie | Korektę normy o nieobecności (art. 130 § 3) dostarcza S-07. | Plan |
| Zaokrąglenie normy ułamkowej | Do minuty, różnica z wartości widocznej | Planista widzi spójne liczby; ostrzeżenie S-05 porównuje dokładnie. | Plan |
| Fundamenty | Z Fazy 1 S-05, bez duplikacji | Jedna definicja opcji wyspy i kalendarza, bez konfliktów edycji. | Wywiad |

## Scope

**In scope:** typ `WorkloadRow`; czyste `summarizeWorkload` i `formatWorkload` z testami; hook `useWorkload`; kolumna "Godziny" i akapit pod siatką; aktualizacja i nowe kroki smoke (dokładne teksty dla sześciu przypadków i tygodnia ze świętem); dokumentacja; wdrożenie.

**Out of scope:** ocena, progi, kolory statusu i blokady; korekta o nieobecności (S-07); norma miesięczna i godziny z wielu grafików; wskaźnik równomierności zespołu; pasek i wykres; widok pracownika (S-11); migracje, tabele i trasy API; testy komponentów i hooków.

## Architecture / Approach

Dwie fazy od środka na zewnątrz: czysta funkcja i tekst z testami granic i determinizmu (Faza 1), potem widok, smoke, dokumentacja i wdrożenie (Faza 2). Cała logika prawna (święta, norma, sumy) jest w funkcjach z S-05, a ten wycinek składa z nich wiersz i opisuje go tekstem. Kolumna jest komórką `td` w istniejącym wierszu, nic nie trafia do `th scope="row"` ani do `aria-label` przycisków, a kolumna nie ma `role` ani `aria-live`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Suma godzin i porównanie z normą | `summarizeWorkload`, `formatWorkload`, `WorkloadRow`, testy | Format tekstu i zaokrąglanie normy ułamkowej wymagają akceptacji autora |
| 2. Kolumna "Godziny", smoke i wdrożenie | `useWorkload`, kolumna i akapit, kroki smoke, dokumentacja, wdrożenie | Kruche kroki smoke (druga zmiana liczby kolumn) i brak testów komponentów |

**Prerequisites:** Faza 1 planu S-05 (`live-rule-violations`) w bazie gałęzi; poprawki z przeglądu S-03 scalone; lokalny Supabase i Docker (smoke); bez migracji.
**Estimated effort:** około 2 sesji, po jednej na fazę; mały wycinek, bo logika prawna jest gotowa w S-05.

## Open Risks & Assumptions

- Implementacja zależy od scalenia Fazy 1 S-05; bez niej plan nie ma danych (minut, etatu, normy) i nie wolno ich duplikować.
- Norma tygodniowa to wycinek miesięcznej normy z art. 130, więc kolumna mówi o tych siedmiu dniach, nie o całym miesiącu; akapit pod siatką to opisuje.
- Do czasu S-07 kolumna nie uwzględnia nieobecności, więc u osoby z urlopem norma jest zawyżona; akapit mówi to wprost.
- Konflikty ze S-05 w `types.ts`, `AssignmentGrid.tsx`, `smoke.mjs` i dokumentacji są przewidywalne; plan wskazuje punkty wstawiania.
- Brak testów komponentów i hooków: widok opiera się na przeglądzie w przeglądarce.

## Success Criteria (Summary)

- Planista widzi przy każdej osobie sumę, normę i różnicę, które zmieniają się od razu po kliknięciu i wracają po wycofaniu przy błędzie.
- Liczby zgadzają się z wektorami: 40, 30, 20 h i 17 h 9 min dla etatów 1/1, 3/4, 1/2 i 3/7, 32 h w tygodniu z jednym świętem poza niedzielą, zmiana z dnia 6 liczona w całości.
- Bramka (`astro sync`, lint, `astro check`, testy, build) i smoke przechodzą lokalnie i w CI, a kolumna działa na produkcji po wdrożeniu.
