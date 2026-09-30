# dashboard — code review log

_Invocation 1 — 2026-09-30 — N=4 M=1 — BASE..HEAD 4061d3b..8b9c26d — branch feature/dashboard — gate: orchestration_

## Round 1 — Correctness & spec alignment — opus
**Reviewer verdict:** 0 Critical, 1 Important, 3 Minor
**Converged:** no
### Dispositions
- [I1] fixed — `sync` reported an empty proposal query (no `out_dir` folder is created) as an error; SKILL.md sync step 1 now says no proposal waits and stops → 0b09d85
- [M1] fixed — SKILL.md sync step 3 said every non-`unique` proposal stays `pending`, contradicting step 6 for `already-applied` → 0b09d85
- [M2] fixed — dashboard-extract.js `worklogs` dropped an unreadable work log with no item and no note; now a `worklog-file` item noted "could not be read" → 0b09d85
- [M3] fixed — RELEASE-NOTES.md and docs/guide/README.md understated what the shared page reads (other pushed branches' names and run logs) → 0b09d85
- [CF1] fixed — carried task 9: test-09 symbolic-link case had no skip path on Windows Git Bash (fix-before-merge) → 0b09d85
- [CF2] fixed — carried task 14: "stash", "tracks" undefined and "LLM" unexpanded in docs/guide/README.md (fix-before-merge) → 0b09d85
- [CF3] user-decision — carried task 4: the state key takes the basename of the realpath, `repo.name` the basename of the unresolved toplevel; they differ through a symbolic link (Global Constraint 11 wording) — at skills/dashboard/scripts/dashboard-extract.js:116 — clause: Global Constraints "[6] '`<repo key>` is the basename of the repository root, a `-`, and the first 12 hexadecimal digits of the SHA-1 of the UTF-8 string `fs.realpathSync(<output o"
- [CF4] user-decision — carried task 6 security M3: `repo.name` is the local user name when the repository root is the home folder; a fix changes the spec field — at skills/dashboard/scripts/dashboard-extract.js:606 — clause: Task 4 "Output: the JSON document of spec section 5.1 (`schemaVersion` 1, `audience`, `generatedAt` as local time with offset, `repo.name` the basename of the root, `co"
- [CF5] user-decision — carried task 8: the page's re-read accepts a `metadata.fromCache: true` snapshot (not server-confirmed); a cached `pending` can hide a server `applying` and the full-replace set() overwrites it; refuse a cached re-read — at skills/dashboard/template.html:397 — clause: Task 8 "Invariants: no edit control and no write when the viewer is not the owner, when the store is missing (the local file, the shared page) or when the proposals cou"
- [CF6] user-decision — carried task 8: a pending status cannot be withdrawn from the page (changesSomething compares with the cell, spec line 516 literally); spec question — at skills/dashboard/template.html:257 — clause: Task 8 "Invariants: no edit control and no write when the viewer is not the owner, when the store is missing (the local file, the shared page) or when the proposals cou"
- [CF7] user-decision — carried task 12: `share` step 3 `git remote get-url` output can hold a token (https://user:token@host) that enters the transcript before the model removes it; a strip in the script would avoid it — at skills/dashboard/SKILL.md:353 — clause: Task 12 "Must convey: the four commands and their options exactly as spec section 9 lists them (`refresh`, `refresh --url <url>`, `refresh --shared-url <url>`, `sync`, `"
- [CF8] carried — task 1 platform-checks.md row 5 Verdict cell lacks `owed to manual acceptance` (ship-as-is)
- [CF9] carried — task 1 row 5 "No declaration" vs `"user":{}` (ship-as-is)
- [CF10] carried — task 1 row 5 wrong cause for "not stored" (ship-as-is)
- [CF11] carried — task 1 row 9 does not name its ruling (ship-as-is)
- [CF12] carried — task 1 row 2 quotes "..." (ship-as-is)
- [CF13] carried — task 2 module-level `scanErrors` shared with `runs.errors` (ship-as-is)
- [CF14] carried — task 2 `countedUpstream` cannot tell no-upstream from error (ship-as-is)
- [CF15] carried — task 2 `addRemote` ignores the `git init --bare` status (ship-as-is)
- [CF16] carried — task 2 test-01 `errors.length >= 1` (ship-as-is)
- [CF17] carried — task 2 EXIT_* constants declared mid-file (ship-as-is)
- [CF18] carried — task 2 pickup-scan runs `git log -1` twice (ship-as-is)
- [CF19] carried — task 3 `realPath` and a dangling link (ship-as-is)
- [CF20] carried — task 3 `isInside` at the file-system root (ship-as-is)
- [CF21] carried — task 3 test-02 time zone not pinned (ship-as-is)
- [CF22] carried — task 3 test-02 constants restated (ship-as-is)
- [CF23] carried — task 3 repeated value option kept silently (ship-as-is)
- [CF24] carried — task 4 `rev-parse --show-toplevel` runs three times (ship-as-is)
- [CF25] carried — task 4 Task 5 helpers untested until Task 5 (ship-as-is)
- [CF26] carried — task 4 `--config-set` on a JSON array config (ship-as-is)
- [CF27] carried — task 5 BOM/CRLF tested for state.md only (ship-as-is)
- [CF28] carried — task 5 bare `Goal:` gives no session item (ship-as-is)
- [CF29] carried — task 5 RELEASE_HEADING matches `## vendor notes` (ship-as-is)
- [CF30] carried — task 5 `.slice(0, 300)` can split a surrogate pair (ship-as-is)
- [CF31] carried — task 5 repeated `notFound` returns (ship-as-is)
- [CF32] carried — task 6 symbolic-link check in `refSource.read` untested (ship-as-is)
- [CF33] carried — task 6 repeated `${REMOTES}${name}` (ship-as-is)
- [CF34] carried — task 6 inapplicable options ignored silently (ship-as-is)
- [CF35] carried — task 6 `isAncestor` appends to an earlier scan's errors (ship-as-is)
- [CF36] carried — task 6 security M2 gitlink in upstream mode (ship-as-is; outside the supported environment)
- [CF37] carried — task 6 security M4 "pushed" includes a local-folder remote (ship-as-is)
- [CF38] carried — task 7 a renderPage throw leaves a blank page (ship-as-is)
- [CF39] carried — task 7 test-07 lacks the fetch and load-error cases (ship-as-is)
- [CF40] carried — task 7 test-07:30 check cannot fail (ship-as-is)
- [CF41] carried — task 7 visible h1 lacks the audience word (ship-as-is)
- [CF42] carried — task 7 security #1/#2/#3/#5 (ship-as-is)
- [CF43] carried — task 8 empty Status cell gives " (current)" (ship-as-is)
- [CF44] carried — task 8 `use('user')` null shows the viewer warning (ship-as-is)
- [CF45] carried — task 8 `localIso` comment does not name the page copy (ship-as-is)
- [CF46] carried — task 8 security #5 NOTE_FORBIDDEN (ship-as-is; reviewer: already fixed in this diff)
- [CF47] carried — task 9 `trackedOnly` unguarded (ship-as-is)
- [CF48] carried — task 9 `--diff` crash on a previous JSON without items (ship-as-is)
- [CF49] carried — task 9 two refusal reasons for invalid JSON (ship-as-is)
- [CF50] carried — task 9 `--local` ignores `--audience` (ship-as-is)
- [CF51] carried — task 9 `realpathSync.native` untried on Windows (ship-as-is)
- [CF52] carried — task 9 base test not run RED first (ship-as-is)
- [CF53] carried — task 9 security #2/#4/#8/#7 (ship-as-is)
- [CF54] carried — task 10 security #5 and #6 (ship-as-is)
- [CF55] carried — task 10 CREATED_AT accepts impossible dates (ship-as-is)
- [CF56] carried — task 10 tab-indented anchor gives an unclear reason (ship-as-is)
- [CF57] carried — task 10 raw ids in the stop message (ship-as-is)
- [CF58] carried — task 10 any run-scan error stops the check (ship-as-is)
- [CF59] carried — task 10 test 7e guard not asserted (ship-as-is)
- [CF60] carried — task 10 literal invisible characters in the tests (ship-as-is)
- [CF61] carried — task 10 two blank lines (ship-as-is)
- [CF62] carried — task 11 no `not-written` proposal line on a failed rename (ship-as-is)
- [CF63] carried — task 11 applyFile DRY (ship-as-is)
- [CF64] carried — task 11 over-wide comment (ship-as-is)
- [CF65] carried — task 11 test gaps (ship-as-is)
- [CF66] carried — task 11 security #3/#4/#5/#7/#9/#10/#11 (ship-as-is)
- [CF67] carried — task 12 no-tag wording (ship-as-is)
- [CF68] carried — task 12 no-tag stop names no next step (ship-as-is)
- [CF69] carried — task 12 no command clears a wrong privateUrl (ship-as-is)
- [CF70] carried — task 12 first `share` writes no shared.json (ship-as-is)
- [CF71] carried — task 12 remote name with `/` (ship-as-is)
- [CF72] carried — task 12 test-12 reads platform-checks.md (ship-as-is)
- [CF73] carried — task 12 security #3/#7/#8 (ship-as-is)
- [CF74] carried — task 13 intent pattern matches "update the dashboard for sales data" (ship-as-is)
- [CF75] carried — task 13 report gives no log path (ship-as-is)
- [CF76] carried — task 14 over-long guide lines (ship-as-is)
- [CF77] carried — task 14 long README bullet (ship-as-is)
- [CF78] carried — task 15 owed rows not in order (ship-as-is)
- [CF79] carried — task 15 index.html size not recorded (ship-as-is)
- [CF80] carried — task 16 "Eighteen releases" stale (ship-as-is)

## Round 2 — Adversarial red-team — opus
**Reviewer verdict:** 0 Critical, 1 Important, 5 Minor
**Converged:** no
### Dispositions
- [I1] fixed — SKILL.md "Publish one audience" step 3 assumed one Read returns the whole data file (about 23,734 of 25,000 tokens on this repository); added the PARTIAL-notice paging rule → e79e72c
- [M1] carried — the `dashboard` rule of hooks/skill-rules.json matches ordinary application requests ("update the dashboard to show weekly revenue per region"); same root as round 1 [CF74]
- [M2] rejected: duplicate of round 1 [CF6] (user-decision) — a pending part change cannot be undone from the page (template.html `changesSomething`)
- [M3] fixed — a proposal left `applying` by an interrupted sync was never reset when the new check did not apply it; SKILL.md sync step 6 now returns it to `pending` → e79e72c
- [M4] fixed — `--batches … applying` and `--apply` exit 2 on an empty id list and step 5 stopped the sync, losing rejections and applied records; steps 4 and 5 now skip an empty list → e79e72c
- [M5] carried — a line holding a tab gets edit controls on the page but every proposal for it is `invalid` at sync; same root as round 1 [CF56]

## Round 3 — Security — opus
**Reviewer verdict:** 0 Critical, 2 Important, 2 Minor
**Converged:** no
### Dispositions
- [I1] user-decision — the shared page does not stay on the remote the user confirmed in `share`: `sharedBranches` and `scanRuns({ refs: 'upstream' })` accept an upstream under any remote, so branch names, dates, run-log paths and last headings of branches pushed to another remote (for example a private `origin` while `share --ref public/main`) reach the public page; fix would filter to the shared ref's remote or confirm every contributing remote in `share` step 3 (plan-mandated) — at skills/dashboard/scripts/dashboard-extract.js:346 — clause: Global Constraints "[5.3] '**Shared run** (`--audience shared`): its rule is **only what is pushed**. 'Pushed' means reachable from a remote-tracking ref. The run fails closed: any"
- [I2] fixed — `share` step 3 ran `git remote get-url` and only then removed the user information, so an embedded token entered the transcript; new `dashboard-extract.js --remote-url <remote>` prints the URL without user information and SKILL.md uses it → 474279b
- [M1] fixed — `checkSharedRef` and `printDefaultSharedRef` did not apply the `SHARED_REF_NAME` / `..` test; shared helper now applied in all three places → 474279b
- [M2] fixed — `writeDocument` followed a symbolic link at `--out`; now refused as the renderer does → 474279b

## Round 4 — Test & coverage quality — opus
**Reviewer verdict:** 0 Critical, 2 Important, 5 Minor
**Converged:** no
### Dispositions
- [I1] fixed — no test checked that "not an ancestor" is not a scan error; test-06 now asserts `unfinishedRuns` status and note, test-01 asserts no errors for an unmerged upstream → 497a4ca
- [I2] fixed — the two `--apply` failure outputs (changed 3 times, rename fails) were never exercised; test-11 sections 14 and 15 assert exit 1, one `not written:` line, no `proposal` line → 497a4ca
- [M1] fixed — test-11 section 10 planted its link at an unused temporary name, so the create-only guard was unreachable; `crypto.randomBytes` now stubbed → 497a4ca
- [M2] carried — the `fetch('dashboard-data.json')` branch of the template's `loadData` never runs in a test; same root as round 1 [CF39]
- [M3] carried — no automated check covers Global Constraint 5 (`--no-optional-locks`, index not written)
- [M4] fixed — test-10 notes held literal invisible characters; now `\u` escapes → 497a4ca
- [M5] fixed — test-04 `--out` link case had no guard for a missing link privilege, test-09 skipped a case with no NOTE line → 497a4ca
