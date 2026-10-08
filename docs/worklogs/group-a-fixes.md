<!-- Work log: status=active slug=group-a-fixes created=2026-10-08 -->

# Work log: Group A plugin fixes (open items of 2026-10-08)

**Goal:** Fix the 13 plugin defects of group A (A1 to A13, described in
tmp/docs/2026-10-08-open-items.md, a local file) through one design step
and three releases.

**Done when:** each of A1 to A13 is fixed in a release merged into `main`,
or has a `## Decisions` entry in which the user decided not to fix it.

**Admission rule:** A finding becomes an open item only when it blocks a part from reaching the status `done`, or blocks the "done when" condition of the whole work, or when its consequence is lost user work or a wrong commit. Every other finding gets one line under `## Accepted limits`.

## How to maintain this document

Update this document without being asked, at these moments:

1. A part changes status: update its row in `## Parts`. The `Commit` cell is
   filled once, for a `done` part only: when a `done` part has an empty
   `Commit` cell and the commit that holds its last changes now exists, fill
   the cell.
2. A part is added, split or dropped: a new part gets a new row with the next
   number; part numbers are never reused. A dropped part keeps its row with
   the status `dropped`, and gets a `## Decisions` entry.
3. A problem is found and not fixed at once: apply the admission rule. If the
   problem passes, add a row to `## Open items` with the number of the line
   `Next item number`, then increase that line by one. Read the file again
   first: the number must be one that no row and no `item #<n>` text uses.
   After a merge that brought two items with one number, renumber one of them
   and set the line to one plus the highest number. If the problem does not
   pass, add one line to `## Accepted limits`.
4. An open item leaves the table: delete its row. This happens when its fix is
   committed (in a project without git: when the fix is finished and
   verified). It also happens when the user decides not to fix it, or when it
   proves wrong or a duplicate; then add one line to `## Accepted limits` in
   the form `- <YYYY-MM-DD> item #<n>: <item text> — <reason>`, so that the
   problem stays readable after its row is gone.
5. A decision is made: append an entry to `## Decisions`. Never rewrite an
   older entry; add a line that starts with `**Follow-up**` below it instead.
6. A convention appears that also applies to later parts: add it to
   `## Rules for the next parts`, and name the part that produced it.
7. Every part is `done` or `dropped` and `## Open items` has no row: ask the
   user whether to close this work log. To close it, change `status=active` on
   line 1 to `status=closed` and add ` closed=<YYYY-MM-DD>` before ` -->`.

Before starting a part, read `## Rules for the next parts` and apply every
rule. Do not commit this document on your own; it goes into the next commit
that the user requests. Keep this document on the branch where the work
happens: a session on a branch that does not hold this file cannot see it.
Some tools stop on an uncommitted file, for example an orchestrated run or a
whole-branch review of the superpowers-orchestrator plugin. Before the user
starts one, ask the user to commit this document. While such a run is in
progress, do not write this document: note the changes, and make the update
after the run ends.

## Parts

| # | Part | Status | Since | Commit | Note |
|---|------|--------|-------|--------|------|
| 1 | Design step for A1 to A13 | done | 2026-10-08 | a061765 | record `tmp/docs/2026-10-08-design-section-a.md` |
| 2 | Release 1: memory files | in progress | 2026-10-08 | | A4, A5, A10, A11, A12, A13 |
| 3 | Release 2: hook patterns and security review | not started | | | A1, A2, A3 (D10) |
| 4 | Release 3: review prompts | dropped | 2026-10-08 | | A3 moved to part 3 (D10) |

Status is one of: `not started`, `in progress`, `done`, `dropped`. A part that
an open item blocks keeps its status, and its `Note` names the item number.
`Since` is the date of the last status change. `Commit` stays empty until the
part is `done`. Then it gets, once, the short hash of the newest commit that
holds changes of the part. It is filled by the first update after that commit
exists, so it reaches git one commit later. When a
session cannot tell which commit that is, it asks the user and leaves the cell
empty until the answer. The hash is valid on the work branch; after a squash
merge or a rebase it no longer exists, and nobody has to correct it.

## Rules for the next parts

- (part 1) The specification of every release is
  `tmp/docs/2026-10-08-design-section-a.md`. A measurement wins over it: an
  implementer stops and asks when the two disagree.
- (part 1) Part 3 starts from `main` after part 2 is merged: A2 and A5 both
  edit `README.md`.
- (part 1) `tests/smart-compress` must be green before the A2 tests are
  written (open item 1).
- (part 1) The place of the A3 step inside SDD Core Flow step 3 is still
  open: the review runs between `task-brief` and the implementer dispatch,
  which `skills/subagent-driven-development/SKILL.md:68` holds together;
  batch-template item 5 keeps its opening "5. A task with".

## Open items

| # | Item | Part | Found | Blocks |
|---|------|------|-------|--------|

Next item number: 2

`Part` is the number of the part in which the item was found. `Found` is the
date `<YYYY-MM-DD>` on which it was found. `Blocks` names what the item
blocks: a part number, or `whole work`.

## Accepted limits

- 2026-10-08 item A1: isTestFile does not see a relative path that starts with tests/ as a test file — never reached: track-edits.js stores absolute paths (0 relative of 310 distinct real paths)
- 2026-10-08 item A1: a project inside a folder named test or tests makes every edited file a test file, so the TDD reminder never fires there — missed advisory reminder only; 0 of 96 real session folders; a base folder breaks a session launched in tests/
- 2026-10-08 item A1: the patterns Tests?\.[^/]+$ and __tests__\/ do not treat \ as a separator (Windows) — missed or extra advisory reminder only; not measured on Windows
- 2026-10-08 item A1: the agents pattern has no separator before agents, so docs/user-agents/x.md asks for a decision-log entry — extra advisory reminder only
- 2026-10-08 item A1: a test file that was edited and restored still silences the TDD reminder — testFiles is not checked against git; not part of item 18; v7.58.0 left it unchanged
- 2026-10-08 item A2: tsc --showConfig goes through the build-success rule, which keeps only the tail of the JSON — not in item 19, no case, 0 real tsc commands in all transcripts
- 2026-10-08 item A3: executing-plans does not run the security review for a security-flagged task — inline execution dispatches no implementer, and the plan template promises the review "before the implementer is dispatched"; no recorded run executed a flagged task inline
- 2026-10-08 item A4: stop-reminders.js reads session-log.md (size warning) and state.md (staleness reminder) in the current folder (:688, :634, :607), so after a cd both reminders are missed — advisory reminders only; no lost work
- 2026-10-08 item A4: context-engine.js:78 writes context-snapshot.json into the current folder after a cd on compact — the snapshot is injected only when its git_hash equals HEAD; outside the item
- 2026-10-08 item A4: the save command writes session-log.md into the Bash tool's current folder; a log saved inside a worktree is deleted by a hand-run git worktree remove — the finishing skill lists ignored files before its own removal; CLAUDE_PROJECT_DIR is unset in the Bash tool and only a literal absolute path gets the exclude entry
- 2026-10-08 item A7: the git-push rule reads the first "->" of the whole output, so a Heroku, multi-ref, -v or two-URL push, or pre-push hook lines, give a wrong summary — in Claude Code standard error is not a terminal, so only these rare shapes pass 200 characters; 0 multi-ref compressions in real use; no lost work
- 2026-10-08 item A7: context-engine.js writes context-snapshot.json through a hard link with that name — git never checks out a hard link; only a person or a tool creates that state
- 2026-10-08 item A7: the npm-install rule prints the vulnerabilities line twice (summary and alert lines) — duplicate text only; sibling point of the v7.59.0 reviewer
- 2026-10-08 item A8: printRemoteUrl prints a token in full for six malformed remote URL forms (a password with /, # or ?; https:/…; https//…; scp-like user:SECRET@host:path) — git cannot use any of these URLs (git ls-remote refuses all six) and prints the token in its own error message; the text never reaches the shared page
- 2026-10-08 item A9: the four controller templates poll for "the file that subagent was told to write", but the code, doc and SDD task reviewers write no file at a path the controller knows — 0 hand-back failures in 42 nested dispatches since 2026-10-01; reopen when the next orchestrated run shows a failed hand-back or a child's report in the main session
- 2026-10-08 item A10: a map hash of 1 to 3 characters, or a number read as a hash ("Git: 2026"), counts as fresh when HEAD starts with it (before A10 it always counted as stale) — git never writes a short hash under 4 characters; the chance is 1 in 16 per character; advisory note only
- 2026-10-08 item A10: a map written after git init and before the first commit has no Git hash, so the hook never reports it stale — older than release 1; named as a risk in the design record; advisory note only
- 2026-10-08 item A4: after the cd to CLAUDE_PROJECT_DIR the hook output names memory files by bare name (stale note, grep note, not-injected line), and the AI resolves them against its own Bash folder — whole-branch review of release 1; an absolute path would cost characters at every session start; advisory only
- 2026-10-08 item A13: step 6 of the map procedure says "at the project root … never in any subdirectory", while the hook looks in the folder where the session was started; the two differ when a session starts in a sub-folder — whole-branch review of release 1; the heading is older than release 1
- 2026-10-08 item A11: without git, Hot Files has no data source — no source exists; the section may stay empty
- 2026-10-08 item A11: the without-git rule at using-superpowers/SKILL.md:150 can never run, because it sits under the <project-map-stale> tag, which the hook emits only with git — measured by C and R; recorded as a finding outside group A
- 2026-10-08 item A13: a project-map.md larger than the room left in the session-start output (about 1,900 to 2,600 characters for all memory sections) is never injected, and the skill's size rule counts lines, not characters — by design (v7.31.0 order); README.md:258 documents it; the <not-injected> line names the file and entry step 6 reads it

## Decisions

- 2026-10-08 (part 1): The user accepted every recommendation of the design
  record `tmp/docs/2026-10-08-design-section-a.md` (D1 to D11, "all
  recommended").
  - Part 2 (release 1) fixes A4 (one guarded `cd "$CLAUDE_PROJECT_DIR"` in
    `hooks/session-start` only), A5 (both hook sentences name
    `session-log.md` and `session-log-archive.md`), A10 (the skill records
    `--short`; the hook accepts a map hash that is the start of HEAD), A11
    (Hot Files from `git log`), A12 (generic gate wording), and for A13 one
    skill sentence plus the correction at `context-management/SKILL.md:192`.
  - Part 3 (release 2) fixes A1 (anchored `test_` pattern; `hooks/*.js`
    narrowed to a `hooks` folder that holds `hooks.json`, or
    `.claude/hooks/`), A2 (`make` leaves the build rule) and A3 (SDD text
    only: a security review step in Core Flow step 3).
  - Not fixed, by the user's decision: A6 is dropped (its wording is
    deliberate, 2026-08-30 design); A7, A8, A9 and A13 are accepted limits;
    parts of A1, A2, A3, A4 and A11 too. Each has a line under
    `## Accepted limits`.
  - Open item 1 is fixed on its own branch before release 1 (D11).
- 2026-10-08 (part 1): Part 4 dropped (D10). With A6 and A9 not fixed, release 3
  would hold only A3, a short text change; A3 moved to part 3.
- 2026-10-08 (part 1): After release 1, prune this repository's untracked
  `project-map.md` to the skill's own size rules (D9 b: 41 Key Files
  against "10-20"). This is not a release.
