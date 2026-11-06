# Employee invitation Implementation Plan

## Overview

Czwarty wycinek domenowy Shiftly (S-10 z roadmapy, FR-001, FR-002): planista zaprasza pracownika z listy pracowników, a pracownik z jednorazowego linku ważnego 7 dni ustawia hasło i się loguje. Pracownik istnieje w `employees` bez konta (S-01); zaproszenie tworzy konto z rolą `employee`, wiąże je z rekordem kolumną `user_id` i wysyła mail. Ponowne zaproszenie działa też jako reset hasła (FR-002: brak samodzielnego resetu). Plan zawiera świadomą zmianę reguły projektu: klucz service-role staje się sekretem Workera, używanym wyłącznie przez trasę zaproszenia (decyzja autora z wywiadu). Poczta: kod jest niezależny od dostawcy SMTP, a konfiguracja własnego nadawcy jest bramką wdrożenia na produkcję, nie częścią tego planu.

## Current State Analysis

- Auth: jedyny klient to `createServerClient` na ciasteczkach (`src/lib/supabase.ts:5-21`), jeden na żądanie w `locals.supabase`; rola tylko z `app_metadata.role` (`src/middleware.ts:19`); bramka `decideAccess` (`src/lib/services/access.ts`) dopasowuje ścieżki dokładnie, bez prefiksów, a nieznana ścieżka jest tylko dla planisty. Rola `employee` istnieje (`src/types.ts:1`), ale wchodzi tylko na ścieżki publiczne i `/dashboard`. Test publicznych ścieżek: `access.test.ts:38`. Logowanie: `src/pages/api/auth/signin.ts` (po sukcesie redirect `/`), formularz `src/components/auth/SignInForm.tsx`.
- Brakuje: trasy powrotu z linku, strony ustawiania hasła, klienta admina i klucza service-role w aplikacji, szablonów maili, kolumny `user_id` w `employees`, polityki "własny wiersz" (wzorzec czeka w `role_helpers.sql:51-54`, komentarz w `employees.sql:43`: "arrives together with the user_id column in S-10 and S-11"). `employees.email` jest nullable, znormalizowany (`lower(btrim)`, ≤254) i unikalny (`employees_email_key`, `employees.sql:10,20-23`). `employees.ts` mapuje każdy błąd 23505 na `email_taken` (`:54-59`), `updateEmployee` pozwala zmienić e-mail (`:94-108`).
- Konfiguracja `supabase/config.toml` (lokalna): `site_url = "http://127.0.0.1:3000"` i `additional_redirect_urls` nie pasują do aplikacji na porcie 4321; `enable_signup = false`; `minimum_password_length = 6`; `[auth.email] otp_expiry = 3600` (PRD wymaga 7 dni), `enable_confirmations = false`; `[auth.rate_limit] email_sent = 2` ("Requires auth.email.smtp"); szablony i `[auth.email.smtp]` zakomentowane, katalogu `supabase/templates` nie ma. Poczta lokalna to `[local_smtp]` (UI na 54324).
- CI (`.github/workflows/ci.yml:42-56`) startuje Supabase z `-x mailpit,edge-runtime,...`, więc lokalny GoTrue nie ma dokąd wysłać maila (wysyłka zaproszenia zwróci błąd), a `.env` i `.dev.vars` w jobie `smoke` dostają tylko URL i klucz anon; klucz service-role trafia wyłącznie do polecenia `npm run smoke`.
- Skrypty: `scripts/create-planner.mjs:40-42` zawiera regułę hasła z PRD (≥8, duża litera, cyfra, znak specjalny) i wywołania API admina (`:71-90`); `scripts/smoke.mjs` ma strażnika lokalnego hosta (`:23-40`), `createAccount` przez API admina (`:86-106`), aktorów `anonymous`, `noRole`, `employee`, `planner` (`:217-220`).
- Dokumentacja zakazuje klucza service-role w Workerze (`CLAUDE.md`, `README.md:148`, `AGENTS.md:23`, `deploy-plan.md:51`), a archiwalny plan F-01 (`context/archive/2026-10-20-role-based-access/plan.md:34,43`) zakłada jednocześnie, że admin API posłuży S-10: tych dwóch zapisów nie da się pogodzić. Autor wybrał zmianę reguły (zob. "Key Discoveries").
- Fakty z dokumentacji Supabase (sprawdzone w sieci 2026-11-06): `otp_expiry` obejmuje też linki zaproszeń i odzyskiwania hasła; dokumentacja odradza wartości powyżej 86 400 s i mówi, że dłuższy czas można ustawić tylko przez Management API; domyślny SMTP wysyła wyłącznie do członków zespołu organizacji (limit 2 maile na godzinę), własny SMTP startuje z limitem 30 na godzinę; lokalnie maile trafiają do Mailpit. Niezweryfikowane (do sprawdzenia w Fazach 2 i 3): czy lokalny stos i hostowany projekt przyjmą `otp_expiry = 604800`, czy ponowne `inviteUserByEmail` dla niepotwierdzonego użytkownika wysyła nowy link i unieważnia stary, które pole (`email_confirmed_at` czy `confirmed_at`) wskazuje potwierdzone konto, czy `generateLink` typu `invite` działa dla istniejącego niepotwierdzonego użytkownika.
- Równolegle powstaje plan S-03 (`weekly-schedule-draft`); styk: `scripts/smoke.mjs`, `src/types.ts`, `access.test.ts`, dokumentacja (zob. "Parallel Work Notes").

## Desired End State

- Planista na `/employees` i w edycji pracownika widzi stan konta: "Bez konta", "Zaproszony dd.mm.rrrr (link ważny do dd.mm.rrrr)" albo "... (link wygasł dd.mm.rrrr)", oraz przycisk "Zaproś" (brak konta) lub "Wyślij ponownie" (konto istnieje). Bez e-maila przycisk jest nieaktywny z podpowiedzią. Po zaproszeniu e-mail pracownika jest tylko do odczytu.
- Zaproszenie: nowy pracownik dostaje mail z linkiem `/auth/set-password?token_hash=...&type=invite`; ponowne zaproszenie przed ustawieniem hasła wysyła nowy link, a poprzedni przestaje działać; zaproszenie aktywnego konta wysyła link resetu (`type=recovery`) na tę samą stronę; konto spoza Shiftly o tym e-mailu (np. z okresu otwartej rejestracji) daje odmowę 409 z komunikatem.
- Pracownik otwiera link: strona pokazuje formularz hasła (otwarcie linku niczego nie zużywa, więc skanery poczty nie palą tokenu), reguła hasła z PRD jest sprawdzana na żywo i na serwerze przed zużyciem tokenu; po poprawnym ustawieniu hasła jest zalogowany i trafia na `/dashboard`. Link jest jednorazowy i ważny 7 dni.
- Rola `employee` jest nadawana przy zaproszeniu; pracownik z kontem czyta z `employees` wyłącznie własny wiersz i nie może go zmienić; kolumn `user_id` i `invited_at` planista nie może ustawić przez API ani PostgREST.
- Klucz service-role jest sekretem Workera, importowanym wyłącznie przez trasę zaproszenia (reguła ESLint), a dokumentacja opisuje nową zasadę i checklistę wdrożenia, w tym bramkę SMTP.
- Weryfikacja: `npx astro sync && npm run lint && npx astro check && npm test && npm run build` przechodzi, a smoke z nowymi krokami (baza, zaproszenie przez API, ustawianie hasła przez token z `generateLink`, logowanie, odmowy) przechodzi lokalnie i w CI.

### Key Discoveries:

- **Decyzja o kluczu service-role** (wywiad, 2026-11-06): autor wybrał klucz jako sekret Workera zamiast Edge Function i zamiast skryptu CLI. Plan to ogranicza: jeden moduł (`src/lib/supabase-admin.ts`), jedna trasa, reguła ESLint zakazująca importu gdzie indziej, sprawdzenie roli planisty i istnienia pracownika przez klienta sesji przed użyciem klucza, brak odczytów danych kluczem admina. Skutek uboczny: `CLAUDE.md`, `README.md`, `AGENTS.md`, `deploy-plan.md` i `.env.example` muszą zostać zmienione (Faza 4), a lokalny `.dev.vars` zawiera teraz klucz lokalnego stosu.
- Token ma być zużyty dopiero przez POST, który najpierw waliduje hasło: skanery poczty (np. odnośniki sprawdzane przez klienty pocztowe) otwierają linki GET i zużywają jednorazowe tokeny, a złe hasło nie może palić tokenu. Stąd strona `GET /auth/set-password` (bez `verifyOtp`) i `POST /api/auth/set-password` (walidacja hasła, `verifyOtp`, `updateUser`).
- `inviteUserByEmail` przyjmuje tylko `data` (`user_metadata`) i `redirectTo`, bez `app_metadata`, więc rola wymaga osobnego wywołania `updateUserById`; to tworzy krótkie okno między wysłaniem maila a nadaniem roli, a błąd w środku wymaga kompensacji (`deleteUser`).
- Kolumny `user_id` i `invited_at` muszą być niedostępne do zapisu dla `authenticated` (granty kolumnowe), inaczej planista mógłby powiązać rekord z dowolnym kontem. To usuwa też pułapkę mapowania 23505 w `employees.ts`: unikalność `user_id` nie może być złamana przez sesję planisty.
- Reset przez ponowne zaproszenie nie zamyka publicznego endpointu odzyskiwania hasła w Supabase (`/auth/v1/recover`): brak samodzielnego resetu to brak UI, nie blokada serwera. Link trafia wyłącznie do właściciela skrzynki. Zaakceptowane ryzyko.
- Polityka haseł jest egzekwowana tylko w aplikacji (decyzja autora): sesja zaproszenia mogłaby wywołać `updateUser` bezpośrednio i ustawić słabsze hasło niż wymaga PRD; Supabase ma jedynie minimum 8 znaków. Zaakceptowane ryzyko.
- Wysyłka zaproszenia wymaga działającego odbiorcy SMTP także w CI: nawet bez czytania maili kontener `mailpit` musi działać w jobie `smoke`, więc zmiana listy `-x` w `ci.yml` jest konieczna, choć smoke nie odczytuje poczty (decyzja autora: link z `generateLink`).
- Etykieta "Zaproszenie wygasło" z wywiadu zastąpiona neutralnym "(link wygasł dd.mm.rrrr)": akceptacja linku nie jest śledzona, więc po 7 dniach nie wiadomo, czy pracownik ustawił hasło, czy nie; zdanie o samym linku jest prawdziwe w obu przypadkach.

## What We're NOT Doing

- Wyboru i konfiguracji dostawcy SMTP, domeny i SPF/DKIM: to krok wdrożenia i bramka produkcyjna (Faza 4, checklista). Domyślny SMTP Supabase wysyła tylko do członków zespołu i ma limit 2 maile na godzinę, więc produkcyjnego przepływu nie da się pokazać, dopóki nadawca nie jest ustawiony; S-11 i dalsze wycinki na produkcji czekają na to samo.
- Śledzenia akceptacji zaproszenia (trigger na `auth.users`, stan "Konto aktywne"): planista dowiaduje się, że konto jest aktywne, dopiero gdy ponowne zaproszenie wysyła link resetu. Żadnych funkcji `SECURITY DEFINER` ani triggerów na schemacie `auth`.
- Edge Functions, własnych tokenów zaproszeń i tabeli zaproszeń.
- Przejmowania istniejących kont bez roli (przypadek D): odmowa 409; planista albo usuwa konto w panelu Supabase, albo używa innego adresu.
- Zmiany e-maila po powiązaniu konta, usuwania, dezaktywowania i blokowania kont (FR-015 zaparkowane).
- Zamykania publicznego endpointu odzyskiwania hasła w Supabase i egzekwowania polityki haseł po stronie Supabase (zaakceptowane ryzyka, zob. wyżej).
- Powiadomień planisty o wnioskach urlopowych (S-14), widoku pracownika (S-11): S-10 kończy się logowaniem i `/dashboard`.
- Czytania maili w smoke, testów e2e w przeglądarce i testów jednostkowych modułu admina (importuje `astro:env/server`, który nie rozwiązuje się w testach); logika decyzyjna jest w czystych funkcjach.
- Zmiany logowania (`signin.ts`) i bramki dostępu poza dopisaniem dwóch ścieżek publicznych.
- Sprzątania nieaktualnych zapisów w `deploy-plan.md`, które nie dotyczą zaproszeń.

## Implementation Approach

Od środka na zewnątrz: czyste reguły (Faza 1), konfiguracja Auth i schemat z RLS dowiedziony na tokenach (Faza 2), serwer: klient admina, trasa zaproszenia i trasa ustawiania hasła, dowiedzione w smoke (Faza 3), UI i dokumentacja ze zmianą reguły (Faza 4). Fazy 2 i 3 zawierają krótkie sprawdzenia niezweryfikowanych założeń Supabase (zob. "Current State Analysis"): jeśli któreś nie zadziała, faza zatrzymuje się i wraca do autora z konkretną alternatywą, nie wymyśla obejścia. Najważniejszy przypadek: jeśli lokalny stos lub Management API odrzucą `otp_expiry = 604800`, wybór wraca do autora (24 godziny z zmianą NFR w PRD albo własny token).

Zaproszenie ma jedną ścieżkę decyzyjną w czystej funkcji (`decideInviteAction` z `classifyAuthUser`), a trasa tylko wykonuje wynik. Stan konta ustala się na serwerze za każdym razem z `employees.user_id` i użytkownika Auth, nie z `invited_at`. Trasa: pracownik czytany klientem sesji (RLS), e-mail wymagany, klient admina tylko do `getUserById`, `inviteUserByEmail`, `updateUserById`, `deleteUser` i zapisu `user_id` i `invited_at`. Reset aktywnego konta idzie przez `resetPasswordForEmail` klienta sesji.

## Critical Implementation Details

- **Kolejność w trasie zaproszenia (stan A)**: `inviteUserByEmail`, potem `updateUserById` z rolą, potem zapis `user_id` i `invited_at`; błąd w drugim lub trzecim kroku wywołuje `deleteUser` (najlepszym wysiłkiem, z logiem) i zwraca 500. Mail wychodzi w kroku pierwszym, więc link bez nadanej roli istnieje przez ułamek sekundy; użytkownik bez roli i tak dostaje odmowę na `/dashboard`.
- **Kolejność w trasie ustawiania hasła**: walidacja hasła przed `verifyOtp` (zły format nie zużywa tokenu), `verifyOtp`, `updateUser({ password })`. Błąd `updateUser` po udanym `verifyOtp` zużywa link: odpowiedź mówi, żeby poprosić planistę o nowe zaproszenie.
- **Granty kolumnowe**: `revoke insert, update` na tabeli i `grant insert (...)`, `grant update (...)` tylko dla pięciu kolumn S-01; `select` zostaje tabelowy. Dotychczasowe kroki smoke S-01 muszą nadal przechodzić.
- **Strona linku**: `Cache-Control: no-store` i `Referrer-Policy: no-referrer` (token jest w adresie).

## Phase 1: Reguły

### Overview

Dodać typy i czyste funkcje: walidację hasła, klasyfikację konta Auth, decyzję zaproszenia, stan zaproszenia na liście i regułę blokady e-maila, wraz z testami. Żadne zachowanie aplikacji się jeszcze nie zmienia.

### Changes Required:

#### 1. Typy

**File**: `src/types.ts`

**Intent**: Rozszerzyć `Employee` o powiązanie z kontem i dodać typy zaproszenia (plik jest też zmieniany przez S-03; dopisywać zmiany lokalnie, bez przesuwania istniejących definicji).

**Contract**: `Employee` dostaje pola tylko do odczytu `userId: string | null` i `invitedAt: string | null` (ISO); `EmployeeInput` bez zmian. `InviteAccountState = "none" | "pending" | "active"`; `InviteAction = "invite" | "reinvite" | "reset_password"`; `InviteStatus = { kind: "no_account" } | { kind: "invited"; invitedAt: string; validUntil: string; expired: boolean }`; `InviteResult = "invited" | "reinvited" | "password_reset"`; `PasswordCheck { minLength: boolean; upper: boolean; digit: boolean; special: boolean; maxLength: boolean }`.

#### 2. Reguła hasła

**File**: `src/lib/services/password.ts` (nowy)

**Intent**: Jedno źródło prawdy o haśle z PRD dla formularza i trasy (wzorzec: `scripts/create-planner.mjs:40-42`, który zostaje osobną kopią w skrypcie).

**Contract**: `checkPassword(raw: unknown): PasswordCheck` i `validatePassword(raw: unknown): { ok: true } | { ok: false; error: string }`. Reguła: co najmniej 8 znaków (punkty kodowe), co najmniej jedna duża litera (`\p{Lu}`), cyfra (`\d`), znak specjalny (znak spoza `[\p{L}\p{N}\s]`), najwyżej 72 znaki (limit bcrypt/GoTrue); białe znaki nie liczą się jako znak specjalny; niebędące ciągiem wejście jest odrzucone. Pierwszy niespełniony warunek daje jeden komunikat po polsku. Brak wymogu małej litery.

#### 3. Zaproszenie

**File**: `src/lib/services/invitation.ts` (nowy)

**Intent**: Czysta logika decyzji zaproszenia i prezentacji stanu, bez importów `astro:*`, `cloudflare:workers` i Supabase.

**Contract**: `INVITE_VALIDITY_DAYS = 7`. `classifyAuthUser(user: { email_confirmed_at?: string | null; confirmed_at?: string | null } | null): InviteAccountState`: `null` to `none`, potwierdzone (któreś z pól niepuste) to `active`, w przeciwnym razie `pending`. `decideInviteAction(state): InviteAction`: `none` to `invite`, `pending` to `reinvite`, `active` to `reset_password`. `inviteStatus(employee: { userId: string | null; invitedAt: string | null }, now: Date): InviteStatus` (czas wstrzyknięty, wynik deterministyczny; `validUntil` to `invitedAt` plus 7 dni, `expired` gdy `now` jest po nim; brak `userId` albo `invitedAt` to `no_account`). `formatInviteLabel(status): string`: `Bez konta`, `Zaproszony 06.11.2026 (link ważny do 13.11.2026)`, `Zaproszony 06.11.2026 (link wygasł 13.11.2026)` (daty w strefie UTC, żeby były powtarzalne). `emailChangeBlocked(existing: { userId: string | null; email: string | null }, nextEmail: string | null): boolean`: `true`, gdy `userId` jest ustawione, a znormalizowany (przycięty, małe litery) następny e-mail różni się od obecnego.

#### 4. Testy

**File**: `src/lib/services/password.test.ts`, `src/lib/services/invitation.test.ts` (nowe)

**Intent**: Udowodnić granice reguły hasła, tabelę decyzji i prezentację stanu oraz powtarzalność.

**Contract**: Hasło: `Abcdef1!` (8 znaków) przyjęte; `Abcde1!` (7) odrzucone; brak dużej litery, cyfry, znaku specjalnego po jednym przypadku odrzuconym; `Żółw123!` przyjęte (Unicode); spacja jako jedyny znak specjalny odrzucona; 72 znaki przyjęte, 73 odrzucone; `null`, liczba, pusty ciąg odrzucone; `checkPassword` zwraca wszystkie flagi niezależnie; tabela przypadków z `it.each`. Zaproszenie: `classifyAuthUser` dla `null`, obu pól puste, `email_confirmed_at` ustawione, tylko `confirmed_at` ustawione; `decideInviteAction` dla trzech stanów; `inviteStatus`: brak konta, ważne (dzień 3), granica (dokładnie 7 dni po zaproszeniu: ważne), wygasłe (7 dni plus 1 s), `userId` bez `invitedAt`; `formatInviteLabel` trzy warianty; `emailChangeBlocked`: bez konta zawsze `false`, z kontem ten sam e-mail w innej wielkości liter `false`, inny e-mail `true`, zmiana z e-maila na `null` `true`. `expectDeterministic` na `checkPassword`, `inviteStatus` (ten sam `now`) i `decideInviteAction`.

### Success Criteria:

#### Automated Verification:

- Testy reguł hasła i zaproszenia przechodzą w workerd: `npm test`
- Linting przechodzi: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`

#### Manual Verification:

- Komunikaty hasła po polsku, format etykiet stanu zaproszenia (w tym neutralne "link wygasł") i tabela decyzji zostały przejrzane i zatwierdzone przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Konfiguracja Auth i schemat

### Overview

Dostosować lokalną konfigurację Auth do PRD (7 dni, minimum 8 znaków, adresy aplikacji), dodać szablony maili `invite` i `recovery` z linkiem na stronę aplikacji, dodać migrację z `user_id`, `invited_at`, polityką "własny wiersz" i grantami kolumnowymi, i dowieść tego w smoke przez PostgREST. Faza zawiera sprawdzenie, czy lokalny stos przyjmuje `otp_expiry = 604800`.

### Changes Required:

#### 1. Konfiguracja Auth

**File**: `supabase/config.toml`

**Intent**: Doprowadzić lokalny Auth do wymagań PRD i do adresów aplikacji.

**Contract**: `[auth]`: `site_url = "http://localhost:4321"`, `additional_redirect_urls` z `http://localhost:4321/**` (zamiast `127.0.0.1:3000`), `minimum_password_length = 8`; `password_requirements` bez zmian (pusty: skład sprawdza aplikacja). `[auth.email]`: `otp_expiry = 604800`. `[auth.rate_limit]`: `email_sent = 30` (obowiązuje z własnym SMTP; zapas dla smoke). Odkomentowane sekcje `[auth.email.template.invite]` i `[auth.email.template.recovery]` z polem `subject` po polsku i `content_path` na pliki szablonów. Po zmianie restart: `npx supabase stop && npx supabase start`. Sprawdzenie założenia: stos startuje z `otp_expiry = 604800`; jeśli odrzuca wartość, faza zatrzymuje się i wraca do autora (zob. Implementation Approach).

#### 2. Szablony maili

**File**: `supabase/templates/invite.html`, `supabase/templates/recovery.html` (nowe)

**Intent**: Maile po polsku z linkiem do strony aplikacji zamiast domyślnego linku Supabase (który zwraca tokeny we fragmencie adresu, nieczytelnym po stronie serwera).

**Contract**: Link w `invite.html`: `{{ .SiteURL }}/auth/set-password?token_hash={{ .TokenHash }}&type=invite`; w `recovery.html`: `.../auth/set-password?token_hash={{ .TokenHash }}&type=recovery`. Treść: kto zaprasza (bez danych osobowych poza adresem e-mail odbiorcy), że link jest jednorazowy i ważny 7 dni, że po jego wygaśnięciu trzeba poprosić planistę o nowe zaproszenie. Bez zewnętrznych obrazów i skryptów.

#### 3. Migracja

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_employee_accounts.sql` (nowy; utworzyć poleceniem `npx supabase migration new employee_accounts` w chwili implementacji, tak by znacznik był późniejszy niż istniejące migracje i migracja S-03)

**Intent**: Powiązać rekord pracownika z kontem Auth, utrwalić moment ostatniego zaproszenia i dać pracownikowi odczyt własnego wiersza, bez możliwości zapisu tych kolumn przez sesję planisty.

**Contract**: `alter table public.employees add column user_id uuid unique references auth.users (id) on delete set null, add column invited_at timestamptz;`. Polityka `employee can select own employee row` dla `authenticated`: `using ((select public.current_app_role()) = 'employee' and user_id = (select auth.uid()))` (wzorzec `role_helpers.sql:51-54`). Granty kolumnowe: `revoke insert, update on table public.employees from authenticated;` i `grant insert (first_name, last_name, email, fte_numerator, fte_denominator), update (first_name, last_name, email, fte_numerator, fte_denominator) on table public.employees to authenticated;` z komentarzem `-- non-obvious:` (tylko service-role zapisuje `user_id` i `invited_at`; `select` pozostaje tabelowy). Uaktualniony komentarz końcowy zastępuje zapowiedź z `employees.sql:43`.

#### 4. Smoke: baza

**File**: `scripts/smoke.mjs`

**Intent**: Udowodnić na tokenach, że polityka "własny wiersz" izoluje dane, a granty kolumnowe nie pozwalają planiście zapisać `user_id` i `invited_at`, i że dotychczasowe kroki pracowników nadal przechodzą.

**Contract**: Kroki w regionie bazy: pracownik z kontem `employee` powiązanym z wierszem (wiersz tworzy planista, `user_id` ustawia service-role przez PATCH) czyta dokładnie jeden wiersz, własny; nie widzi wierszy innych pracowników; PATCH własnego wiersza nie zmienia go (potwierdza odczyt planisty); INSERT odrzucony. Konto bez roli powiązane z wierszem czyta `[]` (polityka wymaga roli). Planista: PATCH `first_name` działa; PATCH `user_id` i PATCH `invited_at` odrzucone (błąd uprawnień), INSERT z `user_id` odrzucony; dotychczasowe kroki S-01 (INSERT i PATCH pięciu kolumn) bez zmian. Drugi wiersz próbujący użyć tego samego `user_id` (service-role) odrzucony przez unikalność. Szablony: krok `check` w Node (smoke jest skryptem Node) odczytuje `supabase/templates/invite.html` i `recovery.html` i potwierdza, że zawierają dokładny wzorzec linku z `/auth/set-password`, `{{ .TokenHash }}` i właściwym `type`. Sprzątanie kont Auth utworzonych w smoke (admin API `DELETE /auth/v1/admin/users/<id>`) przed sprzątaniem pracowników; `user_id` ma `on delete set null`.

### Success Criteria:

#### Automated Verification:

- Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- Linting przechodzi: `npm run lint`
- Smoke z krokami bazy i szablonów przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos, ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`): `npm run smoke`

#### Manual Verification:

- Lokalny stos startuje z `otp_expiry = 604800` i `minimum_password_length = 8`; migracja, polityki, granty kolumnowe i treść szablonów zostały przejrzane przez autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 3: Serwer: klient admina, zaproszenie, ustawianie hasła

### Overview

Dodać klienta admina ograniczonego do jednej trasy, trasę zaproszenia, trasę ustawiania hasła, ścieżki publiczne w bramce, kontrolę blokady e-maila przy edycji pracownika i zmiany w CI, i dowieść całego przepływu w smoke z tokenami z `generateLink`.

### Changes Required:

#### 1. Klient admina i środowisko

**File**: `src/lib/supabase-admin.ts` (nowy), `astro.config.mjs`, `eslint.config.js` (lub odpowiadający plik konfiguracji ESLint), `.env.example`

**Intent**: Wystawić klucz service-role tylko tam, gdzie decyzja autora to dopuszcza, i wymusić to narzędziem.

**Contract**: `env.schema` dostaje `SUPABASE_SERVICE_ROLE_KEY` (`context: "server"`, `access: "secret"`, `optional: true`). `createAdminClient(): SupabaseClient | null` zwraca `null`, gdy brak URL lub klucza; używa `createClient` z `@supabase/supabase-js` z `auth: { autoRefreshToken: false, persistSession: false }` (sprawdzić, czy to bezpośrednia zależność w `package.json`, i w razie potrzeby dodać). Reguła ESLint `no-restricted-imports` na `@/lib/supabase-admin` z komunikatem "Klucz service-role wolno użyć tylko w trasie zaproszenia" i wyjątkiem dla `src/pages/api/employees/[id]/invite.ts` oraz samego modułu. `.env.example`: komentarz o opcjonalnej zmiennej (wartość tylko w `.dev.vars` i jako sekret Workera).

#### 2. Trasa zaproszenia

**File**: `src/pages/api/employees/[id]/invite.ts` (nowy)

**Intent**: Jedna trasa realizująca zaproszenia A, B, C i odmowę D z decyzją z czystych funkcji.

**Contract**: `export const prerender = false`, `POST /api/employees/[id]/invite` bez ciała. Kolejność: brak klienta sesji lub admina (503 `not_configured`), `isUuid` (404 `not_found`), `getEmployee` klientem sesji (RLS planisty; `null` to 404), brak e-maila (422 `no_email`), stan konta: `userId` ustawione → `admin.auth.admin.getUserById` → `classifyAuthUser` (brak użytkownika w Auth przy ustawionym `userId` to stan `none`), `userId` puste → `none`. Wykonanie `decideInviteAction`: `invite` → `inviteUserByEmail(email)`; błąd `email_exists` → 409 `account_exists`; inne błędy (w tym brak nadawcy SMTP) → 502 `mail_failed` z logiem; następnie `updateUserById(id, { app_metadata: { role: "employee" } })` i zapis `user_id` i `invited_at` kluczem admina; błąd w dalszych krokach → `deleteUser` (najlepszym wysiłkiem) i 500 `failed`. `reinvite` → `inviteUserByEmail(email)` ponownie (sprawdzić w tej fazie, że wysyła nowy link dla niepotwierdzonego użytkownika) i zapis `invited_at`. `reset_password` → `resetPasswordForEmail(email)` klientem sesji (szablon `recovery`) i zapis `invited_at`. Sukces: 200 `{ status: InviteResult }`. Odpowiedzi przez `jsonResponse` (`no-store`). Tylko ta trasa importuje moduł admina.

#### 3. Trasa i strona ustawiania hasła

**File**: `src/pages/api/auth/set-password.ts` (nowy), `src/pages/auth/set-password.astro` (nowy), `src/lib/services/access.ts`, `src/lib/services/access.test.ts`

**Intent**: Przyjąć token z linku bez zużywania go przy otwarciu i ustawić hasło w jednym kroku po walidacji.

**Contract**: `GET /auth/set-password?token_hash=...&type=invite|recovery` (strona publiczna): bez `verifyOtp`; nagłówki `Cache-Control: no-store`, `Referrer-Policy: no-referrer`; brak parametru albo `type` spoza listy to komunikat "Link jest nieprawidłowy" ze statusem 400; poza tym renderuje wyspę formularza z Fazy 4 z `tokenHash` i `type`. `POST /api/auth/set-password` (publiczna) z JSON `{ tokenHash, type, password }`: `readJsonBody` (415/400), brak klienta (503), `type` spoza listy (400 `invalid_link`), `validatePassword` (422 `{ errors: { password } }`, token nie jest zużywany), `verifyOtp({ token_hash, type })` klientem sesji (błąd to 400 `invalid_link`), `updateUser({ password })` (błąd to 500 `password_not_saved` z komunikatem o nowym zaproszeniu), sukces to 200 `{ ok: true }` z ciasteczkami sesji. W `access.ts` dwa nowe wpisy `public` (dokładne ścieżki `/auth/set-password` i `/api/auth/set-password`); w teście: lista ścieżek publicznych (`access.test.ts:38`) dostaje oba wpisy, a lista domyślnej odmowy dostaje `/api/employees/0b5e2d6e-7c1a-4f8e-9a53-2d1f6c3b8e90/invite`.

#### 4. Warstwa pracowników i blokada e-maila

**File**: `src/lib/employees.ts`, `src/pages/api/employees/[id].ts`

**Intent**: Pokazać `userId` i `invitedAt` w odczytach i zablokować zmianę e-maila po powiązaniu konta.

**Contract**: `COLUMNS` i mapowanie odczytu dostają `user_id` i `invited_at` (zapisy bez zmian: `toRow` ich nie zawiera). `PUT /api/employees/[id]`: po `isUuid` i przed walidacją zapisu odczyt istniejącego pracownika; gdy `emailChangeBlocked(existing, nextEmail)`, odpowiedź 422 z `errors.email` ("E-mail jest zablokowany po zaproszeniu konta").

#### 5. CI

**File**: `.github/workflows/ci.yml`

**Intent**: Dać aplikacji w jobie `smoke` klucz lokalnego stosu i odbiorcę poczty, bez czytania maili.

**Contract**: z listy `-x` w `supabase start` usunąć `mailpit` (zaproszenie wymaga działającego SMTP, żeby GoTrue nie zwracał błędu wysyłki); `.dev.vars` (i `.env`) dla `npm run preview` dostają także `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env` (klucz lokalnego stosu, nie sekret repozytorium). Smoke nadal dostaje ten klucz w środowisku polecenia.

#### 6. Smoke: przepływ

**File**: `scripts/smoke.mjs`

**Intent**: Dowieść całego przepływu zaproszenia na prawdziwej sesji planisty i prawdziwym stosie Auth.

**Contract**: Kroki między `signIn(planner)` a `signOut(planner)`, na pracownikach `smoke-inv-<runId>-...@example.com`: (A) `POST /api/employees/<id>/invite` zwraca 200 `invited`; service-role potwierdza `user_id` i `invited_at` w `employees` i `app_metadata.role = "employee"` w Auth; (B) drugie zaproszenie zwraca 200 `reinvited`, a `invited_at` rośnie; token: smoke generuje `hashed_token` przez `POST /auth/v1/admin/generate_link` (typ `invite`, a jeśli stos go odrzuca dla istniejącego użytkownika, typ `recovery`; wynik tego sprawdzenia trafia do uwag implementacji); `GET /auth/set-password?token_hash=...&type=...` zwraca 200 z formularzem i nagłówkami `no-store` i `no-referrer`, powtórne `GET` także 200 (token niezużyty); `POST /api/auth/set-password` ze słabym hasłem zwraca 422 `errors.password`, a token nadal działa; z poprawnym hasłem 200 z ciasteczkami sesji; kolejne użycie tego samego tokenu zwraca 400 `invalid_link`; nowy aktor z ciasteczkami z tej odpowiedzi: `/dashboard` 200, `/employees`, `/shifts`, `/api/employees` odmowa 403; (C) planista zaprasza ponownie to samo konto: 200 `password_reset`; nowy token `recovery` z `generate_link` ustawia nowe hasło, a logowanie przez `/api/auth/signin` nowym hasłem działa, starym nie; (D) konto bez roli utworzone przez admin API na adres pracownika: zaproszenie zwraca 409 `account_exists`, a `employees` pozostaje bez `user_id`; pracownik bez e-maila: 422 `no_email`; nieznany UUID i `not-a-uuid`: 404; `PUT /api/employees/<id>` ze zmienionym e-mailem po powiązaniu: 422 `errors.email`, ze zmianą samego imienia: 200; pracownik, konto bez roli i anonim: odmowa `POST .../invite` (403 i 401). Sprzątanie kont Auth utworzonych w tych krokach zgodnie z Fazą 2.

### Success Criteria:

#### Automated Verification:

- Testy przechodzą: `npm test`
- Linting przechodzi, w tym reguła ograniczająca import modułu admina: `npm run lint`
- Sprawdzanie typów przechodzi: `npx astro check`
- Build przechodzi: `npm run build`
- Smoke z krokami zaproszenia i ustawiania hasła przechodzi lokalnie (jak w Fazie 2, z `.dev.vars` zawierającym klucz lokalnego stosu): `npm run smoke`

#### Manual Verification:

- Wyniki sprawdzeń założeń Supabase zostały zapisane w uwagach implementacji (przyjęcie `otp_expiry = 604800`, ponowne `inviteUserByEmail` dla niepotwierdzonego użytkownika, pole potwierdzenia konta, `generateLink` typu `invite`) i nie wymagają zmiany planu; w razie rozbieżności decyzja wraca do autora

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 4: UI i dokumentacja

### Overview

Pokazać planiście stan konta i przycisk zaproszenia, dać pracownikowi stronę ustawiania hasła, zablokować pole e-mail po powiązaniu, zmienić regułę o kluczu service-role w dokumentach i spisać checklistę wdrożenia z bramką SMTP.

### Changes Required:

#### 1. Lista i edycja pracowników

**File**: `src/pages/employees/index.astro`, `src/pages/employees/[id].astro`, `src/components/employees/InviteButton.tsx` (nowy), `src/components/employees/EmployeeForm.tsx`

**Intent**: Pokazać stan konta (`inviteStatus`, `formatInviteLabel`) i uruchamiać zaproszenie z listy i z edycji.

**Contract**: Kolumna "Konto" na liście (od `md`, na telefonie linia pod nazwiskiem) z etykietą stanu i wyspą `InviteButton`. `InviteButton` (React): props `employeeId`, `hasEmail`, `hasAccount`; etykieta "Zaproś" lub "Wyślij ponownie"; nieaktywny bez e-maila z podpowiedzią "Dodaj e-mail pracownika"; `POST /api/employees/<id>/invite`; stany ładowania, sukcesu (`role="status"`: "Wysłano zaproszenie na adres ...", "Wysłano ponownie ...", "Wysłano link resetu hasła ...") i błędu (`account_exists`: "Na ten adres istnieje już konto spoza Shiftly", `mail_failed`: "Nie udało się wysłać maila; sprawdź konfigurację poczty", `no_email`, `not_configured`, 401 i 403: sesja wygasła); po sukcesie przycisk zmienia się na "Wyślij ponownie". `EmployeeForm`: przy ustawionym `userId` pole e-mail jest tylko do odczytu z podpowiedzią "E-mail jest zablokowany po zaproszeniu konta". Strony pracowników mają już `no-store`.

#### 2. Strona ustawiania hasła

**File**: `src/components/auth/SetPasswordForm.tsx` (nowy), `src/pages/auth/set-password.astro`

**Intent**: Formularz hasła z regułą PRD na żywo, wzorowany na `SignInForm.tsx` i `useShiftForm` w obsłudze błędów.

**Contract**: Pola: hasło i powtórzenie hasła (typ `password`, `autoComplete="new-password"`); lista warunków na żywo z `checkPassword` (≥8 znaków, duża litera, cyfra, znak specjalny) z `aria-live`; zgodność powtórzenia; walidacja `validatePassword` przed wysłaniem; `POST /api/auth/set-password`; po sukcesie `window.location.replace("/dashboard")`; błąd `invalid_link` pokazuje "Link wygasł lub został już użyty. Poproś planistę o nowe zaproszenie."; `password_not_saved` pokazuje komunikat o nowym zaproszeniu; 422 pokazuje błąd przy polu. Pole hasła ma pełne a11y jak `FormField` (`aria-invalid`, `aria-describedby`, `role="alert"`).

#### 3. Dokumentacja i zmiana reguły

**File**: `CLAUDE.md`, `README.md`, `AGENTS.md`, `context/deployment/deploy-plan.md`

**Intent**: Zastąpić zakaz klucza service-role w Workerze nową, ograniczoną zasadą i spisać wdrożenie zaproszeń.

**Contract**: `CLAUDE.md` (sekcje "Auth flow", "Data access", opis `npm run smoke` i zdanie o `scripts/create-planner.mjs`): klucz service-role to sekret Workera i wpis w lokalnym `.dev.vars`, importowany wyłącznie przez `src/lib/supabase-admin.ts` w trasie `src/pages/api/employees/[id]/invite.ts` (wymusza ESLint); poza nią i skryptami nie używać; opisać stronę `/auth/set-password`, trasy zaproszenia i ustawiania hasła, kolumny `user_id` i `invited_at`, szablony maili. `README.md:148` i `AGENTS.md:23` analogicznie; tabela tras o nowe trasy. `deploy-plan.md`: lista sekretów Workera dostaje `SUPABASE_SERVICE_ROLE_KEY` (`npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`), nowa sekcja "Zaproszenia pracowników (S-10)" z checklistą w kolejności: (1) `npx supabase db push`; (2) sekret Workera; (3) ustawienia Auth na hostowanym projekcie (`npx supabase config push` po sprawdzeniu, że obejmuje `otp_expiry`, szablony i `minimum_password_length`; w przeciwnym razie Management API; wartości: `otp_expiry` 604800, minimum hasła 8, `site_url` i adresy przekierowań na adres Workera, szablony `invite` i `recovery`); (4) **bramka**: własny nadawca SMTP skonfigurowany w Supabase (dostawca, domena, limit wysyłek podniesiony ponad domyślne 30 na godzinę) przed wdrożeniem kodu S-10 na produkcję, bo domyślny SMTP wysyła tylko do członków zespołu organizacji i ma limit 2 maile na godzinę; (5) `npm run build` i `npx wrangler deploy`; (6) test zaproszenia na prawdziwym adresie, bez `npm run smoke` na produkcji. Wymienić zaakceptowane ryzyka (polityka haseł tylko w aplikacji, publiczny endpoint odzyskiwania hasła, klucz service-role w Workerze).

### Success Criteria:

#### Automated Verification:

- Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- Smoke przechodzi lokalnie: `npm run smoke`
- CI na pull requeście jest zielone (job `ci` i job `smoke`, z kontenerem `mailpit`)

#### Manual Verification:

- Na lokalnym stosie z Mailpit: zaproszenie z listy, odebranie maila, link z `/auth/set-password`, ustawienie hasła z listą warunków, logowanie i `/dashboard`; ponowne zaproszenie przed ustawieniem hasła unieważnia pierwszy link; zaproszenie aktywnego konta wysyła link resetu; wygasły lub zużyty link pokazuje komunikat; szablony maili wyglądają poprawnie
- W przeglądarce: stan konta na liście i w edycji, przycisk (w tym nieaktywny bez e-maila), e-mail zablokowany po zaproszeniu, a11y formularza hasła i obsługa klawiaturą; na telefonie formularz hasła i lista (etykieta stanu) są czytelne
- Dokumentacja (CLAUDE.md, README.md, AGENTS.md, deploy-plan.md) opisuje nową zasadę klucza service-role, checklistę i bramkę SMTP spójnie z kodem
- Własny nadawca SMTP jest skonfigurowany w hostowanym Supabase, a ustawienia Auth (7 dni, minimum 8, szablony, adresy) są zastosowane (bramka przed wdrożeniem na produkcję)
- Migracja jest zastosowana na hostowanym projekcie (`npx supabase db push`), sekret Workera ustawiony i po wdrożeniu (`npm run build` i `npx wrangler deploy`) zaproszenie prawdziwego adresu kończy się zalogowanym pracownikiem; nie uruchamiać `npm run smoke` na produkcji

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Testing Strategy

### Unit Tests:

- Reguła hasła (`password.test.ts`): granice 7/8 i 72/73 znaków, Unicode, spacja nie jest znakiem specjalnym, wejścia niebędące ciągiem, flagi `checkPassword`.
- Zaproszenie (`invitation.test.ts`): `classifyAuthUser`, tabela decyzji, `inviteStatus` na granicy 7 dni, `formatInviteLabel`, `emailChangeBlocked`, powtarzalność przez `expectDeterministic`.
- Lista ścieżek publicznych i domyślnej odmowy w `access.test.ts`.

### Integration Tests:

- Smoke przez PostgREST (Faza 2): własny wiersz pracownika, odmowa dla konta bez roli, granty kolumnowe, unikalność `user_id`, szablony maili.
- Smoke przez API (Faza 3): przypadki A, B, C, D, brak e-maila, 404, blokada e-maila, odmowy dla pozostałych aktorów, przepływ tokenu (`generate_link`): formularz bez zużycia, słabe hasło, poprawne hasło, ponowne użycie, logowanie, dostęp pracownika.
- Czytanie maili i wygasanie linku po 7 dniach nie są w smoke (ręcznie w Fazie 4: Mailpit; `otp_expiry` sprawdzone w konfiguracji i w Fazie 2).
- Brak testów komponentów i hooków (jak w S-01 i S-02).

### Manual Testing Steps:

1. Dodać pracownika z e-mailem, zaprosić go, otworzyć mail w Mailpit i link, spróbować słabego hasła, ustawić poprawne i sprawdzić `/dashboard`.
2. Zaprosić ponownie przed ustawieniem hasła i sprawdzić, że pierwszy link nie działa.
3. Zaprosić aktywne konto i sprawdzić, że link resetu ustawia nowe hasło.
4. Dodać konto bez roli przez panel Supabase na adres istniejącego pracownika i sprawdzić odmowę 409 z komunikatem.
5. Sprawdzić, że e-mail zaproszonego pracownika jest tylko do odczytu w edycji.
6. Zalogować się jako pracownik i sprawdzić odmowę `/employees`, `/shifts`, `/planner`.

## Performance Considerations

Trasa zaproszenia wykonuje kilka zapytań do Auth i bazy (odczyt pracownika, `getUserById`, `inviteUserByEmail`, `updateUserById`, zapis), a czas oczekiwania na sieć nie liczy się do limitu 10 ms CPU na żądanie w planie Workers Free; do sprawdzenia w logach po wdrożeniu (`npx wrangler tail`, trigger powrotu do Paid z `deploy-plan.md`). Strona ustawiania hasła robi dwa wywołania Auth. Limit wysyłek maili zależy od wybranego SMTP (domyślnie 30 na godzinę po konfiguracji własnego), co przy dziesiątkach pracowników wystarcza.

## Migration Notes

Migracja jest addytywna i bezpieczna dla istniejących danych (kolumny nullable), ale zmienia granty kolumnowe tabeli `employees`; kod S-01 zapisuje wyłącznie pięć dozwolonych kolumn, więc działa bez zmian. Kolejność wdrożenia: `npx supabase db push`, sekret Workera, ustawienia Auth, bramka SMTP, `npm run build` i `npx wrangler deploy` (zob. Faza 4). Wdrożenie kodu bez migracji i bez sekretu kończy się odpowiedzią 503 `not_configured` na trasie zaproszenia, bez wpływu na resztę aplikacji. Zmiany migracji po scaleniu robi się nową migracją. Znacznik czasu migracji tworzy się w chwili implementacji Fazy 2; jeśli S-03 scali się pierwsze, ta migracja musi być późniejsza.

## Parallel Work Notes

S-03 (`weekly-schedule-draft`) jest planowane i może być implementowane równolegle. Wspólne punkty styku: `scripts/smoke.mjs` (S-10 dopisuje kroki zaproszeń, ścieżkę tokenu i sprzątanie kont Auth; S-03 sekcje grafików; konflikty są mechaniczne, drugi do scalenia robi rebase i uruchamia pełny smoke), `src/types.ts` (S-10 rozszerza `Employee`, S-03 dopisuje typy grafiku), `access.test.ts`, dokumentacja (S-10 zmienia fragmenty o service-role, S-03 sekcję danych) i kolejność migracji. S-10 zmienia `employees.ts`, trasy i formularz pracowników, `ci.yml`, `astro.config.mjs` i konfigurację ESLint; S-03 tylko czyta pracowników przez `listEmployees`, więc nie zależy od nowych kolumn.

## References

- Roadmap: `context/foundation/roadmap.md` (S-10), PRD: `context/foundation/prd.md` (FR-001, FR-002, NFR hasła i link 7 dni), infrastruktura: `context/foundation/infrastructure.md:80,106`, wdrożenie: `context/deployment/deploy-plan.md:31-32,49-55,77`
- Dokumentacja Supabase (sprawdzona 2026-11-06): ustawienia OTP i wygasanie linków (`https://supabase.com/docs/guides/auth/auth-email-passwordless`), własny SMTP i limity (`https://supabase.com/docs/guides/auth/auth-smtp`, `https://supabase.com/docs/guides/auth/rate-limits`), konfiguracja CLI (`https://supabase.com/docs/guides/local-development/cli/config`)
- Archiwum: `context/archive/2026-10-20-role-based-access/plan.md:34,43` i `reviews/plan-review.md:113`; `context/archive/2026-10-21-employee-roster/plan-brief.md:22,29`
- Auth i dostęp: `src/lib/supabase.ts:5-21`, `src/middleware.ts:13-38`, `src/lib/services/access.ts:10-52`, `src/pages/api/auth/signin.ts`, `src/components/auth/SignInForm.tsx`
- Pracownicy: `supabase/migrations/20261028085831_employees.sql:5-43`, `supabase/migrations/20261020131134_role_helpers.sql:35-57`, `src/lib/employees.ts:8-12,54-59,94-108`, `src/pages/api/employees/[id].ts`
- Skrypty i CI: `scripts/create-planner.mjs:40-42,71-90`, `scripts/smoke.mjs:23-40,86-106,217-220`, `.github/workflows/ci.yml:42-56`, `supabase/config.toml:154-230`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reguły

#### Automated

- [ ] 1.1 Testy reguł hasła i zaproszenia przechodzą w workerd: `npm test`
- [ ] 1.2 Linting przechodzi: `npm run lint`
- [ ] 1.3 Sprawdzanie typów przechodzi: `npx astro check`

#### Manual

- [ ] 1.4 Komunikaty hasła po polsku, format etykiet stanu zaproszenia (w tym neutralne "link wygasł") i tabela decyzji zostały przejrzane i zatwierdzone przez autora

### Phase 2: Konfiguracja Auth i schemat

#### Automated

- [ ] 2.1 Migracja stosuje się czysto na świeżej lokalnej bazie (przy działającym `npx supabase start`): `npx supabase db reset`
- [ ] 2.2 Linting przechodzi: `npm run lint`
- [ ] 2.3 Smoke z krokami bazy i szablonów przechodzi lokalnie (po `npx supabase start`, `npm run build` i `npm run preview` z `.env`/`.dev.vars` wskazującymi ten sam lokalny stos, ze zmiennymi `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` z `supabase status -o env`): `npm run smoke`

#### Manual

- [ ] 2.4 Lokalny stos startuje z `otp_expiry = 604800` i `minimum_password_length = 8`; migracja, polityki, granty kolumnowe i treść szablonów zostały przejrzane przez autora

### Phase 3: Serwer: klient admina, zaproszenie, ustawianie hasła

#### Automated

- [ ] 3.1 Testy przechodzą: `npm test`
- [ ] 3.2 Linting przechodzi, w tym reguła ograniczająca import modułu admina: `npm run lint`
- [ ] 3.3 Sprawdzanie typów przechodzi: `npx astro check`
- [ ] 3.4 Build przechodzi: `npm run build`
- [ ] 3.5 Smoke z krokami zaproszenia i ustawiania hasła przechodzi lokalnie (jak w Fazie 2, z `.dev.vars` zawierającym klucz lokalnego stosu): `npm run smoke`

#### Manual

- [ ] 3.6 Wyniki sprawdzeń założeń Supabase zostały zapisane w uwagach implementacji (przyjęcie `otp_expiry = 604800`, ponowne `inviteUserByEmail` dla niepotwierdzonego użytkownika, pole potwierdzenia konta, `generateLink` typu `invite`) i nie wymagają zmiany planu; w razie rozbieżności decyzja wraca do autora

### Phase 4: UI i dokumentacja

#### Automated

- [ ] 4.1 Bramka przechodzi: `npx astro sync && npm run lint && npx astro check && npm test && npm run build`
- [ ] 4.2 Smoke przechodzi lokalnie: `npm run smoke`
- [ ] 4.3 CI na pull requeście jest zielone (job `ci` i job `smoke`, z kontenerem `mailpit`)

#### Manual

- [ ] 4.4 Na lokalnym stosie z Mailpit: zaproszenie z listy, odebranie maila, link z `/auth/set-password`, ustawienie hasła z listą warunków, logowanie i `/dashboard`; ponowne zaproszenie przed ustawieniem hasła unieważnia pierwszy link; zaproszenie aktywnego konta wysyła link resetu; wygasły lub zużyty link pokazuje komunikat; szablony maili wyglądają poprawnie
- [ ] 4.5 W przeglądarce: stan konta na liście i w edycji, przycisk (w tym nieaktywny bez e-maila), e-mail zablokowany po zaproszeniu, a11y formularza hasła i obsługa klawiaturą; na telefonie formularz hasła i lista (etykieta stanu) są czytelne
- [ ] 4.6 Dokumentacja (CLAUDE.md, README.md, AGENTS.md, deploy-plan.md) opisuje nową zasadę klucza service-role, checklistę i bramkę SMTP spójnie z kodem
- [ ] 4.7 Własny nadawca SMTP jest skonfigurowany w hostowanym Supabase, a ustawienia Auth (7 dni, minimum 8, szablony, adresy) są zastosowane (bramka przed wdrożeniem na produkcję)
- [ ] 4.8 Migracja jest zastosowana na hostowanym projekcie (`npx supabase db push`), sekret Workera ustawiony i po wdrożeniu (`npm run build` i `npx wrangler deploy`) zaproszenie prawdziwego adresu kończy się zalogowanym pracownikiem; nie uruchamiać `npm run smoke` na produkcji
