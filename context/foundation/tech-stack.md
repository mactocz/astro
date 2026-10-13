---
starter_id: 10x-astro-starter
package_manager: npm
project_name: shiftly
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Aplikacja webowa Shiftly dla planisty i pracowników, z logowaniem kontem, w skali dziesiątek do stu osób i z harmonogramem 8 tygodni po godzinach. Dla aplikacji webowej w JavaScript / TypeScript rekomendowanym domyślnym wyborem jest 10x Astro Starter (Astro, React, TypeScript, Supabase, Cloudflare): logowanie, baza danych i wdrożenie brzegowe są dostępne od razu, a stos spełnia wszystkie cztery bramki jakości przyjazności dla agenta. Pewność bootstrappera to first-class, więc szkielet powstanie zwykle płynnie, z okazjonalnym ręcznym krokiem. Z PRD wykryto tylko logowanie; płatności, czas rzeczywisty, AI i zadania w tle nie występują. Zespół przyjęto domyślnie jako jednoosobowy, bo ścieżka standardowa nie pyta o jego profil. Dwie uwagi z karty startera: reguły dostępu do danych trzeba skonfigurować od początku (pracownik widzi tylko własne dane), a generowanie grafiku nie powinno być długim zadaniem w środowisku brzegowym. Wdrożenie na cloudflare-pages, CI na GitHub Actions z automatycznym wdrożeniem po scaleniu.
