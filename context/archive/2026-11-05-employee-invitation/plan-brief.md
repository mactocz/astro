# Employee invitation — Plan Brief

> Full plan: `context/changes/employee-invitation/plan.md`

## What & Why

Planista Shiftly zaprasza pracownika z listy pracowników, a pracownik z jednorazowego linku ważnego 7 dni ustawia hasło i się loguje; ponowne zaproszenie służy też jako reset hasła. To wycinek S-10 z roadmapy (FR-001, FR-002) i warunek strumienia pracownika (S-11 i dalsze). Plan zawiera świadomą zmianę reguły projektu: klucz service-role staje się sekretem Workera, ale tylko dla jednej trasy zaproszenia.

## Starting Point

Pracownik istnieje w `employees` bez konta (S-01), rola `employee` jest rozpoznawana przez middleware, ale konto pracownika nie ma jak powstać: brak klucza admina w aplikacji, kolumny `user_id`, szablonów maili, trasy powrotu z linku i strony ustawiania hasła. Lokalna konfiguracja Auth ma link ważny 1 godzinę, minimum hasła 6 znaków i adresy nieodpowiadające aplikacji. Dokumentacja zakazuje klucza w Workerze. W repo nie ma wybranego nadawcy poczty ani domeny.

## Desired End State

Planista widzi na liście i w edycji stan konta ("Bez konta", "Zaproszony dd.mm.rrrr (link ważny do ...)") i klika "Zaproś" lub "Wyślij ponownie". Pracownik otwiera link, widzi formularz z regułą hasła z PRD (≥8 znaków, duża litera, cyfra, znak specjalny), ustawia hasło i trafia zalogowany na `/dashboard`. Link jest jednorazowy i ważny 7 dni, a otwarcie go przez skaner poczty niczego nie zużywa. Pracownik czyta tylko własny wiersz w `employees`, a e-mail po powiązaniu konta jest zablokowany.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Uprawnienia admina | Klucz service-role jako sekret Workera, jeden moduł, jedna trasa, reguła ESLint | Wybór autora zamiast Edge Function i skryptu CLI; zmiana reguły w dokumentacji i ograniczenie powierzchni zabezpieczeniami. | Wywiad |
| Link i ważność | Natywny link Supabase z `token_hash`, `otp_expiry = 604800` w `config.toml` i na hoście | Jednorazowość i weryfikację robi GoTrue; Supabase odradza >24 h, więc to ryzyko i punkt kontrolny w planie. | Wywiad |
| Poczta | Lokalnie Mailpit, SMTP produkcji jako krok i bramka wdrożenia | Odblokowuje budowę teraz; kod nie zależy od dostawcy. | Wywiad |
| Powiązanie konta | `employees.user_id` (unikalny, FK), e-mail zablokowany po powiązaniu | Konto i rekord się nie rozjeżdżają; polityka "własny wiersz" działa wprost. | Wywiad |
| Stany zaproszenia | A nowe, B ponowne (stary link nieważny), C reset aktywnego konta, D obce konto odrzucone (409) | Jeden przycisk spełnia FR-001 i FR-002; konta spoza Shiftly nie są przejmowane. | Wywiad |
| Hasło | Reguła PRD tylko w aplikacji (formularz i serwer), Supabase ma minimum 8 | Wybór autora; zaakceptowane ryzyko ustawienia słabszego hasła bezpośrednim wywołaniem API z sesją zaproszenia. | Wywiad |
| Test przepływu | `generate_link` w smoke, bez czytania maili; kontener `mailpit` w CI i tak potrzebny do wysyłki | Wybór autora; CI musi mieć odbiorcę SMTP, żeby zaproszenie nie zwracało błędu. | Wywiad |
| Stan na liście | Z danych `employees` (`user_id`, `invited_at`), bez śledzenia akceptacji | Bez triggera na `auth.users` i bez `SECURITY DEFINER`; etykieta "link wygasł" zamiast "zaproszenie wygasło", bo nie wiadomo, czy hasło ustawiono. | Wywiad, Plan |
| Token | `GET` strony bez `verifyOtp`; `POST` waliduje hasło, potem `verifyOtp` i `updateUser` | Skanery poczty otwierają linki, a złe hasło nie może zużywać tokenu. | Plan |
| Rola | Nadawana osobnym `updateUserById` po `inviteUserByEmail`, z kompensacją `deleteUser` | `inviteUserByEmail` nie przyjmuje `app_metadata`. | Plan |
| Granty | Kolumnowe `insert` i `update` tylko dla pięciu kolumn S-01 | Planista nie może powiązać rekordu z dowolnym kontem przez PostgREST. | Plan |

## Scope

**In scope:** konfiguracja Auth (7 dni, minimum 8, adresy), szablony `invite` i `recovery`, migracja `user_id` i `invited_at` z polityką "własny wiersz" i grantami kolumnowymi, klient admina z regułą ESLint, trasa zaproszenia (A, B, C, D), strona i trasa ustawiania hasła, blokada e-maila, zmiany w `ci.yml`, UI listy i edycji, formularz hasła, dokumentacja ze zmianą reguły i checklistą wdrożenia z bramką SMTP.

**Out of scope:** wybór i konfiguracja dostawcy SMTP i domeny; śledzenie akceptacji (trigger); Edge Functions i własne tokeny; przejmowanie istniejących kont; zmiana e-maila po powiązaniu, usuwanie, blokowanie kont (FR-015); zamykanie publicznego endpointu odzyskiwania hasła; widok pracownika (S-11) i powiadomienia planisty (S-14); czytanie maili w smoke.

## Architecture / Approach

Od środka na zewnątrz: czyste reguły (`password.ts`, `invitation.ts`) w Fazie 1; konfiguracja Auth, szablony i migracja z RLS dowiedzione w smoke w Fazie 2; klient admina, trasa zaproszenia (`POST /api/employees/[id]/invite`) i trasa ustawiania hasła (`POST /api/auth/set-password`) w Fazie 3; UI i dokumentacja w Fazie 4. Przepływ: planista klika "Zaproś" → trasa czyta pracownika sesją planisty (RLS), ustala stan konta kluczem admina, wykonuje decyzję (`invite`, `reinvite`, `reset_password`) → GoTrue wysyła mail z linkiem na `/auth/set-password` → pracownik ustawia hasło → `verifyOtp` i `updateUser` na ciasteczkach → `/dashboard`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Reguły | `validatePassword`, `classifyAuthUser`, `decideInviteAction`, stan zaproszenia, blokada e-maila, testy | Komunikaty i format etykiet wymagają akceptacji autora |
| 2. Konfiguracja Auth i schemat | `config.toml`, szablony, migracja `user_id`, `invited_at`, polityka i granty, smoke bazy | Czy stos przyjmie `otp_expiry = 604800`; zmiana grantów nie może złamać S-01 |
| 3. Serwer | Klient admina, trasy zaproszenia i hasła, ścieżki publiczne, CI z Mailpit, smoke przepływu | Niezweryfikowane zachowanie GoTrue (ponowne zaproszenie, pole potwierdzenia, `generate_link`) |
| 4. UI i dokumentacja | Stan i przycisk na liście, formularz hasła, zmiana reguły w dokumentach, checklista i bramka SMTP | Brak testów komponentów; produkcja zablokowana do czasu SMTP |

**Prerequisites:** F-01 i S-01 zamknięte (są); lokalny Supabase i Docker do `npx supabase db reset`, Mailpit i smoke; dostęp autora do hostowanego projektu i Cloudflare (sekret Workera, `db push`); do wdrożenia produkcyjnego: wybrany i skonfigurowany nadawca SMTP.
**Estimated effort:** około 5 do 6 sesji; ciężej niż S-02 przez model bezpieczeństwa, konfigurację Auth i zależność od poczty.

## Open Risks & Assumptions

- Zmiana reguły z CLAUDE.md: kompromitacja Workera daje pełny dostęp do bazy z pominięciem RLS; ograniczenie to jeden moduł, reguła ESLint, sprawdzenie roli i brak odczytów danych kluczem admina.
- Supabase odradza `otp_expiry` powyżej 24 godzin i dopuszcza dłuższy tylko przez Management API; jeśli stos lub host odrzuci 604800, decyzja wraca do autora (24 h ze zmianą NFR albo własny token).
- Zachowanie GoTrue niezweryfikowane: ponowne zaproszenie niepotwierdzonego użytkownika (nowy link, stary nieważny), pole potwierdzenia konta, `generate_link` typu `invite`; sprawdzane w Fazach 2 i 3.
- Polityka haseł tylko w aplikacji: bezpośrednie wywołanie `updateUser` z sesją zaproszenia może ustawić słabsze hasło niż w PRD; publiczny endpoint odzyskiwania hasła w Supabase pozostaje otwarty (brak samodzielnego resetu to brak UI).
- Bez własnego SMTP produkcja nie wyśle zaproszeń poza członków zespołu organizacji (limit 2 maile na godzinę); wdrożenie S-10 na produkcję jest bramkowane, a S-11 i dalsze wycinki czekają na to samo.
- Podział pracy z S-03: wspólne pliki (`smoke.mjs`, `types.ts`, dokumentacja, kolejność migracji) wymagają rebase przy drugim scaleniu.

## Success Criteria (Summary)

- Planista zaprasza pracownika z e-mailem, pracownik otwiera link, ustawia hasło zgodne z PRD i loguje się na `/dashboard`; ponowne zaproszenie unieważnia stary link, a zaproszenie aktywnego konta wysyła link resetu.
- Pracownik czyta tylko własny wiersz, nie wchodzi na strony planisty, a planista nie ustawi `user_id` ani `invited_at` przez PostgREST; konto spoza Shiftly daje 409.
- Bramka `astro sync`, lint (z regułą modułu admina), `astro check`, testy i build przechodzi, a smoke przechodzi lokalnie i w CI z kontenerem `mailpit`.
