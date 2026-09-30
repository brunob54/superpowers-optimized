# Orchestration Log — dashboard

_Invocation 1 — 2026-09-29 — spec docs/superpowers-orchestrator/2026-09-29-dashboard/specs/dashboard-design.md — N_plan=4 N_code=4 M=1 cap=3 — branch feature/dashboard — BASE 4061d3b_

## Phase 1 — Plan — DONE — 2026-09-29
plan: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — 16 tasks

## Phase 2 — Plan review — rounds 4 — cap — unresolved 0
readiness owed: 1

## RULING 1 — 2026-09-30 — phase 3 — Skill tool allowed for the two artifact skills (Tasks 1, 7, 8)
Items: [task 1/1] forced — plan governs: "Load the skills `artifact-design` and `artifact-capabilities` with the Skill tool." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: none — contradiction: none
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## RULING 2 — 2026-09-30 — phase 3 — One page copy of the note and status rules, tested for parity
Items: [task 3/1] design — plan governs: "Invariants: no edit control and no write when the viewer is not the owner, when the store is missing (the local file, the shared page) or when the proposals cou" — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: 3 of 3 (design consistency, implementation practicality, adversarial) — contradiction: none
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## RULING 3 — 2026-09-30 — phase 3 — Dark tokens: each value once as --dark-*, both required blocks map to it
Items: [task 7/1] forced — plan governs: "Invariants: every value from the data is inserted with `textContent` or `setAttribute` (Global Constraint 3); the app script contains none of `innerHTML`, `oute" — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: none — contradiction: none
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## RULING 4 — 2026-09-30 — phase 3 — The --data-dir literal and the unread option are required by Global Constraint 10
Items: [task 9/1] forced — plan governs: "[6, 10] '`SKILL.md` therefore writes every script command with `--data-dir '${CLAUDE_PLUGIN_DATA}'`, and the scripts take the path only from that argument." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: none — contradiction: none
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## RULING 5 — 2026-09-30 — phase 3 — Run-scan failures returned as a field; /pickup output unchanged
Items: [task 2/1] design — plan governs: "'`pickup-scan.js` requires the module and prints the list in its own format (relative dates included); its output does not change'." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: 3 of 3 (design consistency, implementation practicality, adversarial) — contradiction: settled
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## RULING 6 — 2026-09-30 — phase 3 — Platform check 9 contradicted; returned to the user by spec section 13
Items: [task 1/2] escalated (spec wrong) — the saved query files carry no version; the spec's sync design needs a new source for it
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: none — contradiction: none
Re-dispatch: none — escalated

## STOPPED — 2026-09-30 — phase 3 — platform check 9 contradicted (task 1); spec section 13 returns the design to the user
Detail: .superpowers/sdd/task-1-report.md (### Question 2); docs/superpowers-orchestrator/2026-09-29-dashboard/implementation/platform-checks.md row 9
Open: [task 1/2] escalated (spec wrong) — the files written by ArtifactData `query` with `out_dir` carry no `id` and no `version`; how does `dashboard-sync.js` get each proposal's version?
Ruled: [task 1/1] forced — plan governs: "Load the skills `artifact-design` and `artifact-capabilities` with the Skill tool." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md
Resume: Resume orchestration for docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md [task 1/2]: <answer>

## RULING 7 — 2026-09-30 — phase 3 — Page write fallback compares the listed snapshot; the window is a known limit
Items: [task 1/3] design — amend plan: Task 8 Contract — on the page side, "the version the page read" is the document snapshot the page listed: when the `## Runtime record` says a page write cannot be pinned (platform check 12), `write` reads the document again with the record's single-document read just before the write, applies the list-path write rules (no write for an `applying` document or an `applied` one closed after `generatedAt`) again to the re-read document, and refuses when `exists`, `state`, `closedAt` or `createdAt` of the re-read differs from the listed document; a new document is written only when the re-read finds none; the Task 12 Contract and its `## Known limits` name the window between the re-read and the write (a page write inside it can overwrite a `sync` mark, and that edit can then be lost without a report) and the create that no condition guards, as spec section 13 item 12 requires; row 12 of platform-checks.md stays `confirmed`
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: 3 of 3 (design consistency, implementation practicality, adversarial) — contradiction: settled
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## RULING 8 — 2026-09-30 — phase 3 — The shared page decides "merged" against the default branch's counted upstream
Items: [task 2/2] design — amend plan: Task 6 Contract — the shared run decides "merged" against the counted upstream of the default branch (a remote-tracking ref of the same name, as `--default-shared-ref` prints it), never against the shared ref: `unfinishedRuns` comes from `scanRuns({ refs: 'upstream', base: <counted upstream of the default branch> })`, and the `git` section leaves out the shared ref itself by name and the upstreams merged into that same base; when there is no default branch or it has no counted upstream, no merge exclusion applies (spec section 5, Tab 1: "When there is no default branch, `git-runs.js` scans every `feature/*` branch"); Assumption 20 and the Task 6 reference code and comments follow; test-06 gains a case that shares `origin/feature/run` with a pushed `## STOPPED` heading and expects that run in `unfinishedRuns`; the Task 2 Contract does not change
Detail: docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard-open-decisions.md
Forks: 3 of 3 (design consistency, implementation practicality, adversarial) — contradiction: settled
Re-dispatch: phase 3, in-run resume 1 of 3, return 1 of 6

## Phase 3 — Batch 1 (tasks 1–3) — COMPLETE — commits f3dce66..cc903f2
- Task 1: complete — platform checks recorded (row 9 contradicted, answered by the user; rulings 6, 7)
- Task 2: complete — run scan moved into git-runs.js; git failures returned as data (rulings 5, 8)
- Task 3: complete — shared parsing library and the work-log rule parity test (ruling 2)

## Phase 3 — Batch 2 (tasks 4–6) — COMPLETE — commits 1606c99..2eda373
- Task 4: complete — extractor command line, state folder, runs, git and commits
- Task 5: complete — extractor file sections
- Task 6: complete — shared audience read from the pushed ref only (ruling 8)

## Phase 3 — Batch 3 (tasks 7–9) — COMPLETE — commits 2eda373..4aac563
- Task 7: complete — page template view (ruling 3)
- Task 8: complete — page edits and proposals, re-read write fallback (ruling 7)
- Task 9: complete — renderer: render, verify and compare the page files (ruling 4)

## Phase 3 — Batch 4 (tasks 10–12) — COMPLETE — commits f26b228..7084a89
- Task 10: complete — sync script checks and verdicts, joined with the versions file (Amendment 6)
- Task 11: complete — sync script apply and record batches
- Task 12: complete — the skill file, with the re-read known limits (Amendments 6, 7)

## Phase 3 — Batch 5 (tasks 13–15) — COMPLETE — commits 78d4fdf..d931e97
- Task 13: complete — routing rule, triggering case, Routing Guide
- Task 14: complete — user documentation
- Task 15: complete — page data measured (62892 bytes, row 11 confirmed); acceptance checklist

## Phase 3 — Batch 6 (task 16) — COMPLETE — commits 35aee03..faf9e5b
- Task 16: complete — release v7.55.0
