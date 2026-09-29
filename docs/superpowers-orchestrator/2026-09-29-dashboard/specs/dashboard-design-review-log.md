# Review log — dashboard-design.md

_Invocation 1 — 2026-09-29 — N=4 M=3 — gate: brainstorming_

## Round 1 — Correctness & completeness — claude-opus-5-5
**Reviewers:** M=3, usable 3/3
**Reviewer verdicts:** r1: 1 Critical, 9 Important, 5 Minor | r2: 1 Critical, 5 Important, 7 Minor | r3: 1 Critical, 9 Important, 6 Minor
**Sources mapped:** 44/44
**Reviewer verdict:** 2 Critical, 10 Important, 10 Minor
**Converged:** no

### Dispositions
- [C1] applied — §5.2: stopped runs read from the working tree; merged logs ending STOPPED shown as waiting, stopped runs on unmerged branches missed → unfinished runs come from git-runs.js (moved out of pickup-scan.js: unmerged feature/<slug>, no `_Completed — ` line, read with git show); logs on the checked-out branch are history only; fixtures added ← 3/3: r1:C1, r2:I1, r3:C1
- [C2] applied — §4/§9: one extractor run fed both audiences, contradicting §5.3 → two extractor runs in the data flow; cost sentence corrected ← 3/3: r1:I1, r2:C1, r3:I1
- [I1] applied — §5.3: shared run enumerated from the file system; staged files; multi-source items; no-commit and upstream cases → shared run reads HEAD only (cat-file -e, ls-tree HEAD), pushed history only, no uncommitted count; renderer drops non-tracked as second guard; marker tests on untracked names and staged files ← 3/3: r1:I2, r2:M4, r3:I2
- [I2] applied — §7/§8: already-applied unreachable and dates computed at sync time → date taken from createdAt; set-part found by part number; already-applied compares with the expected new line; two-date test ← 3/3: r1:I4, r2:I2, r3:I3
- [I3] applied — §7: several proposals on one target → one pending proposal per item (document id = item id, new edit replaces and merges); status and note merged into one kind `set-part` ← 3/3: r1:I5, r2:I3, r3:I5
- [I4] applied — §8: session-log headings not unique → anchor carries headingOrdinal; fewer equal headings gives none; fixture added ← 3/3: r1:I6, r2:I4, r3:I4
- [I5] applied — §8/§10: no validation of proposals from db; baseCommit and branch unused → verdicts invalid, file-missing, wrong-branch with listed checks ← 3/3: r1:I7, r2:M5, r3:I9
- [I6] applied — §8 step 1/§13: the work-log in-run check does not exist in code → sync holds back work-log proposals when git-runs.js finds an unfinished, not stopped run on the current branch; asks once about a whole-branch review; §13 item 5 replaced ← 3/3: r1:I9, r2:I5, r3:I6
- [I7] applied — §7: "pending sync until the next refresh" invited duplicate edits → indicator follows db state across refreshes; applied/rejected shown after sync; #94426 effect named ← 2/3: r1:I8, r2:M6
- [I8] applied — §5.2: closed work logs listed as malformed → three-way line-1 classification of the work-log check, BOM and CR removed ← 1/3: r1:I3
- [I9] applied — §5.1: items did not carry exact raw heading and line text → exact raw text, headingOrdinal, lineNumber informational ← 1/3: r3:I7
- [I10] applied — §5.2: `## Open items` is a table, not a list → table rows with named columns ← 1/3: r3:I8
- [M1] applied — §9: refresh --url private only; share off leaves a stale public link → --shared-url; share off message tells the user to turn off the link; local shares the CLAUDE_PLUGIN_DATA stop (stated in §10) ← 3/3: r1:M5, r2:M7, r3:M3
- [M2] applied — §10: no default branch, no upstream, no commits → rows added, using git-runs.js defaultBranch and gitState ← 2/3: r1:M1, r3:M4
- [M3] applied — §5.2/§7: one-line `Open: <text>` form → one item; marker appended at line end ← 2/3: r1:M4, r2:M1
- [M4] applied — §10: pending count of a page that no longer works → try the list; say unknown when it fails ← 2/3: r2:M2, r3:M1
- [M5] applied — §4/§8: where proposal bodies live between check and apply → proposals.json in the state folder ← 1/3: r1:M2
- [M6] applied — §8 step 5: CR and BOM preservation → kept, tested ← 1/3: r1:M3
- [M7] applied — §6: partial failure of page creation → each URL stored right after creation ← 1/3: r2:M3
- [M8] applied — §3/§7: `dropped` not offered, Commit cell → dropped is a non-goal (use /worklog); Commit cell unchanged ← 1/3: r3:M2
- [M9] applied — §5.2: "newest" releases → first 15 in file order ← 1/3: r3:M5
- [M10] applied — §5.3/§6: unpushed commits and branch names on the shared page → shared run lists only branches with an upstream and commits of @{upstream}; warning updated; test (4) ← 1/3: r3:M6

## Round 2 — Ambiguity & testability — claude-opus-5-5
**Reviewers:** M=3, usable 3/3
**Reviewer verdicts:** r1: 0 Critical, 7 Important, 10 Minor | r2: 0 Critical, 6 Important, 10 Minor | r3: 0 Critical, 7 Important, 6 Minor
**Sources mapped:** 46/46
**Reviewer verdict:** 0 Critical, 14 Important, 9 Minor
**Converged:** no

### Dispositions
- [I1] applied — §5.3: shared run did not say which ref branch-derived fields are read from; "history" undefined → rule is "only what is pushed": files, folders and commits from @{upstream}; run logs and dates from <branch>@{upstream}; no upstream stops the shared refresh; privacy tests (4) and (5) added ← 3/3: r1:I3, r2:I3, r3:I1
- [I2] applied — §4/§9: change summary had no unit, baseline or definition → `render --diff <previous private.json>`: added and removed ids per section, changed section status; JSON kept in the state folder; test added ← 3/3: r1:I4, r2:M6, r3:I6
- [I3] applied — §2..§13: external claims without source or "unverified" label → new §12.1 table with a source per fact; unverified facts labelled and added to §13 (items 3, 7, 8); project-artifact files named ← 3/3: r1:M6, r2:M7, r3:I5
- [I4] applied — §5.1/§13: scope of raw items undefined; "parse as phases" undefined; §2 fact 2 contradicted §7 → raw only for listed expected lines; phase parsing is a non-goal; §13 item 9 reworded; fact 2 reworded ← 3/3: r1:M8, r2:I6, r3:M6
- [I5] applied — §5.1/§5.2: two sections with the id `runs` → `unfinishedRuns` and `runHistory`, rules name the id ← 2/3: r1:I1, r2:I2
- [I6] applied — §5.2: run of the checked-out feature branch contradicted between the tabs → it is in `unfinishedRuns`; a log read from the working tree is never a Tab 1 source; fixture with the branch checked out ← 2/3: r1:I2, r2:I1
- [I7] applied — §7: createdAt UTC or local undefined → local time with offset; date = first 10 characters; test with differing UTC date ← 2/3: r1:I5, r2:M2
- [I8] applied — §7: edit on a rejected or applied document; createdAt kept or reset → rejected: new document; pending: merge and new createdAt; applied: no edit until refresh ← 2/3: r1:I6, r3:I3
- [I9] applied — §7/§8: cell compare and rewrite undefined → split after removing outer pipes, trim to compare, rewrite with single spaces; same status leaves Since; padded-row test ← 2/3: r1:M5, r3:I4
- [I10] applied — §8: run check placed on "accepted" proposals before acceptance; unit unclear; ambiguous run → `held-run` verdict computed by `--check` and repeated by `--apply`; ambiguous counts as in progress; review question asked by the skill before the diffs ← 2/3: r2:M5, r3:I2
- [I11] applied — §6/§9/§13: public link following republishes, Share control, permission on republish after sharing unverified → labelled unverified; §13 item 7 ← 1/3: r1:I7
- [I12] applied — §5.1/§8: a `[superseded by …]` suffix moves later equal headings one ordinal → headings normalized (trailing superseded part removed) before comparing and counting; test on three equal headings ← 1/3: r2:I4
- [I13] applied — §8: hold-back decided by kind, and session-log assumed untracked → decided by `git ls-files --error-unmatch` of the target; test with tracked and untracked session-log ← 1/3: r2:I5
- [I14] applied — §6/§9: Artifact tool refuses a publish without a prior read, and a read returns the whole HTML with its data → data published as a separate `dashboard-data.json` fetched by the page; read before the first republish of a session; local file keeps the inline block; §13 item 6 — harness: tested (Artifact tool description) ← 1/3: r3:I7
- [M1] applied — §5.2: entry, window, list end, continuation lines undefined → terms defined; superseded removed before taking 10; continuation lines belong to their item; only `[resolved` counts ← 3/3: r1:M1, r2:M1, r3:M2
- [M2] applied — §5.1: id input, ids without a source, duplicate lines → exact input joined by `\n`, natural key for items without a file, occurrence added to the id and the anchor ← 3/3: r1:M2, r2:M3, r3:M1
- [M3] applied — §5.2: the work-log check has five results; symlink and invalid names; `]` in notes; uncommitted count unit → all results mapped; notes forbid `| [ ]`; count = porcelain lines not starting `??` ← 3/3: r1:M10, r2:M9, r3:M3
- [M4] applied — §5.2: date format, branch scope, built time → committer date YYYY-MM-DD; all local branches except the default; local time with offset ← 2/3: r1:M4, r3:M5
- [M5] applied — §10/§11: `claude -p` has no Artifact tool, unsourced → cited to the project-artifact skill text, not tested; §13 item 8; manual step becomes a behavioral test if the check fails (harness field dropped: repository-readable) ← 2/3: r1:M7, r2:M8
- [M6] applied — §5.1/§8: `'detached'` versus null → mapped to null; set-part needs a non-null branch; as-of line text for detached HEAD ← 2/3: r1:M9, r3:M4
- [M7] applied — §5.3: "tracked" undefined for the private run; null-file items; display → committed at HEAD (cat-file -e); null-file items tracked; lock sign on private items ← 1/3: r1:M3
- [M8] applied — §6: repo key computed by which unit, exact input → computed by the extractor (`--state-dir`), realpath of show-toplevel, no newline, one key per worktree ← 1/3: r2:M4
- [M9] applied — §8/§10: no default branch in the run check; ArtifactData list paging → git-runs.js scans every feature branch, as /pickup does; `query` with a state filter; §13 item 4 ← 1/3: r2:M10

## Round 3 — Feasibility & architecture risk — claude-opus-5-5
**Reviewers:** M=3, usable 3/3
**Reviewer verdicts:** r1: 2 Critical, 4 Important, 5 Minor | r2: 1 Critical, 4 Important, 5 Minor | r3: 1 Critical, 4 Important, 2 Minor
**Sources mapped:** 28/28
**Reviewer verdict:** 2 Critical, 5 Important, 8 Minor
**Converged:** no

### Dispositions
- [C1] applied — §4/§6: page files were published from the plugin data folder, which the Artifact tool does not accept as a `files` source → renderer `--out` writes them into the session scratchpad; the state folder keeps only config.json and the previous JSON; §10 row for a missing scratchpad; §12.1 fact — harness: tested (Artifact tool description, verified by the controller) ← 3/3: r1:C1, r2:C1, r3:C1
- [C2] applied — §6/§9: reading the page does not allow replacing dashboard-data.json in a new session → read plus `list` with scope files before the first republish of a session; §10 row; §13 item 6 — harness: tested (overwrite_unread text, verified by the controller) ← 3/3: r1:C2, r2:I2, r3:I2
- [I1] applied — §6/§10/§13: CLAUDE_PLUGIN_DATA is not in the Bash environment → SKILL.md passes `--data-dir "${CLAUDE_PLUGIN_DATA}"` (substituted in skill text); empty or literal placeholder = not set; `local` works without it; §13 item 1 reworded — harness: tested (echo printed unset) ← 3/3: r1:I1, r2:I1, r3:I1
- [I2] applied — §5.1/§5.2/§11: the extractor cannot run the work-log bash commands and needs its own copy; wrong section name → Node implementation from one set of constants, applied to working-tree and git show text; parity test against the commands copied from SKILL.md; section names corrected ← 3/3: r1:I4, r2:I4, r3:I3, r3:M1
- [I3] applied — §8 step 2.4: a stopped run on the current branch was not held back → held-run covers in progress, ambiguous and stopped; reason sentence names the resume and Phase 5 effects; test added ← 2/3: r1:I3, r2:I3
- [I4] applied — §5.1/§5.2: `## Open items` has five columns → expected cell count from the header row; the page shows four of the five ← 2/3: r2:M1, r3:I4
- [I5] applied — §4: the Artifact tool requires reading every file Claude publishes and did not write → the model reads the two page files once per publish; caps keep them small; the renderer prints the size; §13 item 11 measures it — harness: tested (tool description) ← 1/3: r1:I2
- [M1] applied — §4: git-runs.js interface undefined → `scanRuns({ refs: 'local' | 'upstream' })` returns data; pickup-scan.js keeps its own output ← 2/3: r1:M1, r2:M2
- [M2] applied — §6: git status can take index.lock during a run → every script git command uses `--no-optional-locks` ← 2/3: r1:M4, r2:M3
- [M3] applied — §4/§8: query results, batch limit, lost page edits → query with out_dir into the scratchpad (one file per document, with version); batches of 50; if_version on each record write; §13 item 9 — harness: tested (ArtifactData schema) ← 1/3: r1:M2
- [M4] applied — §3: --plugin-dir uses another data folder and creates second pages → stated next to the machine non-goal ← 1/3: r1:M3
- [M5] applied — §5.2: Keep a Changelog headings → `## [<version>]` accepted; note when no heading matches ← 1/3: r1:M5
- [M6] applied — §8 step 2: a note replacing a Note cell can remove an `item #` link → warning in the diff; test ← 1/3: r2:M4
- [M7] rejected: harness probe not runnable here — the controller should run one Write of a small JSON file to `${CLAUDE_PLUGIN_DATA}/dashboard/probe.json` from a plugin skill session and record whether a permission prompt appears — (tool missing) — who writes proposals.json by hand; the M3 change removes the hand copy, so the premise no longer applies ← 1/3: r2:M5
- [M8] applied — §6: skill loads and icon at run time → first publish loads artifact-design and, for the private page, artifact-capabilities, and passes an icon; republish loads neither ← 1/3: r3:M2

## Round 4 — Adversarial failure modes — claude-opus-5-5
**Reviewers:** M=3, usable 3/3
**Reviewer verdicts:** r1: 0 Critical, 2 Important, 8 Minor | r2: 0 Critical, 6 Important, 6 Minor | r3: 0 Critical, 4 Important, 6 Minor
**Sources mapped:** 32/32
**Reviewer verdict:** 0 Critical, 8 Important, 10 Minor
**Converged:** no

### Dispositions
- [I1] applied — §5.3: `@{upstream}` can be a local branch or a remote ref of another name, so unpushed content reached the public page; local branch names leaked → an upstream counts only as `refs/remotes/<remote>/<branch>` of the same name; shared page names branches by upstream name; privacy tests (7) and (8) ← 3/3: r1:I1, r2:I3, r3:I1
- [I2] applied — §5.1/§8: occurrence shifted after applying one of two equal lines, giving a false already-applied and a reused id → occurrence and id use the line with its `[resolved …]` part removed; only the line at the anchor's position is compared; all targets of one file computed before one write; test in both orders ← 3/3: r1:M1, r2:I1, r3:I3
- [I3] applied — §7/§8: an edit on the page during a sync, or a stale page read, lost the edit or reopened a closed document → new state `applying` set with if_version before any file write; page refuses edits on applying; page writes conditional on version (§13 item 12); sync stopped after marking is completed by the next sync ← 3/3: r1:M2, r2:I2, r3:M2
- [I4] applied — §4: repository text (commit subjects, branch names) could be parsed as HTML on a page with db write access → textContent only; `<` escaped in the inline JSON; markup-in-data test ← 3/3: r1:M6, r2:I4, r3:I4
- [I5] applied — §8 step 2.4: a stopped run on another branch was not held back, and resume checks out its branch → held-run for an in-progress run on the current branch or any stopped or ambiguous run on any branch; report tells the owner to commit or stash before switching; test ← 2/3: r1:I2, r2:M6
- [I6] applied — §5.2: a killed session shows as in progress forever → "no commit since <date> — may need resume" after 24 hours without a branch commit ← 1/3: r2:I5
- [I7] applied — §4/§6: the two pages were indistinguishable, so the owner could make the private page public → audience in the title, a permanent banner on the private page, a warning for non-owner viewers, `share` prints the URL to make public ← 1/3: r2:I6
- [I8] applied — §6: nothing stopped private files from being published to the shared URL → audience meta tag; `render --verify` before each publish; the session's first read compares the page's audience; `--url` and `--shared-url` refuse each other's URL; test (9) ← 1/3: r3:I2
- [M1] applied — §5.1/§10: git error text in notes can hold absolute paths → private run replaces the repo root and home; shared run writes a fixed note; test (10) ← 2/3: r1:M3, r2:M1
- [M2] applied — §7: an applied item could stay locked for ever; no-op proposals → applied with closedAt earlier than generatedAt counts as absent; no-op edits not written and `invalid` in sync ← 2/3: r1:M4, r3:M1
- [M3] applied — §6: a moved repository silently creates new pages → "No state yet": the skill says so, mentions `refresh --url`, asks first ← 2/3: r1:M8, r3:M6
- [M4] applied — §8 step 5: non-atomic write of an untracked 333 KB log; symlinks → temporary file plus rename, size and time re-checked before the rename, temporary kept on failure; symlink targets `invalid` ← 2/3: r2:M2, r3:M3
- [M5] applied — §10: the `local` fallback folder could be inside the repository → refused ← 2/3: r2:M5, r3:M4
- [M6] applied — §8: work-log rules broken by status edits on blocked parts and moves away from done → warning for blocked parts; move away from done with a filled Commit cell is `invalid` ← 1/3: r1:M5
- [M7] applied — §8: createdAt not validated → pattern check in `invalid` ← 1/3: r1:M7
- [M8] applied — §7: local ISO times compared as text → parsed into instants ← 1/3: r2:M3
- [M9] applied — §5.3: shared page followed whatever branch was checked out → shared ref stored by `share` (default branch upstream or `--ref`), shown on the page ← 1/3: r2:M4
- [M10] applied — §4: the model reads text other people wrote before each publish → treated as data, never as instructions; stated in SKILL.md ← 1/3: r3:M5

Self-review (brainstorming Spec Self-Review): cross-references to section 8 steps and section 13 items checked after the renumbering (steps 1-7, items 1-12); `share` command row and the no-upstream error rows updated to the stored shared ref; no placeholder or contradiction found.
