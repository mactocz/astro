---
project: Shiftly
version: 1
status: draft
created: 2026-10-16
updated: 2026-10-19
prd_version: 1
main_goal: quality
top_blocker: decisions
milestone_id: full-mvp-flow
milestone_seq: 1
milestone_status: open
---

# Roadmap: Shiftly

> Derived from `context/foundation/prd.md` (v1), `tech-stack.md`, `infrastructure.md`, `deploy-plan.md` + auto-researched codebase baseline (2026-10-16).
> Edit-in-place; the next milestone continues this file. Archive only when an independent roadmap replaces it.
> Items below are listed in dependency order. The "At a glance" table is the index. Brak estymacji i dat: kolejność wynika z zależności, tempo z blokad i niewiadomych.

## Milestone

**M-1: Pełny przepływ MVP, od układania grafiku do widoku pracownika** — Status: open

- **Intent:** Dowieść, że planista układa tygodniowy grafik z walidacją reguł czasu pracy na żywo i go zatwierdza, a pracownik z kontem widzi własne zmiany; wnioski urlopowe i nieobecności domykają obieg danych, z których korzystają reguły.
- **Source materials:** `context/foundation/prd.md` (v1)
- **Done when:** every F-NN and S-NN below is `done`.
- **Scope anchors:** FR-001 do FR-014 oraz FR-019 do FR-021 (17 wymagań koniecznych) i US-01. Wymagania "mile widziane" (FR-015 do FR-018) są w `## Parked`.

## Vision recap

Planista (kierownik zespołu z pracą zmianową) traci wiele godzin na ręczne układanie i poprawianie grafiku, a naruszenia przepisów o czasie pracy wychodzą na jaw za późno. Shiftly ma sprawdzać grafik pod kątem reguł czasu pracy na żywo podczas układania, a nie po fakcie, i proponować grafik, który te reguły spełnia.

## North star

**S-05: Planista widzi na żywo naruszenia reguł podczas ręcznego układania grafiku** — to pierwszy dowód głównej hipotezy PRD (walidacja na żywo, nie po fakcie), a przy celu "poprawność reguł przed szybkością" właśnie rdzeń reguł jest najważniejszy i najbardziej ryzykowny.

> Gwiazda przewodnia (ang. north star) to najmniejszy przepływ od początku do końca, którego dostarczenie dowodzi, że produkt działa. Jest ustawiona tak wcześnie, jak pozwalają zależności, bo cała reszta ma sens tylko wtedy, gdy to działa.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                              | Prerequisites | PRD refs                                         | Status   |
| ---- | --------------------------- | ----------------------------------------------------------------- | ------------- | ------------------------------------------------ | -------- |
| F-01 | role-based-access           | (foundation) system rozróżnia planistę i pracownika               | —             | Access Control; NFR (własne dane pracownika)     | ready    |
| F-02 | rules-verification-harness  | (foundation) testy automatyczne lokalnie i w CI                   | —             | Guardrails (wynik walidacji powtarzalny); NFR (wynik kontroli < 3 s) | in-progress |
| S-01 | employee-roster             | dodać i edytować pracownika z etatem, bez konta                   | F-01          | FR-001, FR-003                                   | proposed |
| S-02 | shift-dictionary            | zdefiniować i edytować zmiany we wspólnym słowniku                | F-01          | FR-013                                           | proposed |
| S-03 | weekly-schedule-draft       | utworzyć grafik tygodniowy z obsadą na zmianę i znaleźć go na liście | S-01, S-02 | FR-008, FR-009, FR-013, FR-019                   | proposed |
| S-04 | manual-shift-assignment     | ręcznie obsadzać zmiany pracownikami i poprawiać wpisy            | S-03          | FR-011, US-01                                    | proposed |
| S-05 | live-rule-violations        | zobaczyć na żywo naruszenia reguł i braki obsady                  | S-04, F-02    | FR-010, US-01                                    | proposed |
| S-06 | workload-vs-norm            | zobaczyć sumę godzin pracownika względem normy z etatu            | S-04          | FR-020                                           | proposed |
| S-07 | absence-entry               | wpisać nieobecność pracownika i zobaczyć kolizję w grafiku        | S-01, S-05    | FR-004, US-01                                    | proposed |
| S-08 | schedule-approval           | zatwierdzić grafik z blokadą krytycznych naruszeń                 | S-05          | FR-012, US-01                                    | proposed |
| S-09 | schedule-generation         | wygenerować propozycję grafiku bez nadpisywania wpisów ręcznych   | S-05, S-07, F-02 | FR-009, FR-011, US-01                         | proposed |
| S-10 | employee-invitation         | zaprosić pracownika e-mailem; pracownik ustawia hasło z linku     | F-01, S-01    | FR-001, FR-002                                   | proposed |
| S-11 | employee-own-schedule       | (pracownik) zalogować się i zobaczyć własne zmiany na telefonie   | S-10, S-08    | FR-014                                           | proposed |
| S-12 | schedule-new-version        | utworzyć nową wersję zatwierdzonego grafiku                       | S-08, S-11    | FR-021                                           | proposed |
| S-13 | employee-absence-report     | zgłosić nieobecność inną niż urlop; widoczność wzajemna           | S-07, S-11    | FR-004, FR-005, FR-014                           | proposed |
| S-14 | vacation-request            | (pracownik) złożyć wniosek urlopowy i widzieć jego status         | S-07, S-11    | FR-006, FR-014                                   | proposed |
| S-15 | vacation-decision           | zaakceptować lub odrzucić wniosek urlopowy z wpływem na grafik    | S-14          | FR-007, US-01                                    | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                                | Chain                                                                      | Note                                                                                                   |
| ------ | ------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A      | Układanie i walidacja grafiku        | `F-01` → `S-01` → `S-02` → `S-03` → `S-04` → `S-05` → `S-08` → `S-12`      | Rdzeń reguł jak najwcześniej (cel: poprawność); `S-01` i `S-02` są równoległe; `S-12` czeka też na `S-11` ze strumienia C. |
| B      | Weryfikacja i obciążenie             | `F-02` → `S-06`                                                            | Dołącza do A przy `S-05` (`F-02`) i `S-04` (`S-06`); `F-02` jest bezpośrednim warunkiem gwiazdy przewodniej. |
| C      | Ścieżka pracownika                   | `S-10` → `S-11` → `S-13` → `S-14` → `S-15`                                 | Zaczyna się równolegle do A po `S-01`; `S-11` czeka na `S-08`, a `S-13` i `S-14` na `S-07`.            |
| D      | Nieobecności i generowanie           | `S-07` → `S-09`                                                            | Dołącza do A przy `S-05`; generator dopiero po regułach i nieobecnościach (cel: poprawność).          |

## Baseline

What's already in place in the codebase as of `2026-10-16` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro, React i Tailwind działają; w UI jest tylko komponent przycisku oraz strony logowania, rejestracji i dashboardu (`src/components/ui/button.tsx`, `src/pages/`). Brak nawigacji Pracownicy/Grafiki, list, formularzy domenowych i widoku grafiku.
- **Backend / API:** partial — trasy `signin`, `signup`, `signout` i middleware (`src/pages/api/auth/`, `src/middleware.ts`); brak tras domenowych.
- **Data:** absent — projekt Supabase istnieje, ale nie ma migracji, tabel ani danych startowych (`supabase/` zawiera tylko `config.toml`).
- **Auth:** partial — e-mail i hasło oraz sesja w ciasteczkach działają (logowanie sprawdzone na produkcji); brak ról planista/pracownik, zaproszeń, ustawiania hasła z linku i obsługi powrotu z linku; rejestracja jest publiczna, a PRD przewiduje, że konto pracownika zakłada planista; chroniona strona przekierowuje na logowanie, a PRD chce komunikatu o braku dostępu.
- **Deploy / infra:** present — Worker działa pod `https://shiftly.mto-astro.workers.dev` z sekretami (`context/deployment/deploy-plan.md`); CI ma lint, build i smoke, bez kroku wdrożenia (wdrażanie ręczne).
- **Observability:** partial — logi Workera włączone i sprawdzone (`wrangler tail`); brak logowania i śledzenia błędów w kodzie aplikacji.

## Foundations

### F-01: Role i kontrola dostępu

- **Outcome:** (foundation) system rozróżnia planistę i pracownika: strony planisty są niedostępne dla pracownika i osoby niezalogowanej, a pracownik ma dostęp wyłącznie do własnych danych.
- **Change ID:** role-based-access
- **PRD refs:** Access Control; NFR (własne dane pracownika)
- **Unlocks:** S-01, S-02 i każdy dalszy wycinek planisty (strony tylko dla planisty); S-10 i S-11 (pracownik widzi tylko własne dane).
- **Prerequisites:** —
- **Parallel with:** F-02
- **Blockers:** —
- **Unknowns:**
  - Jak powstaje pierwsze konto planisty (np. pierwszy rejestrujący się, ręczne nadanie roli) i czy publiczna rejestracja zostaje zamknięta? — Owner: user. Block: no.
  - Czy nadal obowiązuje zapis z PRD, że niezalogowany widzi komunikat o braku dostępu zamiast przekierowania na logowanie (dziś jest przekierowanie, a skrypt smoke je sprawdza)? — Owner: user. Block: no.
- **Risk:** Stawiam to przed jakimkolwiek wycinkiem z danymi osobowymi pracowników (cel: poprawność); pomyłka tutaj uderza w prywatność wszystkich dalszych wycinków, więc zakres ograniczam do samego rozróżnienia ról i dostępu.
- **Status:** ready

### F-02: Ścieżka weryfikacji reguł

- **Outcome:** (foundation) testy automatyczne uruchamiają się lokalnie i w CI, z jednym przykładowym przypadkiem sprawdzającym, że ten sam wejściowy zestaw daje ten sam wynik; same reguły dochodzą dopiero w S-05.
- **Change ID:** rules-verification-harness
- **PRD refs:** Guardrails (wynik walidacji powtarzalny); NFR (wynik kontroli < 3 s)
- **Unlocks:** S-05 (weryfikowalna, powtarzalna walidacja reguł) i S-09 (powtarzalność generatora).
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez automatycznych testów zabezpieczenie PRD "te same dane, ten sam wynik" jest niesprawdzalne; celowo minimalne (uruchamianie, krok w CI, jeden przypadek), żeby nie budować warstwy testów na zapas.
- **Status:** in-progress

## Slices

### S-01: Lista pracowników

- **Outcome:** Planista może dodać pracownika (z wymiarem czasu pracy, bez zakładania konta) i edytować jego dane, w tym etat.
- **Change ID:** employee-roster
- **PRD refs:** FR-001, FR-003
- **Prerequisites:** F-01
- **Parallel with:** S-02, F-02
- **Blockers:** —
- **Unknowns:**
  - Jakie dane pracownika poza etatem i e-mailem są wymagane (np. imię i nazwisko)? — Owner: user. Block: no.
- **Risk:** Pierwsza tabela z danymi osobowymi, więc ustawia wzorzec modelu danych i polityki dostępu dla całej reszty; zaproszenia są osobno w S-10, bo pracownik może istnieć bez konta.
- **Status:** proposed

### S-02: Słownik zmian

- **Outcome:** Planista może zdefiniować zmiany (nazwa, godziny rozpoczęcia i zakończenia) raz we wspólnym słowniku i je edytować.
- **Change ID:** shift-dictionary
- **PRD refs:** FR-013
- **Prerequisites:** F-01
- **Parallel with:** S-01, F-02, S-10
- **Blockers:** —
- **Unknowns:**
  - Jak traktować zmiany przechodzące przez północ (np. 22:00 do 06:00), skoro wpływają na liczenie doby i odpoczynku? — Owner: user. Block: no.
- **Risk:** Zmiany są wspólną jednostką dla obsady, reguł i generatora; zapis PRD, że edycja zmiany nie może po cichu zmienić zatwierdzonych grafików, trzeba uwzględnić w modelu od razu (egzekwowanie dojdzie z S-08).
- **Status:** proposed

### S-03: Szkic grafiku tygodniowego

- **Outcome:** Planista może utworzyć grafik tygodniowy: wybrać okres (tydzień od daty początkowej), zmiany i pracowników oraz określić wymaganą liczbę osób na zmianę w każdym dniu, a potem znaleźć grafik na liście i edytować szkic.
- **Change ID:** weekly-schedule-draft
- **PRD refs:** FR-008, FR-009, FR-013, FR-019
- **Prerequisites:** S-01, S-02
- **Parallel with:** F-02, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Model okresu tygodniowego i obsady jest podstawą wszystkich reguł; generowanie celowo wydzielone (S-09), żeby ten wycinek nie rozrósł się o algorytm. Decyzja D6 (`work-time-rules.md`, 2026-10-16): grafik tygodniowy zostaje, a UI i dokumentacja informują, że nie zastępuje formalnego rozkładu czasu pracy (art. 129 § 3: co najmniej miesiąc, przekazany z tygodniowym wyprzedzeniem).
- **Status:** proposed

### S-04: Ręczne obsadzanie zmian

- **Outcome:** Planista może ręcznie przypisywać pracowników do zmian w grafiku roboczym i poprawiać te wpisy.
- **Change ID:** manual-shift-assignment
- **PRD refs:** FR-011, US-01
- **Prerequisites:** S-03
- **Parallel with:** F-02, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wpisy ręczne muszą być rozpoznawalne od początku, żeby późniejsze generowanie ich nie nadpisało (zabezpieczenie PRD: planista nie traci ręcznych zmian).
- **Status:** proposed

### S-05: Naruszenia reguł na żywo

- **Outcome:** Planista może zobaczyć podczas układania krytyczne naruszenia (odpoczynek dobowy, odpoczynek tygodniowy, limit 8 godzin na dobę, limit godzin zależny od etatu) oraz ostrzeżenia o brakach obsady, każde z czytelnym powodem i miejscem w grafiku.
- **Change ID:** live-rule-violations
- **PRD refs:** FR-010, US-01
- **Prerequisites:** S-04, F-02
- **Parallel with:** S-06, S-10
- **Blockers:** —
- **Unknowns:**
  - Wartości progów i definicja doby i tygodnia — rozstrzygnięte 2026-10-16: wartości z tekstu Kodeksu pracy i decyzje D1 do D6 zaakceptowane przez autora, zob. `context/foundation/work-time-rules.md`. — Owner: user. Block: no.
  - Jak liczyć dobę przy zmianach przechodzących przez północ (dokument zaleca potwierdzenie na przykładach testowych)? — Owner: user. Block: no.
  - Czy reguły i ich waga (krytyczne czy ostrzeżenie) odpowiadają potrzebom prawdziwego planisty (rozmowa z osobą, która układała taki grafik)? — Owner: user. Block: no.
- **Risk:** To rdzeń hipotezy produktu i największe ryzyko poprawności: błędna interpretacja progu po cichu daje fałszywe poczucie zgodności z prawem (PRD: narzędzie ostrzega, nie gwarantuje), więc wejdzie wcześnie, z testami powtarzalności z F-02 i przypadkami z `work-time-rules.md`. Zmiany dłuższe niż 8 godzin (system równoważny) są poza MVP i mają dawać czytelny komunikat, nie fałszywą zgodność.
- **Status:** proposed

### S-06: Obciążenie względem normy

- **Outcome:** Planista może zobaczyć w grafiku sumę godzin każdego pracownika względem normy wynikającej z jego wymiaru czasu pracy.
- **Change ID:** workload-vs-norm
- **PRD refs:** FR-020
- **Prerequisites:** S-04
- **Parallel with:** S-05, S-07, S-08, S-09, S-10
- **Blockers:** —
- **Unknowns:**
  - Norma dla pełnego i niepełnego etatu — rozstrzygnięte 2026-10-16: wzór z art. 130 Kodeksu pracy, okres rozliczeniowy = miesiąc kalendarzowy, niepełny etat proporcjonalnie, święta wyliczane z ustawy (D2, D4, D5 w `context/foundation/work-time-rules.md`). — Owner: user. Block: no.
  - Jak zestawiać grafik tygodniowy z miesięcznym okresem rozliczeniowym, gdy tydzień obejmuje dwa miesiące? — Owner: user. Block: no.
- **Risk:** Mierzalna równomierność obciążenia jest decyzją PRD (bez progu i bez blokady), więc wycinek jest mały; proporcję dla niepełnego etatu potwierdza tylko źródło wtórne (biznes.gov.pl), więc kod ma trzymać ją w jednym miejscu, łatwym do poprawki.
- **Status:** proposed

### S-07: Wpisywanie nieobecności

- **Outcome:** Planista może wpisać nieobecność pracownika (urlop, L4), a grafik kolidujący z zatwierdzoną nieobecnością jest wskazany jako krytyczne naruszenie.
- **Change ID:** absence-entry
- **PRD refs:** FR-004, US-01
- **Prerequisites:** S-01, S-05
- **Parallel with:** S-06, S-08, S-10
- **Blockers:** —
- **Unknowns:**
  - Czy nieobecność ma granularność dnia czy godzin (PRD mówi o "dniu/godzinie")? — Owner: user. Block: no.
- **Risk:** Pierwszy raz reguła czerpie dane spoza grafiku; nieobecności zasilą też późniejsze wycinki pracownika (S-13, S-14), więc model ustawiam tutaj.
- **Status:** proposed

### S-08: Zatwierdzanie grafiku

- **Outcome:** Planista może zatwierdzić grafik: krytyczne naruszenie blokuje zatwierdzenie, ostrzeżenie wymaga jawnego potwierdzenia, a zatwierdzony grafik jest zablokowany do edycji i ma zapisane wskazania.
- **Change ID:** schedule-approval
- **PRD refs:** FR-012, US-01
- **Prerequisites:** S-05
- **Parallel with:** S-06, S-07, S-09, S-10
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Zamrożenie zatwierdzonego grafiku i zapis wskazań to zabezpieczenie PRD (naruszenie nigdy nie jest zatwierdzane po cichu); musi być gotowe, zanim pracownik cokolwiek zobaczy (S-11).
- **Status:** proposed

### S-09: Generowanie propozycji grafiku

- **Outcome:** Planista może wygenerować propozycję grafiku, która pokrywa wymaganą obsadę i unika naruszeń, bez nadpisywania wpisów ręcznych.
- **Change ID:** schedule-generation
- **PRD refs:** FR-009, FR-011, US-01
- **Prerequisites:** S-05, S-07, F-02
- **Parallel with:** S-06, S-08, S-10, S-11
- **Blockers:** —
- **Unknowns:**
  - Co ma robić generator, gdy nie da się spełnić wszystkich ograniczeń i według jakiego kryterium wybiera "najlepszą" propozycję (PRD ustala tylko, że naruszenie zostaje widoczne)? — Owner: user. Block: no.
- **Risk:** Najcięższe obliczenie w produkcie, a plan Workers Free ma limit 10 ms CPU na żądanie (decyzja z 2026-10-16), więc potrzebny jest pomiar na wdrożeniu; generator idzie po regułach i nieobecnościach, bo bez nich nie ma jak sprawdzić jego wyniku.
- **Status:** proposed

### S-10: Zaproszenie pracownika

- **Outcome:** Planista może zaprosić pracownika e-mailem, a pracownik może ustawić hasło z jednorazowego linku ważnego 7 dni i się zalogować.
- **Change ID:** employee-invitation
- **PRD refs:** FR-001, FR-002
- **Prerequisites:** F-01, S-01
- **Parallel with:** S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-09
- **Blockers:** Własny nadawca poczty e-mail (domyślny limit wysyłek w Supabase jest za niski dla zaproszeń; ryzyko z `infrastructure.md`).
- **Unknowns:**
  - Czy ponowne zaproszenie po wygaśnięciu unieważnia poprzedni link? — Owner: user. Block: no.
- **Risk:** Zależność od zewnętrznej poczty; do tego momentu rdzeń reguł rozwija się bez niej, dlatego wycinek jest równoległy do strumienia planisty.
- **Status:** proposed

### S-11: Własny grafik pracownika

- **Outcome:** Pracownik może zalogować się i przejrzeć na telefonie własne zmiany z zatwierdzonego grafiku.
- **Change ID:** employee-own-schedule
- **PRD refs:** FR-014
- **Prerequisites:** S-10, S-08
- **Parallel with:** S-06, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy wycinek dla pracowników; izolację danych (pracownik widzi tylko własne) sprawdzam tu na prawdziwym koncie pracownika, nie tylko w założeniach z F-01.
- **Status:** proposed

### S-12: Nowa wersja zatwierdzonego grafiku

- **Outcome:** Planista może utworzyć nową wersję zatwierdzonego grafiku (kopię), poprawić ją i zatwierdzić; pracownik widzi tylko najnowszą zatwierdzoną wersję danego okresu.
- **Change ID:** schedule-new-version
- **PRD refs:** FR-021
- **Prerequisites:** S-08, S-11
- **Parallel with:** S-06, S-09, S-13, S-14, S-15
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Wersjonowanie zmienia to, co widzi pracownik, więc idzie po S-11; historia starszych wersji zostaje widoczna tylko dla planisty.
- **Status:** proposed

### S-13: Zgłaszanie nieobecności przez pracownika

- **Outcome:** Pracownik może zgłosić nieobecność inną niż urlop (np. L4) bez akceptacji planisty, a planista i pracownik widzą nawzajem swoje wpisy, bez dublowania.
- **Change ID:** employee-absence-report
- **PRD refs:** FR-004, FR-005, FR-014
- **Prerequisites:** S-07, S-11
- **Parallel with:** S-06, S-09, S-12, S-14, S-15
- **Blockers:** —
- **Unknowns:**
  - Czy zgłoszona przez pracownika nieobecność od razu liczy się w regule jak zatwierdzona (krytyczna), skoro nie wymaga akceptacji? — Owner: user. Block: no.
- **Risk:** Dane od pracownika wchodzą do reguł bez kontroli planisty, więc ważne jest, jak je traktuje walidacja; model nieobecności jest już z S-07.
- **Status:** proposed

### S-14: Wniosek o urlop

- **Outcome:** Pracownik może złożyć wniosek o urlop i widzieć jego status, planista jest powiadamiany o nowym wniosku, a wniosek w stanie "złożony" jest ostrzeżeniem w grafiku.
- **Change ID:** vacation-request
- **PRD refs:** FR-006, FR-014
- **Prerequisites:** S-07, S-11
- **Parallel with:** S-06, S-09, S-12, S-13, S-15
- **Blockers:** Własny nadawca poczty e-mail, jeśli powiadomienie ma iść pocztą (zob. niewiadoma).
- **Unknowns:**
  - Jak planista jest powiadamiany o wniosku: e-mailem czy wskaźnikiem w aplikacji? — Owner: user. Block: no.
- **Risk:** Wniosek ma stany ("złożony", zaakceptowany, odrzucony), które dotykają reguł; PRD świadomie podniosło ten zakres do koniecznych, więc wchodzi w osobnym wycinku z decyzją o akceptacji w S-15.
- **Status:** proposed

### S-15: Decyzja o wniosku urlopowym

- **Outcome:** Planista może zaakceptować lub odrzucić wniosek urlopowy, widząc wpływ nieobecności na grafik; zaakceptowany urlop jest krytyczną kolizją w grafiku.
- **Change ID:** vacation-decision
- **PRD refs:** FR-007, US-01
- **Prerequisites:** S-14
- **Parallel with:** S-06, S-09, S-12, S-13
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Akceptacja zmienia wagę kolizji z ostrzeżenia na krytyczne i może unieważnić już ułożony grafik, więc wpływ na grafik musi być pokazany przy decyzji (wymaganie PRD).
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                  | Suggested issue title                                         | Ready for `/10x-plan` | Notes                                                         |
| ---------- | -------------------------- | ------------------------------------------------------------- | --------------------- | ------------------------------------------------------------- |
| F-01       | role-based-access          | Role planista/pracownik i kontrola dostępu                    | yes                   | Run `/10x-plan role-based-access`                             |
| F-02       | rules-verification-harness | Testy automatyczne lokalnie i w CI (ścieżka weryfikacji reguł) | yes                  | Run `/10x-plan rules-verification-harness`; bezpośredni warunek gwiazdy przewodniej |
| S-01       | employee-roster            | Lista pracowników: dodawanie i edycja z etatem                | no                    | Czeka na F-01                                                 |
| S-02       | shift-dictionary           | Słownik zmian                                                 | no                    | Czeka na F-01                                                 |
| S-03       | weekly-schedule-draft      | Grafik tygodniowy: formularz, obsada na zmianę, lista         | no                    | Czeka na S-01, S-02                                           |
| S-04       | manual-shift-assignment    | Ręczne obsadzanie zmian w grafiku roboczym                    | no                    | Czeka na S-03                                                 |
| S-05       | live-rule-violations       | Naruszenia reguł i braki obsady na żywo                       | no                    | Progi rozstrzygnięte (`work-time-rules.md`); czeka na S-04, F-02 |
| S-06       | workload-vs-norm           | Suma godzin pracownika względem normy z etatu                 | no                    | Norma rozstrzygnięta (`work-time-rules.md`); czeka na S-04    |
| S-07       | absence-entry              | Wpisywanie nieobecności i kolizja w grafiku                   | no                    | Czeka na S-01, S-05                                           |
| S-08       | schedule-approval          | Zatwierdzanie grafiku z blokadą krytycznych naruszeń          | no                    | Czeka na S-05                                                 |
| S-09       | schedule-generation        | Generowanie propozycji grafiku                                | no                    | Czeka na S-05, S-07, F-02                                     |
| S-10       | employee-invitation        | Zaproszenie pracownika e-mailem i ustawienie hasła            | no                    | Czeka na F-01, S-01; wymaga nadawcy poczty                    |
| S-11       | employee-own-schedule      | Własny grafik pracownika (telefon)                            | no                    | Czeka na S-10, S-08                                           |
| S-12       | schedule-new-version       | Nowa wersja zatwierdzonego grafiku                            | no                    | Czeka na S-08, S-11                                           |
| S-13       | employee-absence-report    | Zgłaszanie nieobecności przez pracownika                      | no                    | Czeka na S-07, S-11                                           |
| S-14       | vacation-request           | Wniosek o urlop i jego status                                 | no                    | Czeka na S-07, S-11                                           |
| S-15       | vacation-decision          | Akceptacja lub odrzucenie wniosku urlopowego                  | no                    | Czeka na S-14                                                 |

## Open Roadmap Questions

1. **Brak zweryfikowanego, konkretnego przypadku.** — Ból pochodzi z ogólnej analizy procesu, nie z osobistego doświadczenia autora; brak rozmowy z osobą, która układała taki grafik w ostatnim miesiącu. Konsekwencja: PRD opiera się na hipotezie; ryzyko zbudowania reguł niepotwierdzonych przez planistę. Owner: autor. Block: roadmap-wide (najmocniej dotyka S-05).
2. **Wartości progów zasad czasu pracy.** — Dokładne wartości (odpoczynek dobowy, odpoczynek tygodniowy, limit godzin zależny od etatu) trzeba zweryfikować w źródłach prawnych przed implementacją. Konsekwencja: walidacja nie da się zaimplementować i przetestować bez nich. Owner: autor. **Rozwiązane 2026-10-16:** wartości z tekstu Kodeksu pracy (Dz.U. 2026 poz. 1245) i decyzje D1 do D6 zaakceptowane przez autora, zob. `context/foundation/work-time-rules.md`. Block: none.
3. **Skala: `target_scale.qps` i `target_scale.data_volume` nie zostały określone.** — Dwie linie `# TODO` we frontmatterze PRD; liczba użytkowników (`medium`, dziesiątki do stu osób) jest ustalona. Owner: autor. Block: none (nie wpływa na kolejność).
4. **Czy przed pilotażem potrzebne jest śledzenie błędów w aplikacji, poza logami Workera?** — Baseline: logi Workera są włączone, ale kod aplikacji nie loguje ani nie zgłasza błędów; PRD nie stawia na to osobnego wymagania. Owner: user. Block: none.
5. **Które wycinki ze strumienia pracownika odciąć w pierwszej kolejności, jeśli zabraknie czasu?** — Przy celu "poprawność reguł przed szybkością" wycinki S-05 do S-09 są chronione; kandydaci do odcięcia to S-13 do S-15 (nieobecności i urlopy od strony pracownika), ale PRD świadomie odrzuciło zmniejszanie zakresu. Owner: user. Block: none.

## Parked

- **FR-015: blokowanie pracowników** — Why parked: PRD oznacza jako "mile widziane", nie jest na ścieżce kamienia milowego.
- **FR-016: dostępność i preferencje dni i godzin pracy zgłaszane przez pracowników** — Why parked: PRD oznacza jako "mile widziane"; poza regułą MVP.
- **FR-017: grafiki dzienne** — Why parked: PRD oznacza jako "mile widziane"; w MVP tylko grafik tygodniowy.
- **FR-018: usuwanie grafików i zmian** — Why parked: PRD oznacza jako "mile widziane"; w MVP tylko edycja.
- **Obsługa wielu firm (dane i uprawnienia per organizacja)** — Why parked: PRD, Non-Goals; MVP obsługuje jedną organizację.
- **Konfigurowalne reguły czasu pracy per firma lub branża** — Why parked: PRD, Non-Goals; w MVP stała lista czterech reguł.
- **Ewidencja rzeczywistego czasu pracy** — Why parked: PRD, Non-Goals; narzędzie planuje, nie rejestruje przepracowanych godzin.
- **Kwalifikacje pracowników w regule** — Why parked: PRD, Non-Goals; obsada to liczba osób.
- **Ograniczanie kosztów jako cel reguły** — Why parked: PRD, Non-Goals; brak danych o koszcie pracy.
- **Preferencje i dostępność pracowników jako wejście reguły** — Why parked: PRD, Non-Goals; zgłaszanie to FR-016.
- **Gwarancja zgodności z przepisami** — Why parked: PRD, Non-Goals; narzędzie ostrzega i wskazuje naruszenia, nie certyfikuje zgodności.
- **Automatyczne wdrożenie po scaleniu** — Why parked: ręczne wdrożenie działa i jest opisane (`context/deployment/deploy-plan.md`); wraca, jeśli koszt ręcznego wdrażania zacznie przeszkadzać.

## Milestone History

(Append-only. Carried forward verbatim into each successor milestone's roadmap; empty on the very first milestone. Closure entries are written by this skill's `READY_TO_CLOSE → CLOSED` transition. Format:)

- **M-<seq>: <Milestone name>** (`<milestone_id>`) — closed <YYYY-MM-DD>. <One-line outcome.>

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches the item is archived. Do NOT pre-populate. Format:)

- **<Slice ID>: <Outcome>** — Archived <YYYY-MM-DD> → `context/archive/<YYYY-MM-DD-change-id>/`. Lesson: <pointer to lessons.md if any, or `—`>.
