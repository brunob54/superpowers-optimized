# The `/worklog` command — tracking work that lasts many sessions

This document explains what a work log is, what the three `/worklog` commands
do, and how to use them. It ends with one complete example.

The command exists since v7.52.0. The short reference is in the
[User Guide, section 6](README.md#work-logs--one-tracking-document-for-multi-part-work).

## Contents

1. [What a work log is](#1-what-a-work-log-is)
2. [When to use a work log](#2-when-to-use-a-work-log)
3. [The three commands](#3-the-three-commands)
4. [What the file contains](#4-what-the-file-contains)
5. [How to use it, step by step](#5-how-to-use-it-step-by-step)
6. [Example](#6-example)
7. [What you should know about git](#7-what-you-should-know-about-git)
8. [When a command stops](#8-when-a-command-stops)

## 1. What a work log is

A **work log** is one file that records the progress of one piece of work.
The work has several parts, and it lasts many sessions. A **session** is one
conversation with Claude, from its start to its end or to `/clear`.

The file is written in Markdown, a plain-text format with simple marks for
headings, lists and tables. The file is stored at `docs/worklogs/<slug>.md`,
below the top folder of the git repository. A **git repository** is a project
folder whose history of changes git records. A **commit** is one saved set of
changes in that history. Git tracks the work log, so the work log is part of
your commits. A project can hold several work logs.

The **slug** is the short name of the work log. It is also the file name
without `.md`. A slug must follow these rules:

- It holds only the lowercase letters `a` to `z` (no accented letters),
  digits and hyphens.
- A hyphen is allowed only between two other characters, and never next to
  another hyphen. `test-fixtures` is valid. `-test`, `test-` and `test--x`
  are not valid.
- It has at most 40 characters.
- It is not one of the three command words `new`, `update` and `close`.

A work log solves one problem: a new session does not remember the earlier
sessions. The work log tells the new session which parts are finished, which
problems are open, and which decisions were already made.

## 2. When to use a work log

Use a work log when all of these are true:

- The work has several parts that you finish one after the other.
- The work needs more than one session.
- You want one place that shows the status of the whole work.

An example: you have four groups of tests, and you refactor one test group
after the other. To **refactor** code is to change its structure without
changing its behaviour.

Do not use a work log for a task that one session finishes. For such a task
the file only adds writing work.

## 3. The three commands

| Command | What it does |
| --- | --- |
| `/worklog new [<slug>]` | Creates a work log. Claude asks you for the content, then writes the file. |
| `/worklog` or `/worklog update [<slug>]` | Runs a **full update**: Claude compares the file with the session and with the commits, and corrects the file. |
| `/worklog close [<slug>]` | Closes the work log. |

The square brackets mean that the slug is optional.

- `/worklog new` without a slug: Claude asks you for the slug.
- `/worklog update` and `/worklog close` without a slug: Claude uses the only
  active work log. When several work logs are active, Claude asks you which
  one. When no work log is active, Claude says so and offers `/worklog new`.

A work log is **active** until you close it.

You can also ask in plain words, for example "create a work log", "update
the work log" or "close the work log". A message that only mentions the
command, for example "what does `/worklog close` do?", runs no command.

**The command never commits.** The file goes into the next commit that you
ask for.

## 4. What the file contains

Line 1 of the file is a status line. Claude reads it to know whether the work
log is active or closed:

```markdown
<!-- Work log: status=active slug=test-fixtures created=2026-10-03 -->
```

After line 1, the file has these sections:

| Section | Content |
| --- | --- |
| Header | The title, the goal, the "done when" condition and the admission rule. |
| `## How to maintain this document` | The update rules of the file. Claude follows them during the work. |
| `## Parts` | One table row per part: its number, name, status, the date of the last status change, the commit, and a note. |
| `## Rules for the next parts` | Rules that appeared in one part and also apply to the later parts. |
| `## Open items` | One table row per open item, and the line `Next item number`. |
| `## Accepted limits` | One line per finding that gets no open item, and one line per open item that left the table without a fix. |
| `## Decisions` | One entry per decision: what was decided, why, and which options were rejected. |

Four terms:

- A **finding** is a problem that Claude or you find during the work.
- An **open item** is a finding that has a row in the table `## Open items`.
- The **"done when" condition** is one condition that you can check. It says
  when the whole work is finished.
- The **admission rule** decides which finding becomes an open item. Its
  purpose is to keep the list of open items short. A finding that does not
  pass the rule gets one line under `## Accepted limits` instead.

The **default admission rule** is: a finding becomes an open item only when
one of these is true:

- The finding blocks a part from reaching the status `done`.
- The finding blocks the "done when" condition of the whole work.
- The consequence of the finding is lost user work or a wrong commit.

The status of a part is one of `not started`, `in progress`, `done` and
`dropped`. A part number is never used again. A dropped part keeps its row.

The file holds its own update rules. For this reason any session that reads
the file can keep it up to date, also on a computer where the plugin is not
installed. The **plugin** is superpowers-orchestrator, the extension of
Claude Code that provides this command.

You can edit the file yourself in a text editor. Two limits apply: the status
line must stay on line 1, and no other line may start with
`<!-- Work log: status=`. The commands never reorder or delete your text. The
only deletion is the row of an open item that leaves the table.

## 5. How to use it, step by step

### Step 1 — Create the work log

Type `/worklog new <slug>`. Claude asks five things in one group of
questions:

1. The title.
2. The goal, in one or two sentences.
3. The "done when" condition.
4. The list of parts.
5. The admission rule. Claude offers the default rule first.

Claude does not ask again for a value that you already gave in the session.
When you say that a part is already `done`, Claude also asks for its commit.

In two cases Claude shows the full path of the new file and asks you to
confirm it before writing: when the project is not a git repository, and when
your current folder is below the top folder of the repository.

Claude then writes `docs/worklogs/<slug>.md` and reports the path. Claude
never overwrites a file: when a work log with this slug exists, the command
stops.

Commit the new file with your next commit.

### Step 2 — Work on the parts

You do not need a command during the work. Claude updates the file by the
rules in the file itself, without being asked, at these moments:

- A part changes its status.
- You or Claude add, split or drop a part.
- Claude or you find a problem, and nobody fixes it immediately. Claude
  applies the admission rule.
- An open item leaves the table: Claude deletes its row. This happens when
  the fix of the item is committed. It also happens when you decide not to
  fix the item, or when the item proves wrong or a duplicate. In these last
  cases Claude adds one line with the reason under `## Accepted limits`.
- You or Claude make a decision.
- A rule appears that also applies to the later parts.

The plugin gives Claude a short notice, the **session-start notice**, at
three moments: at each session start, after `/clear`, and after a
**compaction** (the automatic shortening of a long conversation). The notice
names the active work logs, at most three of them by path. It does not
contain the content of a work log. It tells Claude to read a work log before
working on it.

To continue the work in a new session, name the work log, for example:
"Continue the work log test-fixtures with part 2."

### Step 3 — Run a full update when you want to be sure

Type `/worklog`. In a full update, Claude does these things:

1. Claude reads the whole file.
2. Claude repairs the structure. When a section heading is missing, Claude
   adds it and tells you. When the line `Next item number` is missing, Claude
   computes the number again and asks you to confirm it, because the computed
   number can be too low.
3. Claude compares the file with the session: the status of each part, the
   findings, the fixes committed, the decisions and the rules.
4. In a git repository, Claude reads the commits made since the creation date
   of the work log. When that list is too long to read completely, Claude
   tells you that it did not read the older commits.
5. Claude applies the update rules of the file. Claude reports each change in
   one line, or says that the work log was already up to date.

Good moments for a full update are the end of a session and the moment before
a commit.

Some details about the `Commit` column:

- Claude fills the cell of a part only when the part is `done`, and only
  once. The cell of a dropped part stays empty.
- The cell gets the **short hash** (the first characters of the identifier of
  a commit) of the newest commit that holds changes of the part.
- That commit must exist first. Claude fills the cell in the first update
  after the commit. The filled cell is then part of the following commit.
- When Claude cannot tell which commit holds the part, Claude asks you and
  leaves the cell empty until you answer.
- A part that was already `done` when you created the work log gets a commit
  only when you name the commit at creation. The full update reads only the
  commits made since the creation date.

### Step 4 — Close the work log

When every part is `done` or `dropped` and no open item remains, Claude asks
you whether to close the work log. To close it, type `/worklog close`.

When a part is not finished or an open item remains, Claude lists them and
asks you: close anyway, or stop. When you choose to close anyway:

- Each open item becomes one line under `## Accepted limits`, with the text
  "open at closing".
- The parts keep their status.
- One entry under `## Decisions` records that you closed the work log with
  unfinished parts.

Before closing, Claude fills each empty `Commit` cell of a `done` part that
it can fill, and tells you which cells stay empty.

Closing changes line 1 to the closed form:

```markdown
<!-- Work log: status=closed slug=test-fixtures created=2026-10-03 closed=2026-10-09 -->
```

The commands never write a closed work log again, and the session-start
notice no longer names it. The file stays in the repository as a record.

On a computer without the plugin, you or Claude close the work log by the
same change of line 1 in a text editor.

To reopen a closed work log, edit line 1 yourself back to the active form:
replace `status=closed` with `status=active` and remove the `closed=` field.

## 6. Example

The project has four test groups. Each test group reads its fixtures in its
own way. A **fixture** is a file with test data. The work is to move every
test group to one shared loader, a helper file that reads the fixtures.

### Creating the work log (3 October)

```text
You:    /worklog new test-fixtures

Claude: (asks for the title, the goal, the "done when" condition, the parts
        and the admission rule)

You:    Title: Move the tests to the shared fixture loader
        Goal: Every test group reads its fixtures through tests/lib/fixtures.js.
        Done when: no test file reads a fixture file directly, and all test groups pass.
        Parts: unit tests, hook tests, integration tests, behavioural tests
        Admission rule: the default rule

Claude: Created docs/worklogs/test-fixtures.md. The file is not committed.
        The session-start notice names it from the next session start on.
```

The new file follows. Three texts are left out here: the section
`How to maintain this document`, the explanation paragraph below the table of
`## Parts`, and the explanation paragraph below the line `Next item number`.

```markdown
<!-- Work log: status=active slug=test-fixtures created=2026-10-03 -->

# Work log: Move the tests to the shared fixture loader

**Goal:** Every test group reads its fixtures through tests/lib/fixtures.js.

**Done when:** no test file reads a fixture file directly, and all test groups pass.

**Admission rule:** A finding becomes an open item only when it blocks a part
from reaching the status `done`, or blocks the "done when" condition of the
whole work, or when its consequence is lost user work or a wrong commit.
Every other finding gets one line under `## Accepted limits`.

## Parts

| # | Part | Status | Since | Commit | Note |
|---|------|--------|-------|--------|------|
| 1 | Unit tests | not started | | | |
| 2 | Hook tests | not started | | | |
| 3 | Integration tests | not started | | | |
| 4 | Behavioural tests | not started | | | |

## Rules for the next parts

## Open items

| # | Item | Part | Found | Blocks |
|---|------|------|-------|--------|

Next item number: 1

## Accepted limits

## Decisions
```

You ask Claude to commit the new file.

### Working on part 1 (5 October)

You ask Claude to do part 1. During this session Claude changes the work log
without a command:

- The row of part 1 gets the status `in progress`, and later `done`.
- A rule appeared: each fixture file is named after the test file that uses
  it. Claude adds the rule to `## Rules for the next parts`.
- Claude found that the loader reads each fixture file twice. This costs 0.2
  seconds and blocks no part. The finding does not pass the admission rule, so
  it gets one line under `## Accepted limits`.

You ask for a commit. The new commit `4f2a91c` holds the changes of part 1
and the changed work log. The `Commit` cell of part 1 is still empty in this
commit, because Claude wrote the work log before the commit existed.

### Working on part 2 (6 October)

You start a new session and write: "Continue the work log test-fixtures with
part 2." Claude reads the file first, and it applies rule 1 of
`## Rules for the next parts` to the hook tests.

Three things happen in this session:

- At its first change of the file, Claude fills the `Commit` cell of part 1
  with `4f2a91c`. This commit now exists.
- Claude finds that three hook tests need a binary fixture (a file that is
  not text), and the loader reads text files only. This finding blocks
  part 2, so it passes the admission rule and becomes open item 1.
- You decide to drop part 4: the behavioural tests run the real command-line
  program and use no fixture files. Claude sets the row of part 4 to
  `dropped`. In this example, Claude forgets the entry under `## Decisions`
  that a dropped part needs.

At the end of the session you type `/worklog`. The full update finds the
forgotten entry. Claude answers, for example:

```text
Full update of docs/worklogs/test-fixtures.md:
- Decisions: entry "Part 4 dropped" added. Part 4 has the status dropped and had no entry.
```

The sections of the file that changed now look like this:

```markdown
## Parts

| # | Part | Status | Since | Commit | Note |
|---|------|--------|-------|--------|------|
| 1 | Unit tests | done | 2026-10-05 | 4f2a91c | |
| 2 | Hook tests | in progress | 2026-10-06 | | blocked by item #1 |
| 3 | Integration tests | not started | | | |
| 4 | Behavioural tests | dropped | 2026-10-06 | | see Decisions |

## Rules for the next parts

1. Name each fixture file after the test file that uses it (from part 1, 2026-10-05)

## Open items

| # | Item | Part | Found | Blocks |
|---|------|------|-------|--------|
| 1 | Three hook tests need a binary fixture; the loader reads text files only | 2 | 2026-10-06 | 2 |

Next item number: 2

## Accepted limits

- 2026-10-05 The loader reads each fixture file twice; this costs 0.2 seconds and blocks no part

## Decisions

### 2026-10-06 Part 4 dropped

**Decision:** The behavioural tests stay as they are.
**Reason:** They run the real command-line program and use no fixture files.
**Rejected:** Moving them to the loader for consistency: there is nothing to move.
```

You ask for a commit. It holds the changes of 6 October and the work log.

### Finishing and closing (9 October)

In later sessions Claude makes the loader read binary files, and you commit
that fix. Claude then deletes the row of item 1. Parts 2 and 3 reach `done`,
and you commit their changes. After each of these commits, Claude fills the
`Commit` cell of the part at its next change of the file.

Now every part is `done` or `dropped`, and `## Open items` has no row. Claude
asks whether to close the work log. You answer yes, or you type:

```text
/worklog close
```

Claude changes line 1:

```markdown
<!-- Work log: status=closed slug=test-fixtures created=2026-10-03 closed=2026-10-09 -->
```

The `Commit` cell of part 4 stays empty: only a `done` part gets a commit.
You commit the closed file with your next commit.

## 7. What you should know about git

- **Keep the work log on the branch where the work happens.** A **branch** is
  a separate line of commits in git. A session on a branch that does not hold
  the file cannot see it.
- **Commit the work log before you create a git worktree.** A git worktree is
  a second working folder of the same repository. An uncommitted work log is
  absent there. When both folders then get a copy with different edits, git
  must later **merge** the two copies (combine the changes of two branches).
  When a merge brings two open items with the same number, Claude gives one
  of them a new number.
- **Commit the work log before an orchestrated run or a whole-branch review.**
  An orchestrated run is an autonomous run of this plugin: Claude plans,
  implements and reviews a feature without you (User Guide, section 4). A
  whole-branch review is the review loop of `multi-code-review`, a command of
  this plugin. Both can stop when the work log has uncommitted changes. While
  such a run is in progress, Claude does not write the work log; Claude makes
  the update after the run ends.
- **`docs/worklogs` must be a real folder**, not a symbolic link (a file
  system entry that points to another file or folder). The search for active
  work logs does not follow a folder that is a link. A work log must also be
  a regular file, not a link: the commands stop on a work log that is a link.
- **When git ignores the file**, `/worklog new` tells you so. Git ignores a
  file when an ignore rule, for example in `.gitignore`, matches its path.
  The command `git add`, which selects files for the next commit, then leaves
  the file out.
- **A hash in the `Commit` column is valid on the work branch.** After a
  rebase or a squash merge (two git operations that replace commits by new
  ones) the hash no longer exists. Nobody has to correct it.
- **In a project that is not a git repository** the commands also work. The
  `Commit` column stays empty.

## 8. When a command stops

In each situation of this table, the command stops before Claude changes the
file. One exception stands below the table.

| Situation | What happens |
| --- | --- |
| The first word is not `new`, `update` or `close`; or more than one word follows the command word; or the slug is a command word | Claude shows the usage text. |
| The slug breaks a slug rule | Claude says which rule. |
| `/worklog new` with a slug whose file exists | The command stops. Claude never overwrites a work log. |
| `/worklog update` or `/worklog close` with a slug whose file does not exist | Claude shows the list of the files under `docs/worklogs/`, each with its status. |
| No slug, and no work log is active | Claude says so and offers `/worklog new`. |
| The work log is closed | Claude says that it is closed. |
| Line 1 has neither the active form nor the closed form, for example after an edit in a text editor | Claude shows the two valid forms of line 1. Correct line 1 yourself. |
| The file is a symbolic link | Claude says that a work log must be a regular file. |
| `/worklog close`, and one of the headings `## Parts`, `## Open items`, `## Accepted limits`, `## Decisions` is missing | Claude names the heading and tells you to run `/worklog update`, which repairs it. |

Three more cases:

- **The `slug=` field of line 1 differs from the file name.** This is not a
  stop. Claude uses the slug of the file name, reports the difference, and
  corrects the field of an active work log. This correction is the exception
  named above: it also stays when `/worklog close` stops afterwards. In a
  closed work log, Claude only reports the difference.
- **A file under `docs/worklogs/` has a name that breaks the slug rules**, for
  example `Test_Fixtures.md`. The commands and the session-start notice
  ignore the file, so Claude can say that no work log is active. The list of
  the files shows it with the label `invalid file name — rename it`.
- **The rewrite of line 1 fails.** This is rare. Claude stops and shows
  what the failed step printed. A printed path is the path of a kept copy of
  the work log: you can restore the work log from this copy. Changes that `/worklog close` made before this moment stay in the
  file.

The usage text is:

```text
/worklog [new|update|close] [<slug>]
/worklog new [<slug>]       create a work log
/worklog update [<slug>]    full update; /worklog alone does the same
/worklog close [<slug>]     close a work log
```
