# Open decisions — dashboard

## Ruling 1 — 2026-09-30 — phase 3 — [task 1/1] Skill tool for the two artifact skills

- **Class:** forced
- **Item:** [task 1/1] n/a n/a — pre-flight conflict: Tasks 1, 7 and 8 must load `artifact-design` and `artifact-capabilities` with the Skill tool, but the run forbids the Skill tool to the controller and every worker
- **Contract clause:** "Load the skills `artifact-design` and `artifact-capabilities` with the Skill tool." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md, Task 1
- **Defensible answers:** n/a
- **Forks:** none; contradiction: none
- **Resolution:** plan governs: "Load the skills `artifact-design` and `artifact-capabilities` with the Skill tool." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — Spec section 6 requires the implementer to load these skills, the Artifact tool itself requires both before any artifact page or runtime code is written, and neither skill belongs to the superpowers-orchestrator plugin that the no-Skill-tool rule keeps out, so reading the bundled `.d.ts` files or having the orchestrator load the skills would produce page code written without the platform's required guidance.

## Ruling 2 — 2026-09-30 — phase 3 — [task 3/1] One page copy of the note and status rules

- **Class:** design
- **Item:** [task 3/1] n/a n/a — pre-flight conflict: the note rule, the part statuses and `localIso` must run in the browser page (Task 8) and in Node (Tasks 3, 10), and the Task 7 and Task 9 Contracts give the page no way to load shared code, so the plan forces a copy
- **Contract clause:** "Invariants: no edit control and no write when the viewer is not the owner, when the store is missing (the local file, the shared page) or when the proposals cou" — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md, Task 8
- **Defensible answers:** (a) plan governs: keep the one copy across the runtime boundary, comments naming the other copy, a parity test; (b) amend plan: the renderer inlines the shared rules into the page (a fourth placeholder or a third published file); (c) amend spec 5.1 so the data carries the limits and statuses (the `localIso` copy stays)
- **Forks:** 3 of 3 — design consistency: VERDICT: (a) plan governs — keep the copy across the runtime boundary, each copy names the other in a comment, and a parity test pins the page's `localIso` and note check to the Node versions; implementation practicality: VERDICT: (a) plan governs: keep the one cross-runtime copy, with comments naming the other copy and a parity test; adversarial: VERDICT: (a) plan governs — keep the copy across the runtime boundary, and widen the parity test to cover `PART_STATUSES`, `NOTE_LIMIT`, `NOTE_FORBIDDEN` and `localIso`; contradiction: none. TABLED by two lenses: move the three constants into `dashboard-parse.js` so `dashboard-sync.js` imports them; the parity test goes into test-08.
- **Resolution:** plan governs: "Invariants: no edit control and no write when the viewer is not the owner, when the store is missing (the local file, the shared page) or when the proposals cou" — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — the Task 8 and Task 10 Contracts bind the rules in both runtimes and the Task 7/9 Contracts and spec section 4 fix the page files, so one bounded, tested copy in the page changes no binding text; (b) breaks two binding Contracts or spec section 4, (c) changes the spec and still leaves the `localIso` copy; the tabled refinement removes the Node-to-Node copy at no Contract cost.

## Ruling 3 — 2026-09-30 — phase 3 — [task 7/1] Dark tokens in the two required blocks

- **Class:** forced
- **Item:** [task 7/1] n/a n/a — pre-flight conflict: the Task 7 Contract requires the dark color tokens under both the media-query block and the `:root[data-theme="dark"]` block, so the token assignments appear twice, which the DRY rule reports as duplication
- **Contract clause:** "Invariants: every value from the data is inserted with `textContent` or `setAttribute` (Global Constraint 3); the app script contains none of `innerHTML`, `oute" — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md, Task 7
- **Defensible answers:** n/a
- **Forks:** none; contradiction: none
- **Resolution:** plan governs: "Invariants: every value from the data is inserted with `textContent` or `setAttribute` (Global Constraint 3); the app script contains none of `innerHTML`, `oute" — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — The Task 7 Contract and the Artifact tool's own page contract require the dark tokens under both blocks, which CSS can satisfy only with two assignment lists, and the DRY rule excludes writing each color value twice when one `--dark-*` token per value costs nothing, so only outcome (a) — each dark color value written once as a `--dark-*` token, both blocks mapping to it, with a comment naming the platform requirement — keeps both; (c) departs from the platform contract.

## Ruling 4 — 2026-09-30 — phase 3 — [task 9/1] The --data-dir literal and the unread option

- **Class:** forced
- **Item:** [task 9/1] n/a n/a — pre-flight conflict: Global Constraint 10 and the Contracts of Tasks 9, 11 and 12 require the same `--data-dir` literal on every `SKILL.md` script command and a `--data-dir` option that the render and sync scripts accept and never read, which the DRY rule reports
- **Contract clause:** "[6, 10] '`SKILL.md` therefore writes every script command with `--data-dir '${CLAUDE_PLUGIN_DATA}'`, and the scripts take the path only from that argument." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md, Global Constraints
- **Defensible answers:** n/a
- **Forks:** none; contradiction: none
- **Resolution:** plan governs: "[6, 10] '`SKILL.md` therefore writes every script command with `--data-dir '${CLAUDE_PLUGIN_DATA}'`, and the scripts take the path only from that argument." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — Global Constraint 10 quotes spec sections 6 and 10, which require every script command to carry the literal, and the platform substitutes the variable only in the skill text with a fresh shell per call, so outcome (b) changes the spec and only outcome (a) — the repeated literal and the accepted, unread option are required, not DRY or unused-parameter defects, with one comment at each script's option naming Global Constraint 10 — changes neither the spec nor a binding Contract.

## Ruling 5 — 2026-09-30 — phase 3 — [task 2/1] Run-scan failures as a returned field

- **Class:** design
- **Item:** [task 2/1] n/a n/a — pre-flight conflict: Global Constraint 4 says the output of `pickup-scan.js` does not change, while the Task 4 and Task 6 Contracts and spec line 684 need `scanRuns` to report a failed git command so the dashboard section gets `status` `error`
- **Contract clause:** "'`pickup-scan.js` requires the module and prints the list in its own format (relative dates included); its output does not change'." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md, Global Constraints
- **Defensible answers:** (A) `scanRuns` reports the failure; `pickup-scan.js` keeps standard output and adds one standard-error line on a failure; (B) `scanRuns` reports the failure; `/pickup` stays silent on purpose, the ignoring code named in a comment, the standing rule widened to swallowed errors
- **Forks:** 3 of 3 — design consistency: VERDICT: (B), in its field form: `scanRuns` returns each git failure as data on its result and does not throw; the dashboard sets `status` `error` from that field; `pickup-scan.js` does not read the field and prints exactly as before; implementation practicality: VERDICT: (A) — `scanRuns` reports each git failure; `pickup-scan.js` keeps its standard output and adds one line on standard error only when the scan reports a failure; adversarial: VERDICT: (B), in one exact form: `scanRuns` returns the failure as a data field and never throws; `pickup-scan.js` leaves that field unread, with one comment naming Global Constraint 4; no try/catch is added; contradiction: settled — the field form has no catch and no ignoring code, so the swallowed-error objection behind (A) does not apply to it, while (A) makes the model see new standard-error text from `/pickup` (the Bash tool shows standard error), which reinterprets the spec sentence that Global Constraint 4 quotes.
- **Resolution:** plan governs: "'`pickup-scan.js` requires the module and prints the list in its own format (relative dates included); its output does not change'." — docs/superpowers-orchestrator/2026-09-29-dashboard/plans/dashboard.md — outcome (B) in its field form: `scanRuns` in `git-runs.js` returns every git failure of the scan as data on its result (for example `errors: [{ command, message }]`), never throws and prints nothing; the dashboard (Tasks 4 and 6) sets `status` `error` from that field; `pickup-scan.js` does not read the field, keeps its output exactly as before, and carries one comment naming Global Constraint 4; no try/catch and no new standing-rule clause are needed.

## Ruling 6 — 2026-09-30 — phase 3 — [task 1/2] Platform check 9 contradicted: where sync gets each version

- **Class:** escalated (spec wrong)
- **Item:** [task 1/2] n/a n/a — platform check 9 contradicted: the files that ArtifactData `query` with `out_dir` writes hold only the document body (no `id`, no `version`), so the plan does not say how `dashboard-sync.js` gets each proposal's version
- **Contract clause:** "The per-document files written by ArtifactData `query` with `out_dir` carry each document's version." — docs/superpowers-orchestrator/2026-09-29-dashboard/specs/dashboard-design.md, n/a
- **Defensible answers:** n/a
- **Forks:** none; contradiction: none
- **Resolution:** escalated — spec section 13 says "a failed check returns the design to the user", and every route (inline `query` result, a versions file copied by the model, one `get` per document) changes the `sync` design of the spec
