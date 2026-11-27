# Test współbieżności `approve_schedule` (Faza 2)

2026-11-27, lokalny stos Supabase, migracja `20261127084657_schedule_approval.sql`. Jedna sesja `psql` trzymała
transakcję otwartą (`pg_sleep(4)` po zatwierdzeniu albo po zapisie), druga strona pisała w tym czasie przez `psql` albo
prawdziwym żądaniem do PostgREST. Skrypt był w katalogu tymczasowym zadania, dane testowe `Smoke-lock-*` usunięte.

| Przypadek | Działanie w trakcie | Wynik |
| --- | --- | --- |
| (a) | insert przypisania przez `psql` podczas zatwierdzania | czeka ok. 2,7 s, potem `42501` z polityki; 0 przypisań |
| (a) | to samo przez PostgREST, dwa razy z rzędu | czeka, potem 403 `42501`; 0 przypisań |
| (a) | `DELETE` obsady przez PostgREST | czeka, potem 200 `[]`; obsada nietknięta |
| (b) | zatwierdzanie podczas niezatwierdzonego insertu | zatwierdzenie czeka, potem `PT412`; grafik zostaje szkicem |
| (c) | `LOCK TABLE` w funkcji `security definer` | działa (każde udane zatwierdzenie powyżej) |
| (d) | `save_schedule` tego samego grafiku podczas zatwierdzania | czeka, potem 423 `PT423`, nie `PT404` |
| F1 | zapis innego szkicu, który usuwa komórkę obsady | czeka, potem 200; brak zakleszczenia |

Wniosek: zachowania zgodne z założeniami planu. `schedule_is_draft` zostaje `stable` (po odczekaniu na blokadę tabeli
polityka widzi nowy status, także dla przygotowanych zapytań PostgREST). Plan B z F7 niepotrzebny.

Nie sprawdzone: zakleszczenie zależy od przeplotu, więc przypadek F1 pokazuje jeden przebieg, a o jego braku
rozstrzyga kolejność blokad (obsada pierwsza).
