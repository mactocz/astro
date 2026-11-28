---
change_id: schedule-generation
title: Schedule generation
status: implementing
created: 2026-11-27
updated: 2026-11-27
archived_at: null
---

## Notes

S-09 z roadmapy (FR-009, FR-011, US-01). Decyzja autora (2026-11-27): zostajemy na planie Cloudflare Workers Free (limit 10 ms CPU na żądanie). Pomiar po S-08: p50 7,19 ms, p99 41,55 ms dla żądań Workera (`context/deployment/deploy-plan.md`), więc plan generatora musi rozstrzygnąć, gdzie liczy się generator i reguły.
