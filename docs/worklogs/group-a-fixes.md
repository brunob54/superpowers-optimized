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
| 1 | Design step for A1 to A13 | not started | | | check A7-A9; user decisions |
| 2 | Release 1: memory files | not started | | | A4, A5, A10, A11, A12, A13 |
| 3 | Release 2: hook patterns | not started | | | A1, A2; A8 if kept |
| 4 | Release 3: review prompts | not started | | | A3, A6; A9 if kept |

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

## Open items

| # | Item | Part | Found | Blocks |
|---|------|------|-------|--------|

Next item number: 1

`Part` is the number of the part in which the item was found. `Found` is the
date `<YYYY-MM-DD>` on which it was found. `Blocks` names what the item
blocks: a part number, or `whole work`.

## Accepted limits

## Decisions
