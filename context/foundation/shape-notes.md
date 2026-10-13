---
project: Shiftly
context_type: greenfield
created: 2026-10-13
updated: 2026-10-13
product_type: web-app
target_scale:
  users: medium
timeline_budget:
  mvp_weeks: 8
  hard_deadline: 2026-12-06
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "rodzaj bólu"
      decision: "wiodące: tarcie w pracy (wiele godzin ręcznego układania i poprawek); dodatkowo koordynacja (rozproszona dostępność, urlopy, preferencje) i ryzyko zgodności (naruszenia widoczne za późno)"
    - topic: "persona główna"
      decision: "kierownik zespołu w małej/średniej firmie z pracą zmianową"
    - topic: "insight"
      decision: "walidacja przepisów na żywo podczas układania, nie po fakcie"
    - topic: "uwierzytelnianie"
      decision: "logowanie kontem (e-mail + hasło)"
    - topic: "role"
      decision: "dwie role: planista + pracownik; pracownika zaprasza planista (zakłada profil, pracownik ustawia hasło)"
    - topic: "wnioski o urlop składane przez pracownika"
      decision: "Faza 2: nice-to-have, poza MVP. Zmienione w Fazie 4 na must-have (FR-006, FR-007) po ponownym zasygnalizowaniu ryzyka zakresu (stany wniosku, zatwierdzanie); planista nadal może wpisywać nieobecności ręcznie (FR-004)"
    - topic: "blokowanie pracowników"
      decision: "planista może blokować pracownika; zablokowany pracownik nie może się zalogować (np. w przypadku zwolnienia); usuwanie pracownika nie zostało wybrane"
    - topic: "rozbicie FR grafiku"
      decision: "widzi naruszenia / poprawia ręcznie / zatwierdza jako trzy osobne FR (FR-010, FR-011, FR-012)"
    - topic: "reguła MVP — wejścia"
      decision: "zapotrzebowanie (wymagana obsada w dni i godziny) oraz wymiar czasu pracy (etat); poza regułą MVP: kwalifikacje, preferencje i dostępność"
    - topic: "reguła MVP — cele"
      decision: "spełnia zasady czasu pracy i odpoczynku (twarde reguły), zapewnia wymaganą obsadę, równomiernie rozkłada obciążenie; poza regułą MVP: ograniczanie kosztów"
    - topic: "braki kadrowe"
      decision: "widoczny konflikt, jak naruszenie reguły (rozszerza FR-010); wymaga zapotrzebowania w wejściach"
    - topic: "równomierne obciążenie"
      decision: "mierzalne i widoczne: planista widzi rozkład godzin na pracownika; bez progu i bez blokady"
    - topic: "źródło naruszeń przy generowaniu"
      decision: "generator unika naruszeń; naruszenie zostaje, gdy nie da się spełnić wszystkich ograniczeń, lub po ręcznej poprawce"
    - topic: "edycja po zatwierdzeniu"
      decision: "zatwierdzony grafik jest ostateczny; zmiana przez nową wersję (kopię)"
    - topic: "reguły czasu pracy w MVP"
      decision: "odpoczynek dobowy, odpoczynek tygodniowy, limit godzin zależny od etatu, kolizja z nieobecnością (zatwierdzona = krytyczne, niezatwierdzona = ostrzeżenie); dokładne wartości progów do weryfikacji w źródłach prawnych"
    - topic: "zdanie reguły MVP"
      decision: "wariant C: propozycja + jawne konflikty — najlepsza propozycja grafiku; tam, gdzie się nie udaje, planista widzi naruszenia reguł i braki kadrowe (zamiast gwarancji zgodnego grafiku)"
    - topic: "poziom zapotrzebowania (FR-019)"
      decision: "na zmianę w dniu (liczba osób; zmiana ma godziny rozpoczęcia i zakończenia); kwalifikacje poza MVP"
    - topic: "rozkład godzin (FR-020)"
      decision: "suma godzin pracownika względem normy wynikającej z etatu; must-have"
    - topic: "zmiana zatwierdzonego grafiku (FR-021)"
      decision: "nowa wersja (kopia); pracownik widzi najnowszą zatwierdzoną wersję danego okresu, starsze wersje widzi tylko planista"
    - topic: "brak kadrowy a zatwierdzenie"
      decision: "ostrzeżenie — zatwierdzenie po jawnym potwierdzeniu planisty (spójne z US-01: prawo = krytyczne, braki operacyjne = ostrzeżenia)"
    - topic: "NFR"
      decision: "hasło (co najmniej 8 znaków, znak specjalny, cyfra, duża litera), link zaproszenia jednorazowy i ważny 7 dni, pracownik widzi tylko własne dane, wynik kontroli reguł < 3 s, czytelność na telefonie (responsywność), dwie najnowsze wersje głównych przeglądarek desktopowych; każde wskazanie w grafiku ma czytelny powód i miejsce w grafiku"
    - topic: "typ produktu"
      decision: "strona lub aplikacja webowa"
    - topic: "skala"
      decision: "dziesiątki do stu osób (planiści i pracownicy z kontami)"
    - topic: "sonda 100× skali"
      decision: "zmieniłyby się: dane i uprawnienia per organizacja oraz reguły czasu pracy różne między firmami i branżami; poza MVP"
    - topic: "termin i tryb pracy"
      decision: "twardy termin 6 grudnia 2026; praca po godzinach (15 h tygodniowo); termin 4 listopada odrzucony"
    - topic: "zakres pierwszego przepływu MVP"
      decision: "pełny przepływ (12 kroków + ręczna poprawka z ostrzeżeniami); świadomie zaakceptowany koszt zamiast zmniejszania zakresu"
    - topic: "widoczność dla pracownika"
      decision: "tylko własne zmiany ze zatwierdzonych grafików"
  frs_drafted: 21
  quality_check_status: accepted
---

# Shape notes

## Seed idea

> Narzędzie do planowania grafików pracy z kontrolą przepisów (odpoczynek dobowy i tygodniowy, etat, urlopy). Ogólne, nie dla konkretnej firmy. Planista układa grafik ręcznie i może go wygenerować automatycznie. Sugestie do rozważenia (niezatwierdzone): zakres tylko widok tygodnia, 3–4 reguły, automat zachłanny zamiast solvera. Do ustalenia: dokładna lista reguł prawnych, czy preferencje pracowników są w MVP.

Uwaga: fragment "Sugestie do rozważenia" jest niezatwierdzony — traktować jako opcje do rozstrzygnięcia w fazach 3–5, nie jako wymagania.

## Vision & Problem Statement

Kierownik zespołu lub osoba odpowiedzialna za planowanie grafików odczuwa problem podczas układania i aktualizowania harmonogramów, gdy musi pogodzić dostępność pracowników, zapotrzebowanie operacyjne i przepisy prawa pracy. Ręczne planowanie zajmuje wiele godzin, prowadzi do błędów i częstych korekt, a niezgodności mogą generować dodatkowe koszty i ryzyko kar. Wiodący koszt to czas planisty i cykl poprawek; dodatkowo dane (dostępność, urlopy, preferencje) są rozproszone, a naruszenia przepisów wykrywane za późno.

Insight: walidacja przepisów na żywo podczas układania grafiku, nie po fakcie.

Źródło: ból pochodzi z ogólnej analizy procesu, nie z osobistego doświadczenia autora. Szacunki autora (niezmierzone): ręczne planowanie zajmuje 3–8 godzin tygodniowo, a typowy zespół liczy 10–30 osób.

Przy skali 100× większej zmieniłyby się: dane i uprawnienia rozdzielone per organizacja oraz reguły czasu pracy różniące się między firmami i branżami (nie wchodzi do MVP).

## User & Persona

Osoba główna: kierownik zespołu w małej lub średniej firmie z pracą zmianową, odpowiedzialny za układanie i aktualizowanie grafiku.

## Access Control

Logowanie kontem (e-mail + hasło). Dwie role:

- **Planista** — zarządza pracownikami (blokowanie pracowników: nice-to-have, FR-015), zmianami i grafikiem; wpisuje nieobecności; akceptuje lub odrzuca wnioski urlopowe pracowników.
- **Pracownik** — konto zakłada planista (zaprasza go, pracownik ustawia hasło). W MVP: widzi własne zmiany z najnowszej zatwierdzonej wersji grafiku (tylko odczyt), zgłasza nieobecności inne niż urlop i składa wnioski o urlop.

Konto pracownika jest opcjonalne: pracownik może istnieć w systemie bez konta i bez zaproszenia. Link z zaproszenia wygasa; samodzielnego resetu hasła nie ma — planista wysyła nowe zaproszenie.

Stan konta (nice-to-have, FR-015): planista może zablokować pracownika (np. w przypadku zwolnienia); zablokowany pracownik nie może się zalogować.

Zgłaszanie dostępności i preferencji dni i godzin pracy przez pracownika nie jest wymaganiem MVP (FR-016, nice-to-have).

Niezalogowany użytkownik otwierający chronioną stronę widzi komunikat o braku dostępu, bez automatycznego odesłania do logowania.

## Success Criteria

### Primary

- Planista przechodzi od logowania do zatwierdzonego grafiku: wchodzi w "Pracownicy", dodaje pracownika (e-mail), system wysyła zaproszenie z linkiem do ustawienia hasła; wchodzi w "Grafiki", klika "Dodaj", wypełnia formularz, generuje grafik, widzi naruszenia reguł i poprawia grafik ręcznie, zatwierdza go.
- Pracownik po ustawieniu hasła loguje się i przegląda własne zmiany ze zatwierdzonych grafików.

### Secondary

- Zbieranie preferencji dni i godzin pracy od pracowników.

### Guardrails

- Zatwierdzony grafik nie ukrywa naruszenia reguł (naruszenie jest widoczne i rejestrowane, nigdy zatwierdzane po cichu).
- Reguły i wynik walidacji są deterministyczne i powtarzalne (te same dane wejściowe dają ten sam wynik).
- Planista nigdy nie traci ręcznie wpisanych zmian przez automatyczne generowanie.

## Timeline acknowledgment

Acknowledged on 2026-10-13: 8-week MVP requires sustained dedication; user accepted. (Szacunek autora: 6–8 tygodni po 15 h tygodniowo, z nauką pracy z agentem, testami i dokumentacją; w polu `mvp_weeks` zapisano górną granicę. Zmniejszenie zakresu zostało zaproponowane i odrzucone.)

## Functional Requirements

### Konta i pracownicy
- FR-001: Planista can dodawać pracowników wraz z wymiarem czasu pracy (etatem) — konto pracownika jest opcjonalne — i wysyłać zaproszenie do konta tym, którzy mają się logować. Priority: must-have
  > Socrates: Kontrargument: "większość pracowników może w ogóle nie potrzebować konta". Rozstrzygnięcie: zmienione — pracownik może istnieć bez konta i bez zaproszenia.
- FR-002: Pracownik can ustalić hasło po wejściu w link z zaproszenia (link wygasa; reset hasła przez ponowne zaproszenie od planisty), aby móc się zalogować. Priority: must-have
  > Socrates: Kontrargument: "reset hasła i wygaśnięcie linku to ukryty koszt, którego FR nie nazywa". Rozstrzygnięcie: zawężone — link wygasa, brak samodzielnego resetu; planista wysyła nowe zaproszenie.
- FR-003: Planista can edytować dane pracowników, w tym wymiar czasu pracy (etat). Priority: must-have
  > Socrates: Kontrargument: "blokowanie można odroczyć — w MVP mało pracowników i rzadko odchodzą". Rozstrzygnięcie: rozdzielone — edycja danych zostaje must-have; blokowanie przeniesione do FR-015 jako nice-to-have.
- FR-015: Planista can blokować pracowników; zablokowany pracownik nie może się zalogować (np. w przypadku zwolnienia). Priority: nice-to-have
  > Socrates: Rozważone kontrargumenty (wykluczenie zablokowanego z nowych grafików). Rozstrzygnięcie: wymaganie zostaje bez zmian, tak jak zapisane.

### Nieobecności i dostępność
- FR-004: Planista can wpisywać nieobecności (urlopy, L4) pracowników; pracownik widzi nieobecności wpisane przez planistę, a planista widzi te zgłoszone przez pracownika, aby nie zdublować wpisów. Priority: must-have
  > Socrates: Kontrargument własny: wzajemna widoczność nieobecności jest warunkiem uniknięcia dublowania. Rozstrzygnięcie: wymaganie zostaje, z doprecyzowaniem wzajemnej widoczności.
- FR-005: Pracownik can zgłaszać nieobecności inne niż urlop (np. L4); zgłoszenie nie wymaga akceptacji planisty. Priority: must-have
  > Socrates: Kontrargument: dostępność i nieobecności się pokrywają. Rozstrzygnięcie: pracownik zgłasza nieobecności (must-have); zgłaszanie preferencji i dostępności na dalszy plan (FR-016). Zachodzi na FR-006 — rozstrzygnięte jako osobne: urlop wymaga akceptacji (FR-006/FR-007), inne nieobecności pracownik tylko zgłasza.
- FR-006: Pracownik can złożyć wniosek o urlop; planista jest powiadamiany o nowym wniosku. Priority: must-have
  > Socrates: Kontrargument: "wniosek bez powiadomienia planisty jest niezauważony". Rozstrzygnięcie: zostaje z powiadomieniem planisty.
- FR-007: Planista can zaakceptować lub odrzucić wniosek urlopowy pracownika; przy akceptacji widzi wpływ nieobecności na grafik. Priority: must-have
  > Socrates: Kontrargument: "akceptacja bez sprawdzenia grafiku psuje plan". Rozstrzygnięcie: akceptacja pokazuje wpływ na grafik.
- FR-016: Pracownik can zgłaszać swoją dostępność i preferencje dni i godzin pracy. Priority: nice-to-have

### Grafiki
- FR-008: Planista can przeglądać listę grafików tygodniowych. Priority: must-have
  > Socrates: Kontrargument: "dwa rodzaje to dwa widoki". Rozstrzygnięcie: w MVP tylko grafik tygodniowy; dzienne w FR-017.
- FR-017: Planista can przeglądać grafiki dzienne. Priority: nice-to-have
- FR-009: Planista can utworzyć nowy grafik przez formularz (okres: tydzień od daty początkowej; zmiany obowiązujące w grafiku; pracownicy objęci grafikiem; zapotrzebowanie na zmianę w dniu) i go wygenerować; wynik generowania jest propozycją startową do edycji, nie gotowym grafikiem. Priority: must-have
  > Socrates: Kontrargument: "generator da tylko propozycję, którą planista i tak poprawi". Rozstrzygnięcie: zostaje must-have, doprecyzowane jako propozycja startowa.
- FR-019: Planista can określić dla każdego dnia grafiku wymaganą liczbę pracowników na każdą zmianę (zmiana ma godziny rozpoczęcia i zakończenia). Priority: must-have
  > Socrates: Kontrargument: "obsada na każdą godzinę to dużo danych przed pierwszą wartością". Rozstrzygnięcie: obsada określana na zmianę w dniu; obsada to liczba osób, nie kwalifikacje (kwalifikacje poza MVP).
- FR-010: Planista can zobaczyć w grafiku naruszenia reguł (krytyczne naruszenia i ostrzeżenia) oraz braki kadrowe. Priority: must-have
  > Socrates: Rozważone kontrargumenty (zawężenie listy reguł do MVP; aktualizacja na żywo). Rozstrzygnięcie: wymaganie zostaje bez zmian, tak jak zapisane.
- FR-020: Planista can zobaczyć w grafiku sumę godzin każdego pracownika względem normy wynikającej z jego wymiaru czasu pracy. Priority: must-have
  > Socrates: Kontrargument: "suma godzin bez etatu wprowadza w błąd". Rozstrzygnięcie: godziny pokazane względem etatu; realizuje decyzję "równomierne obciążenie jest mierzalne i widoczne" (bez progu i bez blokady).
- FR-011: Planista can ręcznie poprawić grafik; ponowne generowanie nie nadpisuje wpisów ustalonych ręcznie. Priority: must-have
  > Socrates: Kontrargument: "ręczne poprawki i ponowne generowanie się nadpisują". Rozstrzygnięcie: generowanie nie rusza wpisów ręcznych (spójne z guardrailem).
- FR-012: Planista can zatwierdzić grafik; zatwierdzony grafik jest ostateczny i zablokowany do edycji. Priority: must-have
  > Socrates: Kontrargument: "zatwierdzenie bez zamrożenia nic nie znaczy". Rozstrzygnięcie: zatwierdzony grafik jest zablokowany do edycji.
- FR-021: Planista can utworzyć nową wersję zatwierdzonego grafiku (kopię), poprawić ją i zatwierdzić; pracownik widzi tylko najnowszą zatwierdzoną wersję danego okresu, starsze wersje widzi tylko planista. Priority: must-have
  > Socrates: Kontrargument: "wersjonowanie to osobna funkcja z konsekwencjami". Rozstrzygnięcie: zostaje; pracownik widzi najnowszą zatwierdzoną wersję, historia zachowana (odrzucono cofnięcie zatwierdzenia i brak zmian po zatwierdzeniu).
- FR-013: Planista can edytować grafiki robocze (niezatwierdzone) oraz zmiany (nazwa i godziny rozpoczęcia i zakończenia, definiowane raz we wspólnym słowniku i używane w kolejnych grafikach; edycja zmiany nie może po cichu zmienić grafików już zatwierdzonych). Priority: must-have
  > Socrates: Kontrargument: "usuwanie grafików to ryzyko utraty historii". Rozstrzygnięcie: w MVP tylko edycja; usuwanie przeniesione do FR-018 jako nice-to-have. Edycja zatwierdzonego grafiku odbywa się przez nową wersję (FR-021).
- FR-018: Planista can usuwać grafiki oraz zmiany. Priority: nice-to-have

### Widok pracownika
- FR-014: Pracownik can zalogować się i przeglądać własne zmiany z najnowszej zatwierdzonej wersji grafiku oraz własne nieobecności i wnioski wraz z ich statusem. Priority: must-have
  > Socrates: Kontrargument: "pracownik chce też widzieć swoje nieobecności i wnioski ze statusem". Rozstrzygnięcie: FR-014 rozszerzone.

## User Stories

### US-01: Planista generuje grafik i widzi naruszenia reguł

- **Given** zalogowany planista z dodanymi pracownikami (z wymiarem czasu pracy), ich nieobecnościami i określonym zapotrzebowaniem na obsadę
- **When** generuje grafik
- **Then** system pokazuje naruszenia reguł z odpowiednią wagą (krytyczne naruszenie albo ostrzeżenie)

#### Acceptance Criteria
- Grafik na dzień/godzinę zatwierdzonej nieobecności pracownika (zaakceptowany wniosek urlopowy lub nieobecność wpisana przez planistę) jest krytycznym naruszeniem reguły.
- Grafik na dzień/godzinę niezatwierdzonej nieobecności (wniosek urlopowy w stanie "złożony") jest ostrzeżeniem.
- Grafik naruszający limity czasu pracy i odpoczynku dobowego lub tygodniowego jest krytycznym naruszeniem reguły.
- Grafiku z krytycznym naruszeniem lub niezgodnością nie można zatwierdzić do czasu jego poprawienia.
- Grafik z ostrzeżeniem można zatwierdzić po jawnym potwierdzeniu przez planistę.
- Brak kadrowy (zmiana poniżej wymaganej obsady) jest ostrzeżeniem.

## Non-Functional Requirements

- System nie przyjmuje haseł krótszych niż 8 znaków ani takich, które nie zawierają znaku specjalnego, cyfry i dużej litery.
- Link z zaproszenia można użyć jeden raz i wygasa po 7 dniach.
- Pracownik widzi wyłącznie własne dane (zmiany, nieobecności, wnioski); dane innych osób są dla niego niedostępne.
- Po zmianie grafiku wynik kontroli reguł jest widoczny dla planisty w czasie < 3 s (dla grafiku tygodniowego małego zespołu).
- Grafik pracownika jest czytelny i możliwy do przeglądania na ekranie telefonu (responsywność).
- Aplikacja działa w najnowszych dwóch wersjach głównych przeglądarek desktopowych.
- Każde wskazanie w grafiku (naruszenie, ostrzeżenie, brak kadrowy) ma czytelny powód i miejsce w grafiku.

## Business Logic

Na podstawie zapotrzebowania na pracowników w poszczególnych dniach i godzinach, ich wymiaru czasu pracy, nieobecności i obowiązujących zasad czasu pracy aplikacja proponuje grafik, który w możliwie największym stopniu zapewnia wymaganą obsadę, spełnia te zasady i wyrównuje obciążenie, a tam, gdzie się to nie udaje, wskazuje planiście naruszenia reguł i braki kadrowe wymagające jego decyzji.

Wejścia: dla każdego dnia grafiku planista określa wymaganą liczbę pracowników na każdą zmianę (zmiana ma godziny rozpoczęcia i zakończenia); z danych pracownika reguła bierze jego wymiar czasu pracy i nieobecności (zaakceptowane i niezatwierdzone wnioski urlopowe oraz nieobecności wpisane przez planistę). Zasady czasu pracy w MVP: odpoczynek dobowy, odpoczynek tygodniowy, limit godzin zależny od etatu, kolizja z nieobecnością. Dokładne wartości progów do weryfikacji w źródłach prawnych; narzędzie ostrzega, nie gwarantuje zgodności z prawem.

Wynik: propozycja grafiku oraz wskazania przy nim — krytyczne naruszenia (zatwierdzona nieobecność, przekroczenie limitów czasu pracy lub odpoczynku), ostrzeżenia (niezatwierdzona nieobecność; brak kadrowy, czyli zmiana poniżej wymaganej obsady). Dla każdego pracownika widoczna jest suma godzin względem normy wynikającej z etatu; równomierność jest mierzalna i widoczna, bez progu i bez blokady.

Spotkanie z regułą: planista widzi wskazania w grafiku po wygenerowaniu i po ręcznej poprawce; krytycznego naruszenia nie da się zatwierdzić do czasu poprawienia, ostrzeżenie można zatwierdzić po jawnym potwierdzeniu.

## Non-Goals

- Obsługa wielu firm (rozdzielanie danych i uprawnień per organizacja) — MVP obsługuje jedną organizację; wynika z sondy skali 100×.
- Konfigurowalne reguły czasu pracy per firma lub branża — w MVP stała lista czterech reguł.
- Ewidencja rzeczywistego czasu pracy (rejestracja wejść i wyjść) — narzędzie planuje, nie rejestruje faktycznie przepracowanych godzin.
- Kwalifikacje pracowników w regule — obsada to liczba osób, nie kwalifikacje.
- Ograniczanie kosztów jako cel reguły — w MVP brak danych o koszcie pracy i brak takiego celu.
- Preferencje i dostępność pracowników jako wejście reguły — zgłaszanie to FR-016 (nice-to-have).
- Gwarancja zgodności z przepisami (niefunkcjonalny) — narzędzie ostrzega i wskazuje naruszenia, nie certyfikuje zgodności z prawem; wartości progów wymagają weryfikacji w źródłach prawnych.

## Quality cross-check

Status: accepted (2026-10-13). Wszystkie wymagane elementy są obecne. Luki wymagające działań poza sesją (zob. Open Questions):

- Brak zweryfikowanego, konkretnego przypadku bólu — PRD opiera się na hipotezie; ryzyko zbudowania reguł niepotwierdzonych przez planistę.
- Wartości progów zasad czasu pracy nie zostały ustalone — walidacja nie da się zaimplementować i przetestować bez nich.

## Open Questions

1. **Brak zweryfikowanego, konkretnego przypadku.** — Ból pochodzi z analizy ogólnej; brak rozmowy z osobą, która układała taki grafik w ostatnim miesiącu. Owner: autor.
2. **Wartości progów zasad czasu pracy.** — Dokładne wartości (odpoczynek dobowy, odpoczynek tygodniowy, limit godzin zależny od etatu) trzeba zweryfikować w źródłach prawnych przed implementacją. Owner: autor.

## Resolved during shaping (informational; not part of the PRD schema)

- Termin 4 listopada 2026 a szacunek 6–8 tygodni: termin 6 grudnia 2026 (≈ 7,7 tygodnia od 13.10.2026), praca po godzinach; 4 listopada odrzucony.
- Czy preferencje dni i godzin pracy są w MVP: nie; FR-016 (nice-to-have), poza regułą MVP.
- Skąd biorą się naruszenia przy generowaniu: generator unika naruszeń; naruszenie zostaje, gdy nie da się spełnić wszystkich ograniczeń, lub po ręcznej poprawce.
- FR-005 a FR-006: osobne — urlop wymaga akceptacji, inne nieobecności pracownik tylko zgłasza.
- Jak edytować zatwierdzony grafik: zatwierdzony grafik jest ostateczny; zmiana przez nową wersję (kopię), FR-021.
- Którą wersję widzi pracownik: najnowszą zatwierdzoną wersję danego okresu; starsze wersje widzi tylko planista.
- Czy brak kadrowy blokuje zatwierdzenie: nie; jest ostrzeżeniem — zatwierdzenie po jawnym potwierdzeniu.
- Wartości liczbowe NFR: hasło co najmniej 8 znaków ze znakiem specjalnym, cyfrą i dużą literą; link z zaproszenia ważny 7 dni.
- Przejrzystość interfejsu: każde wskazanie w grafiku (naruszenie, ostrzeżenie, brak kadrowy) ma czytelny powód i miejsce w grafiku.
- Nazwa projektu: Shiftly.
- Given w US-01: potwierdzony przez autora (nieobecności i zapotrzebowanie tak, dostępność nie).
- Pracownik bez konta: wystarcza, że nieobecności wpisuje planista (FR-004); dostępność poza MVP (FR-016).
- Zachowanie dla niezalogowanego: komunikat o braku dostępu, bez automatycznego odesłania do logowania.
- Formularz nowego grafiku: okres grafiku (tydzień od daty początkowej), zmiany obowiązujące w grafiku, pracownicy objęci grafikiem, zapotrzebowanie na zmianę w dniu.
- Definicja zmian: wspólny słownik, definiowany raz i używany w kolejnych grafikach.
- Brakujące liczby: szacunki autora (niezmierzone) — ręczne planowanie 3–8 godzin tygodniowo, typowy zespół 10–30 osób.
