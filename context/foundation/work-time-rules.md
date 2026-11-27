---
title: Reguły czasu pracy w MVP (Polska) — wartości progów i źródła
status: decyzje D1-D6 zaakceptowane przez autora 2026-10-16; wartości z aktów zweryfikowane w tekście (nie jest poradą prawną); decyzja D7 (nieobecności a norma tygodniowa) zaakceptowana przez autora 2026-11-26
researched_at: 2026-10-16
jurisdiction: PL, Kodeks pracy
legal_state: Kodeks pracy, tekst jednolity Dz.U. 2026 poz. 1245 (stan na 2026-08-27); ustawa o dniach wolnych od pracy, tekst jednolity Dz.U. 2025 poz. 296
feeds: roadmap S-05 (live-rule-violations) i S-06 (workload-vs-norm); PRD Open Questions nr 2
---

# Reguły czasu pracy w MVP: wartości progów i źródła

Dokument odpowiada na Otwarte pytanie nr 2 z PRD ("wartości progów zasad czasu pracy") dla czterech reguł MVP:
odpoczynek dobowy, odpoczynek tygodniowy, limit godzin zależny od etatu, kolizja z nieobecnością.
Wartości pochodzą z **tekstu aktów**, nie z opracowań (wyjątek: niepełny etat, zob. niżej). Zestawienie przygotował
asystent AI; zgodnie z PRD narzędzie **ostrzega i nie gwarantuje zgodności z prawem**. Autor zaakceptował decyzje D1 do D6
w proponowanym kształcie (2026-10-16); w razie wątpliwości co do interpretacji warto je potwierdzić u prawnika lub w PIP
przed użyciem produktu przez prawdziwy zespół.

Założenie (D1, zaakceptowane): prawo polskie, podstawowy system czasu pracy (art. 129).

## Wartości progów

| Reguła PRD | Wartość | Przepis | Uwaga dla implementacji |
| --- | --- | --- | --- |
| Odpoczynek dobowy | co najmniej **11 godzin** nieprzerwanego odpoczynku w każdej dobie | art. 132 § 1 | "Doba" to **24 godziny liczone od godziny rozpoczęcia pracy** wg rozkładu (art. 128 § 3 pkt 1), nie doba kalendarzowa. |
| Odpoczynek tygodniowy | co najmniej **35 godzin** nieprzerwanego odpoczynku w każdym tygodniu, w tym co najmniej 11 godzin dobowego | art. 133 § 1 | "Tydzień" to **7 kolejnych dni kalendarzowych od pierwszego dnia okresu rozliczeniowego** (art. 128 § 3 pkt 2), a nie koniecznie poniedziałek do niedzieli. |
| Odpoczynek tygodniowy, praca zmianowa | przy przejściu na inną zmianę wg rozkładu można skrócić do **nie mniej niż 24 godzin** | art. 133 § 2 | Dotyczy dokładnie pracy zmianowej, czyli głównego przypadku Shiftly; trzeba zdefiniować "przejście na inną zmianę". |
| Limit godzin, doba | **8 godzin na dobę** | art. 129 § 1 | Z zastrzeżeniem art. 135 do 138, 143, 144 (inne systemy czasu pracy). Zob. D3. |
| Limit godzin, okres rozliczeniowy | wymiar = **40 h × liczba tygodni** w okresie **+ 8 h × liczba dni pon.–pt. pozostałych** do końca okresu **− 8 h za każde święto** przypadające w dniu innym niż niedziela **− godziny usprawiedliwionej nieobecności** przypadające do przepracowania wg rozkładu | art. 130 § 1 do 3 | Okres rozliczeniowy do **4 miesięcy** (art. 129 § 1), do 12 miesięcy gdy uzasadnione (§ 2). Zob. D2. |
| Limit godzin, twardy pułap | tygodniowy czas pracy łącznie z nadliczbowymi nie może przekraczać przeciętnie **48 godzin** w okresie rozliczeniowym | art. 131 § 1 | Nadliczbowe (art. 151) są poza regułami MVP; pułap 48 h jest granicą bezpieczeństwa. |
| Niepełny etat | norma = norma pełnoetatowa **obniżona proporcjonalnie do wymiaru etatu** | źródło wtórne: biznes.gov.pl | **Kodeks w art. 128 do 152 nie podaje wzoru na godziny** (art. 129 § 5 mówi o proporcji tylko dla wynagrodzenia, art. 151 § 5 odsyła do wymiaru z umowy). Zob. D4. |
| Kolizja z nieobecnością | nie jest progiem ustawowym; to reguła z PRD na danych o nieobecnościach | PRD (US-01) | Przepis wpływa na normę: godziny usprawiedliwionej nieobecności obniżają wymiar (art. 130 § 3). Zob. D7. |

### Brzmienie przepisów (dosłownie, Dz.U. 2026 poz. 1245)

- **Art. 128 § 3.** "Do celów rozliczania czasu pracy pracownika: 1) przez dobę – należy rozumieć 24 kolejne godziny, poczynając od godziny, w której pracownik rozpoczyna pracę zgodnie z obowiązującym go rozkładem czasu pracy; 2) przez tydzień – należy rozumieć 7 kolejnych dni kalendarzowych, poczynając od pierwszego dnia okresu rozliczeniowego."
- **Art. 129 § 1.** "Czas pracy nie może przekraczać 8 godzin na dobę i przeciętnie 40 godzin w przeciętnie pięciodniowym tygodniu pracy w przyjętym okresie rozliczeniowym nieprzekraczającym 4 miesięcy, z zastrzeżeniem art. 135–138, 143 i 144."
- **Art. 130 § 1.** "Obowiązujący pracownika wymiar czasu pracy w przyjętym okresie rozliczeniowym, ustalany zgodnie z art. 129 § 1, oblicza się: 1) mnożąc 40 godzin przez liczbę tygodni przypadających w okresie rozliczeniowym, a następnie 2) dodając do otrzymanej liczby godzin iloczyn 8 godzin i liczby dni pozostałych do końca okresu rozliczeniowego, przypadających od poniedziałku do piątku." **§ 2.** "Każde święto występujące w okresie rozliczeniowym i przypadające w innym dniu niż niedziela obniża wymiar czasu pracy o 8 godzin." **§ 3.** wymiar "ulega w tym okresie obniżeniu o liczbę godzin usprawiedliwionej nieobecności w pracy, przypadających do przepracowania w czasie tej nieobecności, zgodnie z przyjętym rozkładem czasu pracy".
- **Art. 131 § 1.** "Tygodniowy czas pracy łącznie z godzinami nadliczbowymi nie może przekraczać przeciętnie 48 godzin w przyjętym okresie rozliczeniowym."
- **Art. 132 § 1.** "Pracownikowi przysługuje w każdej dobie prawo do co najmniej 11 godzin nieprzerwanego odpoczynku, z zastrzeżeniem § 3 oraz art. 136 § 2 i art. 137." (§ 2: nie dotyczy pracowników zarządzających zakładem w imieniu pracodawcy ani akcji ratowniczej.)
- **Art. 133 § 1.** "Pracownikowi przysługuje w każdym tygodniu prawo do co najmniej 35 godzin nieprzerwanego odpoczynku, obejmującego co najmniej 11 godzin nieprzerwanego odpoczynku dobowego." **§ 2.** "[…] w przypadku zmiany pory wykonywania pracy przez pracownika w związku z jego przejściem na inną zmianę, zgodnie z ustalonym rozkładem czasu pracy, tygodniowy nieprzerwany odpoczynek może obejmować mniejszą liczbę godzin, nie może być jednak krótszy niż 24 godziny." **§ 3.** odpoczynek "powinien przypadać w niedzielę" (24 godziny od 6:00, chyba że pracodawca ustalił inną godzinę); **§ 4.** przy dozwolonej pracy w niedzielę może przypadać w innym dniu.
- **Art. 151[10] pkt 3.** Praca w niedziele i święta jest dozwolona "przy pracy zmianowej" (a art. 151[11] wymaga wtedy innego dnia wolnego).

### Dni wolne (wejście do obliczenia wymiaru)

Art. 1 ustawy o dniach wolnych od pracy (Dz.U. 2025 poz. 296): 1 stycznia, 6 stycznia, pierwszy i drugi dzień Wielkiej Nocy,
1 maja, 3 maja, pierwszy dzień Zielonych Świątek, Boże Ciało, 15 sierpnia, 1 listopada, 11 listopada, **24 grudnia (od 2025 r.)**,
25 i 26 grudnia, oraz niedziele. Święta ruchome wynikają z daty Wielkanocy (Wielkanoc 2026: 5 kwietnia; Zielone Świątki 24 maja;
Boże Ciało 4 czerwca). Dla art. 130 § 2 liczą się tylko święta w dniu innym niż niedziela.

## Przypadki testowe do F-02 i S-05 (obliczone, do potwierdzenia przez autora)

Wymiar czasu pracy, pełny etat, okres rozliczeniowy = miesiąc kalendarzowy (założenie D2):

| Okres | Pełne tygodnie | Dni pon.–pt. na końcu | Święta w dni inne niż niedziela | Wymiar pełny | Wymiar 1/2 etatu (D4) |
| --- | --- | --- | --- | --- | --- |
| marzec 2026 (31 dni) | 4 | 2 (30 i 31.03) | 0 | **176 h** | 88 h |
| kwiecień 2026 (30 dni) | 4 | 2 (29 i 30.04) | 1 (6.04, drugi dzień Wielkiej Nocy) | **168 h** | 84 h |
| październik 2026 (31 dni) | 4 | 2 (29 i 30.10) | 0 | **176 h** | 88 h |

Przykład marcowy (176 h) zgadza się z przykładem na portalu biznes.gov.pl; pozostałe wiersze policzyłem według art. 130.

Odpoczynek dobowy (art. 132 § 1): koniec pracy 22:00, następny początek 06:00 = 8 h przerwy, **krytyczne naruszenie**;
koniec 22:00, początek 09:00 = 11 h, **zgodne** (próg włącznie: "co najmniej 11 godzin").
Odpoczynek tygodniowy (art. 133): brak nieprzerwanej przerwy 35 h w tygodniu = **krytyczne naruszenie**, a przy przejściu na inną zmianę
próg spada do 24 h. Dokładną interpretację "doby" przy przechodzeniu przez północ potwierdź na własnych przykładach (zob. D3).

## Co z tego wynika dla projektu

1. **Doba i tydzień zależą od rozkładu i okresu rozliczeniowego**, więc model musi znać godzinę rozpoczęcia pracy pracownika i początek okresu rozliczeniowego, a nie tylko dni kalendarzowe.
2. **Pułapka dla zmian dłuższych niż 8 godzin.** Przy limicie 8 godzin na dobę zmiany 12-godzinne (częste w pracy zmianowej) wyjdą jako naruszenie, chyba że obowiązuje system równoważny (art. 135: do 12 godzin, okres rozliczeniowy do 1 miesiąca, a w uzasadnionych przypadkach do 3 lub 4). Systemy z art. 135 do 138 są poza regułami MVP (PRD: stała lista czterech reguł).
3. **Rozkład czasu pracy ma wymagania formalne** (art. 129 § 3, w brzmieniu zmienionym ustawą z 4.12.2025, w mocy od 27.01.2026, Dz.U. 2026 poz. 25): rozkład sporządzony na okres krótszy niż okres rozliczeniowy obejmuje **co najmniej 1 miesiąc**, może być papierowy lub elektroniczny, a pracodawca przekazuje go pracownikowi **co najmniej na 1 tydzień przed** rozpoczęciem pracy w tym okresie. Art. 129 § 4 wymienia przypadki, gdy rozkładu sporządzać nie trzeba. PRD planuje grafiki **tygodniowe** (FR-008, FR-009): nie przesądzam, czy to sprzeczność, ale warto to skonsultować (D6).
## Decyzje (zaakceptowane przez autora 2026-10-16)

Autor zaakceptował wszystkie sześć propozycji bez zmian.

| # | Pytanie | Decyzja | Dotyczy |
| --- | --- | --- | --- |
| D1 | Czy MVP zakłada prawo polskie i podstawowy system czasu pracy (art. 129)? | tak | S-05, S-06 |
| D2 | Jaki jest okres rozliczeniowy w MVP i kiedy się zaczyna (od tego zależy "tydzień" i wymiar)? | jeden stały okres: miesiąc kalendarzowy | S-05, S-06 |
| D3 | Czy limit **8 godzin na dobę** wchodzi do reguły "limit godzin"? | tak, z wyraźnym komunikatem, że systemy równoważne nie są obsługiwane | S-05 |
| D4 | Czy niepełny etat to norma pełnoetatowa × ułamek etatu? (Kodeks nie podaje wzoru; źródło wtórne: biznes.gov.pl) | tak, proporcjonalnie; proporcja w jednym miejscu kodu, łatwym do poprawki | S-06 |
| D5 | Skąd wziąć kalendarz świąt do wymiaru? | wyliczać z art. 1 ustawy o dniach wolnych od pracy (w tym święta ruchome) | S-06 |
| D6 | Jak potraktować wymóg rozkładu na co najmniej miesiąc i przekazania z tygodniowym wyprzedzeniem (art. 129 § 3) względem grafików tygodniowych? | grafik tygodniowy zostaje; UI i dokumentacja ostrzegają, że nie zastępuje formalnego rozkładu | S-03, S-05 |
| D7 | Czy zatwierdzona nieobecność obniża normę tygodniową i o ile? | tak: o 8 h × etat za każdy odrębny dzień od poniedziałku do piątku niebędący świętem, który obejmuje zatwierdzona nieobecność; wniosek (`requested`) i odrzucona (`rejected`) niczego nie obniżają; dolne ograniczenie 0; święta nie są odejmowane drugi raz (zob. niżej) | S-07 |

Skutek w roadmapie: `S-05` i `S-06` zmieniły status z `blocked` na `proposed`; pytanie nr 2 z PRD jest rozwiązane.

Pozostałe niewiadome, które ten dokument ujawnił, a nie rozstrzygnął (każda bez blokady planowania):
interpretacja doby przy zmianach przechodzących przez północ (S-05) oraz zestawianie grafiku tygodniowego z miesięcznym okresem
rozliczeniowym, gdy tydzień obejmuje dwa miesiące (S-06).

### D7: nieobecności a norma tygodniowa (dopisana przy S-07)

D7 dopisano po D1-D6 przy zmianie `absence-entry` (roadmapa S-07). Autor zaakceptował ją 2026-11-26: w wywiadzie planistycznym i w przeglądzie Fazy 1, razem z wektorami normy. To nie jest porada prawna; narzędzie ostrzega i nie gwarantuje zgodności z prawem, a interpretację art. 130 § 3 warto potwierdzić u prawnika lub w PIP (jak D1-D6).

Pytanie: czy zatwierdzona nieobecność obniża normę tygodniową i o ile?

Przepis. Art. 130 § 3 obniża wymiar czasu pracy o liczbę godzin usprawiedliwionej nieobecności "przypadających do przepracowania w czasie tej nieobecności, zgodnie z przyjętym rozkładem czasu pracy" (brzmienie dosłowne wyżej). Dzień nieobecności w rozkładzie czasu pracy obniża więc wymiar o godziny pracy przypadające na ten dzień. Grafik tygodniowy Shiftly nie zna rozkładu z dnia, w którym pracownik jest nieobecny (nikt nie przypisuje wtedy zmiany), więc nie ma skąd wziąć "godzin przypadających do przepracowania". Narzędzie przyjmuje, że godzin pracy takiego dnia jest 8 × etat. To jest interpretacja art. 130 § 3, a nie jego brzmienie.

Decyzja:

- zatwierdzona nieobecność (status `approved`; każdy rodzaj: urlop, zwolnienie lekarskie L4, inna nieobecność) obniża normę tygodniową o 8 h × etat za każdy odrębny dzień spośród siedmiu dni grafiku, który przypada od poniedziałku do piątku, nie jest świętem i jest objęty taką nieobecnością;
- kilka nieobecności w jednym dniu liczy się raz, sobota i niedziela niczego nie obniżają, a dzień, który obniżyło już święto (art. 130 § 2), nie obniża normy drugi raz;
- nieobecność niezatwierdzona (`requested`) i odrzucona (`rejected`) normy nie obniża;
- norma nie spada poniżej 0 (wtedy każda praca w tygodniu jest ponad normą);
- to samo liczenie zasila ostrzeżenie `weekly_norm` (S-05) i kolumnę "Godziny" (S-06), więc nigdy nie pokazują dwóch norm dla jednego tygodnia.

Przykłady (pełny etat): tydzień od poniedziałku 02.11.2026 bez świąt i urlop od wtorku 03.11 do czwartku 05.11 dają 40 h minus 3 × 8 h = 16 h. Tydzień od wtorku 10.11.2026 ze świętem w środę 11.11 i urlop od wtorku 10.11 do piątku 13.11 dają 40 h minus 8 h (święto) minus 3 × 8 h (wtorek, czwartek i piątek; środa jest świętem i nie liczy się drugi raz) = 8 h. Dla 1/2 etatu obie wartości są proporcjonalnie mniejsze (8 h i 4 h).

D7 dotyczy tylko normy tygodniowej grafiku, liczonej jak w S-05 i S-06 (40 h × etat, 8 h × etat za święto w siedmiu dniach grafiku); nie rozstrzyga zestawiania grafiku tygodniowego z miesięcznym okresem rozliczeniowym (D2) i nie zmienia limitów krytycznych (odpoczynek dobowy i tygodniowy, 8 h na dobę, 48 h w tygodniu). Kolizja zmiany z nieobecnością (reguły `absence` i `absence_requested`) nie wynika z D7 ani z progu ustawowego, tylko z PRD (US-01): zatwierdzona jest krytyczna, niezatwierdzona to ostrzeżenie, odrzucona jest pomijana.

## Źródła

- Kodeks pracy, tekst jednolity, Dz.U. 2026 poz. 1245 (obwieszczenie Marszałka Sejmu z 1 września 2026 r., stan na 27 sierpnia 2026 r.): https://api.sejm.gov.pl/eli/acts/DU/2026/1245/text/T/D20261245L.pdf (art. 128 do 133, 151, 151[10]; przypis 16: ustawa z 4 grudnia 2025 r., Dz.U. 2026 poz. 25, w mocy od 27 stycznia 2026 r.).
- Ustawa o dniach wolnych od pracy, tekst jednolity, Dz.U. 2025 poz. 296 (art. 1, z dodaną Wigilią od 1 lutego 2025 r.): https://api.sejm.gov.pl/eli/acts/DU/2025/296/text.pdf
- Portal biznes.gov.pl, "Jak ustalać i rozliczać czas pracy" (źródło wtórne: wzór wymiaru i zasada proporcji dla niepełnego etatu; publikacja 27.06.2021): https://www.biznes.gov.pl/pl/portal/00133
- Państwowa Inspekcja Pracy o wolnej Wigilii od 2025 r.: https://www.pip.gov.pl/dla-pracodawcow/pytania-i-odpowiedzi/czy-od-2025-roku-wigilia-jest-dniem-wolnym-od-pracy-i-czy-pracodawca-moze-polecic-mi-prace-we-wszystkie-niedziele-handlowe-w-grudniu
