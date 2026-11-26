# Live rule violations — Plan Brief

> Full plan: `context/changes/live-rule-violations/plan.md`

## What & Why

Planista Shiftly widzi na żywo, po każdym kliknięciu w widoku obsadzania, krytyczne naruszenia reguł czasu pracy i ostrzeżenia, każde z czytelnym powodem i miejscem w grafiku (wycinek S-05 z roadmapy, FR-010, US-01). To gwiazda przewodnia roadmapy i rdzeń hipotezy produktu: narzędzie ma pokazać planiście, co łamie przepisy, zanim grafik pójdzie dalej. Wycinek dostarcza też kontrakt wskazania, który zużyją S-07 (nieobecności), S-08 (zatwierdzanie i zapis wskazań), S-09 (generator) oraz fundamenty dla S-06 (suma godzin).

## Starting Point

S-04 dało widok `/schedules/<id>/assign` z optymistycznym stanem przypisań w wyspie React i podsumowaniem obsady "x z y". Wyspa nie ma jednak danych, których potrzebują reguły: zmiany mają tylko sformatowane teksty godzin (bez minut rozpoczęcia i zakończenia), a pracownik nie ma etatu (komentarz w kodzie mówi wprost, że wyspa nigdy go nie dostaje). W repo nie ma kalendarza (dzień tygodnia, święta, Wielkanoc) ani żadnej funkcji reguł. Kroki smoke porównują tekst komórek i tabel co do znaku, więc każdy nowy element w siatce może je złamać.

## Desired End State

Pod siatką obsadzania jest lista wskazań (krytyczne pierwsze), a w komórkach osoby i dnia oraz w kolumnie "Wskazania" są tekstowe znaczniki. Każde wskazanie ma powód po polsku z liczbami (np. przerwa 8 h 0 min, wymagane co najmniej 11 h) i wskazuje osobę oraz dzień. Po każdym kliknięciu, także po wycofaniu przy błędzie, wskazania liczą się od nowa. Reguły krytyczne: odpoczynek dobowy 11 h, 8 h w oknie 24 h, 48 h w tygodniu, odpoczynek tygodniowy 35 h (24 h przy zmianie godziny rozpoczęcia). Ostrzeżenia: przekroczenie normy tygodniowej etatu i brak kadrowy. Wynik jest deterministyczny, a każde wskazanie ma stabilny klucz dla S-08.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Limit godzin zależny od etatu | Ostrzeżenie względem normy tygodniowej, nie krytyczne | Norma z art. 130 jest miesięczną średnią, więc krytyczna ocena jednego tygodnia blokowałaby w S-08 zgodne z prawem grafiki. | Wywiad |
| Fundamenty wspólne z S-06 | Faza 1 tego planu (minuty zmian, etat w wyspie, kalendarz, norma) | Jeden właściciel i jedna definicja; S-06 jest planowany równolegle, a implementowany po tej fazie. | Wywiad |
| Doba dla limitu 8 h | Okno 24 h od rozpoczęcia pracy (art. 128 § 3) | Jedyny odczyt z definicją prawną; łapie rotacje z wcześniejszym startem (pon. 08:00-16:00 i wt. 06:00-14:00 to 10 h). | Wywiad |
| Zakres oceny | Jeden grafik, krawędzie oznaczone na stronie | Deterministyczne, bez nowych odczytów; sąsiad nie ma tożsamości do czasu S-08 i S-12. | Wywiad |
| Tydzień odpoczynku tygodniowego | Siedem dni grafiku | Tydzień z D2 prawie nigdy nie pokrywa się z grafikiem, więc reguła prawie nigdy by się nie wykonała. | Wywiad |
| Przejście na inną zmianę | Inna godzina rozpoczęcia niż ostatnia zmiana przed przerwą | Słownik zmian nie ma typów, a nazwy mogą się powtarzać. | Wywiad |
| Zmiana dłuższa niż 8 h | Krytyczne, z komunikatem o systemie równoważnym (art. 135) | Zgodne z D3 i PRD; nigdy fałszywa zgodność. | Wywiad |
| Pokazanie wskazań | Lista pod siatką, znaczniki w komórkach, kolumna "Wskazania" | Powód i miejsce zawsze czytelne, a istniejące tabele zachowują strukturę. | Wywiad |
| Pułap 48 h, okna doby, klucz wskazania | Krytyczny pułap; raport raz na grupę okien; klucz `reguła|osoba|kotwice` | Autor rozstrzygnął w planowaniu, do zakwestionowania przy zatwierdzaniu. | Plan |

## Scope

**In scope:** typy wskazania; czyste funkcje kalendarza, godzin i reguł z testami; minuty zmian i etat w opcjach wyspy; `list` z hooka; hook `useViolations`, lista wskazań, znaczniki i kolumna "Wskazania"; aktualizacja i nowe kroki smoke; dokumentacja; wdrożenie z pomiarem CPU renderu.

**Out of scope:** nieobecności (S-07); zatwierdzanie, blokada krytycznych i zapis wskazań (S-08); generowanie (S-09); suma godzin per osoba względem normy (S-06); odczyt sąsiednich grafików i odpoczynek na krawędziach; norma miesięczna; praca w niedzielę i święta jako reguła; systemy równoważne; DST; migracje, tabele i trasy API; testy komponentów i hooków; konfigurowalne progi.

## Architecture / Approach

Od środka na zewnątrz: fundamenty i dane (Faza 1), reguły odpoczynku i godzin (Faza 2), norma, brak kadrowy i silnik `evaluateSchedule` (Faza 3), widok (Faza 4), smoke, dokumentacja i wdrożenie (Faza 5). Reguły to czyste funkcje liczone w wyspie ze stanu optymistycznego i raz w Workerze przy renderze, bez zapytań do serwera i bez migracji. Fazy 1 do 3 to wyłącznie czyste funkcje z testami granic co do minuty i determinizmu, więc poprawność reguł jest rozstrzygnięta, zanim ruszy interfejs. Wszystkie fazy trafiają do jednego pull requesta.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Fundamenty | Minuty zmian i etat w wyspie, kalendarz ze świętami, norma tygodniowa, sumy godzin, `list` z hooka | Święta i norma wymagają akceptacji autora (176, 168, 176 h z dokumentu reguł) |
| 2. Reguły odpoczynku i godzin | Typ wskazania, odpoczynek dobowy, 8 h w oknie, 48 h, odpoczynek tygodniowy, powody i klucze | Okna doby i krawędzie grafiku; powody wymagają akceptacji autora |
| 3. Norma, brak kadrowy i silnik | Dwa ostrzeżenia i `evaluateSchedule` w kanonicznej kolejności | Determinizm i unikalność kluczy całości |
| 4. Widok wskazań | Lista, znaczniki, kolumna, aktualizacja po kliknięciu, zaktualizowane kroki smoke | Kruche kroki smoke i brak testów komponentów (przegląd w przeglądarce) |
| 5. Smoke, dokumentacja i wdrożenie | Kroki wskazań z asercjami przyczyny, dokumentacja, CI, wdrożenie, pomiar CPU | Limit 10 ms CPU na żądanie przy renderze serwerowym wyspy |

**Prerequisites:** S-04 w `master` (scalone i wdrożone); poprawki z przeglądu S-03 (F2 i F9) scalone przed implementacją; lokalny Supabase i Docker (smoke); bez migracji.
**Estimated effort:** około 5 sesji, po jednej na fazę; największe ryzyko to poprawność prawna reguł, nie ilość kodu.

## Open Risks & Assumptions

- Reguły ostrzegają i nie gwarantują zgodności z prawem (guardrail PRD); odczyt art. 128 § 3 i próg 24 h przy zmianie wymagają akceptacji autora, a raportowanie jest odporne tylko na to, co zdefiniowano.
- Odpoczynek na krawędziach grafiku (poprzedni i następny tydzień) nie jest sprawdzany do czasu S-08 i S-12; strona mówi to wprost.
- Grafik z zmianami dłuższymi niż 8 h (np. 12 h) nie przejdzie zatwierdzenia w S-08, bo systemy równoważne są poza MVP.
- Render serwerowy wyspy liczy reguły w Workerze (limit 10 ms CPU); pomiar po wdrożeniu jest wierszem planu, a przeniesienie na `client:only` osobną zmianą, jeśli wynik będzie blisko limitu.
- Konflikty ze S-06 w `types.ts`, `AssignmentGrid.tsx`, `smoke.mjs` i dokumentacji są przewidywalne; plan wskazuje punkty wstawiania.
- Brak testów komponentów i hooków: widok opiera się na przeglądzie w przeglądarce.

## Success Criteria (Summary)

- Planista widzi wskazania od razu po kliknięciu (krytyczne i ostrzeżenia, z powodem, osobą i dniem), a każde znika, gdy przyczyna zniknie, także po wycofaniu przy błędzie.
- Reguły działają zgodnie z granicami co do minuty (659 i 660 minut przerwy, 480 i 481 minut w oknie, 2880 i 2881 minut w tygodniu, 2099 i 2100 oraz 1439 i 1440 minut przerwy tygodniowej) i z wektorami norm 176, 168, 176 h.
- Bramka (`astro sync`, lint, `astro check`, testy, build) i smoke przechodzą lokalnie i w CI, a pomiar CPU renderu strony obsadzania po wdrożeniu mieści się w limicie.
