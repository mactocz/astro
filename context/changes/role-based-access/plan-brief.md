# Role based access — Plan Brief

> Full plan: `context/changes/role-based-access/plan.md`
> Upstream: `context/foundation/roadmap.md` (F-01) and `context/foundation/prd.md` (Access Control, NFR)

## What & Why

System ma rozróżniać planistę i pracownika: strony planisty są niedostępne dla pracownika i osoby niezalogowanej, a pracownik widzi wyłącznie to, co dla niego przewidziano. To fundament F-01 z roadmapy, który musi stanąć przed jakimkolwiek wycinkiem z danymi osobowymi (S-01, S-02, S-10, S-11). Zakres jest celowo wąski: rozróżnienie ról i bramki dostępu, bez tabel domenowych.

## Starting Point

Dziś middleware chroni tylko `/dashboard` listą tras i przepuszcza każdego zalogowanego; ról nie ma nigdzie. Rejestracja jest publiczna (także na produkcji), anonim jest przekierowywany na logowanie (PRD chce komunikatu), a `supabase/` nie ma migracji. Smoke zakłada konto przez publiczną rejestrację.

## Desired End State

Konto ma rolę `planner` albo `employee`; każda ścieżka poza małą jawną listą jest tylko dla planisty. Anonim widzi stronę "Brak dostępu" (401), zalogowany bez wystarczającej roli ją samą (403). Rejestracja jest zamknięta, pierwszego planistę tworzy skrypt, a w bazie są funkcje `is_planner()` i `current_app_role()` gotowe dla polityk RLS w S-01. Smoke w CI dowodzi tego na prawdziwych kontach.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Pierwszy planista i rejestracja | Rejestracja zamknięta, planistę tworzy `scripts/create-planner.mjs` (tworzy lub awansuje) | PRD: konta zakłada planista; strona na produkcji jest publiczna, więc otwarta rejestracja to otwarte drzwi | Roadmap (niewiadoma) + Plan (user) |
| Zachowanie dla anonima | Strona "Brak dostępu" ze statusem 401 i odnośnikiem do logowania, bez przekierowania | Zapis z PRD Access Control; zmienia asercje smoke | Roadmap (niewiadoma) + Plan (user) |
| Gdzie rola | `app_metadata.role` z `getUser()` | Zero dodatkowych zapytań na planie Free (10 ms CPU), użytkownik nie może jej zmienić | Plan (user) |
| Model tras | Domyślna odmowa: public, any-role (`/dashboard`), reszta tylko planista; dopasowanie dokładne | Nowe strony planisty są chronione automatycznie, pomyłka kończy się odmową, a nie wyciekiem | Plan (user) |
| Warstwa bazy | Pierwsza migracja: `current_app_role()`, `is_planner()`, wzorzec RLS w komentarzu | Jedna definicja roli dla wszystkich polityk, sprawdzona zanim powstanie pierwsza tabela z danymi osobowymi | Plan (user) |
| Dowód bramki planisty | Minimalna strona `/planner` (zastępowana w S-01) | Prawdziwa strona dla smoke (200 planista, 403 pracownik) i strona dostępna z `/dashboard` dla planisty (logowanie nadal kieruje na `/`) | Plan (user) |
| Weryfikacja | Testy jednostkowe polityki + smoke z kontami planisty, pracownika i bez roli (klucz service-role tylko lokalnie i w kroku smoke) | Rejestracja jest zamknięta, więc smoke i tak musi tworzyć konta przez API administracyjne | Plan (agent) |
| Odczyt roli | Wyłącznie `app_metadata`, nigdy `user_metadata`; nieznana wartość = brak roli | `user_metadata` użytkownik zapisze sam; smoke próbuje to podrobić | Plan (agent) |

## Scope

**In scope:** polityka dostępu i testy; middleware, strona odmowy, `/planner`, rola na `/dashboard`; smoke z macierzą ról; zamknięcie rejestracji; skrypt `create-planner`; migracja z funkcjami roli; dokumentacja.

**Out of scope:** tabele domenowe i polityki "własne dane" (S-01, S-10, S-11), zaproszenia i poczta (S-10), blokowanie kont (FR-015), zarządzanie rolami w UI, klucz service-role w Workerze, zmiana polityki haseł w Supabase, lokalizacja istniejących stron.

## Architecture / Approach

`decideAccess({ pathname, signedIn, role })` to czysta funkcja w `src/lib/services/access.ts`; middleware wylicza `locals.role` z `app_metadata`, pyta ją o decyzję i przy odmowie przepisuje żądanie na publiczną stronę `/access-denied` (lub zwraca JSON dla `/api/*`). Po stronie bazy `public.is_planner()` czyta tę samą rolę z `auth.jwt()`. Rolę ustawia wyłącznie API administracyjne.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Polityka dostępu | Czyste `decideAccess`/`parseRole` + testy tabelaryczne | Błędny podział warstw (public / any-role / planner-only) |
| 2. Egzekwowanie + smoke | Middleware, `/access-denied`, `/planner`, smoke z rolami, klucz tylko dla smoke w CI | Status 401/403 przy przepisaniu żądania; wyciek klucza do aplikacji |
| 3. Zamknięcie rejestracji | Usunięte strony i trasa, `enable_signup = false`, `create-planner.mjs`, dokumentacja | Wyłączenie niewłaściwej opcji Supabase (logowanie e-mail); konta bez roli na produkcji |
| 4. Warstwa bazy | Migracja z funkcjami roli, RPC w smoke, próba podrobienia roli | Prawa `anon` do nowych funkcji; ręczne `db push` na hostowanym projekcie |

**Prerequisites:** `npm ci` w worktree, Docker i `npx supabase start` dla smoke lokalnie; dostęp autora do panelu Supabase i `wrangler` dla kroków produkcyjnych.
**Estimated effort:** ok. 4 sesje, po jednej na fazę; Fazy 2 i 3 trafiają do jednego PR i wdrożenia; kroki produkcyjne (ręczne) po Fazach 3 i 4.

## Open Risks & Assumptions

- Rola w JWT (RLS) odświeża się z tokenem, do 3600 s; strony aplikacji czytają ją świeżo, więc okno dotyczy tylko polityk RLS (zaakceptowane).
- Zakładamy, że `supabase status -o env` w CI zwraca klucz service-role (nazwa do potwierdzenia w użytej wersji CLI) i że `[auth] enable_signup = false` nie wyłącza logowania e-mailem (dowodzi smoke).
- Zakładamy, że status ustawiony na stronie po `next("/access-denied")` w middleware dociera do klienta; smoke to sprawdza.
- Istniejące konta na produkcji nie mają roli i po wdrożeniu widzą tylko strony publiczne; kolejność wdrożenia (przegląd kont, planista, kod, wyłączenie rejestracji, migracja) jest opisana w planie.

## Success Criteria (Summary)

- Planista wchodzi na `/planner`; pracownik dostaje 403, anonim 401, konto bez roli 403; nowa, nieznana ścieżka jest domyślnie tylko dla planisty.
- Rejestracji nie da się otworzyć ani przez aplikację, ani bezpośrednio przez API Supabase; pierwszego planistę utworzy się jednym poleceniem.
- Bramka CI (lint, typy, testy, build, smoke z rolami i RPC) jest zielona, a podrobienie roli przez `user_metadata` nie daje dostępu.
