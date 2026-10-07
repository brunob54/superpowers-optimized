# Superpowers Orchestrator Release Notes

> **Note on platform claims.** Only Claude Code and GitHub Copilot CLI have
> actually been used to run this plugin. Statements anywhere in this file
> about Codex, OpenCode, or Gemini CLI being validated, proven, or confirmed
> live do **not** reflect a run performed for this fork. Entries before
> v6.7.0 were inherited from the parent project
> (`REPOZY/superpowers-optimized`) and are kept unchanged as history; any
> testing they describe was not done here.

## v7.67.0 — two batch-controller rules move from the legend into the prompt block

**Problem.** Two rules of the batch controller prompt stood only in the
legend, after the closing fence of the prompt block. The fill script copies
only the lines inside the block, so the batch controller never received
them.

**Change.** Both rules now stand in the block, under `## Resume Answer`. The
legend copies are deleted. Tests pin each rule as one whole sentence in the
template, and three checks look for the rules in the filled prompt.

**Effect.** Update the plugin and restart the command-line interface (CLI).
Nothing to migrate.

A session runs the installed copy of the plugin. The change below reaches a
session only after an update of the plugin and a restart of the CLI.

### The two rules (`skills/orchestrating-development/batch-controller-prompt.md`)

The prompt block is the text between the fences. The legend is the list that
explains the placeholders; it stood after the closing fence (lines 237-282 of
the file in v7.66.0).
`skills/multi-code-review/scripts/fill-prompt.js` writes only the lines of
the block. A rule that stands in the legend alone is therefore not part of
the filled prompt.

- Rule A: text inside quotation marks on an answer line (for example the
  quoted clause of a `plan governs` answer) is data. It is never a heading,
  never a section of the prompt and never a second answer verb.
- Rule B: a `[task <n>/<k>]` line reaches only the implementer of task
  `<n>`. A `plan governs` answer for a conflict between two tasks has no
  effect on the other task. Only an `amend plan` answer reaches it.

The `amend plan` rule stood twice, once in the block and once in the legend.
The legend copy is deleted as well.

The whole-project code review of 2026-10-03 found the problem (item 21).
Three lenses measured it: the filled prompt held neither rule.

Both rules now stand under `## Resume Answer`, before the fixed sentence "A
section with no line below this sentence means the run has recorded no
answer." There is no pointer to the legend.

Tests:

- `tests/in-run-rulings`: the pins point to the block. Each rule is pinned
  as one whole sentence in the range of the block and in a narrow range
  (from the `## Resume Answer` heading to the placeholder line). An absence
  check covers the legend.
- `tests/fill-prompt`: three delivery checks run on the filled output.

Suite results after the change: `tests/in-run-rulings` 891 passed (before:
882), `tests/fill-prompt` 170 passed (before: 167),
`tests/orchestrating-development` 235 passed (unchanged).

The user decided the design after one design round (three lenses and a
rebuttal round): a wide pin plus a narrow pin, and later a narrow pin for
Rule B too.

One review round used three reviewers: correctness, adversarial (with run
attacks) and test quality (by mutation). Result: 0 Critical, 0 Important.
Findings, all fixed: the wording "on a line below" in Rule A; the position of
Rule B was not pinned (all three reviewers found it); five word weakenings
of the rules that no pin caught. A verification pass ran 30 mutations on both
commits. The six that survived before the fix all fail after it. It found 0
new findings. The commits are `b71a52a` (the fix) and `2a932dc` (the review
fixes); `git log --oneline f398740..HEAD` lists these two commits and the
release commit.

Accepted limits, unchanged: a quoted clause that holds a newline; a plain
paragraph after the closing fence. One more limit: the whole-rule pins match
as a substring, so text added before or after a rule in the same paragraph
would still pass. The verifier did not measure this.

## v7.66.0 — a session-log pruning rule that can act, with an archive script

**Problem.** The context-management skill said: keep `session-log.md` under
200 entries, and prune entries older than 6 months when the log is longer.
On a busy project this rule cannot act: this repository's log reached 423
entries in 3 months, and none was 6 months old.

**Change.** After each save, the skill counts the entries; above 200 it
offers an archive in one line, once per session. When the user agrees, a new
script keeps the newest 100 entries and moves the older ones, byte for byte,
to `session-log-archive.md`.

**Effect.** Update the plugin and restart the command-line interface (CLI).
Nothing to migrate; no entry moves until you agree.

The user decided the design: report but never move without the user,
archive with a script, keep the newest 100, put the archive next to the log
and hide it from git.

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the CLI.

### 1. The skill reports a long log after a save (`skills/context-management/SKILL.md`)

Before: the rule "Keep under 200 entries — prune entries older than 6
months when it exceeds this" could act only on a log that was both long and
old.

Now step 4 of the save procedure ends with a count:
`grep -c -a -E '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' session-log.md`. Above 200,
the reply gives the count in one line and offers the archive (for example
"archive the session log"). The line appears once per session. The skill asks
no question that waits for an answer, and it moves no entry before the user
says yes. The `-a` matters: in the Claude Code Bash tool, `grep` runs
ugrep with the option `-I` (skip binary files), so it prints nothing for a
file that holds a byte that is not valid UTF-8 (the usual text encoding)
unless `-a` makes it read the file as text (measured).

The keyword searches at the start of a task use `-a` as well, and they
also read `session-log-archive.md` when `session-log.md` gives no hit. The
skill's routing table and its description name "archive the session log".
`hooks/skill-rules.json` routes the phrase to the skill: a keyword alone
scores 1, below the minimum score of 2 that the prompt hook needs, so the
entry also has a pattern (measured).

### 2. The archive script (`skills/context-management/scripts/archive-session-log.js`)

Run from the folder that holds `session-log.md`:
`node "<skill-dir>/scripts/archive-session-log.js" [<keep>]`, where
`<skill-dir>` is the skill's base folder. The script keeps the newest
`<keep>` entries (default 100) and appends the older ones, byte for byte, to
`session-log-archive.md` in the same folder. The log gets one pointer
paragraph that names the archive. On success the script prints one line and
exits 0. It exits 2 for a wrong argument and 1 for a missing log or a
failure. When a step before the log write fails, the script removes what it
appended to the archive (a line it added to `.git/info/exclude` stays). When
it cannot do that, its message says which file holds the moved entries.

- An entry starts at a line `## YYYY-MM-DD` outside a fenced code block.
  Fences follow CommonMark (the Markdown specification), as the
  `task-brief` script of subagent-driven development reads them.
- A save of another session during the run is kept, except in a short
  window (see Accepted limits). The git step runs before the read. The log
  is read again just before it is rewritten: entries appended meanwhile go
  to the end of the new log, and any other change undoes the archive
  write.
- After each write the script compares the bytes of the file with the
  expected bytes. When the log cannot be written, it undoes the archive
  write.
- Inside a git work tree it hides the archive from git with
  `hooks/git-exclude.js`, unless `session-log.md` itself is tracked; then
  the output says to commit the archive together with the log.

The automatic recall of the hooks does not read the archive: the
session-start hook adds the last two `[saved]` entries of the log, and the
prompt hook adds log entries that match the prompt.

### Review

One review round of three reviewers (correctness, adversarial, and test
quality) found 6 Important findings (a wrong result in a plausible state, or
a check that cannot fail) and 13 Minor ones; a finding that two reviewers
made counts once. The test-quality reviewer made 66 mutations
(deliberate small defects that a test must catch) on a separate clone; the
tests caught 45.

The six Important findings: a save of another session during the run was
lost (found by two reviewers); a second run after a failed log write
duplicated entries; a heading inside a code block split an entry; archiving
a git-tracked log took the old entries out of version control; the check
before writing could never fail; no test used a byte outside ASCII (the
basic 7-bit character set). One round of fixes corrected all 19 findings.
A verifier then replayed every reviewer input on the reviewed and on the
fixed commit: every finding was fixed. It found six new Minor findings; a
targeted correction fixed five of them, and the same verifier's replay
passed. The sixth needs a
state outside the supported environment (the environments the plugin
defends, listed in the project's `CLAUDE.md`; last item below).

### Accepted limits

- A save that lands between the script's last read of the log and the end
  of its write can be lost. Two measurements with a log of 250 entries gave
  0.13 to 0.53 milliseconds for this window. In 40 runs with one save per
  millisecond, 0 to 2 entries were lost per round (six rounds).
- The step-4 count also counts a `## YYYY-MM-DD` line inside a fenced code
  block; the script does not.
- A log write that stops part-way (for example on a full disk) keeps the
  moved entries in the archive, and the script says so; no test covers this
  branch.
- The `grep` of macOS misses a keyword that stands after an invalid UTF-8
  byte on the same line, also with `-a`.
- A log that was shortened by hand before this release (this repository's)
  keeps its own pointer; the script adds a second one.
- An archive that is a symbolic link to a missing file, together with a log
  that cannot be written, is outside the supported environment: the undo
  removes the link, and the file it created keeps the moved entries.

### Suites

All 21 fast suites pass. New: `tests/context-management` (70 checks). It
runs the script on fixture folders, makes file writes fail or change on
purpose (to test the concurrent save and wrong bytes), and checks the skill
text. Changed: `tests/suite-guard` 134 → 137; it now requires 20 suites that
load the guard against undefined commands.

## v7.65.0 — seven small corrections: update-check cache, recall folder, git log settings, unfinished tests, task briefs, git status -v, measure checks

**Problem.** Seven confirmed review findings were open. Without network,
every session start repeated the update check. After a `cd`, the prompt
recall found no file. `log.showSignature` broke `/pickup` dates and counts.
A dashboard test that never finished passed. The last task's brief took the
plan sections after it. The compression of `git status -v` dropped diff
lines. Four checks could not fail.

**Change.** Each cause is fixed where it starts, with checks that fail on
the old code. One review round found 3 Important and 12 Minor findings; 13
are fixed, 2 are accepted limits.

**Effect.** Update the plugin and restart the command-line interface (CLI).
Nothing to migrate.

These are items 7 to 13 of the findings that the whole-project review of
2026-10-03 confirmed beyond its limit of 15 (the numbering of v7.63.0). None
needed a design step. One implementer agent made each correction, tests
first; the main session replayed each suite and committed each item by
explicit path.

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the CLI.

### 1. A failed update check is cached (`hooks/session-start`, item 7)

Before: the check that looks for a newer plugin version runs at most once in
24 hours, but only a successful check was cached. Without network, every
session start ran `git fetch` (a plugin installed as a git clone) or `curl`
(a marketplace install) again: `curl` waits up to 3 seconds, and the fetch
has no time limit where no `timeout` command exists (stock macOS).

Now every outcome is cached. The clone path writes its cache before the fetch.
The marketplace path writes the remote version, or the word `failed` after a
failed request; a recent cache that holds `failed` means no request and no
notice, and an empty cache counts as no cache. A cache whose modification time
lies in the future counts as old on both paths.

The two paths used one cache file, `~/.claude/hooks-logs/update-check.cache`.
On a home folder with both a clone and a marketplace install, a marketplace
check stopped the check of the clone path for 24 hours (and the first version
of this fix made a clone check stop the marketplace check as well). The
clone path now uses `update-check-clone.cache`; the marketplace path keeps
`update-check.cache`.
After this update a clone install checks once more (its new file does not
exist yet), and on a home folder with only a clone the old file stays unused.

### 2. The prompt recall reads the project folder (`hooks/skill-activator.js`, item 8)

Before: the prompt hook read `session-log.md` and `known-issues.md` from the
`cwd` field of its input, which follows every `cd` of the session. After a
`cd` into a sub-folder, no entry was recalled.

Now the hook reads both files in `cwd` first, and then in the folder that
the environment variable `CLAUDE_PROJECT_DIR` names when that is another
folder (documented by Claude Code: the project root where the session
started; it keeps its value after a `cd`). Reading `cwd` keeps the recall of
entries saved after Claude entered a git worktree: the save command appends
to the file in the current folder. An entry that both files hold is shown
once. The limit of 2 entries applies to each recall block across both
folders, so the output is the old output whenever `cwd` has enough matches,
and the project root fills the remaining places. Without the variable
(Codex), the hook reads `cwd` as before.

Not changed: `hooks/stop-reminders.js` (its size warning for
`session-log.md`) and `hooks/session-start` on the `compact` and `clear`
events still read the current folder of the moment.

### 3. `log.showSignature` and `color.diff` no longer change the output that `/pickup` and the dashboard read (`skills/pickup/scripts/git-runs.js`, item 9)

Before: with `log.showSignature=true`, `git log` printed a signature line
before the formatted line of each signed commit. A run's last commit date
was read as the word "No", and each signed commit took two lines in the
commit counts of `/pickup`. With `color.diff=always`, the `--oneline`
lines that `/pickup` prints carried colour codes, although the code comment
said that colours were off.

Now every git call of these scripts adds `-c log.showSignature=false` and
`-c color.diff=never`. Measured over the git commands that `git-runs.js`,
`pickup-scan.js` and `dashboard-extract.js` run: no other `color.*` key
changes their output. The new test signs a commit with an SSH (Secure Shell)
key; it needs `ssh-keygen` and git 2.34 or later.

### 4. A dashboard test file that never finishes fails (`tests/dashboard/helpers.js`, item 10)

Before: `finish()` set the exit code. A test file that ended without calling
it (an early `return`, or an awaited promise that never settles) ended with
exit code 0, and the suite counted it as passed.

Now an exit listener (a function that Node runs when the process ends)
decides the exit code. It is 1 when `finish()` was never called (the
listener prints `FAIL: finish() was never called`) or when any check failed,
also a check made after `finish()`. This also holds when the file calls
`process.exit(0)` before `finish()` or after a failed check. The new
`tests/dashboard/test-13-helpers.js` runs eight small test files as child
processes, and counts its own failures without these helpers.

### 5. A task brief ends at a plan-level heading (`skills/subagent-driven-development/scripts/task-brief`, item 11)

Before: only a `Task <n>` heading ended a brief. The brief of the last task
took every section after it (for example `## Verification Summary`), and a
middle task took a phase heading between two tasks.

Now a brief ends at the next heading, outside a fenced code block, with as
many `#` characters as its task heading or fewer. Over the 226 briefs of the
27 files in this repository that hold `Task <n>` headings (26 plans and one
design specification), 214 are unchanged and 12 are shorter; each
is an exact prefix of the old brief, cut at a plan-level heading.

Because more headings now end a brief, a fence that the script did not
recognise could end a brief early. Fences now follow CommonMark (the Markdown
specification): 0 to 3 spaces, then 3 or more backticks or tildes; a fence
closes only on the same character, at least as many times, followed by
blanks only. The script also reads a plan with CRLF line endings (a
carriage return before each line feed; a plan checked out with
`core.autocrlf=true`, the Git for Windows default) as it reads plain line
feeds. The first version of the item 11 fix had broken this; the script
before this release read such plans correctly. When a plan ends inside a
fence that never closed, one warning line on standard error names the line
of that fence; the brief and the exit status do not change.

### 6. The compression of `git status -v` keeps every line of its diff (`hooks/compression-rules.js`, item 12)

Before: the `git-status` rule filtered the whole output. In the diff that
`git status -v` and `-vv` print, it dropped the second of two blank context
lines, and context lines that start with `(use "git ` or
`no changes added to commit`.

Now the rule filters only the status text before the first `diff --git `
line (colour codes are ignored in that test). In the diff part it removes
only the summary hint that `-vv` prints at column 0 after the diff.
`docs/architecture/smart-compress.md` says so; its `git-log` row said
"entries", but the rule cuts lines, and the cut can fall inside a commit.

### 7. The smart-compress measure checks can fail (`tests/smart-compress/run-tests.sh`, item 13)

Before: each branch of the `measure()` helper counted a PASS, so the four
measure lines passed even when the hook crashed.

Now each call checks that the hook ran without error (exit 0, nothing on
standard error, valid JSON (JavaScript Object Notation) output) and either
changed nothing or returned a replacement that is shorter than the output
and ends with the `[compressed: N->M lines | rule]` marker line. The token
figures are `INFO` lines that do not change the PASS count. The item 12
checks run git without the user's configuration
(`GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`).

### Review

One review round of three reviewers (correctness, adversarial, and test
quality) found 3 Important and 12 Minor findings; a finding that two
reviewers made counts once. The test-quality reviewer made 63 mutations
(deliberate small defects that a test must catch) on a separate clone. The
tests caught 47; 7 of the 16 that survived change no behaviour.

The three Important findings: a plan with CRLF line endings closed no fence
in `task-brief`; a broken exit code in the dashboard helpers passed every
check; a script that took a two-tilde line for a fence passed every check.
The fix round corrected 13 findings; 2 are accepted limits (the first two
below). The verification pass replayed every reviewer input on the reviewed
and on the fixed commit: every finding was fixed. It found one new Minor
defect: with two folders read, the hook context could exceed the
10,000-character limit (measured 12,999 characters, against 6,913 before). A
targeted correction fixed it, and the same verifier's replay passed.

### Accepted limits

The first two come from the review; the implementers and the verifier found
the other three.

- The measure checks are a basic check: a replacement that keeps the marker
  line but drops content passes; a rule that throws makes the hook return the
  output unchanged, which passes; in a clone with 40 commits or fewer and a
  clean working tree, no measure call is compressed.
- In the prompt recall, an empty `CLAUDE_PROJECT_DIR` counts as unset (Claude
  Code never sets an empty value).
- The OpenCode plugin (`.opencode/plugins/superpowers-orchestrator.js`) still
  caches only a successful update check; OpenCode is not tested.
- A cache file made unreadable by hand makes the marketplace path ask at every
  session start.
- A fence inside a list item that is indented 4 or more spaces is not a fence
  for `task-brief`.

### Suites

All 20 fast suites pass. Changed counts: `tests/sdd-scripts` 283 → 297,
`tests/smart-compress` 276 → 281, `tests/dashboard` 591 → 604 (summed over
its test files; `test-13-helpers.js` is new); in
`tests/codex/run-unit-tests.sh` (still 21 suites) the update-check test
48 → 104 and the skill-activator test 142 → 148.

## v7.64.0 — no nested git init, wave commits by path, the subagent guard removed, the shared-checkout rule delivered

**Problem.** Four confirmed review findings needed a design step first. The
fresh-project gate ran `git init` inside an existing repository. Implementers
of a parallel wave could commit each other's staged files. Since 2026-09-05
the subagent guard made 18 blocks and none was correct. The reviewers'
shared-checkout rule stood after the prompt block, so no reviewer dispatched
by pointer received it.

**Change.** The gate checks for a repository first. Wave implementers commit
only the files they name. The guard is removed. The rule stands inside both
reviewer prompts.

**Effect.** Update the plugin and restart the command-line interface (CLI).
Nothing to migrate. `~/.claude/hooks-logs/subagent-violations.jsonl` is no
longer written; you may delete it.

These are items 14 to 17 of the findings that the whole-project review of
2026-10-03 confirmed beyond its limit of 15 (the numbering of v7.63.0). For
each item, three independent reviewers designed a correction and then
measured each other's designs; the user chose each design. The steps below
change what a skill tells a model to do; no model run checked that a model
obeys the new text (the user's decision).

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the CLI.

### 1. The fresh-project gate never runs `git init` inside a repository (`skills/using-superpowers/SKILL.md`)

Before: the gate fired on a creation word when the session folder had no
`project-map.md`, and after the user said yes it ran `git init --quiet` with
no check. In a sub-folder of an existing repository, that creates a second
repository inside the first. Measured: a commit made there goes into the
inner repository. In a new, untracked sub-folder, once the inner repository
has a commit, a later `git add -A` in the outer repository stages a gitlink (a
pointer to the inner repository, file mode 160000) and none of the files; when
that is committed, a clone of the outer repository gets an empty folder.
Before the inner repository's first commit, the outer `git add -A` fails.

Now the gate runs `LC_ALL=C git rev-parse --show-toplevel 2>&1` in the session
folder before it shows its message:

- The output starts with `fatal: not a git repository (or any`: no repository
  holds the folder. The message is unchanged, and `git init --quiet` runs
  after a yes.
- The output is a folder: the session folder is already inside that
  repository. The message names it and runs no `git init`. In a sub-folder it
  also offers a separate repository; when the user asks for one, the gate
  runs `git init` and gives a warning: an untracked folder
  becomes an embedded repository on an outer `git add -A` unless the outer
  repository ignores it, and files that the outer repository already tracks
  stay tracked even when the folder is ignored. At the top folder of the
  repository (`git rev-parse --show-prefix` prints an empty line) there is no
  such offer.
- Any other output (inside `.git`, a bare repository, "dubious ownership" —
  git refuses a repository that another user account owns — or a broken `.git`
  file of a moved worktree): no `git init`; the gate shows the error.

The gate also tells `context-management` to write `project-map.md` in the
session folder, which is where the session-start hook reads it. The note
about `context-snapshot.json` appears only when no repository holds the
folder. All the new text is in the second part of the skill: the part that
the session-start hook injects is unchanged.

The new test `tests/codex/test-fresh-project-gate.sh` copies the command out
of the skill and runs it in scratch repositories in the states above; it pins
the gate section whole and counts `git init --quiet` over the whole file.

### 2. Implementers of a parallel wave commit by explicit path (`skills/subagent-driven-development/`)

Before: when you run subagent-driven-development directly, independent tasks
can run as a parallel wave: several implementers in one checkout, with one git
index. Each one committed with a bare `git commit`, which commits everything
that is staged, a sibling's files too. Measured: the first commit held the
files of both tasks, and the second task's commit said "nothing to commit". A
pre-commit hook widens the time window, because a bare `git commit` holds no
lock on the index while the hook runs. Orchestrated runs are not affected:
their batches run tasks one at a time.

Now the controller writes `You run in a parallel wave.` into the Context of
each wave implementer and each wave fix subagent, and the implementer prompt's
"Parallel wave only" rules apply:

- Commit with `git add -- <files>`, then the task's commit command ending with
  ` -- <files>`.
- `<files>` names each file of the task, one by one: from the task's own
  Edit, Write, `rm` and `mv` calls, plus each file that a program of the task
  wrote (a package installer, a code generator, a formatter), confirmed with
  `git status --porcelain -- <path>`. It never comes from a whole-tree
  `git status` or `git diff`, which in a wave also list other agents' files. It
  is never empty, a folder, a glob or `.`.
- Delete and rename with plain `rm` and `mv`; list both paths of a rename.
- Run a formatter or a code generator only on the task's own files.
- Never `git add -A`, `git add .`, `git commit -a`, `git commit --amend`,
  `git stash`, `git reset`, or `git checkout` / `git restore` of paths that are
  not the task's.
- When git reports an empty commit (it uses three different messages), report
  no commit SHA, never the current HEAD.
- When git cannot create `index.lock`, wait about ten seconds and run the
  same command again, for at most two minutes; then report BLOCKED. Never
  delete the lock.

The skill's own plan-tick commit (in its Core Flow, which every mode of
subagent-driven-development uses) now ends with `-- <plan file>`. Apart from
that line, sequential runs, orchestrated runs and the plans that writing-plans
writes are unchanged.

### 3. The subagent guard is removed (`hooks/subagent-guard.js`)

The guard was a SubagentStop hook: it blocked a subagent whose final message
paired an action verb with a skill name, and told it to redo its task.
Since 2026-09-05 the guard made 18 false blocks and no correct one: 7 in the
1,505 subagent transcripts on disk, on agents' own prose (for example a quoted
"Re-invoking multi-doc-review"), and 11 recorded only in its log file, on
agents with an empty agent type (probably Claude Code's own internal agents).
The transcripts also hold one deliberate test block, and about 10 real skill
calls inside subagents that the guard never saw, each one requested by the
dispatch prompt. In auto mode, since Claude Code 2.1.271, a subagent hands its
report back through a tool, so the guard read an empty closing text for such
subagents.

Removed: the hook, its test, its wiring in `hooks/hooks.json` and
`plugin.universal.yaml`, the "Subagent leakage guard" rows of the Codex
documents, and the guard text in the README (the hook count goes from 10 to
9), `docs/FORK-IMPROVEMENTS.md` and four skills. The four "Guard Interaction"
sections are now "## Report Marker". The report markers stay, because each
skill's return parsing reads them (`researching-prior-art` discards a
researcher's report file whose first line is not the marker). The "Do NOT
invoke any skills" lines of the prompts stay. The file
`~/.claude/hooks-logs/subagent-violations.jsonl` is no longer written; the
plugin does not delete it.

### 4. The shared-checkout rule reaches the reviewers (`skills/multi-code-review/`, `skills/multi-doc-review/`)

Before: both reviewer templates had a "## Shared checkout" section after the
closing fence of the prompt block. `fill-prompt.js` copies only the block, so
the section reached none of about 238 code reviewers dispatched by pointer; a
prompt that the model filled carried it only sometimes. The section also told
reviewers that other reviewers exist, which the template header rules out, and
it promised that "anything that must actually run is run once by the
controller", which no step did. Real runs show one collision: two doc
reviewers used one scratch folder with a fixed name, and one deleted it while
the other was using it.

Now the section is deleted, and one bullet inside each prompt body says:
other agents may work in this checkout at the same time; create files only at
paths that `mktemp` prints; use no fixed port and no shared database; run a
program that writes files only in a copy made under a `mktemp -d` path, with
HOME set to another `mktemp -d` folder. The code template adds that a focused
test follows these rules too. Both `SKILL.md` files point to the bullet. A new
check fails when a heading stands after the closing fence of any
`skills/*/*-prompt.md`.

### Review

One review round of three reviewers (correctness, adversarial, and test
quality with 77 mutations on a separate clone: 57 caught, 20 survived) found
9 Important and 12 Minor findings (a finding that two reviewers made counts
once). The fix round corrected all of them except
one Minor finding (text after a fence without a heading), which goes to a later
item. The verification pass replayed every reviewer input on the reviewed and
on the fixed commit: every finding was fixed, but the fix round had made one
new Important defect (files that a program of the task wrote were left out of
the wave commit). A targeted correction fixed it, and the same verifier's
replay passed.

### Accepted limits

- Two wave tasks that edit one file: every commit form puts both changes into
  the first commit.
- Under dubious ownership, `context-management` step 1 hides git's error and
  may still offer `git init`.
- A file that was untracked when a wave task started and that the task then
  deleted makes the task's commit fail loudly.
- The new gate test does not load `tests/lib/undefined-command-guard.sh`: that
  guard makes a script with `set -e` exit 1, and the other bash tests in
  `tests/codex/` do not load it either.

### Suites

All 20 fast suites pass. Changed counts: `tests/sdd-scripts` 207 → 283,
`tests/reviewer-templates` 272 → 323, `tests/orchestrating-development`
229 → 235, `tests/fill-prompt` 166 → 167, `tests/in-run-rulings` 883 → 882,
`tests/smart-compress` 268 → 276;
`tests/codex/run-unit-tests.sh` still runs 21 suites (the guard's test is gone,
the gate test is new).

## v7.63.0 — six confirmed findings outside the review's limit of 15 are corrected

**Problem.** The whole-project review of 2026-10-03 confirmed more findings
than its limit of 15. In three, a check reported success without checking:
a named test that was not found, a test pattern that matched no file, a stub
scan (a search for unfinished code) that dropped production lines. A tool
missed quoted log targets, three scripts failed to start under
`core.autocrlf=true`, and a test wrote into the user's real log.

**Change.** This release corrects all six, and also the regression and the
gaps that its review round found.

**Effect.** Update the plugin and restart the command-line interface (CLI). A
clone with `core.autocrlf=true` must delete four files and check them out
again (section 3).

The review report lists the findings outside its limit of 15 in the section
"Confirmed, but cut by the cap of 15". On 2026-10-05 each of them was checked
again against the code of v7.62.0: 2 findings rated Important no longer
exist, because their code changed, and two Minor places changed in part; the
others still hold. The user chose this order: first the six small corrections
of this release (items 1 to 6 below), then a design step for the corrections
that change a rule or a gate, then seven more small corrections. Several
findings are accepted as limits. Item 6 changes a test only.

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the CLI.

### 1. A named test that is not found fails the run (`tests/claude-code/run-skill-tests.sh`)

The runner of the behavioural tests counted a `--test` name that it did not
find as skipped. The run then ended with "STATUS: PASSED" and exit code 0, for
example for `--test tests/claude-code/test-multi-code-review.sh` (a path, where
the runner expects a file name) or for a misspelled name. Now such a name
counts as failed: the run ends with "STATUS: FAILED" and exit code 1, and the
message says that a test name is a file name inside `tests/claude-code/`. The
"Skipped:" line of the summary is removed, because nothing is skipped any more.

After the review, two more forms stop the run before any test runs, with exit
code 1: a second `--test` option (before, it replaced the first name, so the
first named test never ran) and an empty name (`--test ""`, which ran the
default list). The new fast suite `tests/skill-test-runner/` runs the runner
with a substitute `claude` program, so it never calls the real CLI.

### 2. `find-polluter.sh` runs the test files that its pattern names

`skills/systematic-debugging/find-polluter.sh` finds the test that creates an
unwanted file or folder (the "pollution"). It runs the test files one by one
and stops at the first test after which the pollution exists. The documented
pattern `'src/**/*.test.ts'` matched no file, because `find .` prints every
path with `./` in front. The script then ran no test and printed "No polluter
found - all tests clean!" with exit code 0.

Now the script:

- matches the pattern with `./` in front and also as the caller wrote it, so
  every file that the pattern matched before still matches (the review found
  that the first correction dropped a top-level `tests/` folder for
  `'*/tests/*.py'`);
- adds one `find -path` test for each choice of keeping or removing each `**/`
  of the pattern, because in `find -path` a `**/` stands for one or more
  folders, never for zero;
- stops with exit code 1 and a message when the list of files is empty;
- stops with exit code 1 when the pollution exists before a test runs (before,
  it skipped every test and printed "all tests clean");
- reads the file names one line at a time, so a name with a space stays one
  name.

The documented example is now `'src/.git' 'src/**/*.test.ts'`, in the script
and in `skills/systematic-debugging/root-cause-tracing.md`: the old example
`'.git'`, run from the root of a repository, always found the pollution before
the first test. The new fast suite `tests/find-polluter/` runs the script with
a substitute `npm` program.

### 3. Every script keeps LF line ends under `core.autocrlf=true` (`.gitattributes`)

With `core.autocrlf=true` (a git setting that is common on Windows), git
writes the line ends of a text file as CRLF (carriage return and line feed)
unless a rule in `.gitattributes` asks for LF (line feed only).
Four tracked scripts had no
such rule: `sdd-workspace`, `task-brief` and `review-package` in
`skills/subagent-driven-development/scripts/`, and
`tests/claude-code/analyze-token-usage.py`. Under that setting, `./task-brief`
failed with `env: bash\r: No such file or directory`. The three scripts now
have one named rule each, and `*.py` files have a rule. A named rule is used
instead of a rule for the whole folder, because a folder rule would also
change a binary file put into the folder.

The new unit test `tests/codex/test-script-line-ends.js` asks git for the
checked-out content of every tracked file that starts with `#!`, and of
`hooks/run-hook.cmd`, under `core.autocrlf=true`, and fails on a carriage
return. It ignores the user's own git attributes file, `core.safecrlf` and
`init.templateDir`, which made an earlier version fail or hide a missing rule.

**Action for a clone with `core.autocrlf=true`:** git does not rewrite a file
whose content did not change, so a clone made before this release keeps the
CRLF copies, and `git checkout` alone changes nothing (measured). Delete the
four files first, then check them out again:

```bash
rm skills/subagent-driven-development/scripts/sdd-workspace \
   skills/subagent-driven-development/scripts/task-brief \
   skills/subagent-driven-development/scripts/review-package \
   tests/claude-code/analyze-token-usage.py
git checkout -- skills/subagent-driven-development/scripts tests/claude-code/analyze-token-usage.py
```

No test of this release ran on Windows; the behaviour was measured on macOS
with `core.autocrlf=true`.

### 4. The stub scan drops a line only when its file is a test file

`skills/verification-before-completion/SKILL.md` asks for a stub scan before a
task is called done: a `grep` for `TODO`, `FIXME`, `placeholder` and
`NotImplementedError`. A stub is code that stands in for code not written yet.
The last filter of the scan removed every output line that held "test" or
"spec" anywhere, also in the code text or inside a word. So stubs in
`components/Inspector.ts` or `attestation/verify.go`, or on a line with
"latest" or "special", were not reported, and a task could be called done
with a stub in it.

Now `grep` runs inside `<src-dir>` in a subshell (a child shell, so the caller's
current folder does not change), so a printed path never holds the folders
above `<src-dir>`. The
filter reads only that path, up to the first colon, and drops a line only for
a folder named `test`, `tests`, `__tests__`, `spec` or `specs`, or a file named
`*.test.*`, `*.spec.*`, `*_test.go`, `*_test.py`, `test_*.py`, `tests.py` or
`conftest.py`. The review found that the first correction still dropped every
line when an absolute `<src-dir>` had a parent folder named `tests`; the
subshell form removes that case. The new fast suite
`tests/verification-before-completion/` copies the command out of the skill
text and runs it under bash and zsh, with a relative and an absolute
`<src-dir>`.

### 5. `analyze-compaction` reads quoted and variable log targets

`tools/analyze-compaction.js` marks the Bash calls of a transcript that write
a ruling log of the orchestrator, and counts the headings that they write. It
read the target of a `>>` redirect as the raw word after it, so a target in
quotes, or a variable, got no mark. Now the tool removes the quotes, reads a
variable that the same command assigns a literal value before the redirect,
and reads a balanced `$(...)` as part of a word. Only the file name of a
target must be literal; the folder part may hold a variable, as the unquoted
form already allowed. The review found that the first correction also marked
a command that only held such a redirect as text inside a here-document body
(the lines between `<<'EOF'` and `EOF`); the redirect scan now skips those
bodies, and the heading count still reads the body of a real log write.

Measured on 2026-10-05 over 1,787 transcript files of this project (headings
counted in marked Bash commands only): v7.62.0 marks 78 commands and counts 18
headings; this release marks 129 commands and counts 39 headings. The first
correction marked 143 commands; the 14 that this release no longer marks hold
the log name only as text inside a here-document body. v7.62.0 had the same
fault for an unquoted name: the 10 commands that v7.62.0 marks and this
release does not mark also hold the log name only inside a here-document
body.

### 6. The test of the subagent guard no longer writes into the real log

`tests/codex/test-subagent-guard.js` ran the hook with the user's own home
folder, so every run of the test added 20 records to
`~/.claude/hooks-logs/subagent-violations.jsonl`. On 2026-10-05 that file held
14,529 lines, 14,475 of them from the test. The test now gives the hook a
temporary home folder and checks that the records arrive there. The records
already in the file stay; the file belongs to the user.

### Review

One review round of three fresh reviewers ran on the six corrections:
correctness, adversarial (concrete inputs, run, not only reasoned), and test
quality with 59 mutations (small deliberate defects) on a separate clone.
Each new suite failed on the code before its correction. The reviewers found
one regression (section 2, the `./` prefix) and further gaps in items 1 to 5;
item 6 had no finding. One fix round corrected them, with tests first. One
verification pass then replayed every reviewer input on the code before and
after the fix round: every input gave the expected result, and no new defect
was found.

### Limits

- `run-skill-tests.sh` takes one test name only. `--test` or `--timeout` with
  no value stops with "unbound variable".
- `find-polluter.sh`: a file name that holds a new line breaks the list; the
  number of `find -path` tests doubles with each `**/`; in `find -path` a `*`
  also matches `/`; the "To investigate" hint prints a name with a space
  without quotes; an empty list and a found polluter both end with exit code 1.
- The line-end test does not ignore a system attributes file or the
  repository's own `.git/info/attributes`.
- The stub scan takes one folder as `<src-dir>`; folder names match with
  letter case, so a stub in a `Tests/` folder is printed; a path that holds a
  colon is read wrongly. Inside Claude Code, `grep` can be a shell function
  that runs ugrep (another grep program), which skips files that a
  `.gitignore` names.
- `analyze-compaction` gives no mark for a variable assigned in another call,
  a file name made by `$(...)`, or a backslash escape; it reads a body after
  `<<\EOF` as code; a heading in a `<<-` body that starts with a tab is not
  counted.
- Not in this release: the corrections of the review report that change a rule
  or a gate (they need a design step first), and seven more small corrections.

### Tests

The fast suites are 20 now: `tests/codex/run-unit-tests.sh` (21 suites inside)
and 19 suites `tests/<name>/run-tests.sh` that load the guard against a command
that does not exist. New: `tests/skill-test-runner/` (16 checks),
`tests/find-polluter/` (30), `tests/verification-before-completion/` (9 when
zsh is installed, 5 without) and
`tests/codex/test-script-line-ends.js` (4). `tests/analyze-compaction/` has 76
checks. `tests/suite-guard/` requires at least 19 guarded suites now.

## v7.62.0 — the context gate and the statusline bridge are removed, and four more review findings are corrected

**Problem.** The context gate (a check that a hook made on each user prompt)
used a window of 200,000 tokens unless a matching cache file existed, and
fired 0 times in 174 main-session transcripts (session records). A new
worktree (a second working folder) held no spec (design document) and no plan.

**Change.** This release removes the gate and the statusline bridge, the
script that filled that cache file (finding 12). It also corrects findings 9,
13, 14 and 15.

**Effect.** A user who installed the bridge can remove it by hand, and must
change a command that names it under `~/.claude/plugins/` before the update
(section 1). Others update the plugin and restart the command-line interface
(CLI).

The review is the whole-project code review of 2026-10-03 (15 findings).
Findings 1 to 4 were corrected in v7.59.0, findings 6, 10 and 11 in v7.60.0,
and findings 7 and 8 in v7.61.0. Finding 5 no longer exists, because v7.59.0
deleted the file it named. This release holds the last five: 9, 12, 13, 14 and
15. The report of the review also lists findings that were confirmed and that
are outside the list of 15 (section "Confirmed, but cut by the cap of 15"):
10 rated Important and 21 places rated Minor. No commit of this release is a
correction of one of them.

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the CLI.

### 1. The context gate and the statusline bridge are removed (finding 12)

A hook is a script that Claude Code runs at a fixed event. The hook
`hooks/skill-activator.js` runs at the event UserPromptSubmit (the user sends
a prompt) and adds hints about skills to the prompt. It also held a context
gate. The context window is the amount of text that the model can hold at one
time. For a prompt that starts the execution of a plan, the gate estimated
how full the context window was. At 60 percent or more (the variable
`SUPERPOWERS_PRESSURE_THRESHOLD` changed this value) the hook replaced its
hints by a block that told the model to stop, to save `state.md` and to ask
for `/compact`.

What was wrong:

- The input of UserPromptSubmit carries no token usage and no window size.
  The hooks reference of Claude Code lists the input fields; none of them
  holds either value.
- The hook therefore read the last usage figure of the transcript (the file
  in which Claude Code records the session) and divided it by a fixed window
  of 200,000 tokens. The hook used the cache file of the statusline bridge
  (next point) instead, but only when that file held figures of the same
  session that were at most 30 minutes old. With the fixed window, a session
  with a window of 1,000,000 tokens would have been blocked once it held
  120,000 tokens, which is 12 percent of its window. This figure is computed;
  the count below found no blocked session.
- The status line is the line of text at the bottom of the Claude Code
  screen; a command in the settings prints it. The statusline bridge was a
  script that the user set as that command, and the bridge then started the
  original command. The bridge stored the usage figures that Claude Code
  gives to the command in a cache file, and the gate read that file. The
  agent that made the change measured a cache file whose figures were 26.6
  minutes old and 52,000 tokens lower than the real figures of the session.
  After `/compact` (the command that shortens the context), the gate read the
  figure from before the compaction and blocked the prompt again. The gate
  also blocked a prompt of a subagent (an agent that the session started)
  with the figure of its parent.
- The real use, counted again for this entry: 0 firings in 174 main-session
  transcripts since 2026-08-30. The other 1,734 transcripts belong to
  subagents, and only 1 of them holds a UserPromptSubmit record.

What changed (a decision of the user):

- This release removes the gate from `hooks/skill-activator.js`, together
  with the variable `SUPERPOWERS_PRESSURE_THRESHOLD` and the option
  `--pressure` of the script.
- This release deletes `hooks/statusline-context-cache.js` (the bridge) and
  `tools/install-statusline-bridge.sh` (its installer), with their tests and
  their text in the README and in `docs/guide/`.
- `skills/subagent-driven-development/SKILL.md` now says that no hook checks
  how full the context window is when a batch starts.
- The rule "Current context window ≥ 60% full" in
  `skills/writing-plans/SKILL.md` stays. It is an estimate that the model
  makes itself; it never used the gate.

**Migration, only for a user who installed the bridge.** The installer copied
the bridge to `~/.claude/statusline/statusline-context-cache.js`, outside the
plugin, and printed the lines for `~/.claude/settings.json`. In the settings
file the path is written in full (`/Users/<name>/.claude/...` on macOS), not
with `~`.

1. In `~/.claude/settings.json`, key `statusLine.command`: remove the prefix
   `node <home>/.claude/statusline/statusline-context-cache.js -- ` and keep
   the text after ` -- `. That text is the status line command that was there
   before the bridge. When the bridge is the whole command (no ` -- `), remove
   the key `statusLine`.
2. In the same file, remove `SUPERPOWERS_PRESSURE_THRESHOLD` from `env`, when
   it is there.
3. Then delete the two files `~/.claude/statusline/statusline-context-cache.js`
   and `~/.claude/hooks-logs/context-window.cache.json`. Do step 1 first: a
   settings file that still names a deleted bridge has a status line command
   that fails.
4. A special case: `statusLine.command` names the bridge at a path under
   `~/.claude/plugins/`. Two places hold a bridge file there: a version
   folder of the plugin (`~/.claude/plugins/cache/superpowers-orchestrator/...`)
   and the clone of the marketplace
   (`~/.claude/plugins/marketplaces/superpowers-orchestrator/hooks/`). Change
   this command before the update, as in step 1. The new version has no
   bridge file. The update changes the clone of the marketplace at once, so a
   command that names the clone fails right after the update. A command that
   names a version folder fails as soon as the old version folder is removed.

Doing nothing in the cases of steps 1 to 3 breaks nothing. The installed copy
lies outside the plugin and needs no file of the plugin. It keeps writing a
cache file that no hook reads any more.

Limits:

- An old version folder of the plugin keeps its bridge file; the update does
  not delete it. On the machine of this draft, 14 old version folders hold
  one.
- The documents of earlier work under `docs/superpowers-orchestrator/` still
  name the removed option and the removed variable. They are history and are
  not changed.

### 2. Session start injected the snapshot of the previous session start (finding 15)

The snapshot is the file `context-snapshot.json`. The script
`hooks/context-engine.js` (below: the engine) writes it at every session
start: the hash of the commit that is HEAD (field `git_hash`), the time
(field `generated_at`), the
changed files, the newest commits, and the blast radius (the files that
depend on a changed file). The hook `hooks/session-start` reads the file and
injects a summary of it into the context of the model.

What was wrong: the hooks reference of Claude Code
(https://code.claude.com/docs/en/hooks.md) says "All matching hooks run in
parallel." `hooks/hooks.json` also starts the engine with `"async": true`,
which means in the background. So `session-start` read the file before the
engine wrote the new one. The injected block was always the snapshot of the
previous session start, and the hook presented it as the present state. The
agent that made the change measured an old commit list in 10 of 10 runs.

What changed:

- `session-start` injects the block only when `git_hash` of the file equals
  the output of `git rev-parse HEAD`. An older commit, no file, a file with no
  valid time, a file that is being written, a repository with no commit and a
  folder that is not a repository give no block and no error text.
- The first line of the block states the time of the snapshot: "Snapshot
  taken <time> UTC at the commit that is HEAD now."
- The labels say what each list holds: "Files changed by the newest commit",
  or "Commits made between the snapshot before this one and this one: N.
  Files they changed", and "Blast radius at the time of the snapshot". One
  list that the engine writes into two fields is printed once.
- `skills/systematic-debugging/SKILL.md` compares `git_hash` with
  `git rev-parse HEAD` before it uses the file, and runs two git commands
  when the hashes differ.
- `hooks/context-engine.js` no longer passes the error text of git to its own
  error output, for example in a repository with no commit.
- The token-efficiency skill, the README and
  `docs/architecture/project-memory.md` state the hash rule.

Effect: the block is rare now. The agent that made the change measured an
equal hash in 3 of the 12 newest session starts of this repository. In the
other session starts nothing is injected, and the model runs git commands when
it needs the list.

Limits:

- An equal hash does not prove every line of the block. The engine reads the
  blast radius from the working files, and the file list can cover several
  commits. The heading line with the time is there for this reason.
- `hooks/codex/session-start-adapter.js` still injects the block with no
  comparison of the hash. Codex is no longer supported.

### 3. A session log written through Bash stayed visible to git (finding 13)

The exclude file is `.git/info/exclude`: a local file of one repository that
lists paths which git ignores. It is never committed. The hook
`hooks/track-edits.js` writes an entry there for the workspace files of the
plugin (`session-log.md`, `state.md`, `known-issues.md`, `project-map.md`),
so that they do not appear in `git status`.

Two shell terms: a redirect (`>`, `>>` or `>|`) sends the output of a command
into a file. A here-document (`<<`) gives the lines that follow it to a
command as its input.

What was wrong: the save command of the context-management skill appends to
`session-log.md` with `cat >> session-log.md` and a here-document, through the
Bash tool. The hook ran only after the Edit and the Write tool. The file got
no entry, stayed visible in `git status`, and `git add -A` staged it.

The first version of this correction was wrong. It exists only inside this
release and was never released. It wrote an entry for every workspace file
name that a Bash command mentioned. A reviewer found the result: a user's own
new, untracked `state.md` at the top of a project was hidden from git after a
command that only named it, and `git add -A` then left the file out with no
message. A replay on a scratch repository for this entry confirmed it: after
`grep -n notes state.md`, the first version wrote the entry `/state.md`; the
final version wrote nothing.

What changed:

- `hooks/hooks.json` runs `track-edits.js` after Edit, Write and Bash.
- After a Bash call the hook acts only on a redirect whose target has the
  exact name `session-log.md`. A command that only names a file writes
  nothing. `state.md`, `known-issues.md` and `project-map.md` get no entry
  through Bash.
- A relative target is resolved against the folder of the shell (field `cwd`
  of the hook input). The file must exist. The folder rule of v7.59.0 decides
  as after a Write: the file lies directly in the project folder or in the top
  folder of a git work tree. A file that git tracks gets no entry. A Bash
  call writes no line into the edit log.
- Both routes (Edit or Write, and Bash): no entry when git tracks a file of
  the same name in another letter case, for example `STATE.md`, on a file
  system that ignores letter case (the default on macOS and Windows).

Cost: one more Node process after each successful Bash call. Measured for
this entry on one Mac with Node 24.13.1, 20 runs each: a median of 18.4 ms
for a command with no redirect, and 56.6 ms for the save command, because
the hook then also starts git.

The compression hook replaces the output of a Bash command by a shorter text
at the same event (PostToolUse). Three headless probes (runs of the `claude`
program with no user interface) on Claude Code 2.1.289, made in the main
session of this work, showed: a second PostToolUse hook that prints `{}` does
not remove that replacement, whichever of the two hooks ends first.

Limits. In each case below, the hook writes no entry, and the file stays
visible in `git status` until a later save with the exact save command of the
context-management skill (`cat >> session-log.md` and a here-document):

- a target that holds a variable, a backtick, a backslash or `~` at its start;
- a command that writes the file in another way, for example `tee`;
- a redirect on a line after the first `<<` of the command;
- a real redirect inside a command substitution that stands in double
  quotes, for example `echo "$(printf x > session-log.md)"`;
- a `cd` inside a subshell, which `cwd` of the hook input does not show.

A second limit works in the other direction. The hook reads a `>` as a
redirect also in two places where the shell does not: between `[[` and `]]`,
where `>` compares two texts; and inside double-quoted text that holds a
command substitution `$( )` (a command whose output the shell puts in its
place) with a `"` inside it, because the reader of the hook ends the quoted
text at that `"`. The comment of `redirectTargets` in `hooks/track-edits.js`
states both cases. A `session-log.md` that git does not track can then get the
exclude entry, as after a Write of that file. Checked for this entry: the
reader returns `session-log.md` for `[[ a > session-log.md ]]` and for
`echo "$(echo '"') > session-log.md"`.

### 4. A new worktree held no spec and no plan (finding 9)

A worktree is a second working folder of the same repository. A spec is the
design document that the brainstorming skill writes; a plan is the task list
that the writing-plans skill writes. A new worktree holds only committed
files. The skills that write a spec and a plan have no step that commits the
new file, so both were absent in the worktree. A plan that the model then
reads from the first folder can cause a second fault: a commit of the plan in
that folder lands on the branch of that folder, not on the feature branch
(the new branch of the worktree).

The first version of this correction (inside this release, never released)
committed the two files on the current branch, with `git add` on the whole
topic folder (`docs/superpowers-orchestrator/<date>-<slug>/`, the folder that
holds the spec, the plan and the logs of one piece of work). A reviewer showed
two results: the commit landed on the base branch (the branch that the first
folder had checked out, from which the feature branch starts), and it also
took other files of the folder. The user then decided the design below: the
skill commits neither the spec nor the plan on the base branch.

What changed in `skills/using-git-worktrees/SKILL.md`:

- Step 2 checks the spec and the plan, each by its own absolute path, with an
  existence test and
  `git status --porcelain --ignored --untracked-files=all -- "<file-path>"`.
- Step 3 creates the worktree and the branch.
- Step 4 moves a file that step 2 found untracked (a `??` line) into the
  worktree with `mv`, stages it, and commits it there on the feature branch.
  The path inside the worktree is written as an absolute path. Each file is
  named by its own path; no other file of its folder is moved or committed.
- A command of step 4 that fails ends the step. The skill shows the error and
  says in which folder the file is now. The skill does not run a failing
  commit a second time, and it does not switch off a commit hook.
- A file that already exists in the worktree is never overwritten; the user
  is asked.
- A tracked file with a change that is not committed is not moved. The user
  chooses: the user commits the file, or the branch is created in the same
  folder with no worktree.
- A file that git ignores (a `!!` line) means no worktree: the skill creates
  the branch in the same folder with `git checkout -b`, which keeps the file.
- When a rule of the user or the project forbids a commit without approval,
  the skill asks once, before step 3.
- After the move the skill tells the user the new absolute path of each file
  and corrects the path in `state.md`.

What changed in `skills/finishing-a-development-branch/SKILL.md`: the summary
of Option 4 (Discard) names the files that the feature branch added under
`docs/superpowers-orchestrator/`, from
`git diff --name-only --diff-filter=A <base-branch>...<feature-branch>` on
that folder. These are the moved spec and plan, and any other file that the
branch added there; a spec or a plan in another folder is not named. After
the move, the first folder has no copy of the spec and the plan, so a discard
deletes them.

Limits:

- The skill moves only the spec and the plan. The review logs and every other
  file of the topic folder stay in the first folder.
- The suite pins the rules by their exact text and runs the commands of the
  skill on test repositories. No run with the `claude` CLI measured what a
  model does with the new steps.

### 5. The coverage figure used today's file size and counted failed reads (finding 14)

`tools/measure-context.js` reads a transcript and reports where the context of
the session went. For a large file that reached the model in pieces, it prints
the coverage: the lines that the session received, divided by the lines of the
file.

A PARTIAL notice is the notice that the Read tool adds when it cuts a large
file ("PARTIAL view — <path>: showing lines A-B of T total"). The script
counts a notice as "paged short" when the agent read further pages of the
file but never reached its last line.

What was wrong: the script divided by the line count of the file on disk
today. A file that grew after the session therefore got a wrong coverage, and
its notice was counted as "paged short" (in one case that the agent that made
the change found: 33.7 percent printed, 100 percent true). The script also
never read the field `is_error` of a tool result. The script listed a failed
Read as fully received, and also a file that the Read tool refused for its
size.

What changed:

- The total comes from the transcript first: the Read record or the PARTIAL
  notice states the lines of the file at the time of the read. With no such
  record, the script counts the lines of a saved copy of a Bash output: when
  the output of a command is longer than 30,000 characters, Claude Code saves
  it in a file and shows only a 2 KB preview. The script uses that copy only
  when one `cat` of the file was the only printing step of the command, so
  that the copy is the exact text of the file. Only then does the script
  count the file on disk, and that figure has the label "counted on disk
  today".
- The script skips a failed Read. A Read that the tool refused for the size
  of the file gives a row with zero lines received, so the later page reads
  decide its coverage. The script also skips a failed Bash command with one
  printing step. A step is a part of the command between `;`, `&&`, `||` or a
  line end, and a printing step is any step that is not a `cd`. The error
  status of such a command is the status of its one printing step, so that
  step printed no file.
- A total that differs from the total stated before it starts a new version
  of the file. Lines of two versions are never added together. The row shows
  the newest version and names each earlier version with its own total and
  coverage.
- "100 percent" and "last line reached: yes" need a proof: a page showed the
  last line, or a range ran to the end of the file. Without a proof the row
  prints "unknown", and a notice on that file is counted as "end not proven".

This release changes no token figure. Measured for this entry on the 1,905
transcripts of this computer, with the script before this release (commit
`04e8e25`) and the script of this release: no token figure changed. Of the 482
coverage rows of the new script, 275 are new or differ (the old script
printed 413 rows). The PARTIAL notices counted as "paged short" fell from 118
to 6. Between the first commit of this correction (`a663745`) and the final
script, 41 of the 482 rows differ.

Limits:

- A row can print "unknown" for a file that is probably complete: the script
  does not assume a last line that no page showed.
- A change of a file that no Read record states (a file read only through
  Bash) is not seen.
- Some malformed records still stop the script with an error, as before this
  release. Measured for this entry with 16 malformed record shapes: 5 stopped
  the script before and after this release with a `TypeError` (a record that
  is `null`; a Bash command that is not text; a Read path that is not text;
  an assistant record and a user record whose `content` list holds `null`).
  The script skips a line that is not JSON.

### Tests

- New suite `bash tests/using-git-worktrees/run-tests.sh`: 146 checks at the
  time of this draft (129 at commit `8280e38`; the count follows the last
  correction of the skill). It takes the commands out of the skill text and
  runs them on test repositories. The list of fast suites in `CLAUDE.md` does
  not name it yet.
- `bash tests/finishing-branch/run-tests.sh`: 69 checks (64 in v7.60.0).
- `bash tests/measure-context/run-tests.sh`: 404 checks (143 before this
  release).
- `tests/codex/test-git-exclude-hooks.js`: 181 tests.
- `tests/codex/test-skill-activator.js`: 142 tests.
- New file `tests/codex/test-session-start-snapshot.sh`: 110 checks.
- `bash tests/codex/run-unit-tests.sh`: 20 suites, as in v7.61.0 (this
  release removed one with the bridge and added one for the snapshot).

Not run: an interactive session with the changed hooks; Windows; the
behavioural suites (the suites that start the `claude` CLI); Copilot CLI.

## v7.61.0 — the two safety hooks read the words of a command, and one table of secret file paths applies to five tools

**Problem.** The two safety hooks (programs that can refuse a tool call)
tested text patterns with a fixed word order. `git reset HEAD~1 --hard`
passed; `git rm -r --cached .` was refused. Bash could read `.env`; the
Read tool could not.

**Change.** Each rule now tests the words of a Bash command in any order. One
path table (patterns of secret file paths) decides for Read, Edit, Write,
Grep and Bash.

**Effect.** Update the plugin and restart Claude Code. On 34,373 real
commands the old hooks refused 102 and the new hooks refuse 51; only 14 are
refused by both. Nothing to migrate; section 7 lists the limits.

The review is the whole-project code review of 2026-10-03 (15 findings).
Findings 1 to 4 were corrected in v7.59.0, and findings 6, 10 and 11 in
v7.60.0. Finding 5 no longer exists, because v7.59.0 deleted the file it
named. This release corrects findings 7 and 8. Findings 9, 12, 13, 14 and
15 are still open.

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the command-line
interface (CLI).

A hook is a small program that Claude Code runs at a fixed moment. A
PreToolUse hook runs before a tool call, and it can refuse the call. The
plugin has two PreToolUse hooks for safety:

- `hooks/safety/block-dangerous-commands.js` checks every Bash command. It
  refuses a command that destroys work or data.
- `hooks/safety/protect-secrets.js` checks Read, Edit, Write, Grep and Bash.
  It refuses a call that reads, changes or copies to another place a file
  that holds secrets (passwords, keys, tokens).

### 1. What was wrong (findings 7 and 8)

Each rule was one regular expression (a text pattern) that was tested on the
whole command text. The pattern fixed the order of the words. The release
author measured these forms with the old hook scripts:

- Dangerous commands passed when their words were in another order:
  `git reset HEAD~1 --hard`, `git -C repo reset -q --hard`,
  `git push origin main --force`, `git push origin +main`, `rm -rf ~/*`,
  `rm -rf ..`. These passed too: `git checkout .`, `git restore .`,
  `git stash clear`, `git push --mirror` and `rm -rf .git`.
- Harmless commands were refused. `git rm -r --cached .` only removes files
  from the index of git (the list of files for the next commit), and the
  rule for `rm` of the current folder refused it. Text that only names a
  command was refused: `echo "git reset --hard"`, a commit message that
  holds these words, a comment, and a here-document that is written to a
  file. (A here-document is the `<<EOF` form: lines of text that the shell
  gives to a program as its input.)
- Read, Edit and Write on `.env` were refused, but the Bash tool could read
  and write the same file: `grep API_KEY .env`, `echo "A=1" > .env`,
  `wc -l .env`, `git add .env` and `tar czf a.tgz .env` passed.
  protect-secrets did not check the Grep tool. Read of `.ENV` and of
  `C:\proj\.env` passed.
- The message for a secret value in the content of a Write call told the
  model to move the value into the `.env` file. The same hook refuses to
  write that file.
- Both hooks had a constant `SAFETY_LEVEL` with the value `high`. Nothing
  could change it, so the 11 rules of level `strict` never ran.

### 2. The new design

Three design agents with different tasks (completeness, attack, false
refusals, which are refusals of harmless commands) proposed designs. Then
each agent answered the results of the other two (a rebuttal round). The
user chose the design and decided four questions: the scratch folder
exemption (section 4), a command that cannot be read fully, code inside
`python -c` and similar calls, and the redesign itself.

**One shared reader.** The new file `hooks/safety/shell-words.js` is the
reader: it turns the text of one Bash call into a list of simple commands. A
simple command is one program with its words, for example
`git reset --hard`. The reader removes quotes. It reads comments, redirects
(`<`, `>`, `>>`: the shell connects a file to the program), pipes (`|`: the
output of one program is the input of the next), the separators `;`, `&&`
and `||`, subshells (`( ... )`: commands that run in a separate copy of the
shell), `$( ... )` and backticks (`` `...` ``; for both forms, the shell
replaces the text with the output of the commands inside), here-documents
and `case ... esac`. It skips a prefix program (a program that runs the
program named after it) and its options, so that it finds the real program:
`sudo --user bob git ...`, `env NAME=value git ...`, `timeout 5 git ...`. The reader only reads text. It runs nothing.

**Rules on words.** Each rule tests one program, its sub-command (the word
after the program, such as `reset` in `git reset`), the set of its options
and its operands (an operand is an argument that is not an option), in any
order. The options of git itself (`-C <folder>`, `-c <setting>`,
`--no-pager`) are skipped. A shortened long option counts: `git reset --har`
is refused like `git reset --hard`.

**Text that is a command by its position is read again** with the same
rules. The release author measured these forms as refused, with a dangerous
command inside: `bash -c <text>` (also `bash -euo pipefail -c`),
`eval <text>`, text piped into a shell, a here-document for a shell, a file
that the same call writes and then runs, the command after `ssh host` (SSH,
Secure Shell: `ssh` runs a command on another computer) and after `watch`,
`su -c <text>`, `find -exec`, `git rebase -x`, `git submodule foreach`, and,
inside `python -c`, `node -e` or `perl -e`, a call that starts a process:
`os.system("...")`, `execSync('...')`, Perl `system "..."`,
`subprocess.run(["git", "reset", "--hard"])`.

**Text that only names a command is data** and passes: an argument of
`echo` or `grep`, a commit message, a comment, a here-document that is
written to a file.

**A command that the reader cannot read to its end is refused**, by both
hooks, with the rule name `unreadable-command`. Example: a quote that is not
closed. The rules test only the words that the reader returns. When the
reader stops before the end, the rules do not test the rest of the command,
and the rest can hold a dangerous command.

**No second check on the whole text.** The old hooks matched a pattern
anywhere in the command text. The new hooks have no such check. This is why
quoted text passes. It is also why some commands that were refused before
pass now; section 7 names them.

**Other changes.**

- The new file `hooks/safety/hook-io.js` holds what both hooks share: the
  input, the output, the log and the last sentences of every message.
- An error inside a hook: for a Bash command the call is refused; for Read,
  Edit, Write and Grep the call passes and the error is written to the log.
  The reason for the second rule: a defect that refused every Read, Edit and
  Write would stop all work.
- `SAFETY_LEVEL` and the 11 rules of level `strict` are removed from both
  hooks (`git-force-any`, `git-checkout-dot`, `sudo-rm`, `docker-prune`,
  `crontab-r`, `database-config`, `ssh-known-hosts`, `gitconfig`, `curlrc`,
  `grep-password`, `base64-secrets`). `git checkout .` is refused now by the
  rule `git-checkout-tree`. `crontab -r` and `docker system prune` pass, as
  before.
- The rules about secret files and secret variables were moved out of
  block-dangerous-commands. Only protect-secrets holds them now.
- In `hooks/hooks.json` and `plugin.universal.yaml`, the matcher of
  protect-secrets (the list of tools for which Claude Code runs the hook)
  now lists Grep.

### 3. What block-dangerous-commands refuses, and what passes

Three terms: the work tree is the set of files of a repository as they are
on disk; a force push is a push that overwrites the history of a branch on
the remote repository; a dry run only lists what a command would do.

Git forms that are refused (the release author measured each one):

| Refused | Rule name |
|---|---|
| `git reset` with `--hard` or `--merge`, in any position | `git-reset-hard` |
| `git clean` without `-n` or `--dry-run` | `git-clean` |
| `git checkout -f`, `git checkout --force` | `git-checkout-force` |
| `git checkout .`, `git checkout -- .`, `git checkout HEAD -- .` | `git-checkout-tree` |
| `git restore .`, `git restore :/`, also with `--source` or with `--staged --worktree` | `git-restore-tree` |
| `git switch -f`, `git switch --discard-changes` | `git-switch-force` |
| `git push --force` or `-f` with no branch | `git-force-unnamed` |
| A force push to `main`, to `master`, to `HEAD` or to a variable: `git push -f origin main`, `git push origin main --force`, `git push origin +main`, `git push origin +HEAD:main` | `git-force-main` |
| `git push --mirror` | `git-push-mirror` |
| `git push origin :main`, `git push origin --delete main`, `git push -d origin master` | `git-delete-main` |
| `git stash clear` | `git-stash-clear` |

Git forms that pass (the release author measured each one):

| Passes | Why |
|---|---|
| `git reset --soft`, `--mixed`, `--keep`, `git reset HEAD <file>` | These modes keep the changes of the work tree |
| `git clean -n`, `git clean -nd`, `git clean --dry-run -d` | A dry run deletes nothing |
| `git checkout <branch>`, `git checkout -b <branch>`, `git checkout -- <path>` | A branch or named files, not the whole work tree |
| `git restore <path>`, `git restore --staged .` | Named files, or the index only |
| `git switch <branch>`, `git switch -c <branch>` | No force option |
| `git push`, `git push origin feature`, `git push --force origin feature`, `git push origin +feature`, `git push origin :feature` | The branch is not `main` or `master` |
| `git push --force-with-lease`, with any branch or with none | The rule does not count this option as a force |
| `git stash`, `git stash pop`, `git stash drop` | Only `git stash clear` has a rule |
| `git branch -D`, `git rm -r --cached .`, `git rebase main`, `git commit --amend`, `git revert` | No rule |

Other programs (the release author measured each form):

- Refused: `rm -r` of the home folder (`~`, `~/*`, `$HOME`), of a folder
  directly in the home folder (`~/Documents`), of `/`, of a system folder
  (`/etc`), of `.`, `..` and `*`, and of `.git`, also inside a brace list
  (`rm -rf {.git,dist}`; the shell builds one word for each item of
  `{a,b}`); `rm` of an SSH key file; `find / -delete`;
  `find . -name .git -exec rm -rf {} +`; `chmod 777`; `dd` to a disk device
  and a redirect to a disk device (`> /dev/disk2`); `mkfs` on a device
  (`mkfs.ext4 /dev/sda1`); `docker volume rm`, `docker volume prune`,
  `docker system prune --volumes`; a download that a shell runs in the
  same command, before a person can read it
  (`curl <address> | sh`, `curl -o f.sh <address> && bash f.sh`); a function
  that starts copies of itself without end.
- Passes: `rm -rf node_modules`, `rm -rf ./build`, `rm -rf ./{dist,build}`,
  `rm -rf ~/projects/demo/build`, `find . -name '*.tmp' -delete`,
  `find . -mmin +60 -delete`, `chmod 755`, `dd` to a file,
  `docker compose down -v`, `curl -o f.sh <address> && bash -n f.sh`
  (`bash -n` only checks the syntax), and a downloaded file that is only an
  argument (`curl -o d.json <address> && python3 parse.py d.json`).

### 4. The scratch folder exemption

A scratch folder is a folder below a temporary folder of the operating
system (`/tmp`, `/private/tmp`, `/var/tmp`, `/var/folders`, the folder of
`TMPDIR`). Tests and experiments build git repositories there. An exemption
is a named condition under which a rule lets a command pass.

The rules for the git work tree (reset, clean, checkout, restore, switch)
pass when the command text itself names the folder, in one of two forms:

- `git -C <folder> ...`, or
- `cd <folder> && git ...`, with the `cd` directly before the git command.

`<folder>` must be a full path without a variable and without `~`. It must
lie below a temporary folder. It must not be the project folder, a folder
inside the project, or a folder above the project. The project folder is
`CLAUDE_PROJECT_DIR`; without that variable, the `cwd` field of the hook
input.

The release author measured these forms as still refused:

- `cd <folder>; git reset --hard`, and the same with a line end in place of
  `;`. When the `cd` fails, git runs in the folder before it, and that
  folder can be the project.
- `cd <folder> && ls && git reset --hard`: the `cd` is not directly before
  the git command.
- A relative folder, a folder with a variable (`"$TMPDIR/scratch"`), a
  folder with `~`, and a folder that is not below a temporary folder.
- Every push and `git stash clear`. A push changes the remote repository,
  and the stash belongs to the whole repository.
- A command with `--git-dir` or with `GIT_DIR=...`.

The same folder test lets `rm -rf <full path>/.git` and
`cd <full path> && rm -rf .git` pass.

### 5. Secret files: one path table for five tools (finding 8)

A path table is a list of patterns for file paths. The table of
protect-secrets has 27 rows: `.env` files, `.envrc`, SSH private keys,
`.pem` and `.key` files, the credential files of AWS, Kubernetes, Google
Cloud, Azure, Docker, npm and PyPI, `.netrc`, `/proc/<pid>/environ`, and
others. Paths are compared in lower case and with `/` as the separator, so
`.ENV` and `C:\proj\.env` are refused. Template files (`.env.example`,
`.env.sample`, `.env.template`) and public keys (`*.pub`) pass.

The one table decides for five tools: Read, Edit, Write, Grep and Bash.

- **Read, Edit, Write:** the `file_path`.
- **Grep tool** (new): its `path` and its `glob` (a file name pattern such
  as `*.env` that selects the files that the search reads). The
  `pattern` of Grep is
  text and is never tested. Refused: `path` `.env`; `glob` `*.env`,
  `.env*`, `{.env,.env.local}`, `**/*.{pem,key}`. A glob that starts with
  `!` names files that the search leaves out, and it passes.
- **Bash:** every redirect target and every word of every program. The
  release author measured these as refused: `grep API_KEY .env`, `echo "A=1" > .env`,
  `cat < .env`, `wc -l .env`, `sed -n 1p .env`, `git add .env`,
  `git diff .env`, `git log -p .env`, `tar` and `zip` of the file,
  `cp x .env`, `mv`, `scp`, `curl -F file=@.env`, `python3 load.py .env`,
  and a program that the hook does not know (`mytool --config .env`).
- **A file name pattern** (a name with `*`, `?` or `[...]`) is tested
  itself, and against the names of secret files that it can match:
  `cat .env*`, `find . -name '*.env*' -exec cat {} +`,
  `grep -r --include='*.env' KEY .` and `rg -g '*.env*' KEY` are refused.

A Bash word that names a secret file passes only through an exemption of the
program that receives it. Two option exemptions hold for every program: the
value of `--env-file` and the value of `--exclude`. The exemptions, with the
forms that the release author measured (the code holds the full lists):

- A program that neither prints nor changes the content: `ls`, `test`, `[`,
  `stat`, `chmod`, `touch`, and `find` without `-exec` and `-delete`.
- A text argument: the words of `echo`, the pattern of `grep`, the value of
  `grep -e`, a commit message.
- A program that loads the file and does not print it: `source` and `.` set
  the variables of the file in the shell; `ssh-add` loads a private key for
  later `ssh` logins.
- An option whose value is a file that the program uses and does not print:
  `ssh -i` (a private key for the login), `curl --cacert` (certificates
  that check the server), `kubectl --kubeconfig` (the addresses and
  credentials of clusters), `dotenv -e` (variables for the command that
  follows).
- `--env-file`, for every program: a program such as `docker run` loads the
  variables of the file and does not print them.
- `--exclude`, for every program: the value names files that the program
  leaves out. The program loads nothing from them.
- `openssl x509 -in`: openssl reads the certificate in the file and prints
  it, or prints its fields. A certificate holds no secret.
- `cp -n <template> .env`: `cp -n` never replaces a file that exists.
- `git check-ignore`, `git ls-files`, `git status`, `git rm --cached`.

An environment variable is a named value that the system gives to every
program; some hold secrets. A list of every environment variable is
refused: `env`, `printenv`, `export -p` and `set` without arguments.
`printenv HOME` passes. `echo` of a variable with a secret name is refused:
a name in upper case in which one part between `_` is a secret word
(`$API_KEY`, `$PGPASSWORD`, `$DB_PASS`, `$FILE_ENCRYPTION_KEY`), also as
`printenv API_KEY` and `declare -p API_KEY`. Counters and addresses pass
(`$TOKEN_COUNT`, `$PASS`, `$TESTS_PASS`, `$AUTH_URL`, `$SSH_AUTH_SOCK`).
`echo "${API_KEY:+set}"` passes too: it prints only whether the variable is
set.

The 14 patterns for a secret value in the content of Edit and Write are
unchanged. Their message no longer names the `.env` file: it tells the model
to write code that reads the value from the environment, and to ask the user
to store the value.

### 6. What a user sees after a refusal

The hook returns the decision `deny` with one message. Every message has the
same form: the rule name in brackets, what the command would do, a safe
form, and one or two closing sentences. Example for
`git reset HEAD~1 --hard` (the hook prints the message on one line):

```
[git-reset-hard] `git reset --hard` would discard the uncommitted changes of
the work tree. Safe form: `git stash` first, or `git reset --soft`, `--mixed`
or `--keep`; in a scratch repository below a temporary folder, name the
folder in the command: `git -C <full path> ...`. For text that only names a
command, use the Write tool. Do not retry with another spelling.
```

What to do after a refusal:

- You want the command, and you accept what it destroys: run it yourself in
  a terminal outside the session. The plugin has no setting that turns one
  rule off.
- The command works in a scratch repository: name the folder in the command
  (section 4).
- The text only names a command (a note, a document, a test input): let the
  model write it with the Write tool, not through the Bash tool.
- The rule name is `unreadable-command`: the message names the problem, for
  example "a double quote is not closed". Split the command into simpler
  commands.
- A secret file: create or change the file yourself, or give the model the
  one value that the task needs. `cp -n <template> <file>` passes.

Each refusal adds one record to `~/.claude/hooks-logs/<date>.jsonl`, with
the fields `ts`, `hook`, `level`, `id`, `tool`, `target`, `session_id` and
`cwd`, and `permission_mode` when the hook input holds it. For a Bash call,
`target` holds the whole command text as it was written. The log can
therefore hold a secret that was part of a refused command. Before this
release block-dangerous-commands stored the whole command in a field `cmd`,
and protect-secrets stored its first 100 characters.

### 7. Limits

The hooks read text and run nothing. The release author measured each form
below. It passes both hooks, unless the line says "refused".

1. A variable as the program or as a path: `$CMD --hard`, `rm -rf "$DIR"`,
   `F=.env; cat "$F"`. `CMD='git reset --hard'; $CMD` was refused before
   and passes now.
2. An alias (a short name that the shell replaces by a command):
   `alias undo='git reset --hard'; undo` was refused before and passes now.
3. A script file that exists already: `bash cleanup.sh`, `./cleanup.sh`.
4. `make clean` and `npm run clean`: the commands are in another file.
5. A read of a whole folder: `grep -r KEY .`, `tar czf all.tgz .`,
   `git add .`, `git add -A`, and the Grep tool with `path` `.`.
6. `xargs` that gets its operands from a pipe: `ls | xargs rm -rf`,
   `git ls-files | xargs cat`.
7. A file name pattern: `rm -rf b*`, `cat *`, and a pattern with a negated
   set of characters: `rm -rf .[!.]*`, `cat .[!.]*`.
8. Interpreter code (program text that `python`, `node` or `perl` runs)
   other than the calls of section 2:
   `python3 -c "print(open('.env').read())"`, a Python tuple (a list
   written in round brackets: `subprocess.run(("git", "reset", "--hard"))`),
   a list over several
   lines, and a call with several quoted arguments
   (`perl -e 'system("git", "reset", "--hard")'`).
9. A secret variable name in lower case: `echo "$api_key"`, `echo "$token"`.
   Both were refused before.
10. Some forms of the positions of section 2: `su -lc <text>`,
    `echo <text> | bash -s arg`, and a script that the same call writes and
    then runs as `bash -euo pipefail x.sh`. These three were refused before,
    because the old pattern matched anywhere in the text.
    `find . -name '.git*' -exec rm -rf {} +` also passes.
11. `git push --force-with-lease origin main` passes, and
    `git push --force` passes for a branch other than `main` and `master`.
12. Run time. The release author ran two input shapes of one megabyte, and
    the hooks had not finished after 65 seconds, when the measuring script
    stopped them: 125,000 `tee` programs in one pipe (both hooks), and one
    quoted `rm` word that starts a brace list of 500,000 items and does not
    close it (block-dangerous-commands). The same `rm` word without quotes
    is as slow: block-dangerous-commands had not finished it after 66
    seconds, when the script stopped it. No one measured the full run time
    of these shapes. A pipe of 12,500 `tee` programs (100 KB) needs about 2
    seconds: the median (the middle value of the sorted times) of 3 runs on
    one computer (macOS) was 2.02 seconds for block-dangerous-commands and
    2.04 seconds for protect-secrets.
    `hooks/hooks.json` sets no time limit for the two hooks. The hooks
    reference of Claude Code (a copy saved on 2026-10-05) gives 600 seconds
    as the default limit of a command hook, and it says that the tool call
    continues when a PreToolUse hook reaches its limit. A closed brace list
    of 500,001 items is refused in 0.08 seconds as `unreadable-command`.
13. Harmless commands that are refused (false refusals):
    `zip -r a.zip . -x '*.pem' -x '.env*'` (only the words after the first
    `-x` are read as patterns to leave out;
    `zip -r a.zip . -x '*.pem' '.env*'` passes); `echo $KEY_FILE`;
    `yq eval '.tls.key' values.yaml`;
    `python -m uvicorn app:app --ssl-keyfile tls.key`; `cat *.cnf`;
    `grep KEY *.env`.
14. A refused command is written to the hook log as it was written
    (section 6).
15. `.opencode/plugins/superpowers-orchestrator.js` holds an older copy of
    the rule tables of both hooks, with `SAFETY_LEVEL` and the 11 `strict`
    rows. This release does not change that file.
16. The Codex adapter (`hooks/codex/pretool-bash-adapter.js`, the script
    that runs the hook rules for Codex, another coding agent) calls the rule
    functions of both hooks for a Bash command, so it has the new Bash
    rules. It checks no other tool. This release changed it to print the
    new message form and to give the `cwd` field of the hook input to the
    rules of block-dangerous-commands. Codex is no longer supported.
17. No hook checks the Glob tool: no matcher lists it. Glob lists file names
    and prints no content.
18. A program that reads the file named after `--env-file` or `--exclude`
    (section 5): a script that receives `--exclude=.env` and opens the file
    is not refused.
19. `git -C <scratch folder> -c core.worktree=<project> reset --hard`. The
    setting `core.worktree` names the project folder as the work tree, so
    the reset changes the files of the project. Only a command that is
    written to hide its target would use this option.
20. A command that is written to hide its meaning on purpose.

### 8. Tests and measurements

- `tests/codex/test-block-dangerous-commands.js`: 1,043 checks on the real
  hook script, one process for each input. 359 are named checks, and 684 are
  the cases of two decision tables (a decision table is a file that lists
  inputs, each with its expected decision):
  `tests/codex/fixtures/block-dangerous-cases.json`, 645 cases, and
  `block-dangerous-regressions.json`, 39 cases.
- `tests/codex/test-protect-secrets.js`: 1,015 checks. 375 are named checks,
  and 640 are the cases of two decision tables
  (`protect-secrets-cases.json`, 572 cases;
  `protect-secrets-regressions.json`, 68 cases).
- `bash tests/codex/run-unit-tests.sh`: 20 suites.
- For this entry, the release author ran 340 different inputs through the
  real hook scripts of the old version (commit `7698f52`) and of the new
  version, one process for each input. Every form that sections 1 to 7 name
  as measured was one of them, except the forms of limit 12. The forms of
  limits 18 and 19 and the example `mkfs.ext4 /dev/sda1` (section 3) come
  from a later fact check, which ran them through the real hook scripts in
  the same way.
- Run time of one hook process on one computer (macOS), median of 21 runs:
  18 to 19 milliseconds for a normal command such as `git status`. The old
  hooks needed 17 to 18 milliseconds, and a Node process that does nothing
  needs 14.
- Inputs of one megabyte, median of 3 runs, in seconds for
  block-dangerous-commands and for protect-secrets: a list of commands
  joined by `&&`, 0.14 and 0.15; a here-document for a shell, 0.13 and
  0.13; one long word, 0.02 and 0.02; nested subshells, 0.04 and 0.04;
  files that are written and then run, 0.21 and 0.29; a list of pipes into
  `xargs`, 0.14 and 0.14; one word of one megabyte of `*`, 0.02 and 0.03.
- The decisions on real commands. A private list holds 34,373 different
  Bash commands of past sessions. The rule functions of both versions
  decided each command, in one process. The old hooks refused 102 commands,
  and the new hooks refuse 51. 14 commands are refused by both, 88 only by
  the old hooks and 37 only by the new hooks. The smaller number 51 does
  not show fewer false refusals: 37 of the 51 commands passed the old
  hooks, and the rule `unreadable-command` refuses 19 of these 37. The 51
  by rule: `unreadable-command` 19, `env-dump` 17, `git-reset-hard` 9,
  `git-checkout-tree` 5, `git-checkout-force` 2 (one command has two
  rules). Of the 19 commands that the reader could not read, `bash -n` and
  `zsh -n` (a syntax check that runs nothing) both reject 17 and both
  accept 1; bash alone accepts 1. The slowest command needed 3.1
  milliseconds for both rule sets. These are figures only: nobody judged for
  this entry which of the refusals are right.

No one tested the new hooks in an interactive session, on Windows, with the
behavioural suites or in Copilot CLI.

## v7.60.0 — a commit reminder for the session's own files, no invented test result, and a worktree removal that asks first

**Problem.** The stop hook's commit reminder also counted files the session
never edited. The compression hook printed "all tests passed" with no summary
line in the output, and false lint counts. The finishing skill removed a
worktree (a second working folder) with files that git ignores, such as
`session-log.md`.

**Change.** This release corrects review findings 6, 10 and 11. The reminder
counts only the session's uncommitted files; the test and commit compression
rules state only what the output states; the lint rule is removed. The skill
lists ignored files and asks before a removal.

**Effect.** Update the plugin and restart the CLI. Less Bash output is
compressed; section 2 lists the cases. Nothing to migrate.

The review is the whole-project code review of 2026-10-03 (15 findings).
Findings 1 to 4 were corrected in v7.59.0. Finding 5 no longer exists, because
v7.59.0 deleted the file it named. Findings 7, 8, 9, 12, 13, 14 and 15 are
still open.

A session runs the installed copy of the plugin. The changes below reach a
session only after an update of the plugin and a restart of the command-line
interface (CLI).

### 1. The commit reminder counted files that the session never edited (finding 11)

The stop hook (`hooks/stop-reminders.js`) runs when the assistant wants to end
its turn. Its commit reminder had two conditions that were never joined: 5 or
more paths in the edit log of the session (the list of files that the session
changed with the Edit or the Write tool) in the last 30 minutes, and 5 or
more lines of `git status --porcelain` for the whole repository. The number
in the message was the number of status lines. Two wrong results followed:

- Files that the user had changed outside the session were counted, and a
  model that follows the reminder could commit them. In one earlier session
  the reminder appeared six times for files that subagents (agents that the
  session started) were still editing.
- Six new files of the session inside one new folder gave no reminder,
  because git prints one line for the folder.

What changed:

- The reminder counts the logged files of the session for which git reports a
  change that is not committed. One `git status` runs per logged file, with
  `--untracked-files=all`. One value is now the condition and the number, and
  the message says "all edited in this session".
- While the input of the Stop hook lists a subagent that is still running
  (field `background_tasks`, an entry with type `subagent` and status
  `running`), the commit reminder is postponed to a later run of the hook.
  Only this reminder is postponed. The hooks reference of Claude Code
  describes the field under "Stop input"; it does not list the values of
  `status`. The value `running` was measured in a payload of Claude Code
  2.1.289. Without the field, the hook behaves as with the first rule alone.
- A logged file whose folder was renamed or deleted is still counted: its
  path is resolved through the nearest folder that exists.
- The whole count has one time limit of 5 seconds.

Limits:

- A file that was changed only through the Bash tool is not in the edit log
  and is not counted.
- When a subagent runs for more than 30 minutes after the last edit, the
  postponed reminder does not appear.
- When git needs more than 5 seconds for the whole count, the count stops.
  The files counted until then can be fewer than 5, and then no reminder
  appears.
- When the files lie in another repository than the session folder, the
  reminder does not say which repository holds them.
- `hooks/codex/stop-adapter.js` still counts the whole status. Codex is no
  longer supported.

### 2. The compression hook stated results that the output did not state (finding 6)

The compression hook replaces the output of a Bash command that ended with
exit status 0 (the number a program returns; 0 means success) by a shorter
text. Its test rule kept the summary line of the test runner (a line such as
"Tests: 100 passed, 100 total"). When it found no summary line, it printed
"all tests passed". Exit status 0 does not prove that a test ran: the sentence
appeared for an `npm test` that runs `node --test` with 24 skipped tests, for
a run with zero tests, and for an `npm test` script that runs no test.

What changed:

- With no summary line, the test rule returns nothing, and the output is not
  compressed.
- The test rule also returns nothing when a line that it would remove holds
  one of the words skip, pending, todo or ignored. Before, the summary line of
  one test runner could remove the line about the skipped tests of another.
  A summary line that itself names skipped tests is kept, and that output is
  still compressed (jest "Tests: 2 skipped, 22 passed"; mocha "16 pending").
- The mocha line "N pending" is kept next to "N passing".
- The lint rule is removed (a lint tool checks source code for errors and
  style problems). The rule sorted lines by the words "error" and "warning",
  so it could not state the counts of the tool. The output of a lint tool
  that is called by its own name is not compressed.
- A dry run is a run that only reports what the command would do. A command
  with an option that starts with `--dry`, and `git add -n`, is never
  compressed. The commit rule returns nothing when the output holds no
  `[branch hash]` line, so "committed" appears only for a real commit.

Effect on the saving: a passing pytest, vitest or `go test` run, and an
`npm test` that runs `node --test`, is no longer compressed. Jest, mocha and
cargo output with a summary line is compressed as before, when no removed
line holds one of the four words.

Limits:

- A test name or a file name that holds one of the four words keeps the whole
  output uncompressed.
- `git push -n` (the short form of `--dry-run`) is still summarised as "ok".
- A lint tool that `make` starts (`make lint`) still goes through the build
  rule, which matches every `make` command.
- The rules for other commands (git push, npm install and others) are not
  changed by this release.

### 3. "Remove worktree" deleted files that git ignores (finding 10)

`git worktree remove` refuses when the worktree (a second working folder of
the same repository) holds a modified file. It does not refuse for a file
that git ignores: it deletes that file with exit status 0 and no message. The
hooks of the plugin make git ignore the workspace files `session-log.md`,
`state.md`, `known-issues.md` and `project-map.md`, so a session that ran
inside a worktree lost them at the step "Remove worktree" of
`skills/finishing-a-development-branch/SKILL.md`.

What changed:

- The skill has one section "Removing a worktree". The three outcomes of the
  skill that can remove a worktree (Option 1 merge, Option 2 pull request, Option
  4 discard) use it. It runs
  `git -C "<worktree-path>" status --porcelain --ignored --untracked-files=normal`.
  With no output it removes the worktree. With any output it shows the lines,
  says which of them are workspace files of the plugin, and asks the user
  which files to move to the main checkout (the first working folder of the
  repository) and which to delete.
- It never passes `--force` before the answer, and it never overwrites a file
  in the main checkout.
- The skill takes the path of the main checkout first and runs the removal
  and every later git command with `git -C` on that path, because the session
  can run inside the worktree that is removed.
- Options 1 and 4 remove the worktree before they delete the branch. Git
  refuses to delete a branch that a worktree uses.

Limits:

- A worktree that holds an ignored dependency folder, for example
  `node_modules/`, causes one question to the user at the removal.
- A worktree with a detached HEAD (no branch is checked out) can hold commits
  that no branch names; the check does not list them.
- Option 1 still starts with "Checkout base", which git refuses inside a
  worktree.

### Tests

- New suite `bash tests/finishing-branch/run-tests.sh`: 64 checks. It takes
  the commands out of the skill text and runs them on worktrees that the
  suite builds for the test.
- `bash tests/smart-compress/run-tests.sh`: 268 checks (218 in v7.59.0), with
  captured output of test runners and lint tools as input files.
- `tests/codex/test-stop-reminders.js`: 144 tests.
- `bash tests/codex/run-unit-tests.sh`: 19 suites.

Not run: an interactive session with the new stop hook; Windows; Copilot CLI.

## v7.59.0 — the plugin approves no Bash command, and three more hook corrections

**Problem.** The compression hook approved each Bash command it rewrote, so
the user's permission rules and prompts did not apply. Three other hooks
could run a command from a file name, change the user's repository, and hide
project documents from git.

**Change.** This release corrects findings 1 to 4 of a whole-project review.
Compression replaces the output after the command, and no hook rewrites or
approves a command.

**Effect.** Update the plugin and restart the CLI; compression needs Claude
Code 2.1.121 or later. Add allow rules for the commands of unattended
runs, and run the required check for hidden documents. A failing lint run is
no longer compressed; a plugin clone on another branch gets no update and no
notice.

A hook is a program that Claude Code runs at a fixed event, for example
before a tool call (`PreToolUse`), after a tool call (`PostToolUse`), or at
the start of a session (`SessionStart`). The review ran on 2026-10-03
against v7.58.0 (commit `2bdaa7e`) and listed 15 findings. This release
corrects findings 1 to 4. The new design of the compression hook also
removes finding 5 (section 1). Findings 6 to 8 are hook defects too, and
this release does not correct them (see the last section). Eleven commits
make the change: one fix for each of the four findings, and seven
corrections that reviews of those fixes asked for.

Update the plugin and restart the CLI, as after every release. In this
release the entry of the compression hook moved to another event in
`hooks/hooks.json`. A session that still uses the hooks file of the older
release starts the new hook on `PreToolUse`; the hook changes nothing there,
and the test suite checks this.

### 1. The compression hook rewrote and approved Bash commands

What was wrong. The compression hook (`hooks/bash-compress-hook.js`)
shortens the output of some Bash commands before the assistant reads it. For
each single Bash command that a compression rule matched (`git push`,
`git commit`, `npm install`, `make`, `git status` and others), the hook ran
on `PreToolUse`, replaced the command with a call of the wrapper program
`hooks/bash-optimizer.js`, and returned the permission decision "allow".
Claude Code skips the permission prompt after "allow". It also compares the
user's permission rules (the allow, ask and deny rules in the settings of
Claude Code; a deny rule forbids a command) with the command text that the
hook returns. So the command ran with no prompt, and a deny rule such as
`Bash(git push:*)` did not match the replaced text.

The cause. The old design compressed the output by running the command
inside the wrapper program. The hook therefore had to replace the command
before the command ran, and it returned "allow" together with the replaced
command.

What changed (commit `b8291bc`). The hook is now a `PostToolUse` hook. Claude
Code runs the command exactly as the assistant wrote it, in the user's shell,
under the user's permission rules. After the command has ended, the hook
reads the output from the hook input and returns the compressed text in the
field `updatedToolOutput`. The hook returns no permission decision and never
changes a command. `hooks/bash-optimizer.js` is deleted. In `hooks/hooks.json`
and in `plugin.universal.yaml` the entry moved from `PreToolUse` to
`PostToolUse`. The entry was removed from `hooks/hooks-cursor.json`.

This design also removes finding 5 of the review. The wrapper program ran
each command with `/bin/bash`, not with the user's shell (zsh on macOS), so
a file name pattern such as `**/*.md` could match other files than in the
user's shell. The wrapper program no longer exists.

Requirement. Compression needs Claude Code 2.1.121 or later; that version
added `updatedToolOutput` for the Bash tool. On an older Claude Code version
and on Copilot CLI the output is expected to stay raw (raw output is the
output exactly as the command printed it). Nobody ran the hook on either.

Two reviews of the fix (commits `366096d` and `2614465`) added these
corrections:

- **Alert lines.** Claude Code merges the standard error (the error stream)
  of a successful command into its output. A rule could therefore remove an
  error line of a command that ended with exit status 0. One shared step,
  `runRule` in `hooks/compression-rules.js`, now protects such lines for
  every rule, also in the Codex adapter. An alert line is a line of the
  output that holds an alert stem (the start of a word family), in upper or
  lower case. Examples of stems: `error`, `warn`, `fail`, `fatal`,
  `conflict`, `denied`, `traceback`, `exception`, `reject`, `vulnerab`; the
  full list is in `docs/architecture/smart-compress.md`. The stem can be
  inside a longer word (`TypeError`, `FAILED`). Colour codes are removed
  from the line before the search. A file name that holds a stem
  (`src/errors.js`) counts too: every doubt keeps the line. Each alert line
  that is not a whole line of the compressed text is added below that text,
  under the heading `Removed lines with an alert word:`. With more than 40
  such lines the output stays raw.
- **Size rule.** The replacement must have fewer lines than the output and
  fewer characters than the `stdout` text of the response. Otherwise the
  output stays raw.
- **Saved output.** For output above 30,000 characters, Claude Code saves
  the output in a file and adds the fields `persistedOutputPath` and
  `persistedOutputSize` to the response. The assistant then receives only a
  short preview and the path of the file, so a replacement could be longer
  than the preview. The hook leaves such a response unchanged and does not
  read the file.
- **Known fields.** The hook replaces the output only when it knows every
  field of the response. The responses of `git commit` and `git push` carry
  a field `gitOperation` that the first version of the fix did not know, so
  the git-commit rule and the git-push rule never compressed any output in
  that version. The hook now knows four more fields (`gitOperation`,
  `bashEditDiff`, `staleReadFileStateHint`, `dangerouslyDisableSandbox`) and
  returns each unchanged. A response with any other field stays raw.
- **The git-push rule.** The rule read the words "To find out more" in a
  message of the server as the address of the remote, and it removed the
  lines of the server. It now reads the remote only from a line
  `To <address>` whose address holds `:` or `/`, and it keeps every line
  that starts with `remote:`. Before this release the git-push rule
  shortened nothing in a real session: `git push` writes its lines to
  standard error, and the deleted wrapper program printed standard error in
  full below the summary. With this release the rule shortens that output
  for the first time.
- **Repeat rule.** The second run of the same command within 60 seconds
  stays raw. The 60 seconds now count to the start of the second run.

Every replaced output ends with a marker line, a line of the form
`[compressed: 14->10 lines | git-status]` that tells the assistant how many
lines the rule removed.

Changes that a user will notice:

- **The user's permission rules apply again.** A command that the old hook
  approved now follows the user's permission rules. For a command that no
  allow rule covers, the result depends on the permission mode of Claude
  Code. In the modes `default`, `acceptEdits` and `plan`, a permission
  prompt appears. In the mode `dontAsk`, and in a headless run (`claude -p`,
  a run with no dialog), Claude Code denies the command with no prompt. In
  the mode `bypassPermissions` nothing changes. In the mode `auto`, a
  classifier of Claude Code decides. An unattended pipeline run (a run of
  the orchestration skill from a specification to a reviewed branch, with no
  person watching) can stop at such a prompt, or Claude Code denies the
  command: add allow rules for the commands that the run needs before you
  start it.
- **The error stream of a successful command is compressed with its
  output.** The deleted wrapper program stated that standard error is always
  passed through uncompressed. This statement is no longer true for a
  command that ends with exit status 0: its error lines are part of the
  output, and the hook keeps for certain only the lines with an alert stem.
- **The output of a failing command is always raw.** Claude Code sends the
  event `PostToolUseFailure`, not `PostToolUse`, for a command that fails,
  so the hook does not receive it. This includes a failing lint run (lint is
  a program that checks source code against style and error rules, for
  example `ruff` or `eslint`): most lint programs end with a non-zero exit
  status when they report an error. The old hook compressed that output; the
  new hook does not receive it.
- **`npm install` always shows one alert line.** The line
  "found 0 vulnerabilities" holds the stem `vulnerab`, so it appears under
  the alert heading, also when the summary of the rule holds the same words.
- **A passing test run can stay raw.** A passing test run in which more than
  40 different lines hold an alert stem, for example test names such as
  "should fail when the input is empty", is not compressed.
- **Output above 30,000 characters is not compressed.** A long passing test
  run or a long `find` list stays as Claude Code delivers it: a preview and
  the path of the saved file.

What the tests show. `bash tests/smart-compress/run-tests.sh`: 218 checks
pass, 0 fail. The suite runs the hook as a process and gives it hook inputs
in the shape measured on Claude Code 2.1.289; it starts no Claude Code
session. For the 9 commands of the review finding, no `PreToolUse` hook of
`hooks/hooks.json` and no run of the compression hook returns a replaced
command or the decision "allow" (9 of 9). The suite also checks that
`hooks/bash-optimizer.js` does not exist and that `hooks/hooks-cursor.json`
does not start the hook. `tests/codex/test-posttool-bash-compress-adapter.js`
has 13 tests (12 before); the new one checks that warning lines and an
error line of `npm install` stay in the replacement of the Codex adapter.

What no test shows. No live interactive session ran the new hook. Headless
runs (`claude -p`) were made with Claude Code 2.1.289 on the first version
of the fix (commit `b8291bc`) only; no session of any kind ran the two later
versions of the hook.

### 2. A file name could run a command at session start

What was wrong. `hooks/context-engine.js` writes the snapshot at every
session start. The snapshot is the file `context-snapshot.json`: the files
changed since the last session, and for each one the files that refer to
it. A tracked file whose name held `$(...)` or a backtick pair ran the inner
command at session start, with the user's rights and with no prompt. The
command ran only when the text of that file held the base name of a changed
file. A name such as `route.$id.js`, or a name with a non-ASCII letter, ran
nothing, but the hook checked a wrong path, and the file always stayed in
the list of referring files.

The cause. The hook built one shell command string from a file name that git
had printed, and ran the string through a shell.

What changed (commit `de20307`). Every git call goes through `execFileSync`
with an argument list, so no shell reads the text. git prints file names with
`-z` (each name unchanged, ended by a NUL character), and the check of one
file uses `--literal-pathspecs`, so git reads the name as one file and not as
a pattern. The review of the fix (commit `9ace8b6`) found that a tracked file
with the name of the revision range (for example a file named
`HEAD~1..HEAD`) gave an "ambiguous argument" error and an empty list of
changed files; the range is now followed by `--`.

What the tests show. `tests/codex/test-context-engine.js`: 37 tests pass (16
before). A fixture is a small repository or file that a test builds for one
case. The new tests build a fixture repository for each of 10 kinds of file
name (ordinary characters, a space, `$(...)`, a backtick pair, a `$`
variable, a single quote, a leading dash, a non-ASCII letter, a double
quote, a line break) and check three things: the importing file is listed,
the file that only mentions the name in prose is not, and no command
created a file. The unit runner now runs this suite; before, nothing ran it.

### 3. The automatic update could change the user's own repository

What was wrong. The update check of `hooks/session-start` has two parts. For
a marketplace install (the plugin installed with the plugin command of
Claude Code, into its plugin cache), the hook compares the installed version
with the newest published version and prints a notice. For a git clone of
the plugin, the hook runs `git fetch origin` and
`git merge --ff-only origin/main`, a fast-forward: git moves the checked-out
branch to the newer commit and creates no merge commit. The hook treated
the plugin folder as a clone whenever the folder lay inside any git work
tree (the folder that holds the checked-out files of a repository). For a
marketplace install under a `~/.claude` folder that the user keeps in git,
the hook ran the fetch and the fast-forward in the user's repository. The
fast-forward also moved a checked-out branch other than `main`.

The cause. The test was `git rev-parse --git-dir`, which succeeds in every
folder inside a work tree.

What changed (commit `609f5d3`). The automatic fetch and fast-forward run
only when two conditions hold: the plugin folder is itself the top level of
a git work tree, and branch `main` is checked out. A plugin folder that only
lies inside another repository runs the code for a marketplace install: the
version comparison and the notice. A marketplace install gets its version
check as before. The review of the fix (commit `1717639`) found that a tag
named `main` made git print the short branch name as `heads/main`, so a
correct clone was skipped; the hook now compares the full reference name
`refs/heads/main`.

Changes that a user will notice: a clone of the plugin with another branch
checked out, or with a detached HEAD (a checked-out commit with no branch),
gets no automatic update and no notice. Update such a clone with
`git pull`.

What the tests show. `tests/codex/test-session-start-update-check.sh` is
new: 48 checks in 10 scenarios pass (the plugin folder inside the user's
repository, `~/.claude` as a symbolic link into that repository, a clone on
`main`, a clone on `main` with a tag named `main`, a clone reached through a
symbolic link, four other branch names, a detached HEAD). The suite removes
every `GIT_*` variable and stops when git would use a repository other than
its fixture.

### 4. A project document was hidden from git

What was wrong. After each Edit or Write, `hooks/track-edits.js` compared
only the file name with the four workspace file names (`state.md`,
`known-issues.md`, `session-log.md`, `project-map.md`). When git did not
track the file yet, the hook added it to the exclude file
(`.git/info/exclude`, the local list of files that git does not show). A new
document of the user's project such as `docs/known-issues.md` got the entry
`/docs/known-issues.md`. `git status` no longer listed the document,
`git add -A` skipped it, and the commit lacked it, and git printed no
message.

The cause. The skills write their workspace files in one folder only, but
the hook did not check the folder.

What changed (commit `d06e6d9`, corrected by `ce7216e`). The hook writes the
entry only when the file lies directly in one of two folders: the top folder
of its git work tree, or the session's project folder (the folder named by
the environment variable `CLAUDE_PROJECT_DIR`, which Claude Code sets). The
second folder was added after the review: in a session started in a
sub-folder of a repository, the first version of the fix made the plugin's
own workspace files visible, and `git add -A` staged them.

Changes that a user will notice: a workspace file in a sub-folder that is
not the session's project folder gets no entry, and git shows it as
untracked. An example is a session that works in a sub-folder of a
repository on a platform that does not set `CLAUDE_PROJECT_DIR`.

**Required check.** An older version may still hide a document of your
project from git, and this release removes no old entry. Two kinds of old
entry exist. Versions v7.32.0 to v7.58.0 wrote a line such as
`/docs/known-issues.md` into the exclude file. Versions before v7.32.0 wrote
the bare file name, below the comment line `# AI assistant artifacts`, into
a `.gitignore` file in the folder of the document. The check therefore asks
git itself, which reads every ignore source. Run this command in the top
folder of each repository in which you used the plugin:

```bash
git ls-files --others --ignored --exclude-standard | grep -E '(^|/)(state|known-issues|session-log|project-map)\.md$'
```

It prints each existing file with one of the four names that git ignores.
For each printed path, ask git which file and which line hides it:

```bash
git check-ignore -v <path>
```

One rule decides for every printed path. If the file is a document of your
project that belongs in a commit, delete the line that `git check-ignore`
names. If the file is a workspace file of the plugin (in the top folder, or
in the folder in which you start your sessions), keep the line.

Both commands were run on a fixture repository with git 2.50.1 and the grep
of macOS. The fixture held the exclude lines `/docs/known-issues.md`,
`/known-issues.md` and `/state.md`, and an old-style `.gitignore` in
`docs/guides/` with the line `state.md`. The first command printed
`docs/guides/state.md`, `docs/known-issues.md`, `known-issues.md` and
`state.md`. It did not print `docs/mystate.md` or
`packages/app/project-map.md`, which no entry hid. The second command
printed `.git/info/exclude:7:/docs/known-issues.md` for
`docs/known-issues.md` and `docs/guides/.gitignore:3:state.md` for
`docs/guides/state.md`: the file, the line number and the pattern.

What the tests show. `tests/codex/test-git-exclude-hooks.js`: 30 tests pass
(17 before). New cases: each of the four names in the top folder gets an
entry; `docs/known-issues.md`, `docs/guides/state.md` and
`packages/app/state.md` get none; a file in the project folder gets one when
that folder is a sub-folder; without the variable a sub-folder file gets
none; the same through symbolic links and in a linked worktree (a second
work tree of one repository, created with `git worktree add`).

### Beyond the four findings

The reviews of the fixes added two things.

- **The Codex adapter got the update correction** (commit `1717639`).
  `hooks/codex/session-start-adapter.js` had the defect of finding 3 and now
  tests the same two conditions. `tests/codex/test-session-start-adapter.js`:
  22 tests pass (15 before). These are unit tests only: Codex is not
  installed on the test machine, and the adapter was not run in Codex.
- **The snapshot is written only to an absent path or a regular file**
  (commits `659d51a` and `57ff9fc`). When a repository held a symbolic link
  (a file that points to another file) named `context-snapshot.json`, the
  hook overwrote the file that the link points to, with text that holds
  commit subjects. For a folder with that name, the hook added an exclude
  entry that hid the untracked files of the folder. The hook now reads the
  path with `lstat`, which does not follow a link. When the path is a link,
  a folder or anything else that is not a regular file, the hook writes
  nothing and adds no exclude entry. Three of the 37 tests cover a tracked
  link, an untracked link and a folder.

### What this release does not correct

- **Findings 6 to 8 of the review.** Finding 6: the test rule still prints
  "all tests passed" when it finds no summary line in the output of a test
  run that ended with exit status 0. The lint part of finding 6 needed a
  failing run, and on Claude Code a failing run no longer reaches the hook.
  Finding 7 (the patterns of `hooks/safety/block-dangerous-commands.js`) and
  finding 8 (the Bash rules of `hooks/safety/protect-secrets.js`) are
  unchanged.
- **The fetch has no time limit on macOS.** The hook limits the `git fetch`
  of the automatic update to 3 seconds with the command `timeout` or
  `gtimeout`. macOS has neither unless the GNU core utilities are installed.
- **The snapshot of a sub-folder session.** In a session started in a
  sub-folder, the snapshot compares paths relative to two different folders:
  `git diff --name-only` prints the changed files relative to the top
  folder, and `git grep` prints the referring files relative to the session
  folder.
- **The repeat rule with several agents.** The repeat rule keeps one record
  per session, and a subagent (an agent that the main session starts for one
  task) has the session id of the main session. When two agents run the same
  command within 60 seconds, the second agent gets raw output although it
  saw no compressed output. The only result is less compression.
- **Two manifest files.** `.codex-plugin/plugin.json` and
  `.cursor-plugin/plugin.json` state version 7.0.1. No test covers them, and
  this release leaves them unchanged.

Tests, all run on 2026-10-04 on macOS with Node 24.13.1 and git 2.50.1:
`bash tests/codex/run-unit-tests.sh` passes with 19 suites (17 before; the
two new ones are the update-check suite and the context-engine suite), and
`bash tests/smart-compress/run-tests.sh` passes with 218 checks. Each
"before" figure comes from a run of the same test file from commit
`2bdaa7e`.

Documents: `README.md`, `.codex/INSTALL.md` and `docs/guide/README.md` now
state the folder condition of the exclude entry, the two conditions of the
automatic update, and that the plugin approves no command.
`docs/architecture/smart-compress.md`, `docs/platforms/codex.md` and the
token-efficiency skill describe the compression hook as it is now.

## v7.58.0 — the test-first reminder leaves out a restored file

**Problem.** The stop hook's test-first reminder read only the edit log (the
list of files that the session edited). A source file that the session
edited and then restored, so that `git diff` was empty, was named again at
every stop inside the next 30 minutes. Each such reminder cost one turn.

**Change.** The stop hook now asks git about each file it would name. It
leaves a file out only when git tracks the file, `git status` reports no
change for it, and no commit on any branch changed it since the edit.

**Effect.** Update the plugin and restart the CLI; a restored file no longer
triggers the reminder. Every other file is named as before. Nothing to
migrate.

The defect was reported from a second computer: the reminder named
`task_runner_network_handler.py` although its `git diff` was empty, and the
assistant answered that it was "the same out-of-date reminder". The same
thing was reproduced here on 2026-10-03: a control file was written into the
repository and deleted again, and the next stop still named it.

The cause is in `hooks/stop-reminders.js`. The reminder took every source
file with an edit record of the last 30 minutes and never looked at the
current state of the file. The stop guard silences the hook for 2 minutes
only, so every later stop inside the window repeated the reminder. The edit
record is correct at the time it is written; the file changes afterwards.
The check therefore belongs where the record is read, in the stop hook, and
git is the authoritative source. The commit reminder of the same hook was
corrected in the same way earlier.

The rule. A file is left out of the reminder only when all three hold:

- `git status --porcelain --ignored --untracked-files=all` prints nothing for
  the file;
- `git ls-files` prints the file, which means that git tracks it under
  exactly this name;
- `git log --all --reflog --since=<first counted edit>` prints no commit that
  changed the file. `--all` reads every branch, every tag and the newest
  stash entry. `--reflog` adds the commits of the reflogs (a reflog is the
  list that git keeps of the earlier values of a reference): an older stash
  entry, and a commit whose branch was deleted. The edit time is rounded
  down to a whole second, because git stores commit times in whole seconds;
  a commit in the same second counts.

A symbolic link (a file that points to another file) is replaced by the file
it points to before git is asked, because an edit through a link changes
that file. git runs in the folder of the file, so the repository of the file
decides, not the session folder. git runs with `--no-optional-locks`, so the hook does
not rewrite the index (the file in which git stores the state of every
tracked file), and with `--literal-pathspecs`, so the characters `*`, `?` and
`[` in a file name have no special meaning. git runs only when the reminder
is due.

Still named, as before this release: a file that is still modified or
staged; a file that the session deleted; a file committed after the edit,
also on another branch, on a branch that was deleted, in the stash, or in a
worktree that was removed afterwards; a new file that git does not track, also when it was deleted
again; a file that git ignores; a file outside a git repository; every file
for which a git command fails or reaches its time-out of 5 seconds.

The first version of the fix (commit `1a78eb2`) also left out a new file that
was created and then deleted, and it read commits of the current branch
only. Three independent reviews (correctness, adversarial replay of about 95
file states, mutation testing with 30 changed copies of the code) found four
states in which that version left out a file although the change of the
session still existed: a commit in a worktree that was removed afterwards, a
commit on another branch or a `git stash`, a record that differs in letter
case from the tracked name on a file system that ignores case, and a new
file moved to another name with `mv`. git has no record of a file that it
never tracked, so it cannot tell "deleted" from "moved". The rule was
therefore narrowed to positive proof (commit `985bcd8`): a new file that was
created and then deleted is named again for 30 minutes, as before. A fourth
review replayed 80 states against the narrowed rule. It confirmed that the
four states are closed and found two more: a change in a stash entry that is
not the newest one, and a tracked symbolic link that was edited through the
link. The `--reflog` option and the replacement of a link by its target
close them.

Cost, measured with the real hook in a scratch repository: about 9 ms for
each file that is still modified (one git call) and about 26 ms for each
restored file (three git calls). 10 restored files took 269 ms; 200 took
5.2 s.

Known limits, each accepted and not fixed:

- A commit that the session made and then removed again with a hard reset
  stays in the reflog, so the file is still named. This is one reminder too
  many, not a missing one.
- A commit whose committer date was forced to a time before the edit is not
  seen.
- A change that exists only under another file name (the edited file was
  copied, then restored) is not seen, because the copy has no edit record.
- A merge made with the strategy `ours`, which keeps the commit of the
  session in the history but none of its content, is not seen once its
  branch is deleted.
- A git command that hangs costs 5 seconds per file. `hooks/hooks.json` sets
  no time-out for the stop hook.

Tests: `tests/codex/test-stop-reminders.js` has 29 new tests (65 before, 94
now). The 15 fast suites pass. `getUncommittedCount` now uses the new helper
`gitStdout`; one of the new tests pins the number that the commit reminder
prints, which no test read before.

## v7.57.0 — the edit log skips the session scratchpad

**Problem.** The stop hook's test-first reminder named scratch scripts that
the main session or a subagent wrote into the session scratchpad (the
temporary folder that Claude Code gives a session) as modified source
files, because `track-edits.js` logged every Edit and Write with no folder
check. Measured: five such reminders in one session, each costing a turn.

**Change.** The edit hook reads `scratchpad_dir` from its input and logs no
line for a path inside that folder; both paths are resolved through
symbolic links first. Without the field, every edit is logged as before.

**Effect.** Update the plugin and restart the CLI; scratch files no longer
trigger the reminder. Nothing to migrate.

The defect was seen on 2026-10-01: a reviewer subagent wrote `attack.js` and
`mutate.js` into the session scratchpad for a mutation check, and the stop
hook then printed "TDD reminder: 2 source file(s) modified without test
changes" four times; a fifth reminder named a scratch script of the main
session itself. The stop hook decides "source file" by the file extension and
filters the edit log by time, session id and the subagent worktree pattern
only, so the fix belongs where the record enters: the edit hook.

The real hook input was measured before any code was written. A headless
`claude -p` session has no scratchpad folder and no `scratchpad_dir` field
(Claude Code 2.1.286). In an interactive session the PostToolUse input of a
Write carries `scratchpad_dir` in the form
`/private/tmp/claude-<uid>/<project>/<session-id>/scratchpad` (no trailing
slash) for the main session and for a subagent alike, with the same
`session_id`; the subagent's input adds `agent_id` and `agent_type`. The
documentation names `scratchpad_dir` as a common field of every hook event,
absent when the session has no scratchpad.

`hooks/track-edits.js` gains `isInsideScratchpad`: the scratchpad path and
the file path are resolved with `fs.realpathSync` (a missing file through its
parent folder), and the file is inside when `path.relative` gives no `..`
segment and no absolute path. So `/tmp/...` and `/private/tmp/...` name one
folder, and a sibling folder `scratchpad-2` is still logged. The check runs
before the log line and before the save-marker update, so a `session-log.md`
written into the scratchpad moves no marker. A value in the field that is not
a non-empty string, and any error in the check, leave the edit logged: three
reviewers (a correctness reader, an attacker that ran 77 payloads, and a
mutation tester in a worktree) found that a number or an object in the field
made `path.relative` throw inside the hook's catch, which silently dropped a
repository edit from the log; that is fixed. `stop-reminders.js` is not
changed; its test that a source file outside the working directory is
counted still holds.

Tests: `tests/codex/test-track-edits.js` grows from 44 to 60 checks (a
scratch file is not logged and gives no reminder; a trailing separator; the
field absent; a file in the working folder; the sibling folder; a relative
path with and without the scratchpad as `cwd`; the two names of one folder
through a symbolic link, also for a file that does not exist; five non-string
values; the save marker). Of the 17 mutations tried, the first tests caught
10; three tests added after the review catch 3 more; the four that remain
are behaviour-neutral or Windows-only (a file on another drive than the
scratchpad, which `path.isAbsolute` handles but no test on macOS can pin).
The hook unit suite stays at 17 suites.

Also in this release, documents only: the dashboard spec no longer states
that the page pins a write to a document version (platform check 12 found no
such option on the page's `set` and `update`); sections 7, 8 and 13 describe
the re-read before each write and the window that remains.

## v7.56.0 — the dashboard skill: the repository's status on a claude.ai page

**Problem.** What waited for the owner was spread over branches, orchestration
logs, work logs and `session-log.md`; `/pickup` lists only the unfinished runs of local branches and shows no work
logs, open items or branch status, and no view showed them together or let the owner mark an item done.

**Change.** A new `dashboard` skill publishes the status as a private
claude.ai Artifact page (`refresh`), copies the owner's page edits back into
the Markdown files after approval (`sync`), publishes a pushed-content page
(`share`), or writes a local file (`local`).

**Effect.** Reinstall the plugin to get the skill; `/pickup` prints the same
as before. Nothing to migrate.

The status of a repository that uses this plugin lives in many places: the
orchestration logs on feature branches, the work logs under `docs/worklogs/`,
the `Open:` lists of `session-log.md`, `state.md`, the release notes and git
itself. `/pickup` lists only the unfinished runs of local branches and shows no work
logs, open items or branch status; nothing showed
all of it at once, and nothing let the owner close an item without editing the
file by hand.

The new skill `dashboard` has four commands. `refresh` runs a script that reads
the repository and writes one JSON document, renders the page files from it,
and publishes them with the Artifact tool; the reply lists only what changed
since the last refresh. The page has two tabs: "Waits for me" (unfinished
orchestration runs, unmerged branches, active work logs, open items of the 10
most recent session entries, the current goal) and "History" (releases, topic
folders, closed work logs, the last 20 commits, session goals, known issues).
`sync` reads the edit proposals that the owner made on the page (resolve an
open item, change the status or note of a work-log part), shows each change as
a diff, writes only the changes that the owner accepts, and never commits; a
change to a tracked file is refused while an orchestrated run holds the
repository. `share` publishes a second page that reads only pushed content: one
remote-tracking branch for its files, plus the names and run logs of the other
pushed branches that have an upstream on the same remote as the shared branch, never the working folder; one value is not pushed content, the repository
name in its title: it comes from the URL of that remote, or it is the name of the shared branch when that remote is a folder
on the same computer or its URL gives no plain name, and it is never the name of the local folder; on Pro and Max plans such a
page can be shared only by a public link, so `share` warns first. `local`
writes a read-only HTML file for a session that cannot publish.

The scan of unfinished orchestration runs moved from `pickup-scan.js` into the
module `skills/pickup/scripts/git-runs.js`, which `/pickup` and the dashboard
both use; `/pickup` prints the same output, and its suite passes unchanged.
Every git command of these scripts runs with `--no-optional-locks`, so a
refresh never takes the index lock of a running orchestrator.

A first task checked the platform facts that the design still owed and
recorded them in
`docs/superpowers-orchestrator/2026-09-29-dashboard/implementation/platform-checks.md`.
The new fast suite `tests/dashboard/run-tests.sh` covers the run module, the
parsing rules (with a parity test against the work-log commands), the
extractor, the privacy cases of the shared page, the renderer, the page
template (text is inserted as text only), the sync script and the skill text.

Accepted limits: the page shows the state of its last refresh, because a hook
cannot publish; the page URLs are stored on one computer; a fresh page load may
not show writes that Claude made to the page database (anthropics/claude-code#94426).
The live acceptance — one refresh, one edit on the page and one sync on this
repository — is the owner's step before the merge; its steps and results are
in `docs/superpowers-orchestrator/2026-09-29-dashboard/implementation/manual-acceptance.md`.

## v7.55.0 — memory recall skips agent messages and repeats no entry

**Problem.** The `UserPromptSubmit` hook treated task notifications and
messages from other agents as typed prompts, and attached the same recall to
each one. In one orchestrated run this was 72 injections, 70 of them on agent
messages: about 157K tokens, about 31% of the main session's context growth.

**Change.** The hook gives no hint and no recall to a task notification, an
agent message or a subagent's hand-back report, and it injects each recall
entry at most once per session.

**Effect.** On 84 messages of that session, the transcript recorded 452,175
bytes of injected text. A replay through the new hook injects about 7,400
bytes, on the 2 typed prompts only. Reinstall the plugin. Nothing to migrate.

### Why

The dashboard run of 2026-09-30 grew the main session's context to 56% of a
1M-token window, with no compaction. Six independent investigations of its
transcript found two causes:

- With `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, each named controller runs
  as a teammate. Its subagents failed their hand-back ("the agent that
  spawned you is no longer running"), and when the controller woke one with
  `SendMessage`, that subagent's report and task notification went to the
  main session. This is a Claude Code behaviour; it was reported to
  Anthropic, and removing the setting stops it.
- `hooks/skill-activator.js` attached about 5.4 KB of recall to each of those
  messages. It did not check who sent a message, and it repeated the same
  entries: `known-issues.md` gave the same two entries 71 times. Up to the
  end of the run this was 72 injections, 70 of them on messages that the user
  did not type: about 157K tokens, about 31% of the context growth. This
  release fixes this part.

Claude Code documents no field in the hook input that names the sender of a
prompt, and a probe hook (a hook that only logs its input) found none: the
input has seven keys, and the only text is `prompt`. The opening of that text
is the only signal.

The hook input is not the text of the transcript. Claude Code writes the line
"Another Claude session sent a message:" into the transcript record only; a
first version of this fix tested for that line and would not have recognised
a real agent message. Measured on 2026-10-01:

- The probe hook logged two openings on Claude Code 2.1.286:
  `<task-notification>` for a task notification, and `<agent-message from="…">`
  for a message that a named subagent sent.
- The hook input of a subagent's hand-back report was not logged. In a replay
  of the dashboard run's session (Claude Code 2.1.284), all 42 recorded hook
  outputs for messages from agents are reproduced by the tag form
  (`<agent-message from="…">`, the report, the closing tag) and also by the
  report's body alone, which opens with "[Subagent hand-back]". 21 of the 42
  are not reproduced by the transcript text. The replay cannot tell the tag
  form and the body apart, so the list holds both openings.
- The figures of the summary are the session's 84 messages of 2026-09-30:
  2 typed prompts, 37 messages from agents and 45 task notifications; 72 of
  them up to the end of the run, 12 from the investigation after it. The
  transcript recorded the 452,175 bytes on 83 of them. The replay through
  the new hook gives 7,309 to 7,456 bytes, depending on the state of
  `session-log.md` during 2026-10-01; the new hook skips every agent message
  in the tag form and in the body form.

### What changed

- **Agent messages.** `isAgentMessage()` in `hooks/skill-activator.js`: a
  prompt that opens (after leading white space) with `<task-notification>`,
  `<agent-message`, `<teammate-message`, "[Subagent hand-back]" or "Another
  Claude session sent a message" gets `{}` — no skill hint, no recall, no
  context-pressure gate. The probe hook logged the first two openings as hook
  input. The other three were not logged: "[Subagent hand-back]" is in the
  list for the case that the hook receives a hand-back report without its
  tag, and no hook input was measured for `<teammate-message` or for the
  transcript line. A typed prompt that only holds such an opening later in
  its text is enriched as before, and so is a typed prompt that opens with
  only a part of an opening (for example `[` or `<`).
- **Once per session.** The two recall searches keep their ranking (top 2
  each). An entry already injected in the session is then dropped and is not
  replaced by a weaker match. An entry is identified by a SHA-1 hash of its
  text (a short value of fixed length that is computed from the text),
  because session-log headings repeat (17 entries of this repository are
  named `## 2026-08-22 [saved]`). The record is one file per session id in
  the temporary folder (`sp-recall-<session id>.json`); without a session id
  nothing is recorded.
- **One copy of the decision.** `evaluatePrompt()` holds it; the Claude Code
  entry point and the Codex adapter (`hooks/codex/user-prompt-submit-adapter.js`)
  both call it, instead of keeping two copies of the same code.
- **Tests.** 31 new tests in `tests/codex/test-skill-activator.js` (184 in
  the file); 27 run the real hook script, 4 call the shared function through
  the Codex adapter: six forms of an agent message, a leading newline, a
  typed prompt that holds each of the six forms later in its text, a typed
  prompt that opens with only a part of an opening or with an opening in
  another letter case (five cases), once per
  session (also through the adapter), a new session, no session id, entries
  with the same heading, no weaker match after the top 2 (session log and
  known issues), a corrupt record, a record that cannot be read or written,
  the pressure gate skipped for an agent message, an empty `cwd` (the working
  folder that the hook input names), a session id with path characters. The
  test helper fails a test when the hook exits with a non-zero status or
  prints nothing. The tests remove their record files.
- **Docs.** README and `docs/guide/README.md` §6 describe the new behaviour.

### Limits

- Nothing resets the record at a compaction: an entry injected before a
  compaction is not injected again in the same session. The session-start
  hook re-adds the last session-log entries after a compaction.
- A message whose opening is not in the list is enriched as a typed prompt
  is, until its opening is added. One known case: the automatic message
  after a usage-limit reset ("Your claude.ai usage limit has reset…"). The
  once-per-session rule still limits its recall. For a teammate message no
  hook input was measured: in 44 transcripts, no recorded hook output
  follows any of 889 teammate messages, so the hook possibly never runs for
  them.
- Two hook processes of one session that run at the same time can lose an
  update of the record, and the record is written before the output is
  printed. An entry can then be injected a second time, or count as injected
  when it was not. The adversarial review of this release found no workflow
  in which two hook processes of one session overlap.
- The record files stay in the temporary folder until the system removes
  them, as the files of the Bash compression hook do.

## v7.54.0 — the TDD reminder names the source files it counts

**Problem.** A colleague edited a Markdown file and got "TDD reminder: 1
source file(s) modified without test changes". A Markdown file never counts
as source. The reminder counted an earlier code edit, but it named no file,
so it looked false.

**Change.** The TDD reminder lists the files it counts: each path relative
to the working folder, the full path for a file outside it, at most five
names, then "and N more".

**Effect.** Reinstall the plugin. Nothing to migrate.

### Why

The stop hook (`hooks/stop-reminders.js`) counts as source only a file whose
name ends in a code extension (`.js`, `.py`, `.ts`, `.go` and others), and it
excludes `.md` explicitly. This rule has not changed since the hook was
added. The reminder does not look at the last turn only: it counts every
file edited with Edit or Write in the last 30 minutes of the session, and it
fires when no test file was edited in that time. A code edit made earlier in
the session therefore produced a reminder at the stop after a Markdown edit.
The colleague's edit log was not available; this cause comes from reading
the code, not from a measured case.

### What changed

- **Reminder text.** `TDD reminder: N source file(s) modified without test
  changes: <files>.` The list holds at most five names; more files add
  "and N more", so that a long session does not make the block text long.
- **Tests.** Three tests in `tests/codex/test-stop-reminders.js`: a `.py`
  file is named and a `.md` file of the same 30 minutes is not; a file
  outside the working folder is named with its full path; seven files give
  five names and "and 2 more".

### Limits

- The 30-minute window is unchanged. A reminder can still count an edit of
  an earlier turn; it now names that file. A window of "edits since the last
  stop" was rejected: it needs a marker for each stop, and a code change
  could then pass with no reminder.
- The Codex stop adapter (`hooks/codex/stop-adapter.js`) keeps the old text
  without names. Codex is no longer a supported platform.

## v7.53.0 — switch off individual stop reminders by name

**Problem.** The stop hook blocked the end of a task with "Commit reminder"
for a user whose `AGENTS.md` allows a commit only after approval. The only
way to stop a reminder was `disableAllHooks`, which turns off every hook.

**Change.** A new variable, `SUPERPOWERS_STOP_REMINDERS_OFF`, turns off
reminders by name (five names). The commit reminder tells the assistant not
to commit when a project rule requires approval. A block names an unknown
name in the variable.

**Effect.** Reinstall the plugin. To turn off a reminder, set the variable in
the `env` block of `settings.json` and restart the CLI. Nothing to migrate.

### Why

A colleague's `AGENTS.md` says that the assistant must show the diff and wait
for approval before `git commit`. The stop hook (`hooks/stop-reminders.js`)
counted 6 changed files and returned `decision: "block"` with "Consider
committing incremental progress". A block means that Claude Code does not let
the assistant end its turn: the assistant must answer the reminder first. The
Claude Code documentation has no setting that turns off one hook of a plugin:
`disableAllHooks` turns off every hook, including the safety hooks and the
session-start hook.

### What changed

- **`SUPERPOWERS_STOP_REMINDERS_OFF`.** A comma-separated list of reminder
  names: `tdd`, `commit`, `decision-log`, `state-md`, `session-log-size`.
  Names are not case-sensitive. A reminder that is turned off is not
  produced, so it cannot block a stop; the other reminders do not change.
  When `commit` is off, the hook also skips its `git status` call. Example:
  `{ "env": { "SUPERPOWERS_STOP_REMINDERS_OFF": "commit" } }`. The Claude
  Code documentation states that a variable in the `env` block reaches hook
  processes.
- **Commit reminder text.** It now adds: "If a project rule (for example in
  CLAUDE.md or AGENTS.md) requires the user's approval before a commit, do
  not commit: tell the user about the uncommitted changes and wait." This
  helps every user who has such a rule, without any setting.
- **Unknown names.** A name that is not in the list (for example
  `tdd commit`, separated by a space) turns nothing off. The next block of the
  hook names it and lists the known names. The hook never blocks only to show
  this warning. The documentation states that Claude Code discards
  `systemMessage` for Stop hooks and sends standard error of a hook that exits
  0 to the debug log, so the block reason is the only visible channel.
- **Tests.** The two test files that run the stop hook clear the variable
  when they start: a user who sets it in `settings.json` also passes it to
  every command the assistant runs, and the suites then failed (31 of 58 tests
  in one file). The commit test stages its files, so the git setting
  `status.showUntrackedFiles=no` cannot hide them.
- **Documentation.** The README lists the variable and which reminder text
  each name removes; the user guide's Troubleshooting section has an entry for
  a stop reminder that conflicts with a project rule.

### Limits

- The Codex stop adapter (`hooks/codex/stop-adapter.js`) has its own
  reminders. It ignores the variable and keeps the old commit text. Codex is
  no longer a supported platform.
- An unknown name is reported only when the hook blocks for another reason.

## v7.52.0 — the worklog skill: one tracking document per piece of multi-part work

**Problem.** Work with several parts that lasts many sessions had no document
for its progress. `state.md` is a snapshot that every save rewrites,
`session-log.md` has no table of parts and no list of open items, and
`known-issues.md` maps errors to fixes.

**Change.** A new skill, `worklog`, creates, fully updates and closes
`docs/worklogs/<slug>.md`, a document that carries its own update rules. The
session-start hook names the active work logs in one notice of at most 457
characters plus the length of the printed root, with fewer than 1,000
further work logs, and `/pickup` no longer counts an uncommitted work log as
unfinished work.

**Effect.** Type `/worklog new` to start a work log. Reinstall the plugin.
Nothing to migrate.

### Why a new document

The plugin already writes three memory files, and none of them can hold the
progress of multi-part work. `state.md` is one file per project, under 100
lines, and every save-state rewrites it: it is a snapshot of one moment, not a
history. `session-log.md` holds the decisions of each session in time order;
it has no table of parts and no list of open items. `known-issues.md` maps a
recurring error to its solution; it does not track work.

The new skill, the hook change and the `/pickup` change ship inside the
plugin, so a session uses them only after the plugin is reinstalled.

### What a work log is

A work log is one Markdown file per piece of multi-part work, for example
four groups of tests that are refactored one group after the other. It lives
at `docs/worklogs/<slug>.md` under the repository root, and git tracks it. The
slug is its short name: lowercase letters, digits and single hyphens, at most
40 characters, and not one of the command words `new`, `update` and `close`.
Line 1 is a status line written as an HTML comment, which a Markdown viewer
does not show: `<!-- Work log: status=active slug=<slug> created=<YYYY-MM-DD> -->`.
It stands on line 1 because a Markdown formatter can insert an empty line
under a heading, so a status line under the heading would move.

The document has a table of parts, a list of open items with a
`Next item number` line, a list of accepted limits, and a list of decisions
whose entries are never rewritten. An admission rule decides which problem
becomes an open item. The model is `docs/orchestration-issues.md`: measured
on 2026-09-21, 0 of its rows 41 to 92 came from a real case, because reviews
filled the worklist before it had an admission rule. The section
`How to maintain this document` holds seven update rules, so a session that
reads the file can maintain it even where the plugin is not installed. The
skill never commits.

### The three commands

- `/worklog new [<slug>]` asks for the title, the goal, the "done when"
  condition, the parts and the admission rule in one question batch, fills
  `skills/worklog/template.md`, and writes the file. It never overwrites a
  work log.
- `/worklog` or `/worklog update [<slug>]` compares the document with the
  session and with the commits since its creation date
  (`git log -n 200 --since="<created> 00:00"`, at most five windows of 200
  commits), and applies the document's own rules.
- `/worklog close [<slug>]` asks first when a part is unfinished or an open
  item remains, fills the last `Commit` cells, and changes line 1 to the
  closed form.

The skill tests line 1 with a fixed shell command, not by reading it, because
the Read tool shows neither a carriage return nor a symbolic link. It changes
line 1 with a second command that keeps a carriage return and a byte order
mark. The model can load the skill by itself (the skill has no
`disable-model-invocation` key), and `hooks/skill-rules.json` routes "create
a work log" and "update the work log" to it.

### The session-start notice

`hooks/session-start` runs the list command of the skill, copied unchanged,
and names at most three active work logs in one `<active-work-logs>` notice,
with the root as an absolute path. The notice is appended to the notices,
which are always included; the content of a work log is never injected. The
list command reads line 1 only, prints a file only when its name is a valid
slug plus `.md` (a file name is text that anyone who can add a file
controls), and is safe under the hook's `set -euo pipefail`. The fixed text
of the notice has 248 characters; with three 40-character slugs and the text
for further work logs, the notice has at most 457 characters plus the length
of the printed root, with fewer than 1,000 further work logs. A root longer
than 300 characters is cut to its last 300.

### `/pickup`

`skills/pickup/scripts/pickup-scan.js` adds `docs/worklogs` to the paths that
its uncommitted-change check leaves out. A commit made after the handoff
still gives `CHECK`, also when it touches only `docs/worklogs/`.

### Tests

A new fast suite, `tests/worklog/run-tests.sh`, checks the template, copies
the slug, list, check and line-1 commands out of the skill text and runs them
on fixture folders (in `bash`, and in `zsh` when it is installed), checks the
pinned phrases of the skill, and checks that the hook holds the list command
unchanged. `tests/codex/test-session-start-worklog-notice.sh` checks the
exact notice on fixture projects, and `tests/codex/test-session-start-budget.sh`
keeps the output at or under 10,000 characters with three 40-character work
logs. `tests/pickup/run-tests.sh` and `tests/codex/test-skill-activator.js`
gain cases, and `tests/skill-triggering` gains a `worklog` prompt.

### Accepted limits

- The model can forget the update rules in a long session or after a
  compaction; `/worklog` forces a full update.
- An orchestrated run and a whole-branch review stop on an uncommitted file
  that they do not know. The template and the notice ask for a commit before
  such a run and forbid writes while it runs.
- On Windows, if a `find` that is not the Git Bash program runs, the list is
  empty and the hook continues without a notice (not tested there).
- That a formatter moves a status line below a heading is taken from the
  tools' documented rules, not replayed.

## v7.51.0 — orchestration runs on Claude Code only; the usage-limit wait

**Problem.** The orchestration skill's description said "Claude Code only",
but its dispatch rules and the README gave Copilot CLI a route, and no run
ever happened there. The guide did not say how to start a long run so that
Claude Code waits out a usage limit.

**Change.** The skill refuses every platform other than Claude Code, and a
Claude Code session without the Agent tool; the README, the guide and the
brainstorming gate say the same. The guide explains the usage-limit wait and
the cases without it.

**Effect.** Start long runs in a foreground interactive session, not
`claude --bg` or `claude -p`. Reinstall the plugin. Nothing to migrate.

### Platform: Claude Code only

The description of `orchestrating-development` said "Requires the Agent tool
with nested dispatch (Claude Code only)". Its Controller Dispatch Rules gave
a route for Copilot CLI (`task`/`agent`), and the README said that Copilot CLI
supports the multi-level subagents the orchestration skills need. The
Copilot CLI documentation does describe nested subagents (default maximum
depth 4) and task calls that block until they finish. But no orchestrated run
has ever run on Copilot CLI, the plugin's hooks were never checked there, and
it is not documented whether a permission prompt raised by a nested subagent
reaches the user during an unattended run. The user decided on 2026-09-21
that the skill runs on Claude Code only.

- The platform check refuses every other platform with the line
  `orchestrating-development runs on Claude Code only`, and a Claude Code
  session without the Agent tool with the line
  `orchestrating-development needs the Agent tool, which this session lacks`.
- The Copilot CLI dispatch note is deleted.
- Option 2 of the brainstorming spec gate reads "Autonomous pipeline (Claude
  Code only)".
- The README says that the skill refuses on Copilot CLI and on OpenCode; the
  OpenCode depth advice now names only `multi-doc-review` and
  `multi-code-review`. The guide names all four refused platforms.

The other skills still run on Copilot CLI. Allowing it for orchestration would
need a change to the skill and a first real run there.

### The usage-limit wait

Claude Code's setting `autoContinueAtUsageLimit` waits for a claude.ai usage
limit to reset and then continues the session by itself. The Claude Code
documentation now lists it: on by default in interactive sessions signed in
with a claude.ai subscription, Claude Code 2.1.234 or later. The guide's
"Starting a run" section has a new "Usage limits" paragraph:

- Start a long run in an ordinary interactive session, in the foreground. A
  background session (`claude --bg`, agent view), a `claude -p` run and a
  reset more than 24 hours away get no automatic wait; the paragraph links
  the documentation page for the full list.
- Set the key to `true` in `~/.claude/settings.json` anyway: 18 limit stops
  of orchestrated runs on Claude Code 2.1.245 to 2.1.258 did not continue by
  themselves, and the cause is unknown.
- The controller that the limit stopped gets the orchestrator's one retry.

Measured on 2026-09-21: of the 23 usage-limit stops of the 12 orchestrated
runs, the setting as documented covers 19; one ran in a background session
with a weekly reset 35 hours away. One automatic continuation was observed,
in an ordinary session on 2026-09-16, 1 minute 26 seconds after the reset. The
probe checklist `tests/claude-code/usage-limit-restart-probe.md` records these
facts and stays the acceptance check for the next orchestrated run that hits
a usage limit.

### README release list

The v7.50.0 release commit changed the item "(v7.49.0)" of the README release
list into "(v7.50.0)" and added no item for v7.50.0. The list now names both.

### Review

One round, two lenses (correctness and adversarial reading), 0 Critical.
The adversarial lens measured that the first, name-only platform check let a
Claude Code session without the Agent tool start the run (0 of 4 refused,
headless); the separate refusal line fixes it. The correctness lens found that
the brainstorming gate still offered the pipeline on every platform. Both
lenses found that the first text named "four cases" without a wait, while the
documentation lists more. All findings were applied. A sentence about Codex
and OpenCode in the Phase 0 text is now unreachable; it stays, because
`tests/review-gates` uses it as a range marker.

`tests/orchestrating-development` has 229 checks (217 before); its new section
12 pins the platform text of the skill, the brainstorming gate, the README and
the guide, and 11 of its 12 checks failed before the change.

## v7.50.0 — the orchestrator no longer reverts a fix commit by itself

**Problem.** When a user's answer overturned a ruling, resume reverted the fix
commits of that ruling with `git revert`, guarded by a check script. The
script named unsafe git states one by one, so it was never complete: releases
v7.44.0 to v7.49.0 added guards, and each review found new states. The
mechanism ran 0 times in real runs.

**Change.** The mechanism is removed (252 skill lines, the
`tests/precheck-script` suite). The orchestrator records `— fix <sha> not
reverted`, gives the next code review a pointer, and the Phase 5 report lists
every such item.

**Effect.** The rejected code is removed by the next code review, or you see it
at Phase 5. Reinstall the plugin. Nothing to migrate.

### Why the mechanism was removed

When a user's answer at Resume overturned a ruling that had amended the plan,
the orchestrator restored the plan clause, and it also reverted the fix
commits made under that ruling, inside the user's working tree. The rule
exists since 2026-09-04. Releases v7.44.0 to v7.49.0 added guards to it, and
from v7.47.0 a check script decided whether the revert was safe. The script
was a deny-list: a list that names each unsafe state (an index bit set by
hand, a sparse checkout, an ignored file, a renamed path) and treats silence
as "safe". The number of git states has no limit, so each review of a guard
found further states.

Measured on 2026-09-21 over the 12 orchestrated runs of this repository: 30
rulings, 10 user follow-up lines, 5 resume follow-up commits. All 5 commits
touch only plan and record files. No run ever reverted a fix commit, and no
ruling record holds `fix <sha> reverted` or `not reverted`. In the same period
about 20 worklist rows were written about the mechanism, all from reviews and
replays in scratch repositories, none from a run.

### What resume does now

The orchestrator makes no code change for a fix commit of an overturned
ruling. It restores the plan clause as before (the plan revert is a separate
mechanism and is unchanged). For each fix commit it then does two things:

- It records `— fix <sha> not reverted` at the end of the item's
  `**Follow-up:**` line in the ruling record. This wording existed before.
- It appends one line to the ledger `.superpowers/sdd/progress.md`, on disk
  only: `Minor: fix commit <sha> was made under ruling <m>, which a user's
  answer overturned; check the branch's code against the restored clause at
  <plan location>, and report code that contradicts the clause as a finding`.
  Round-1 reviewers receive the ledger's `Minor:` lines as carried findings.
  The append is skipped when the same whole line exists, and a stop removes a
  line that the same resume added.

The changed plan file forces a new code review invocation, as before. That
invocation is expected to raise the contradicting code, and its fix subagent
is expected to remove it. This is not certain: a reviewer may triage the
carried line as `ship-as-is`, and a run that resumes a review-log entry
without a completion marker starts after round 1, where no carried lines are
given. For both cases the Phase 5 report now lists every `— fix <sha> not
reverted` item by ruling number, with the sha and the plan location, or
`none`. The user is the last check of that code.

### Removed

The check script and its ten cases, the path-list rules, the `git revert`
command with `merge.directoryRenames=false`, the cleanup after a conflict, the
undo before a stop, the saved pre-revert state of a fix commit, the stop on an
unfinished revert (`REVERT_HEAD`), and the matching permitted-reads entries.
`tests/in-run-rulings` has 883 checks (948 before); `tests/precheck-script`
(138 checks) is deleted. `docs/guide/README.md` describes the new behaviour.

### Review

One round with two reviewers (correctness against the removal map; an
adversarial read of the new text). Both found independently that the rejected
code could reach Phase 5 unseen; the Phase 5 item is the fix. 0 Critical
findings. The remaining Minor findings (a ledger line that stays after the
code is fixed, a missing ledger file) cause no loss and were left out.

## v7.49.0 — the check script reads index bits and the sparse-checkout setting

**Problem.** Two git states hid a wrong result behind exit code 0. With the
`assume-unchanged` bit on a path, the commit that resume makes committed a
hidden edit of the user. With the `skip-worktree` bit, or in a sparse
checkout, it left a reverted path out. A fix that deleted the last file of a
nested folder gave a false alarm.

**Change.** The check script has 21 lines (18 before). It alarms for either
bit and for any sparse checkout, and it reads untracked files only when the
folder of the path exists.

**Effect.** Such a revert no longer starts. In a sparse checkout no fix is
reverted. `tests/precheck-script` has 138 checks (116 before).
Reinstall the plugin. Nothing to migrate.

Rows 81, 86 and 87 of the orchestration issues log, all three closed by
prevention (the check script). The revert command, the cleanup, the undo and
the commit that resume makes are unchanged.

**Terms.** The index is the list of files that git tracks. The
`assume-unchanged` bit and the `skip-worktree` bit are two marks in the index
that tell git not to compare a file with the disk. A sparse checkout is a
checkout where git keeps only a part of the tree on disk
(`core.sparseCheckout` is true).

**What was measured (git 2.50.1, macOS, bash 3.2 and zsh 5.9).**

- *A hidden edit under `assume-unchanged` (row 81).* The fix commit changed
  `conf.txt`, a later commit already took that change back, and the user
  holds an edit of `conf.txt` that the bit hides. `git status --porcelain`
  prints nothing and the check script of v7.48.0 printed nothing. The revert
  ends with exit code 0 and does not write the path. The commit that resume
  makes then reads the file from disk: exit code 0, and the user's edit
  stands at HEAD. The undo before a stop, and the cleanup after a conflict,
  put the file back to HEAD and delete the edit. When the revert must write
  the path over a hidden edit, git refuses with exit code 128 for both bits;
  that state was safe before.
- *The `skip-worktree` bit (row 81, not in the row's text).* With no edit and
  no sparse checkout, the revert ends with exit code 0 and stages the path;
  the commit that resume makes ends with exit code 0 WITHOUT the path, which
  stays staged. With a hidden edit the edit is neither committed nor deleted:
  the `git checkout` of the undo fails with exit code 1 while the path still
  carries the bit. A path with both bits behaves as a `skip-worktree` path. A
  revert that conflicts on the path itself clears the bit, and the cleanup
  then works.
- *A sparse checkout (row 87).* Cone mode and `--no-cone` mode gave identical
  lines. A fix commit that changed a path outside the checked-out part: the
  commit that resume makes ends with exit code 0 without it. The candidate of
  the row (one `git ls-files -v` line) MISSED a fix commit that DELETED an
  outside path: the path is not in the index before the revert, the revert
  stages it with the letter `S`, and the commit leaves it out. A fix commit
  that ADDED an outside path reverts correctly.
- *The false alarm (row 86).* The fix deleted `d/s/x.txt` while `d/` holds
  other files. Git printed `warning: could not open directory 'd/s/'` on
  standard error two times: from the status read AND from the ignored-file
  read, not from one line as the row says. The revert of such a fix works.

**The three script changes.**

- Line 2, run once:
  `[ "$(git config --bool core.sparseCheckout)" != true ] || echo "a sparse checkout"`.
  `--bool` makes git print `true` for the values `yes`, `on` and `1` too.
- After the ignored-file read:
  `git --literal-pathspecs ls-files -v -- "$p" | sed "/^H /d"`. It prints `h`,
  `S` or `s` for a marked path. The filter is `sed`, not `grep -v`: with
  `set -e` in front of the script the `grep` form ended the script at the
  first ordinary path with no output, which reads as "no alarm".
- The status read is two lines. The first carries `--untracked-files=no` and
  always runs. The released full form, and the ignored-file read, run only
  when `[ -d "$(dirname -- "$p")" ]`. When that folder is absent, no
  untracked or ignored file can stand on or below the path.

**The decision on the sparse checkout.** Two designs missed no measured state.
A per-path line with `git sparse-checkout check-rules` keeps the automatic
revert for a fix whose paths all stand inside the checked-out part; it needs
git 2.41, its behaviour on an older git could not be measured here, and it is
about 100 characters longer. The shipped line alarms for every sparse
checkout; it works on every git version and every part of it is measured.
Both review lenses ended the rebuttal round on each other's first position,
so the user decided: the repository-level line.

**Rejected.** `2>/dev/null` on the ignored-file read: for an unreadable folder
that standard error is the only alarm. `--untracked-files=no` alone: it lost
the `?? d/u.txt` alarm for an untracked file below a listed path that is a
folder at HEAD and in the fix commit. A test for the letters `S` and `s`
only, or `git ls-files -t`: quiet on the hidden edit under `assume-unchanged`.

**Cost.** Three kinds of fix commit that revert correctly now end as "not
reverted": every fix commit in a sparse checkout, a path with the
`assume-unchanged` bit and no edit (git cleared the bit without a message in
that revert), and a fix that added a path outside the checked-out part.

**Accepted limits.** One lost alarm with no loss: the fix deleted
`d/s/x.txt`, the user made the file again, and the folder `d` has mode 000;
the script is now quiet, git refuses the revert with exit code 128, and no
cleanup runs after a refusal. No suite pins the guide passage. The script
makes about 10 git calls per listed path.

**Review.** Correctness review: 2 Important findings (the sentence about the
two bits was true only for `assume-unchanged`; "that warning is no alarm"
read as a permission to disregard standard error) and 2 Minor. Red team: no
regression that loses data. Mutation testing: 48 run,
47 caught; the survivor deletes the guide passage; one mutation that changes
behaviour (`--bool` dropped) now has its own fixture. Verification pass: 0
Critical, 0 Important, 3 Minor. Four older defects of other classes became
rows 89 to 92 of the issues log (a file replaced by a folder with a later
change; `core.fileMode=false`; a file-system monitor that reports wrongly;
`core.trustctime=false`).

**Tests.** `tests/in-run-rulings` has 948 checks (944 before): 23 pinned
whole lines (both fences and the 21 script lines), the ten cases with the new
sentences, the retry sentence, and an absence check for `grep -v`.
`tests/precheck-script` has 138 checks (116 before): the two bits, the bit
on the second listed path with `set -e`, four sparse states, the two shapes
of row 86, and two states that guard against a lost alarm. All fourteen fast
suites exit 0.

## v7.48.0 — a code revert stays inside the files of the fix

**Problem.** A commit made after a fix commit could move the revert of that fix
away from the listed paths. After a folder rename git wrote the reverted file
into the other folder and overwrote an ignored file of the user there. After a
file was renamed or deleted, the revert ended with exit code 0 and could not
be committed.

**Change.** The revert runs with `-c merge.directoryRenames=false`. The check
script has 18 lines (13 before) and two new tests that read the fix commit and
HEAD.

**Effect.** Such a revert no longer starts, and the next review raises the
finding again. `tests/precheck-script` has 116 checks (77 before). Reinstall
the plugin. Nothing to migrate.

Rows 79 and 80 of the orchestration issues log. Row 79 is closed at its
source (the revert command), row 80 by prevention (the check script).

**What was measured (git 2.50.1, macOS, bash 3.2 and zsh 5.9).**

- *A later folder rename (row 79).* The fix commit deleted `d/ignx.txt`, a
  later commit renamed `d/` to `e/`, and the user keeps an ignored
  `e/ignx.txt`. The check script of v7.47.0 printed nothing. The plain
  `git revert --no-commit` followed the folder rename and overwrote the user's
  file: with exit code 1 by default, and with exit code 0 when the
  configuration holds `merge.directoryRenames=true` (git then prints one
  `Path updated` line and no warning about the overwritten file). The loss
  needs an ignored file; git refuses over an untracked or a changed tracked
  file. Git applies the folder rename only when the old folder no longer
  exists at HEAD.
- *The reverse direction.* The fix commit itself renamed `d/` to `e/`, a later
  commit added `e/ignnew.txt`, and the user keeps an ignored `d/ignnew.txt`.
  Every listed path is in order, so no check of the listed paths can see this
  state. The plain revert overwrote the user's file; with
  `-c merge.directoryRenames=false` it changes only the listed paths. The
  setting on the command line also wins over the user's configuration and over
  `GIT_CONFIG_COUNT` and `GIT_CONFIG_PARAMETERS`. On ordinary fix commits
  (modify, add, delete, rename, rename with a later change) the command gave
  the same result as the plain one in every state: success with the resume
  commit, success with the undo, conflict with the cleanup, refusal.
- *A revert that cannot be committed (row 80).* The fix commit changed `a.txt`
  and a later commit renamed it to `b.txt`: the revert ended with exit code 0
  and staged `M  b.txt`, outside the list, and the resume commit failed with
  `pathspec 'a.txt' did not match`. The fix commit added `n.txt` and a later
  commit deleted it: the revert was empty, only `REVERT_HEAD` stayed, and the
  commit failed the same way.

**The script.** `c=<sha>` holds the hash, so the placeholder stands on one
line only; a placeholder that nobody replaced is a syntax error in bash and in
zsh, and any output counts as an alarm. The test `in the fix commit, not at
HEAD` runs for the listed path and then for each parent folder. The test `a
folder at HEAD, not in the fix commit` runs for the path: a later commit that
put a folder on a listed file path made git write a file named
`dd~parent of <sha> (fix)` outside the list, and the run stopped (found in the
design step). Both tests read git trees, never the disk: a disk test gave a
false alarm for a fix commit that replaced a file by a folder. The prose names
eight cases; the retry sentence names a later commit as a cause that normally
stays.

**One decision and its cost.** With the new command alone, the revert of row
79 is safe, but the file comes back alone in the old folder `d/`. The
parent-folder test ends that state as "not reverted". Its cost: when a later
commit deleted the whole folder, a revert that would work also ends as "not
reverted". The test is the only line that stops one more measured state: after
a later rename `d/` to `D/` on a file system that ignores letter case, the
revert ends with exit code 0, the resume commit takes the file in as
`D/x.txt`, and a staged rename stays.

**Rejected.** `-X no-renames` on the revert (it loses later work after a
rename by the fix, turns a refusal into a conflict, and reports success for a
revert that changed nothing). Naming a path in the resume commit only when its
status prints a line (a commit of the record alone, with the change still
staged). A check after the revert (it needs a saved tree to take the change
back safely).

**Review.** A measuring step with two verifiers, two design lenses with a
rebuttal round (each lens withdrew one of its own lines), a correctness review
(1 Important, 4 Minor, all applied), a red-team review (no loss and no write
outside the list with the new lines), mutation testing (61 run, 60 caught; the
survivor deletes the guide passage, which no suite pins) and a verification
pass (1 Minor, applied). `tests/in-run-rulings` has 944 checks (934 before).

**Still open, as new rows of the log:** a fix commit that moved a sub-module
pointer; a false alarm when a fix commit deleted the last file of a nested
folder; a sparse checkout, where the resume commit leaves a path out; a later
change of type between a file and a symbolic link.

## v7.47.0 — one fixed check script runs before every code revert

**Problem.** Before it reverted a fix commit, Resume step 3 compared printed
path names and typed them into git commands. A name with a space hid a local
change. A name such as `*.txt` reached other files. A rename that changes only
the letter case could not be committed on a file system that ignores case. An
ignored file named like a folder was deleted.

**Change.** One fixed script runs before each revert; the orchestrator
replaces only `<sha>`. Any output means "not reverted". The
cleanup and the resume commit are unchanged.

**Effect.** These reverts no longer start; the next review raises the finding
again. 0 of this repository's 363 tracked names are affected. Reinstall the
plugin. Nothing to migrate.

Rows 76, 77 and 78 of the orchestration issues log. All three are closed by
prevention, not by repair.

**What was measured (git 2.50.1, macOS, bash 3.2 and zsh 5.9).**
`git status --porcelain` prints a name with a space inside double quotes, and
`git show --name-only` does not, so the released comparison of printed names
missed a local change on such a path: with a staged user line the revert
exited 0 and merged into it. The comparison also missed a user's staged rename
away from a listed path. Without `--literal-pathspecs`, `git checkout --
'*.txt'` overwrote four unrelated files and `git commit -- ':x.txt'` committed
`x.txt`; every command exited 0. After a revert of a rename from `old.txt` to
`Old.txt`, the cleanup deleted the file, and the resume commit exited 128
(`fatal: will not add file alias`) in every measured form. When the fix commit
deleted `d/x.txt` and the user kept an ignored file `d`, the revert exited 0
and replaced the file with a folder.

**The script.** It stands in Resume step 3 of
`skills/orchestrating-development/SKILL.md` and prints a line in six cases:
the current folder is not the top folder of the repository; a listed name
holds a character outside letters, digits and `. _ / @ + = , -`, or begins
with `-` or `=`; a listed path carries a local change
(`git --literal-pathspecs status --porcelain -- "$p"`); an ignored file stands
on the path or under it; the path stands on disk and does not exist at HEAD
(an untracked file, or the same name in another letter case); a parent folder
name stands on disk and is not a real folder. The path list is read with `-z`,
so no name is printed and typed again. Output on standard error counts: a
wrong hash is an alarm. Two traps are pinned: the letters of the name test are
written out, because the range `A-Z` lets `café.txt` pass under bash 3.2 with
a UTF-8 locale, and the pattern is `[=]*`, because zsh fails on a bare `=*`.

**Review.** Two design lenses and a rebuttal round chose prevention over a
design that handled every name with scripts for the cleanup and the commit:
that design repaired a revert that cannot be committed. The first commit
deleted the `git ls-files` read of v7.46.0; the correctness review showed the
loss (the fix commit replaced the file `d` by `d/x.txt`, the user keeps an
ignored `d/junk.dat`), and the read went back inside the loop. The red team
found that the script was quiet from a sub-folder for a bare file name; the
first script line now refuses that. Mutation testing: 57 of 57 caught on the
first commit, 15 of 15 on the fixes, and one survivor (a second script block
after the paragraph) that a check now catches.

**Tests.** `bash tests/in-run-rulings/run-tests.sh`: 934 passed (914 on
v7.46.0). New suite `bash tests/precheck-script/run-tests.sh`: 77 passed. It
takes the script out of the skill file and runs it on fixture repositories
under bash and `zsh -f`.

**Accepted limits.** A fix commit is never reverted automatically when a path
holds a space, an accent or another unusual character, when it renames a file
by letter case only on a file system that ignores case, or when it replaced a
folder by a file or a symbolic link (row 84). The cleanup and the undo before a
stop are still typed per path (row 83). Rows 79 to 82 record four defects that
are older than this release: a later folder rename, a revert that cannot be
committed, the `assume-unchanged` bit, and two fix commits on one path.

## v7.46.0 — the revert sees renamed and ignored files; one statistics file per session

**Problem.** In Resume step 3 the path list of a reverted fix commit held only
the new name of a renamed file: a conflict ended in a false major error, and
the resume commit removed the file from the branch. The revert also wrote over
an ignored file with no warning. All sessions shared one `session-stats.json`,
so the "Session summary" line named skills of other sessions.

**Change.** The list uses `--no-renames`; the pre-check also lists ignored
files on those paths and then does not revert. Each session has its own
statistics file; the summary line has no minutes.

**Effect.** A revert keeps both names and your ignored files. in-run-rulings
holds 914 checks (907 before). Nothing to migrate.

### Rows 74 and 73 — the fix-commit revert of Resume step 3

`git show --name-only --format= <sha>` lists a renamed file under its new name
only, and the result depends on the user's `diff.renames` setting. Three rules
of `skills/orchestrating-development/SKILL.md` take their paths from that
list. Measured on git 2.50.1, for a fix commit that renamed `old.txt` to
`new.txt`:

- After a conflict (exit 1) the cleanup left `A  old.txt` staged, the status
  check found a mismatch, and the run stopped with a false major error. This
  is the effect that worklist row 74 named.
- The undo before a stop left the same staged file, and no status check
  follows that undo.
- On the success path the resume commit over the narrow list exited 0, and
  `HEAD` then held neither `new.txt` nor `old.txt`: the branch lost the file.

The list command is now `git show --name-only --no-renames --format= <sha>`
at all three sites (the pre-check, the way out of an unfinished revert, the
permitted reads). `--no-renames` gave both names in all seven measured cases.
The pre-check now states that every later rule of the revert takes its paths
from this one list: the cleanup, the undo before a stop, and the reverted
paths that the resume commit names.

`git status --porcelain` does not list an ignored file. When the fix commit
deleted a path and the user keeps an ignored file there, `git revert
--no-commit` exits 0 and writes the committed content over it. `git revert`
has no option that prevents this. The pre-check now also runs
`git ls-files --others --ignored --exclude-standard -- <those paths>`, each
path as its own argument, and skips the command when the list is empty (with
no path it prints every ignored file of the repository). A printed path takes
the existing "not reverted" branch. The candidate of the worklist row,
`git status --porcelain --ignored`, was rejected by measurement: for a file
inside an ignored folder it prints only the folder.

### Row 75 — one statistics file per session

`hooks/track-session-stats.js` kept one `session-stats.json` for all sessions.
Only the writer applied a 2-hour reset, and only on the next Skill call, so
the stop hook could print a stale file of any age (observed: "826min" in a
session that was 10 minutes old).

- `hooks/save-marker.js` has a fourth file kind and `statsFile(sessionId)`.
  The 7-day cleanup of per-session files covers it with no other change.
- The writer uses the file of its session and has no 2-hour reset. With a
  per-session file that reset deleted the counts of a session longer than 2
  hours (measured: "125min, 3" became "0min, 1").
- The stop hook reads the file of its session only. It never reads the old
  shared file, which holds one total of all sessions.
- The summary line no longer shows minutes. They were the time since the first
  Skill call after the last reset, never the age of the session.
- A payload without a session id keeps the shared file name on both sides.

The lost update between parallel writers exists (2 processes at one instant
kept 1 of 2 counts in 10 of 10 runs) but is not the reason for the change:
1,894 transcript files with 160 Skill calls held no two Skill calls of one
session less than 1 second apart.

### Review

One measuring verifier (rows 74 and 73); two lenses plus a rebuttal round
(row 75). Correctness review: 0 Critical, 1 Important, 5 Minor. Red team: 0
Critical, 3 Important, 3 Minor. Mutation testing in a worktree: 35 run, 33
caught, 2 survived, both now caught. One verification pass: 1 Important, 4
Minor. That Important finding was caused by a review fix: `-c
core.quotePath=false` on the list command alone made the pre-check blind to a
local change on a path with an accented character. It was taken back before
the release, and a check pins its absence.

### Accepted limits and new worklist rows

- Parallel Skill calls inside one session can still lose a count. A session
  that runs during the plugin update starts its counts again at zero. The old
  `session-stats.json` stays on disk; you may delete it. A session with no
  Skill call for 8 days loses its counts to the 7-day cleanup.
- Row 76: an ignored file named like a folder that the revert creates again
  is seen by no command. Row 77: a path name that git prints quoted (an
  accented character) or reads as a pattern (`*.txt`). Row 78: a rename that
  changes only the case of a name, on a file system that ignores case.

### Tests

All thirteen fast suites pass with no `command not found` line:
in-run-rulings 914 (907), `tests/codex/test-track-edits.js` 44 tests (39),
`tests/codex/test-stop-reminders.js` 47; the others as on v7.45.0.

## v7.45.0 — one edit log per session; a refused revert runs no cleanup

**Problem.** All sessions shared one edit log, and every edit rewrote it: 8
sessions at once lost 51 of 160 edit lines, and a lost test-file line gave a
false test-first block. In Resume step 3, four sentences about `git revert`
were false, and the cleanup after a refused revert deleted a user's unstaged
change.

**Change.** Each session appends to its own edit log; no hook rewrites one.
After a refused revert the orchestrator runs no cleanup and goes to the
status check.

**Effect.** 0 of 160 lines lost. In-run-rulings checks go from 899 to 907;
save-marker tests from 33 to 39. Update the plugin and restart the
command-line interface (CLI).

### Row 70 — the edit log lost lines

`hooks/track-edits.js` wrote every Edit and Write of every session into one
file, `~/.claude/hooks-logs/edit-log.txt`, and `rotateIfNeeded()` read the
whole file and wrote its last 500 lines again. A line that another process
appended between the read and the write was lost. The worklist row called this
rare. It was not: the real log held 500 lines in 96,427 bytes, which is over
the 50 KB limit of the size check, so every edit read the file, and every edit
that found more than 500 lines rewrote it. All sessions also shared the one
limit of 500 lines (the real log held 19 session ids), so a busy session
pushed the lines of another session out with no race at all.

Measured with 8 hook processes started at once, 20 rounds, on a log of 700
lines: v7.44.0 lost 51 of 160 edit lines with 8 session ids and 38 of 160 with
one shared id (parallel subagents write under the id of their parent
session). The row said "never a false block". That is false: when the lost
line is the edit of a test file, the stop hook sees a source edit without a
test edit and blocks with the test-first reminder (measured with the real
`stop-reminders.js`).

- A session now appends to its own file, `edit-log-<cleaned session id>.txt`.
  The path comes from the new `editLogFile(sessionId)` in
  `hooks/save-marker.js`, which reuses the id cleaning of the save marker. A
  payload without a session id still appends to the shared `edit-log.txt`.
- No hook rewrites, renames or trims an edit log. `rotateIfNeeded`, and the
  unused `getRecentEdits` and `EDIT_LOG` of `track-edits.js`, are removed.
- The 7-day cleanup of per-session files deletes old edit logs. Every append
  sets the modification time of the log, so the log of a live session stays.
- The reader in `hooks/stop-reminders.js` reads the file of its session and
  the old shared file. The shared file holds the edits without a session id,
  and the earlier edits of a session that was open during the plugin update.

After the fix the same measurement lost 0 of 160 lines in both cases. Two
independent design lenses measured 0 of 3,600 and 0 of 800 lines.

Both candidates of the row were rejected by measurement. Rotation through a
rename lost 87 of 800 new lines and, in at least one round, all 700 older
lines: two processes both saw the size over the limit, and the second rename
put a nearly empty file over the full one. A guarded rename still lost 3 of
1,200 lines with 24 processes. Rotation at session start lost 18 of 800 lines
with 8 sessions starting at once.

Limits. A per-session log has no size limit inside one session; the whole stop
hook took 44 ms with 10,000 lines and 165 ms with 100,000 lines (measured).
The old shared `edit-log.txt` is never trimmed again; you may delete it 7 days
after the update. After a downgrade, the older stop hook does not see the
per-session logs, which costs one missed reminder. Whether a short append is
atomic on Windows is documented, not measured. The slow test
`tests/claude-code/test-subagent-hook-scope.sh` now counts the lines that name
its marker file across all edit logs; it was read and syntax-checked, not run.

### Row 72 — what `git revert --no-commit` really does

Measured on git 2.50.1 by one verifier and two reviewers, and replayed by the
main session:

- Exit 128 is a refusal: over an unstaged or untracked change on a path of the
  commit, a merge commit, a bad hash or an `index.lock` file. Git normally
  changes nothing and writes no `REVERT_HEAD`.
- Over a staged change git exits 0 and merges the revert into it, or exits 1
  and conflicts with it.
- Only exit 1 leaves the checkout in the middle of a revert: conflict markers,
  the clean hunks staged, and `REVERT_HEAD`.
- No state creates the folder `.git/sequencer`.

The row named two false sentences in Resume step 3 of
`skills/orchestrating-development/SKILL.md`; four were false. The text now
states the behaviour per exit code, no longer names "the sequencer state", and
says that a successful revert "normally" leaves the reverted hunks staged (a
revert of a fix that a later commit already reverted exits 0 and stages
nothing).

The review found the defect that matters. The text ran the per-path cleanup
(`git reset -- <path>`, then `git checkout -- <path>`) after EVERY non-zero
exit. The pre-check can miss a local change: plain `git status --porcelain`
prints `?? d/` for an untracked file inside an untracked folder. After a
refusal over an unstaged change that the pre-check had not listed, the cleanup
deleted that change (measured: ` M a.txt` before, an empty status after).
After a refusal the orchestrator now runs no cleanup at all and goes directly
to the status check, which also reports the rare exit 128 that did change the
tree (measured with a folder that is not writable). The cleanup and its
`rm -- <path>` exception are for exit 1 only. Two more sentences changed in the
verification pass: the pre-revert state is saved before EACH revert, and a
stop does not undo a fix commit whose revert git refused.

### Review and tests

Two design lenses plus a rebuttal round for row 70; one measuring verifier for
row 72. Review round: correctness 0 Critical, 2 Important, 4 Minor; adversarial
0 Critical, 0 Important, 3 Minor. Mutation testing in a separate worktree: 26
run, 23 caught, 3 survived; all three are now caught (replayed). One
verification pass limited to the fixes: 0 Critical, 0 Important, 4 Minor, all
applied.

All thirteen fast suites pass with no `command not found` line:
`tests/in-run-rulings` 907 checks (899 on v7.44.0), and
`tests/codex/test-track-edits.js` 39 tests (33). The new tests T11 to T14, T12b
and T12c run the real hook scripts as processes under a temporary home folder.

Three worklist rows were opened: a revert overwrites an ignored file at a path
that the fix commit deleted (row 73); a fix commit that renamed a file ends a
conflicted revert in a false major error, because `git show --name-only` lists
only the new name (row 74); all sessions share one `session-stats.json` (row
75).

## v7.44.0 — a resume stops on a code revert that an earlier session left unfinished

**Problem.** A resume that undoes a Phase 4 fix stages the reverted code and
commits it later. When the session ended in between, the next resume
recorded `not reverted` over that staged code. The stop hook blocked at every
stop of a continuation longer than two minutes. The v7.43.0 release commit
shipped an empty `VERSION` file, and every suite passed.

**Change.** A resume asks git for `REVERT_HEAD` before it writes anything, and
stops on it. A stop undoes its own staged reverts first. The stop hook reads
the payload field `stop_hook_active`. A test compares nine version places.

**Effect.** In-run-rulings checks go from 873 to 899; stop-reminders tests
from 40 to 47. Update the plugin and restart the command-line interface (CLI).

### Row 63 — an unfinished fix-commit revert

`git revert --no-commit` writes the file `REVERT_HEAD`, and git keeps it until
the next commit. Resume step 3 of `skills/orchestrating-development/SKILL.md`
has two new rules.

- **Rule A.** Every resume of the `## STOPPED` case runs
  `git rev-parse -q --verify REVERT_HEAD` before it writes anything. A printed
  hash is a major error: the resume writes nothing and makes no commit. Its
  report lists the paths of the unfinished revert, taken from
  `git show --name-only --format= <sha>` and never from the
  `git status --porcelain` output, and states the way out: `git reset -- <path>`
  and `git checkout -- <path>` for each listed path, `git revert --quit` last.
  `git revert --abort` is never the way out: it deletes staged work on other
  paths (measured).
- **Rule B.** A stop inside a running resume first undoes the reverts that this
  resume staged. Measured: a `stopped` commit that names its paths deletes
  `REVERT_HEAD` and leaves the staged code in place.
- The cleanup of a conflicted revert no longer runs `git revert --quit`.
  Measured by two reviewers: with an earlier revert of the same resume staged,
  that command left staged code and no `REVERT_HEAD`. The resume commit deletes
  the file; a stop runs `git revert --quit` last.

Rejected by measurement: a `git patch-id` comparison of the staged changes
with the reverse of the fix commit. It finds no match for two fix commits on
one path, nor for a later change within 3 lines of the fix.

Stated limits: a commit, or a `git reset` without a path, that the user runs
by hand deletes `REVERT_HEAD`; a session that ends between a cleaned conflict
and the resume commit costs one more stop with a harmless way out.

### Row 69 — the stop hook reads `stop_hook_active`

`hooks/stop-reminders.js` returns `{}` when the field is strictly `true` OR the
guard file is younger than two minutes. The field can only remove a block, so
a platform or version that does not send it behaves as before. Measured:
Claude Code 2.1.278 sends the field as a boolean on every Stop, also in
headless mode. The guard file stays: it is the only repeat limit of the
test-first reminder, which the model cannot clear. "Guard only when the field
is absent" was rejected by measurement: 5 blocks in 5 quick user turns, against
1 today. Stated limit: when another plugin's Stop hook blocked first, this hook
is silent for that chain and blocks at the next user stop.

### Row 71 — one version in every place

`tests/codex/test-version-files.js` (10 tests; the hook unit runner goes from
15 to 16 suites) compares `VERSION`, `marketplace.json`,
`plugin.universal.yaml`, the README badge, the two README ranges, the README
release list and the first `RELEASE-NOTES.md` heading with `plugin.json`, and
proves each damage on a copy.

### Review

Five design lenses and two rebuttal rounds; a correctness and an adversarial
review (0 Critical, 2 Important, both fixed); mutation testing, 68 run, 66
caught, 2 survived (one equivalent, one fixed); one verification pass limited
to the fixes (0 Critical, 0 Important, 6 of 6 mutations caught). Worklist row
72 is new: two sentences about `git revert` in the same passage are false for
some states.

## v7.43.0 — the stop hook keeps its save state per session

**Problem.** The stop hook kept one save marker and one guard file for all
sessions, so one session could hide another session's reminders. 70 of 331
measured saves did not move the marker, and the hook then blocked a session
that had saved. The test guard missed an undefined command inside a function
called as a condition.

**Change.** Both files are kept per session. The context-management skill
gives one command that appends the entry and writes the marker. The guard runs
each suite again as a child process and reads its standard error.

**Effect.** Stop-reminders tests go from 29 to 40; suite-guard from 69 to 113
checks. Update the plugin and restart the command-line interface (CLI).
Nothing to migrate.

Rows 67 and 68 of the orchestration issues log are closed by this release.

**The save state of the stop hook (row 67).** The stop hook blocks a stop when
significant files were edited after the last saved decision. It knew the time
of that save from one marker file,
`~/.claude/hooks-logs/last-saved-entry.txt`, and it kept a two-minute guard
file, `stop-hook-fired.lock`, so that it does not block twice in a row. Both
files were shared by every session. A save in session B removed the reminder
of session A, and a block in session B silenced every reminder of session A
for two minutes. The new helper `hooks/save-marker.js` builds both file names
from the session id. Every character outside `A-Za-z0-9_-` becomes `_`, and
the result is cut to 64 characters, so an id such as `../../evil` cannot leave
the log folder. A payload without a session id uses the old shared names.

The stop hook now takes the latest of three times: the per-session marker,
the old shared marker, and the current time minus 7 days. The old shared
marker is still honoured, because old skill text and old handoff documents
still write it; honouring it can only cause a missed reminder, never a block
of a session that saved. The 7-day floor exists because the hook now deletes
per-session files older than 7 days: without the floor, a deleted marker made
edits count again that were already saved (reproduced in review, then fixed).

**A save that did not move the marker.** The marker was written by
`hooks/track-edits.js` when `session-log.md` was changed with the Edit or
Write tool, and by a separate `node -e` line in the context-management skill.
Measured on the transcripts of four days: 81 saves went through Bash and 1
through Edit or Write, 70 of 331 saves did not move the marker, and 33 of 226
real blocks came after a save with no later edit. The skill now gives ONE
Bash command. It appends the entry through a here-document (shell syntax that
passes the following lines to a command as its input) and then writes the
per-session marker, reading the id from `CLAUDE_CODE_SESSION_ID`. Measured
with 7 headless runs: that variable equals the hook's session id in a fresh
session, after `--resume`, after `--continue`, after a compaction and after
`/clear`. The delimiter of the here-document is quoted, so quotes, backticks
and `$` in the entry stay literal, and it is the unlikely word
`SAVED_ENTRY_END_7Q`: review showed that an entry line equal to the delimiter
ends the here-document early, and the shell then runs the rest of the entry
as commands. When a safety hook blocks the command, the skill names the Edit
tool as the other way. An Edit now moves the marker only when it adds a
`[saved]` heading (0 to 3 leading spaces), so trimming an old entry no longer
hides a reminder.

One behaviour stays on purpose. An entry that is saved before the edits that
implement it gives one more reminder, because the hook sees times and not
what an entry covers. The skill now says to save after the edits, and the
reminder prints the marker command for an entry that already covers them.

Rejected by measurement: `Saved` lines in the edit log (while the log rotated,
a line was lost in 7 of 20 rounds), the time in the `[saved]` heading (73 of
328 real headings have no clock time), the modification time of
`session-log.md`, and one shared map file (a save lost in 20 of 20 rounds).

**An undefined command inside a condition (row 68).** The guard of v7.42.0
stops a suite through an ERR (error) trap when a command ends with exit code
127. Bash runs no ERR trap below a function that is called as a condition
(`if f`, `f && x`, `f || continue`, `if f | grep`). Measured: an undefined
command in such a helper of the review-gates suite printed 94
`command not found` lines, and the suite still ended with exit code 0. The
worklist named 12 call sites of this form; the count was 20 in 5 suites. On
its first load the guard now starts the suite again as a child process,
copies the child's standard error to a log file, and fails the suite when the
log holds a line of the form `: line N: …: command not found`. The suite body
runs once. Measured on the 12 guarded suites: the same exit code, the same
standard output, at most 0.04 seconds slower. The ERR trap stays, because it
stops a suite at the first undefined call. This also catches two forms that a
rewrite of the call sites could not fix: `x=$(f)` and a plain `f | grep`.
`tests/suite-guard` tests the guard, so it keeps its own exit code and checks
its own standard error at its end.

Limits, stated in the guard's header: the wrapper fails a suite at its end; a
call whose standard error is hidden or captured is not seen; a marker
variable that is already set in the caller's environment switches the wrapper
off; a kill of the wrapper alone leaves the child suite running; `bash -x`
no longer traces the suite body; Git Bash and bash 5 were not tested.

**Review.** Three design lenses with a rebuttal round for row 67, and two
measuring verifiers for row 68. Then a correctness review (0 Critical, 1
Important), an adversarial review (2 Important), mutation testing (63 run, 14
survived, all closed) and one verification pass (30 more mutations). All
thirteen fast suites pass: stop-reminders 40 tests, the new save-marker test
file 33, suite-guard 113 checks, the others unchanged. Rows 69 (the Stop
payload field `stop_hook_active`) and 70 (the edit log loses lines while it
rotates) were opened.

## v7.42.0 — the stop hook ignores a subagent's throwaway worktree

**Problem.** The stop hook counted a subagent's throwaway edits under
`.claude/worktrees/agent-…/` as the main session's work, and blocked three
stops on one day. A list of `unresolved:` reasons left out one reason that the
same skill writes. A test suite stayed green when a check called a function
that did not exist.

**Change.** The hook leaves those worktree edits out. The list names all five
reasons. Eleven suites load a guard that stops the suite on exit code 127.

**Effect.** The stop-reminders tests go from 15 to 29, in-run-rulings from 871
to 873, and the new suite-guard suite holds 69 checks; 82 mutations were run.
Update the plugin and restart the command-line interface (CLI). Nothing to
migrate.

Rows 64, 65 and 66 of the orchestration issues log are closed by this release.

**The stop hook and a subagent's own worktree (row 64).** The edit log
(`~/.claude/hooks-logs/edit-log.txt`) records every Edit and Write with the
session id, and a subagent's edits carry the id of the session that started
it. Claude Code gives a subagent that runs with worktree isolation the folder
`.claude/worktrees/agent-a<16 hexadecimal digits>/`; a named subagent gets the
same form (six samples, one from a probe dispatch). Such edits are throwaway
work, for example mutation testing, yet `hooks/stop-reminders.js` counted them
and asked for a `[saved]` entry. Both log readers of the hook now go through
one helper, `readSessionEditsAfter`, which leaves those paths out, so the
decision-log reminder, the test-first reminder and the `state.md` check all
ignore them. Both path separators match, for Windows paths. A worktree that
the main session entered has a name of another form and is still counted. The
wider candidate, every path under `.claude/worktrees/`, was rejected for that
reason. "Ignore every edit of a subagent" was rejected too: the log has no
subagent field, and subagents made 114 of the 121 edits of the observed
session. Only the Claude Code hook file wires this hook. Accepted limits: a
subagent in such a worktree whose work is kept gets no reminder, and neither
does a main session started inside such a folder. If Claude Code changes the
name form, the filter matches nothing and the block returns, which is the
safe direction.

**The fifth `unresolved:` reason (row 65).** The Canonical dispositions list
of `skills/multi-code-review/SKILL.md` now names
`unresolved: withheld finding, no credential at the location`, with the
section that writes it (Error Handling). Two checks hold it: one pins the
entry inside its sentence, and one pins the sentence that writes the reason,
so the writer cannot be reworded while the list keeps the old text.

**The undefined-command guard (row 66).** A check that called a function
defined later in the file made bash print `command not found`; no FAIL was
counted and the suite ended with exit code 0 (measured: 871 passed, 0 failed,
with the undefined call in place). `set -u` does not catch this, and
`command_not_found_handle` does not run on bash 3.2, the bash of macOS.
`tests/lib/undefined-command-guard.sh` sets an ERR (error) trap that stops the
suite with exit code 1 when a command ends with exit code 127, and `set -E`,
because without it a call in the middle of a function body is missed. Eleven
suites load it; the codex and opencode runners use `set -euo pipefail` and
already stop. The new suite `tests/suite-guard/run-tests.sh` pins the
behaviour with fixture scripts, builds the list of guarded suites from
`tests/*/run-tests.sh`, and scans every suite for a line that switches the
guard off (18 forms, each proved by a fixture). The known limits are stated in
the guard file. The largest one is open as row 68: bash runs no ERR trap in
the body of a function that is itself called as a condition or inside an `&&`
or `||` list, and 12 call sites in four suites have that form.

**Review.** Two design lenses with a rebuttal round for row 64; then three
reviews in parallel: correctness (0 Critical, 0 Important, 5 Minor),
adversarial (2 Important) and mutation testing in a separate worktree (30 run,
19 caught, 11 survived: 1 equivalent mutant, 10 closed and replayed); then one
verification pass (52 mutations, 2 Important findings on the guard scan, fixed
and replayed on a real suite). All thirteen fast suites pass: codex 14 suites,
smart-compress 107, reviewer-templates 272, writing-plans 21, in-run-rulings
873, fill-prompt 166, orchestrating-development 217, review-gates 142,
measure-context 143, pickup 198, analyze-compaction 40, sdd-scripts 207,
suite-guard 69. Rows 67 (the stop hook's save marker is global, not per
session) and 68 were opened.

## v7.41.0 — a resume stops on a plan edit that no record explains

**Problem.** A session that ended after it edited a plan clause, and before
it wrote any record, left the plan edited. Nothing read that edit, so a later
commit could include it with no ruling. The orchestrator skill also
permitted a plan edit by a code-review fix commit, which `multi-code-review`
forbids.

**Change.** A resume of a Phase 3 or Phase 4 stop first reads the plan diff
and stops on any change except a checkbox tick. A fix subagent never edits
the plan.

**Effect.** The in-run-rulings suite goes from 839 to 871 checks and
reviewer-templates from 269 to 272; 41 mutations were run and 7 survivors
closed. Update the plugin and restart the command-line interface
(CLI). Nothing to migrate.

Rows 61 and 62 of the orchestration issues log are closed by this release.

**The orphan plan edit stop (row 61).** An orphan plan edit is a change to
the plan file that no commit, no audit note and no ruling record explains. It
arises when a session writes a clause edit and ends before it writes the
audit note, the `**Follow-up:**` line and the follow-up commit. Resume (the
part of the orchestrator skill that continues a stopped run) skips its
clean-tree check when the orchestration log ends with a `## STOPPED` entry,
so nothing read that edit. A later commit of the plan file would then take
the edit into history with no note and no ruling.

Resume step 3 now has a new rule. It runs only when the heading of the
`## STOPPED` entry names phase 3 or phase 4. Before the step writes anything
— a revert, an amendment or a `**Follow-up:**` line — it runs
`git diff --no-ext-diff --no-textconv HEAD -- <plan path>`. It runs that
command also when the resume makes no plan edit at all. An implementer's only
write to the plan file is the tick in a task checkbox, the box at the start
of a step line. So a changed line may differ from its committed text only in
the character inside that checkbox. A line that differs in any other
character, and a line added or removed whole, is a major error (an error that
stops the run).

The stop makes no plan edit, writes no `**Follow-up:**` line, makes no commit
and appends no log entry. The `## STOPPED` entry therefore stays the last
entry of the log, and the same resume prompt works again. The report names
the changed lines and states the way out: restore those lines to their
committed text, then send the same resume prompt again.

The rule has no retry branch and no comparison of wordings. No record says
which answer the orphan edit belonged to. A retry that completed the edit
would keep wording X in the plan while the record says wording Y. A
comparison of the two wordings can itself be wrong.

**Why the row's own candidate was rejected.** Row 61 proposed a two-form
test on the `**Follow-up:**` line. Three independent design lenses found that
this test cannot see the crash the row describes. A user's own amendment is
written in this order: reverts, clause edit, audit note, `**Follow-up:**`
line, one follow-up commit. A crash between the clause edit and the note
leaves no `**Follow-up:**` line to test. Parts of the row were also wrong:
the state is not the one the skill calls inconsistent, and Resume step 3
never reverts a user's own amendment, so no revert needs the missing note.

**A fix commit never edits the plan (row 62).** The orchestrator skill named
two kinds of plan edit outside its amendment rule, and the second was a fix
commit of the code-review loop. `multi-code-review` states "The loop never
edits plan text", and the fix prompt said nothing about the plan file. The
corrected sentence names one kind only, the amendment revert and the
checkbox untick of Resume step 3, and states that a fix commit never edits
the plan file. The fix prompt has a new rule: never edit the plan file, not
even its reference text; when a finding can only be fixed by a change to the
plan, leave it unfixed and report its id back as needing a plan edit.

`multi-code-review` has a new disposition (the recorded outcome of a
finding) for such an id: `unresolved: fix needs a plan edit`. It is blocking.
It is recorded also when the same fix commit fixed other ids, and also for a
verification-cycle fix and an addendum fix. It is not a failed fix, so the
loop does not make the failed-fix retry for that id. A fix that a later
answer orders for the same id is dispatched as usual, because an
`amend plan` answer can have changed the plan by then. The row's word "move"
was wrong: the rule that protects a user's decision compares quote text only,
never the location. Two alternatives were rejected: a rule that escalates
when a recorded quote matches nothing at its location, because a later user
amendment of the same unmarked clause makes it fire for the rest of the run,
and a `--stat` check by the controller.

**Review.** Three reviews ran on the first commit: correctness, adversarial,
and mutation testing (a deliberate wrong edit of a rule, to see whether a
check fails) in a separate worktree. One Critical finding was reached by two
reviewers: the first version had no phase condition. Phase 2 leaves the plan
uncommitted on purpose, so every resume of a Phase 2 stop would have stopped
with a false reason. 41 mutations were run and 7 survived; checks now close
all 7, and 25 mutations replayed after the fixes were all caught. One
verification pass then found 1 Important item: the sentence that forbids a
retry had no scope, so a controller could refuse the fix that an `amend plan`
answer orders. That sentence now forbids only the failed-fix retry.

`tests/in-run-rulings/run-tests.sh` goes from 839 to 871 checks and
`tests/reviewer-templates/run-tests.sh` from 269 to 272. All twelve fast
suites pass: codex 14 suites, smart-compress 107, reviewer-templates 272,
writing-plans 21, in-run-rulings 871, fill-prompt 166,
orchestrating-development 217, review-gates 142, measure-context 143, pickup
198, analyze-compaction 40, sdd-scripts 207.

Four limits are accepted. A fix subagent that disobeys the new prompt line is
not detected. A staged orphan edit whose working-tree lines were restored is
not seen; commits name their paths, so the working-tree content is what gets
committed. The way out does not list uncommitted checkbox ticks. A sentence
added inside the new `multi-code-review` bullet is not caught by a check.

Four worklist rows were opened. Row 63: a fix-commit revert that a crash
interrupts leaves its staged code changes, and the next resume reads them as
someone else's work. Row 64: the stop hook counts a subagent's edits as the
main session's work and asks for a `[saved]` entry that is not owed. Row 65:
the list of `unresolved:` reasons in `multi-code-review` leaves out
`withheld finding, no credential at the location`. Row 66: a fast suite stays
green when a check calls a function that is not defined yet, because bash
prints `command not found` and no failure is counted.

## v7.40.0 — the recorded answer quotes the clause your decision leaves in force

**Problem.** An orchestrated run recorded your answer with a quoted clause
copied from the review log. After a fix that line carries no clause at all,
and after your own `amend plan` answer it still held the older wording. The
rule that protects your decision compares that quote, so it found no match
and the run could decide the item itself, writing plan text you had
overturned.

**Change.** The quote is now read from the plan, at the named location, once
the resume has made its own edits. Reverts run before your amendments. Six
more rules of the ruling record are corrected.

**Effect.** A decision you made is found again whenever a later finding
touches it. Nothing to migrate.

Row 45 of the orchestration issues log named this defect and described it
wrongly: it said a revert leaves a quote of the removed wording behind.
Reverts were never the defect. Each `**Follow-up:**` line quotes the clause
as it stood before **its own** ruling's amendment, and a revert restores
exactly that wording, so the two match. Three independent reviewer lenses
reached that conclusion separately, and the ruling record of a real run of
2026-09-05 shows it: each of its five follow-up quotes is the wording from
before the amendment that the same answer makes.

The damage the row named is real, and it has two other causes. The
orchestrator may read only the latest invocation entry's current disposition
line for an item. After `amend plan …; fix it` the review loop fixes the
item, so that line becomes a `fixed — <summary> → <sha>` line, which carries
no quoted clause. The recorded answer then reads `— clause: none`, which the
protecting rule matches against nothing — a consequence the skill already
stated and had no rule against. Separately, your own `amend plan` answer
moves the plan while the recorded quote stays behind.

The fix is on the record side. The quoted text is read from the plan file at
the named location once every plan edit of the resume is written, so it
records the wording your decision leaves in force, which is the wording a
later finding will quote. The plan location falls back to a new tail on the
ruling record's `**Contract clause:**` field when the disposition line
carries none. A clause that cannot be read stops the run instead of being
recorded as `none`. The guard-side alternative — widening the comparison —
was rejected: that rule's default when nothing matches is to decide the item,
so every branch where a widened test failed would land back in the defect,
and an adversarial lens found nine such branches.

Six further rules ship with it. Reverts of a resume are written before any
amendment your own answer makes, because the other order makes the revert see
changed text and stop. A revert stops when one return amended the same clause
twice, since the commit it restores from predates both. A code change an
earlier resume could not undo, because your working tree held a local change
to the same file, is now undone by the next resume instead of being skipped
for ever. A read-only reviewer is given the disposition line inside its
prompt and never the review log's path, so it cannot open every earlier entry.
A clause amended twice keeps both markers, in ruling order. And the
orchestrator's own copy of the clause comparison rule regained the whitespace
collapse it was missing at two sites, without which every clause the plan
wraps across lines — the ordinary shape — failed to match.

One defect here was observed in a real run rather than reasoned about: on
2026-09-05 the answer to one ruling was appended to another ruling's entry,
and the first kept no record of it. The entry is now found by the answered
id, and two entries sharing a bare id are told apart by the parenthesis the
answer already carries.

Review found one Critical and ten Important findings, five of them reached by
two independent reviewers. The Critical was in this release's own first
attempt: the new entry lookup stopped whenever two entries shared an id, a
case the skill says occurs, with no answer a user could write to continue.
107 mutations were run against the new rules; 26 survived the first check set
and 26 checks close them.

`tests/in-run-rulings/run-tests.sh` goes from 768 to 839 checks. All twelve
fast suites pass: codex 14 suites, smart-compress 107, reviewer-templates 269,
writing-plans 21, in-run-rulings 839, fill-prompt 166,
orchestrating-development 217, review-gates 142, measure-context 143, pickup
198, analyze-compaction 40, sdd-scripts 207.

Two limits shipped on purpose, both stopping rather than writing plan text: a
revert also stops when a sibling clause of the same return was amended again
later, and when the other amendment note belongs to an `**Exact content:**`
block. Narrowing either needs a comparison that can itself be wrong.

## v7.39.0 — a quote that the revert can find again

**Problem.** When the orchestrator amends a plan clause, its audit note
quotes the clause's opening words, and a later revert finds the clause by
that quote. The quote failed in four ways: it was unique under a stricter
comparison than the revert uses; it found nothing after a later ruling
changed the words; it could not be built for an `**Exact content:**` block;
and a repaired note skipped the uniqueness rule.

**Change.** Added sentences at seven places in the orchestrating-development
skill close the four cases. No existing sentence was reworded.

**Effect.** Each case now ends in a correct revert or in a stop that names
its cause. The in-run-rulings suite goes from 742 to 768 checks. Nothing to
migrate.

Rows 49 to 52 of the orchestration worklist. None was observed in a run.

**One comparison, not two (row 49).** The revert lets a `'` in the quote
match `'` or `"` in the plan, because open-item lines are normalised. The
insertion test now compares the same way. When the whole clause stands twice
in its block, adding words cannot end: the clause is quoted whole, the note
says so, and a revert or a retry stops on more than one match.

**A later ruling is named (row 50).** Ruling 3 amends a clause, ruling 7
amends it again and changes its opening words, and the user overturns only
ruling 3. The quote of ruling 3 then matches nothing. The resume now looks in
the note's block for a note or a marker with a higher ruling number, names
that ruling in its report, and stops in both cases. The same holds for a
marked clause whose marker a later ruling replaced. The design step decided
that this case ends at a stop with a named cause: Resume step 3 runs only
when the user is present.

**An Exact-content block is found by its marker (row 51).** Its quote could
be pushed into the fenced block, which holds several lines and backtick
characters. The block is now the one exception to the uniqueness rule: eight
words of the introducing paragraph line, never a line of the block. The
marker finds it in the plan now and in the ruling commit's plan. The plan
before the ruling cannot hold the marker, so several matches are chosen by
position: the match whose introducing paragraph line is a removed line of the
hunk (one block of changed lines) that holds the added marker line. A choice
that does not leave exactly one clause stops.

**A repaired note follows the first-insertion rules (row 52).** All three
places that insert only a missing note are covered; the row named one.

**What the review changed.** Two lenses, mutation testing and one
verification pass. Two corrections were to this work's own first wording. The
exception first covered every marked clause, which took the unique quote from
Global Constraints entries; a measurement in a scratch repository showed that
a hunk header also covers unchanged neighbour entries, so the position rule
could never choose among them. And the first pre-ruling rule forbade the
quote search that reads the whole old clause. Mutation testing caught 38 of
44 mutations; every survivor that still applied now fails, as do fourteen
mutations of the later wording.

**Not built.** A `was "…"` field in the note: a quote that finds nothing
already goes to the removed lines of the diff, and the field would change the
note template that multi-code-review mirrors. A rule that pairs removed and
added lines by their order: a wrong pairing would write wrong plan text.
Row 56 records one open point: what happens to an earlier marker when a
marked clause is amended a second time.

---

## v7.38.0 — a code reviewer that reads the real code

**Problem.** A repository can configure a textconv filter, a program that
turns a file into text before git compares it, or an external diff driver, a
program that replaces git's own comparison. v7.37.0 turned both off for the
plan file only. The review package, the diff file every code reviewer reads,
was still built through them, so a reviewer could judge text that is not in
the repository.

**Change.** All four reads of the `review-package` script and all five
fallback reads in the reviewer templates now carry
`--no-ext-diff --no-textconv`.

**Effect.** A review round judges the committed code. The sdd-scripts suite
goes from 193 to 207 checks and reviewer-templates from 244 to 269. Nothing
to migrate.

Row 54 of the orchestration worklist. It was never observed in a run.

**The row named three reads; nine were open.** The three named reads are the
fallback a reviewer uses only when the review package is missing. The main
path had the same defect: `skills/subagent-driven-development/scripts/review-package`
builds the package with two `git diff` and two `git show` reads, and none
turned the helper programs off. Two more fallback reads stood in the task
reviewer template and in the requesting-code-review template. Each of the four
prose files now states the rule and its reason, so a later edit cannot keep
the options and lose the reason.

**Measured, not assumed.** On macOS with git 2.50.1, a fixture repository
configures a textconv filter and both external driver mechanisms
(`diff.<name>.command` and `diff.external`). Before the fix the package held
the helper's text and none of the real lines. A modified file is the stronger
case: a textconv filter turns both sides into the same text, so the change
disappears from the diff completely. `--stat`, `--numstat`, `--name-only` and
`git log --oneline` run no helper program, so on the two `--stat` reads the
options change nothing today. They stay, for the v7.37.0 reason: one uniform
spelling cannot be got wrong. Because no fixture can show a `--stat` read
losing them, one check reads the script and requires the options on each of
its four reads.

**What the review round changed.** A correctness review, an adversarial
review and mutation testing found no defect in the fix. Mutation testing found
that the wording checks counted only the spelling `git diff`: an added
`git show`, `git log -p` or `git --no-pager diff` read passed. The checks now
find a content read by a pattern, refuse the opposite options `--ext-diff` and
`--textconv`, and hold the whole multi-code-review skill at its present count
of reads without the options (one, a prose description). Seven mutations that
first passed now fail. One is accepted as not caught: a rule sentence negated
in prose.

**Not covered, and recorded as row 55.** The adversarial review showed a
different class. A `* binary` attribute makes git print `Binary files differ`
in place of the code, and a replace reference makes git show another commit's
content. Both were reproduced; `--text` and `--no-replace-objects` were
measured as counter-measures. They need a decision on whether the local
configuration of a reviewed repository is trusted, so they are not part of
this release.

---

## v7.37.0 — a revert that reads the plan's own text

**Problem.** A repository can configure a textconv filter, a program that
turns a file into text before git compares it, or an external diff driver, a
program that replaces git's own comparison. The orchestrating-development
skill already called `--no-ext-diff --no-textconv` mandatory for a reviewer's
diff. Its own ten reads of the plan file carried neither option.

**Change.** Every diff of the plan file now carries both options, and the
skill states once what a read without them would cost.

**Effect.** A revert restores the plan's own text instead of a helper
program's output. Nothing to migrate.

Row 53 of the orchestration worklist. It was never observed in a run.

**What the ten reads could do.** The worst is the step that takes the old text
of an amended clause before restoring it: that text came from the diff, so a
helper program's output would have been written into the plan. Three more
reads back the checks that exist to stop a wrong write; those checks would
have passed while seeing nothing. The last four are the crash-repair path,
which decides from a diff whether an amendment was already applied, so a
rewritten diff could apply it twice.

**Measured, not assumed.** On macOS with git 2.50.1, in a scratch repository
with both kinds of helper program configured: `git diff` runs both by default;
`git show <commit> -- <path>` runs a textconv filter by default but not an
external diff driver; the file read `git show <commit>:<path>` runs neither.
An external driver prints whatever the helper prints, never a recognisable
refusal, so the failure would not announce itself.

**One spelling, not two.** Both options are written on every diff read, even
on `git show`, where `--no-ext-diff` turns nothing off today. Two accurate
spellings would be two things to remember and two patterns to check; one
uniform spelling cannot be got wrong, and it survives a change in git's own
defaults. No sentence claims that both options are load-bearing everywhere.
The seven file reads, which need no option, are left as they are.

**How it was found.** Not by looking for it. A design step for worklist rows
49 to 52 rejected the redesign those rows were opened for, and this defect
turned up while one lens's claim about helper programs was being checked. It
outranks all four of those rows, which end at a stop rather than at wrong
text, so it shipped first.

**Tests.** The in-run-rulings suite goes from 737 checks to 742. Three hold
row 53: one finds every read of a plan diff by its shape and requires both
options on each, and two hold the rule's consequence, so a later edit cannot
keep the options and lose the reason for them. A fourth pins the rule sentence
itself. The checks were written before the fix and verified failing.

One review round and one mutation-testing round ran against this branch. Both
found real holes in the first version of those checks, and every finding was
replayed before it was accepted: the counting check first matched two literal
commands, so a read added later was invisible to it, and the rule sentence
could be weakened or deleted with the suite still green. All ten mutations
now fail.

**Still open.** The same helper programs are not turned off for a reviewer's
own diff reads in `skills/multi-code-review/`. A configured helper would show
a reviewer text that is not in the repository, so every finding of that round
would be made against code that does not exist. That is recorded as row 54 and
is not fixed here, because row 53 scopes itself to the plan file.

## v7.36.0 — an audit note that still finds its clause

**Problem.** For an amended plan clause that carries no marker, the quote
inside its audit note is the only way to find that clause again. The quote had
to be unique in the whole plan, checked once, although the plan keeps
changing. A quote taken from a task step also started at the checkbox, so
ticking the box broke it.

**Change.** The quote must now be unique inside the note's own block, which is
the scope the revert searches, and all four searches narrow to that block. A
task checkbox is never part of the quote.

**Effect.** A revert no longer stops as a major error because the plan moved
on or a box was ticked. Nothing to migrate.

Rows 46 and 47 of the orchestration worklist. Both broke the same mechanism.

**Row 47 — the checkbox.** `- [ ] ` was not among the named list markers, so
on a task step line the quote started at the box itself. Plan steps are
checkbox lines, an amendment may edit a mandated sentence in such a line, and
that edit gets no marker — so the quote is the only route back to the clause.
The implementer's only write to the plan file is the checkbox tick, which
happens between the ruling commit and any later revert. The new rule names no
box spelling on purpose: naming `- [ ] ` and `- [x] ` would break again on
`- [X]`, `* [ ] ` or `1. [ ] `, which is the defect itself. The revert already
stated the same thing for its word comparison; the two sites now agree.

**Row 46 — uniqueness that could not stay true.** The old rule compared the
quote against the whole plan, once, before the note was inserted. A batch
controller commits the plan on every task completion, and later rulings amend
other clauses, so a second clause could come to hold the same opening words.
The revert then stopped as a major error with no recovery. Uniqueness is now
required only inside the note's block — the `**Global Constraints:**` block,
or the `### Task <n>` section — and every search narrows there first, falling
back to the whole plan when the block holds no match, so a note placed
elsewhere by an older version of this skill still resolves.

**A read contradiction resolved on the way.** The classification read
exception grants a scan of the whole plan only inside Resume step 3, while the
old rule demanded one at ruling time, where the exception grants only the
cited clause or the constraints block. The block scope removed the demand, so
the release adds no command and leaves the permitted-reads list unchanged.

**What the review rounds caught.** One review round, mutation testing in a
separate worktree, and three verification cycles, which is the cap. The review
round found a Critical regression in the first fix: the block ended at the
next line beginning with a `#` character, but a plan step often shows a script
whose first line is `#!/usr/bin/env bash`, so the block ended inside the
fenced code block — 21 of 46 plan files in this repository hold such a line
inside a task section. Cycle 1 found the fence rule repeating the same shape
of mistake, because an inner fence's opening line read as the close of the
outer one; 9 of 46 plan files hold such a nested fence. Cycle 2 found that the
search over the plan before the ruling fell back to the whole of that output
in exactly the case the next sentence calls expected. Cycle 3 found that the
same search's zero-match branch was keyed to one cause instead of to the
search result. Mutation testing showed every one of the first fifteen checks
failing on some wrong text, and each finding was re-tested locally before it
was called closed.

**Acceptance.** `tests/in-run-rulings/run-tests.sh` runs 737 checks, 705 on
v7.35.0. All eleven fast suites pass.

**Known limits, recorded as worklist rows 49 to 52.** The quote is built under
a strict comparison and matched under a loose one; a clause amended twice with
only the earlier ruling overturned cannot be reverted; an `**Exact content:**`
block cannot always be quoted; and the crash-repair path writes a note with no
uniqueness rule. An indented fenced block is invisible to the fence rule,
which fails to a stop and never to a wrong clause.

## v7.35.0 — revert an amendment without removing a later one

**Problem.** A resume that overturned a ruling restored the clause from the
commit before that ruling, so it also removed a later amendment of the same
clause. Nothing tested whether a ruling was already reverted, so one could be
overturned twice.

**Change.** The revert now compares the clause with the ruling commit's own
version before restoring, and stops when a later ruling amended it. An
absent amendment note and an absent marker mean "already reverted". A stop
after the plan file changed puts the replaced text back.

**Effect.** An override no longer removes another ruling's text or runs
twice, and no half-written plan is committed. Reinstall the plugin. Nothing
to migrate.

When the user overturns a ruling in a resume prompt, Resume step 3 reverts
the amendment that ruling made to the plan. Until now it copied the clause
from `git show <ruling commit>^:<plan path>` — the plan as it read *before*
that ruling. When a later ruling had amended the same clause, that copy also
removed the later ruling's text, and the later ruling's `**Amendment <m>`
note stayed in the plan and described a change that was gone (worklist row
42).

**The clause is compared before it is restored.** The revert now reads the
same clause from `git show <ruling commit>:<plan path>` — the plan as the
ruling commit itself left it — and compares it with the clause in the plan
now. Equal texts mean nothing touched the clause after that ruling, and the
revert proceeds. Different texts mean a later ruling amended it, which is a
major error: the run stops and reports, and restores nothing.

**A ruling cannot be overturned twice.** A second resume prompt can carry
the same ruling id. The only duplicate test was for an identical
`**Follow-up:**` line, so nothing said "already reverted", and when the
first answer was itself `amend plan`, the second revert wrote the
pre-ruling text over the user's own amendment (worklist row 43). An absent
`**Amendment <m>` note together with an absent `(amended by ruling <m>)`
marker now means the amendment was already reverted; the resume records
that and moves to the next answer. The test runs **before** the clause is
located, because the first revert deletes both the note and the marker.

**A stop puts the replaced text back.** Every path that reaches the revert
reaches it with the clean-tree check skipped, on purpose: the tree may hold
the blocked task's own work. A stop in the middle of a revert therefore left
a half-written plan in the tree, and the next resume classified it as a plan
edit that was already uncommitted before the revert started — the blocked
task's work — and committed it. A resume that has already changed the plan
file and then has to stop now puts the replaced text back, clause by clause,
before it stops. It never writes a whole file, and the three commands that
discard local changes stay forbidden.

**Three smaller corrections in the same passage.** (1) The saved baseline
and the check after the write both use `git diff HEAD -- <plan path>`, so a
plan edit that a task staged with `git add` is visible; the earlier form
compared the working tree with the index and missed it. (2) When one resume
reverts two rulings whose clauses share a line, part 2 of the word check
excludes the text of the other clause this same resume restored, and the
reverts run in descending ruling number, with every plan revert before any
fix-commit revert. (3) The permitted-reads list carries the three commands
the fix-commit revert needs — `git show <ruling commit>:<plan path>`,
`git status --porcelain` and `git show --name-only --format= <sha>` — for
the orchestrator alone, and no longer permits `git diff -- <plan path>`.
Without them an orchestrator that obeys its own read list could not revert
the fix half at all.

**Acceptance.** 705 checks in `tests/in-run-rulings/run-tests.sh`, against
678 on 7.34.0, after two review rounds. The second round was checked by
mutation testing in a separate `git worktree`: a mutant that replaced a stop
with a commit, and mutants that renamed the forbidden commands, kept the
whole suite green, so six checks were added that hold each rule's
consequence and not only the sentence that says when the rule applies. The
same analysis opened four smaller worklist rows, and worklist rows 41 and 44
were taken out of this release after its first review round, each with the
blockers that a later design must answer.

## v7.34.0 — find the ruling commit of a later ruling of a return

**Problem.** A resume could not find the ruling commit of an overturned
ruling that was not the first of its return. The search used the ruling's
own number, found no line, and stopped the run.

**Change.** The revert now finds the `## RULING` entry that covers the
ruling and searches for that entry's number. The audit note quotes the
amended clause's opening words, so a revert finds an unmarked clause and
restores only that clause's text.

**Effect.** An override of a later ruling of a return now works, and a
revert no longer writes a wrong clause. Reinstall the plugin so a session
reads the new text. Nothing to migrate.

One return of a phase writes one `## RULING` entry and one commit, and that
commit's subject carries only the first ruling number of the return. Resume
step 3 searched `git log --grep "<slug> ruling <n>"` with the overturned
ruling's own number and required exactly one line. When one return held
rulings 5 and 6 and the user overturned ruling 6, the search found zero
lines and the run stopped as a major error. The stop was safe — nothing was
reverted wrongly — but the override could not be carried out. Since v7.33.0
an amended clause that carries no `(amended by ruling <n>)` marker is found
only through that commit's diff, so the same gap blocked the revert of such
a clause (worklist row 40).

**Finding the commit.** The revert now finds the `## RULING` entry that
covers the overturned ruling: the entry in the orchestration log with the
largest number that is not above the overturned ruling's number. The search
uses that entry's number. Example: one return wrote rulings 5, 6 and 7, so
the commit of ruling 6 has the subject
`chore(orchestration): <slug> ruling 5`. The third-write check of Resume
step 3 now says the opposite thing about its own `<n>`: there `<n>` is the
item's own ruling number, which can be higher than the `## RULING` entry's
number, because the audit note and the marker both carry the item's number.

**Finding the clause.** The audit note now quotes the amended clause's
opening words:
`> **Amendment <n> (orchestrator ruling):** opening words "<opening words>" — <what changed, from what, and why>`.
The label is unchanged. The quote leaves out the `(amended by ruling <n>)`
marker, holds at least the first eight words of the clause, and is checked
for uniqueness outside audit notes before the note is written. A revert of
an unmarked clause searches the plan for that quote, reads from the ruling
commit's diff which lines of the clause changed, takes the old text from the
commit before the ruling commit, and restores only that one clause — never a
whole hunk (one block of changed lines in a diff). A quote that matches no
clause, a quote that matches more than one clause, a note with no quote, and
a set of changed lines whose two rulings cannot be separated are each a major
error.

**Two checks after the plan file is written.** Before the resume commit, the
run inspects `git diff -- <plan path>`. Every changed line must belong to
this clause, to this clause's audit note, to another revert of the same
resume, to a checkbox that this resume unticks, or to an edit that was
already uncommitted when the revert started. Then a word check in two parts:
every word the ruling commit removed from this clause must stand again in
the plan in the same order, and any other text on those same lines must read
exactly as the plan held it before the revert. A difference in either check
is a major error — the run stops and makes no commit.

**The search range.** Every search for a ruling commit by its subject now
runs `git log --first-parent … <BASE>..HEAD`. `<BASE>..HEAD` keeps only the
commits after the recorded branch point, and `--first-parent` makes git skip
the commits a merge brought in, so a commit with the same subject from an
earlier run is never matched. During a run nobody pulls into the feature
branch and nobody merges another branch into it. When the search finds no
exact match and `git log --merges --format=%h <BASE>..HEAD` prints a merge
commit, the run stops as a major error instead of taking the recovery path,
because a merge's second parent can hold a ruling commit the search did not
read. The permitted-read list of Resume step 3 gained
`git log --merges --format=%h <BASE>..HEAD`, `git diff -- <plan path>` and
`git show HEAD:<plan path>`.

**Tests.** `tests/in-run-rulings/run-tests.sh` now has 678 checks (591 in
v7.33.0, 545 in v7.32.0). The change was reviewed in three rounds by
independent reviewers under four lenses (correctness, adversarial, test
quality and plain English); each round's findings were applied in a commit
of their own. `tests/reviewer-templates/run-tests.sh` and
`tests/orchestrating-development/run-tests.sh` pass unchanged.

**Known limits.** The analysis of row 40 opened four more worklist rows,
none of them fixed here and none observed in a run: a branch rewritten
between a stop and a resume hides ruling commits from both subject searches
(row 41); reverting an amendment of a clause that a later ruling also
amended removes the later change and leaves its note standing (row 42); the
same ruling can be overturned twice, and the second revert writes the
pre-ruling text over the user's own amendment (row 43); and the skill does
not say which commit holds a user's own `amend plan` answer at a resume
(row 44).

## v7.33.0 — ruling records in a shape the stop path reads, and plan edits only under amend plan

**Problem.** On the compaction probe run, Phase 4 ruling records lacked the
`[<id> inv <i>] <severity> <file:line>` shape that a stop and a resume read.
A `plan governs` ruling edited the plan. Resume looked for a marker that an amended `**Contract:**` never gets.

**Change.** The Phase 4 step names the record shape, and each field's source
is written out. Only an `amend plan` answer edits the plan in a ruling commit.
An amendment edits the clause before its note, and Resume checks an unmarked
clause through a git diff.

**Effect.** A resume no longer re-applies an amendment that was already made.
Reinstall the plugin; nothing to migrate.

Row 39 of the worklist listed three deviations in the ruling records of the
v7.30.0 compaction probe run. Three read-only investigations of the run's
transcript classified each one before any change:

- **The `**Item:**` field.** Rulings 3 to 9 wrote `[I1] invocation 1, round 1
  (<lens>) — <the whole disposition line>`. Two compactions had removed the
  template from context, and the re-reads that followed skipped it. The
  wording also had a gap: `<severity>` had no named source. The Phase 4 step
  in `skills/orchestrating-development/SKILL.md` now names the shape, and a
  new paragraph says where each part comes from: `Critical` or `Important`
  from the first letter of the id (`n/a` otherwise, or for an item with no
  finding behind it), the location after `— at`, and the finding summary only.
  It gives one example line.
- **A plan edit under `plan governs`.** Ruling 2 removed words from reference
  text in the plan and recorded the answer as `plan governs`. The rule is now
  explicit: in a ruling commit, only an `amend plan` answer edits the plan
  file, and only by the amendment procedure. The Resume revert, the checkbox
  untick and a fix commit of the code-review loop are outside this rule.
  Forcing `amend plan` onto every such edit was rejected: it would use one of
  the three in-run resumes, force a new review invocation, and stop on an item
  with `clause: none`.
- **`state.md`.** The row said `state.md` was not rewritten at the Phase 1 and
  Phase 2 boundaries. The transcript shows it was (two `sed -i` edits), so that
  half was false. The `Rulings:` line lacked `(last: ruling <n>, phase <p>)`;
  the ruling step now names that shape and says what `<count>` and `<n>` mean.

**The marker.** The amendment procedure places `(amended by ruling <n>)` only
on a Global Constraints entry or an Exact-content block. The Resume check, the
override revert and the retry check looked for it on every clause, so on
`main` a resume after an amended `**Contract:**` re-applied the amendment. Now
the procedure edits the clause before it inserts the `**Amendment <n>` note, so
a standing note shows the edit was made. For an unmarked clause with no note,
Resume reads the change from `git diff HEAD -- <plan path>` before the ruling
commit, or from `git show <ruling commit> -- <plan path>` after it, and inserts
only the missing note when the clause already changed. When the ruling commit
is missing, the amendment is completed before the repair commit, so the edit
is inside `ruling <n>`. When the re-apply finds no target, the ruling commit is
made without a plan edit and the run stops. Both git forms are on the
permitted-read list. `docs/guide/README.md` now gives decided-wording
authority only to a marked clause.

**Tests.** `tests/in-run-rulings/run-tests.sh` now has 591 checks (545 before).
With the skill text of `main`, 48 of them fail. A four-lens review (correctness, adversarial, test
quality, plain English) ran twice. Its first round found the crash window
between the clause edit and the note, the unscoped plan-edit rule, and a
missing permitted read; each was reproduced in the skill text and fixed. In
the second round, all 13 mutants of the skill text were caught.

**Known limits.** Resume finds a ruling commit by the ruling's own number, but
one commit per return carries only the first ruling number of that return. An
override of a later ruling in the same return therefore stops as a major error
(worklist row 40); it never reverts the wrong text.

## v7.32.0 — hooks keep their files out of git status without editing .gitignore

**Problem.** Two hooks appended entries to `.gitignore`, a tracked file, in the
repository a session runs in. The uncommitted change stopped an orchestration
run at its clean-tree check, and the orchestrator restored `.gitignore` twice
on one run.

**Change.** Both hooks now write the entry to git's local exclude file, which
git never commits. They write nothing for a tracked file, an already ignored
file, or a folder outside a git repository.

**Effect.** A session no longer changes any tracked file to hide its own
files. Old `.gitignore` entries stay as they are; remove them yourself if you
want. Reinstall the plugin; nothing else to migrate.

`hooks/track-edits.js` runs after every Edit or Write. When the written file is
`state.md`, `session-log.md`, `project-map.md` or `known-issues.md`, it appended
the file name to a `.gitignore` in the file's own folder, also outside git.
`hooks/context-engine.js` runs at session start and appended
`context-snapshot.json` to the `.gitignore` of its working folder. On the
compaction probe run of v7.30.0 the fixture's first orchestration call stopped
at Phase 0 on the untracked `.gitignore`, and later the orchestrator ran
`git restore -- .gitignore` twice before a commit (worklist row 38).

Both hooks now call the new module `hooks/git-exclude.js`:

- It asks git whether the file is tracked (`git ls-files --error-unmatch`) or
  already ignored by any source (`git check-ignore`). In both cases it writes
  nothing. An entry for a tracked file would hide that file without a message
  once the user untracks it.
- Otherwise it appends one line to `$(git rev-parse --git-path info/exclude)`.
  The line starts with `/` and holds the file's path from the repository root,
  with the gitignore pattern characters `\ * ? [` escaped, so it matches that
  one file only. A linked worktree uses the exclude file that all worktrees of
  the repository share. A line that is already present is not added again.
- It resolves symbolic links in the folder path first, does nothing inside the
  `.git` folder, and does nothing for a path that holds a newline.
- `context-engine.js` adds the entry before it writes the snapshot, so
  `git status` does not show the file even while the hook runs.

The orchestrator skill already used the exclude file for `state.md`, so the
hooks and the skill now follow one rule. `context-engine.js` also runs under
Cursor and under the Codex adapter, so the change reaches them too; only
Claude Code ran it for this release.

**Tests.** `tests/codex/test-git-exclude-hooks.js` (17 tests, now part of
`tests/codex/run-unit-tests.sh`) runs each hook as a separate process on a
temporary repository and checks `git status`. 7 of its first 10 tests failed
on the old hooks. A four-lens review (correctness, adversarial, test quality,
plain English) found the tracked-file, symbolic-link, `.git`-folder and
newline defects above in the first version; each was reproduced, fixed and
given a test, and the reviewers then re-ran their reproductions. 15 mutants
were applied to the code, and after the review all the ones that had survived
were killed.

**Known limits.** A folder name that holds a newline still shows its file in
`git status`: a gitignore pattern is one line and cannot contain a newline.
Hooks that write the same file at the same moment can add a duplicate line; the
lines stay valid. An inherited `GIT_DIR` variable sends the entry to that
repository; Claude Code starts hooks, not git, so a hook does not normally see
one.

## v7.31.0 — the session-start hook keeps its output under 10,000 characters

**Problem.** Claude Code keeps a hook's output in context only up to 10,000
characters; above that only a 2,000-character preview stays. The session-start
hook printed 12,926 characters on an empty directory and 40,424 on this
repository, so the Entry Sequence, the workspace files and the
`<superpowers-defaults>` block never reached the model.

**Change.** The hook injects only the first part of the using-superpowers
skill, adds the workspace files in priority order while they fit, and names the
rest in one `<not-injected>` line; a Node script measures and escapes the text.

**Effect.** The whole injection reaches the model: 7,652 characters on an empty
directory, 9,613 on this repository. The three `SUPERPOWERS_*` variables now
take effect. Reinstall the plugin; nothing else to migrate.

The session-start hook is the script Claude Code runs when a session starts,
after `/clear` and after every compaction (the moment Claude Code replaces the
earlier conversation with a summary). Its output was measured on 2026-09-17
(worklist row 37, opened by the compaction probe of v7.30.0). The limit was
measured with a probe hook: the text stays in context in full up to exactly
10,000 characters and goes to a file from 10,001, with the first 2,000
characters as a preview. The old output crossed the limit on every repository,
because the whole 11,776-character skill body plus the header was 12,447
characters before any workspace file. The preview ended inside the skill's
third section. Six skills tell the model to read the last
`<superpowers-defaults>` block of this injection; that block was the last
section of the output, so the three environment variables it carries never
reached a Claude Code session, and the skills fell back to the built-in
defaults.

What the hook does now:

- **Skill part.** `skills/using-superpowers/SKILL.md` is reordered so that the
  trigger conditions, the named-skill rule, the Entry Sequence and the
  complexity rules come first, above a marker comment
  (`session-start-injection-ends`); the hook injects only that part (6,352
  characters, at most 6,400 by a test). The fresh project gate text, the
  staleness update steps, the EnterPlanMode intercept, the Routing Guide and
  the closing sections sit below the marker, and Entry Sequence steps 2 and 6
  and the Full action say: load the whole skill with the Skill tool if only
  its first part is in context. A full task therefore costs one Skill tool
  call for the Routing Guide; before, the guide was never in context at all.
- **Workspace files.** state.md, the project-map staleness note,
  session-log.md (last two saved entries), known-issues.md (last five open
  entries), context-snapshot.json and project-map.md are added in that order,
  each whole when it fits the remaining budget. The ones left out are named
  with their sizes in one `<not-injected>` line, and the model reads them with
  the Read tool when the task needs them. On this repository state.md and the
  staleness note go in; the other four are named.
- **Defaults block.** Always last, room always reserved.
- **Update notice.** Carries the release's three-line summary instead of 30
  lines of release notes, capped at 1,200 characters.
- **Assembly in Node.** `hooks/session-start-assemble.js` measures every part
  as the larger of its UTF-16 length and its UTF-8 byte length, escapes the
  whole text once with `JSON.stringify`, charges the room for the pointer
  line only when a section is left out, and cuts the skill part at 6,400
  characters when the marker is missing. The parts travel through files in a
  temporary directory.

Two older defects went with the change. Every workspace wrapper was built
with a bash `"\n"`, which reached the model as the two characters backslash
and n instead of a line break (24 occurrences on this repository). Any control
character other than tab, newline and carriage return in a workspace file
made the whole hook output invalid JSON.

Review, four independent lenses plus a verification round: the adversarial
lens found that bash counted 2,150 emoji as 2,150 characters where Claude Code
counts 4,300 (an 11,573-character output under a UTF-8 locale), which moved
the measuring into Node; the test lens found that the oversized fixture never
exercised the priority order (13 mutants, 7 survived) and added the cases that
kill them (12 of 13 killed; the survivor is the slack constant, which is not
an observable behaviour); the figures lens corrected a mixed baseline and the
count of skills that read the block; the wording lens found two documents that
stated the old behaviour as current fact (the token-efficiency skill's
compaction table and the compaction probe checklist).

Tests: `tests/codex/test-session-start-budget.sh` (91 checks, registered in
`tests/codex/run-unit-tests.sh`) runs the real hook on an empty directory, on
a directory where every file fits, on a priority-order fixture, on oversized
files, on 2,150 emoji under two locales and on control characters; it failed
on the old hook in 18 of 34 checks. The 133 checks of the defaults-block suite
still pass. The Codex adapter (`hooks/codex/session-start-adapter.js`) is a
separate implementation, embeds the whole skill and is unchanged; the marker
comment says so.

Behavioural check before the release: `tests/skill-triggering/run-all.sh`
(nine naive prompts, one per skill, each run with `claude -p` and the plugin
loaded from the checkout through `--plugin-dir`) on 2026-09-17: 9 of 9 skills
routed, each session's transcript between 58 and 243 KB, so every session
really ran. This is the first release whose router change was checked by that
suite before the merge.

## v7.30.0 — the compaction probe runs headlessly; the guard names summary claims

**Problem.** The compaction recovery guard of v7.19.0 was never tested: its
probe needed a person typing `/compact` in a live orchestration. Worklist row
13 stayed open since v7.19.0 (2026-09-13).

**Change.** The probe now runs with `claude -p`: `--autocompact 120k` compacts
automatically, and a resumed `/compact` call runs a manual compaction.
`tools/analyze-compaction.js` reads the session transcript (Claude Code's file
for one session) and reports the session's actions after each compaction. The
guard says a summary's claim of a done re-read never counts, and a `sed -n`
read of the same line range does.

**Effect.** Row 13 is closed on a recorded run: 10 compactions, and both
rulings written after one were complete and committed. Nothing to migrate.

A compaction is the moment Claude Code replaces the earlier conversation with
a summary because the context window is nearly full. The guard shipped in
v7.19.0 on 2026-09-13 without a run that compacted. The probe ran on
2026-09-16 on a throwaway fixture repository (a small test repository created
only for this run) whose spec holds two hard constraints inserted on purpose
so that every reviewer reports them, with plugin 7.29.0, the default model
with the 1,000,000-token context window, and permission prompts switched off
(bypass permissions mode). Findings, from three independent evaluators
(checklist, outcome, adversarial); they agreed on every fact except the
placement of the completion marker, which a re-check settled:

- **Every compaction attaches again the first 20,000 characters of the
  skill** (an `invoked_skills` attachment record, reaching line 320 of
  `SKILL.md`), so the guard paragraph was in context all ten times. The
  guard's former "first 5,000 tokens" is the same size; the text now gives
  the character figure.
- **The session followed the guard after two compactions, followed it in
  part after one, and skipped it after four.** After the Phase 4 return the
  session read most of the `## In-run rulings` section with the Read tool and
  with `sed -n`, without the heading grep, and left the section's first 37
  and last 102 lines unread. In the skipped cases the compaction summary
  restated the ruling templates almost verbatim, and twice it said the
  re-reads were already done; the session trusted it. The three other
  compactions had nothing pending. Under bypass permissions Claude Code asks
  the model to prefer `sed -n` over the Read tool; the guard now says which
  `sed -n` read counts.
- **No compaction caused a defect.** Both `## RULING` entries carry every
  required line. They are numbered by the first ruling number of their
  return. They were committed after the record and the log entry. No compaction
  lost the prompt directory: `mktemp -d` ran once and eight of the ten
  summaries carried its path. The
  completion marker and the Phase 5 hand-off were correct. The realistic case
  under the 1,000,000-token window, one manual `/compact` before a resume,
  was handled exactly as the guard says.
- **Re-invoking the skill after a compaction injects the full body again**
  (153,780 bytes), which itself triggered another compaction.

Three findings unrelated to the guard became worklist rows 37 to 39:

- The plugin's session-start hook (a script Claude Code runs when a session
  starts) prints 12 to 39 KB. Above 10,000 characters Claude Code writes the
  output to a file and keeps only a 2,000-character preview in context, at
  session start and after every compaction.
- Two hooks append to `.gitignore` in the repository a session runs in, which
  left an uncommitted change in the fixture's working tree during the run.
- Three deviations in the ruling records, made by the run itself and none
  caused by a compaction.

Tests: three new checks that pin the exact guard wording in
`tests/orchestrating-development/run-tests.sh` failed before the wording
change and pass after it (217 checks). The probe checklist
`tests/claude-code/compaction-probe.md` holds the headless procedure, the
corrected fix number, and the run's result block.

## v7.29.0 — code reviewers write the full report to a file

**Problem.** A whole-branch review loop's controller reads every reviewer
report into its own context window: measured on 19 controllers since v7.9.0,
the returned reports were 27 to 35 percent of the three largest windows, and
the "Checks Run" section was 25 to 30 percent of a report's bytes while the
controller never reads it.

**Change.** A code reviewer now writes its full report to a file created by
`mktemp`, and returns the same report without the Checks Run section, ending
with a `Full report: <path>` line. A failed `mktemp` or refused Write keeps the
section in the message.

**Effect.** About 7 to 10 percent less controller context per loop; the
controller's rules are unchanged. Nothing to migrate.

Worklist row 14 of the local issues log asked for three context fixes in
measured order. This release measured all three first, with
`tools/measure-context.js` on every review-loop controller since v7.9.0 (19
controllers, five runs, no compaction record in any of them: median peak
205,600 tokens, maximum 362,899) and with a scan of the ten code-review audit
logs (28 invocations, 77 rounds, 69 verification cycles).

- **Fix 2, lower M on later rounds, is refuted.** Rounds 2, 3 and 4 carried
  Critical or Important findings in 27 of 27, 9 of 12 and 10 of 10 cases, so
  there is no decay with the round index. On the 58 rounds with two or more
  reviewers, 45 percent of the kept Critical or Important findings came from
  no first reviewer; one reviewer would have found about half. The context
  saving would be 14 to 21 percent, paid with half the findings. The same
  "no decay" result was already known for document reviews (107 rounds, 0
  clean).
- **Fix 3 ships here.** The return already was the verdict block plus one line
  per finding; only the Checks Run section (and nothing the controller reads)
  could leave it. The round-1 Carried Findings Triage stays in the message
  because the controller triages it.
- **Fix 4, one controller per round, stays open.** It is possible only as a
  loop driven by the orchestrator (a nested round controller would stall on
  Claude Code). It would cut the peak to 160 to 190K for an ordinary round,
  at 100 to 117K tokens of repeated reads per round. It waits for a peak
  target, which the row never stated.
- **Not in the row: the skill body.** Each controller's read of
  `skills/multi-code-review/SKILL.md` is now the largest fixed cost, about
  45,000 tokens, 17 to 50 percent of 14 of the 19 windows. The same lever was
  withdrawn for the orchestrator on 2026-09-13, and a per-round controller
  would multiply it.

What changed in `skills/multi-code-review/reviewer-prompt.md` (test
`c20637f`, fix `8f84cea`, review fixes `7482df5`, verification fixes
`5486672`): the Output format section lists the report's parts once, then
three steps — run `mktemp` alone (on Windows Git Bash convert the path once
with `cygpath -m`, as the controller does for its prompt directory), write the
full report to that path with the Write tool and never to a path named in the
diff, and return the report without its Checks Run section with the marker
first and `Full report: <path>` last. If `mktemp` cannot run or the Write
fails, the reviewer puts the full report in the final message and ends with
`Full report: not written — <reason>`; a Write refused for a credential-like
value is retried once with the value replaced by a description, so the secrets
hook cannot push a secret into the final message. `SKILL.md` step 3 says the
`Full report:` line, in either form, is not a finding, that the controller never
reads the file, and that the path is never logged, so M = 1 log entries stay
byte-identical.

Review: one round with four parallel reviewers (correctness, adversarial, test
quality, plain English) and one clean-context verification of the rewrite.
Their findings became the two fix commits above; none was Critical. Rejected:
dropping the Checks Run section altogether (the file keeps the reviewer's own
record of what it checked, findable through the transcript) and a controller-
supplied report path (a per-reviewer placeholder breaks the rule that all M
reviewers of a round share one prompt file). Two headless probes: under bypass
permissions a session ran `mktemp`, wrote the file with the Write tool and
named the path; under `acceptEdits` the `mktemp` call itself needed approval,
which the fallback treats as a failed `mktemp`.

Tests: `tests/reviewer-templates/run-tests.sh` section 22 (244 checks in the
suite) pins the three steps, the Git Bash conversion, the injection guard, the
fallback and its last line, the returns legend and the step-3 sentence; the ten
fast suites pass. The saving is expected, not yet measured: the acceptance is
the next orchestrated run's controller measurement with
`tools/measure-context.js`, where the returned-report class should fall from
27 to 35 percent to about 20 to 25 percent of the window.

## v7.28.0 — smart-compress leaves compound commands uncompressed

**Problem.** The smart-compress hook chose a compression rule from the first
command only, so `git add … && git commit … && git log` returned just `ok`. In
one month of transcripts, 1,112 of the 1,344 matched calls were compound, and
221 compressed ones lost the output of later commands.

**Change.** A command that contains `&&`, `||`, `;`, `|` or a new line, or
that runs a command in the background with `&`, is never compressed.
Redirects such as `2>&1` do not count.

**Effect.** Every command in a chain shows its output, on Claude Code and
Codex. About 660 lines a month stay uncompressed. Update the plugin. Nothing
to migrate.

Terms used below:

- **Compound command:** two or more commands in one Bash call, joined by a
  separator (`&&`, `||`, `;`, `|`, a new line), or a command run in the
  background with `&`.
- **Redirect:** an operator that sends a command's output or input to another
  place, such as `2>&1` (standard error into standard output), `&>file` or
  `<&0`. A redirect does not start a second command.
- **`NEVER_COMPRESS`:** the list of patterns in `hooks/compression-rules.js`.
  A command that matches one pattern is never compressed.

### What was wrong

`hooks/bash-compress-hook.js` tested each rule on the whole command text, and
every rule's pattern starts at the beginning of the text. So the first command
selected the rule, and that rule compressed the combined output of all the
commands. Evidence from 2026-09-16:
`git add … && git commit … && git log --oneline -1 && sed -n …` returned only
`ok` and `[compressed: 17->1 lines | git-add]`. The commit succeeded, but the
`git log` and `sed` output never reached the model.

A measurement over 31,438 Bash calls in 1,854 transcripts (2026-08-15 to
2026-09-16) showed the size of the problem:

- The hook would rewrite 1,344 calls, and 1,112 of them (83%) were compound.
- 119 compressed compound calls had all their output reduced to one line
  (`git-add` 98, `git-commit` 18, `git-fetch` 2, `git-push` 1).
- 82 were cut after the first 30 to 60 lines by `git-log`, `ls-large` or
  `find-large`. The cut part was the output of the later commands.
- Of the 4,913 lines that compression removed from compound calls, about 4,250
  were output the model had asked for. The real saving was about 660 lines.

The Codex PostToolUse adapter (`hooks/codex/posttool-bash-compress-adapter.js`)
chose the rule in the same way, so Codex had the same problem.

### What changed

- In `NEVER_COMPRESS`, the pattern for a pipe into a filter (`| grep`, `| awk`
  and others) is replaced by one pattern for every separator:
  `/[;|\n]|&&|(?<![<>])&(?!>)/`. There are still 9 patterns.
- An `&` after `<` or `>`, or before `>`, is a redirect and is not matched.
- Both the Claude Code hook and the Codex adapter read `NEVER_COMPRESS`, so both
  get the change.
- `docs/architecture/smart-compress.md` and `README.md` describe the new rule.
  The tip "add `| cat` to get raw output" is now true for every command; before,
  `cat` was not in the filter list.

### Verification

- `tests/smart-compress/run-tests.sh`: 107 passed. The seven new pass-through
  tests (`&&`, `||`, `;`, a pipe into `tail`, a new line, `&`, `&<`) failed
  before the fix. Three redirect tests (`2>&1`, `&>file`, `<&0`) check that
  these commands are still compressed.
- `tests/codex/run-unit-tests.sh`: a new test checks that the Codex adapter
  leaves a compound command unchanged; it failed before the fix.
- One review round with four reviewers (correctness, adversarial, test quality,
  documentation). All findings were Minor. The review found that `cmd &<in
  other` runs `cmd` in the background; the pattern now matches it.

### Known limits

- Quotes and escapes are not parsed. A separator inside a quoted string (for
  example `git commit -m "a; b"`), the `\;` of `find -exec` and the `>|`
  redirect also stop compression. This only leaves that output uncompressed.
- A command substitution such as `$(…)` is not a separator. If its inner
  command writes to standard error, that text is mixed into the compressed
  output and can be removed. Agents rarely write such commands.

## v7.27.0 — smart-compress no longer stops long Bash commands

**Problem.** The smart-compress hook ran every matched Bash command through an
optimizer that stopped it at 300 seconds and reported a failure, also in the
background. The optimizer also held all output until the end, so a call that
Claude Code moved to the background showed an empty output file.

**Change.** Background calls are not rewritten. The optimizer has no limit of
its own; at the call's time-out, lowered as Claude Code 2.1.273 lowers it, it
writes raw output. Raw output through a macOS pipe was cut at 65,536 bytes; it
now arrives whole.

**Effect.** Long commands finish and show progress. Update the plugin. Nothing
to migrate.

Terms used below:

- **Optimizer:** `hooks/bash-optimizer.js`. The hook `hooks/bash-compress-hook.js`
  rewrites a matched command into `node bash-optimizer.js <command> <rule>
  [<time-out>]`; the optimizer runs the command and compresses its output.
- **Raw output:** output written unchanged, without compression.
- **Time-out:** the `timeout` field of a Bash tool call, in milliseconds (ms).

### What was wrong

Case 026 (2026-09-16): a behavioural suite started with `git status` in the
background. The optimizer ran it with `spawnSync` and `timeout: 300000`, so the
suite was reported as failed after exactly 300 seconds, although it passed at
389 seconds. The steps after it never ran.

The review of the first fix found a second problem. When a Bash call passes its
time-out, Claude Code does not stop the command: it moves the call to the
background (message: "Command did not complete within its 5s timeout and was
moved to the background"). The optimizer held the output, so that background
output file stayed empty until the command ended, and a watch-mode test command
(for example `npx vitest`) showed no output at all.

### What changed

- `hooks/bash-compress-hook.js` returns `{}` (no rewrite) for a call with
  `run_in_background: true`, and adds the call's `timeout` to the rewritten
  command when it is a number.
- `hooks/bash-optimizer.js` runs the command with `spawn`. It holds output for
  compression until the command ends. When the command is still running at the
  time-out, or holds more than 10 MB (megabytes) of output, it writes the held
  output raw and passes later output through as it arrives.
- The time-out follows the rules read from the Claude Code 2.1.273 binary; they
  are not documented. The default is `BASH_DEFAULT_TIMEOUT_MS` or 120000 ms. The
  maximum is `BASH_MAX_TIMEOUT_MS` or 600000 ms, never below the default.
  `CLAUDE_CODE_AUTO_BACKGROUND_TIMEOUT_MS`, when set, lowers the time-out, never
  below 2000 ms. A switch that comes too early only loses compression.
- Raw output is written with `process.exitCode` instead of `process.exit()`.
  On macOS, `process.exit()` right after a large write to a pipe cut the output
  at 65,536 bytes; this also happened on v7.26.0.
- An error inside the optimizer's `close` callback writes the held output raw.

### Verification

- `tests/smart-compress/run-tests.sh`: 97 passed. Each new test failed before
  its fix: background pass-through, output written at the time-out, the maximum
  and automatic background time-outs, and 200,000 bytes through a pipe.
- A live `claude -p` run with a 5-second time-out: the first line was in the
  background output file about 8 seconds before the command ended.
- Two review rounds (seven reviewers) and one pass that re-ran every
  reproduction.

### Known limits

- If a later Claude Code version changes its time-out rules, the switch to raw
  output can come too late.
- Only the first command of a compound command selects the rule, so
  `git add … && git commit … && sed …` is compressed as `git add`. This is a new
  open row in the local issues log.

## v7.26.0 — correct statements about the context gate and about N = 0

**Problem.** Two statements were false. The subagent-driven-development skill
said the 60% context gate catches mid-session batch starts; it fires on none of
the batched or resume prompts. Three places said `SUPERPOWERS_REVIEW_ROUNDS=0`
would disable plan review; a plan still gets its readiness pass.

**Change.** Both statements are corrected in the skills, the hook comment, the
README, the guide and `docs/FORK-IMPROVEMENTS.md`. Fast tests feed the skills'
real paste prompts to the gate and pin both sentences.

**Effect.** The documents now match the code. Behaviour does not change.
Nothing to migrate.

Terms used below:

- **Context gate:** a check in the prompt-submission hook
  (`hooks/skill-activator.js`). When a prompt matches one of its execution
  patterns and the context window is fuller than a threshold (60% by
  default), it blocks the prompt and asks Claude to save state and compact
  first.
- **Paste prompt:** a prompt that a skill tells the user to copy into a new
  session, for example `Execute the plan at …` or `Resume the plan at …`.
- **Rotating review round:** one round of a review loop, run under one of the
  lenses that change from round to round.
- **Execution readiness pass:** the plan review pass that still runs when N
  is 0 (since v7.14.0).

Details:

- **The gate sentence** (orchestration issue row 30). The skill said "the 60%
  context gate on prompt submission catches mid-session starts". The gate
  runs only when `isExecutionTrigger` matches the prompt. Of the prompts the
  plugin tells users to paste, only the Inline prompt `Execute the plan at …`
  matches; the two Subagent-Driven prompts, the two resume prompts and short
  replies ("subagent", "inline", "go", "yes") do not. The phrase "execute the
  plan in batches" also matches. The skill now says this. Widening the
  patterns was rejected on 2026-09-15 and is not part of this release: without
  the statusline bridge the hook divides by a fixed 200K window, so on a 1M
  window a wider trigger would block at 120K tokens.
- **The N = 0 reason** (row 34). `skills/multi-doc-review/SKILL.md`,
  `hooks/session-start` and `README.md` gave as the reason for refusing
  `SUPERPOWERS_REVIEW_ROUNDS=0` that it would disable "spec review, plan review
  and whole-branch code review". They now say "the plan's rotating review
  rounds", the phrase the guide already used, and add that a plan still gets
  its Execution readiness pass.
- **Tests.** `tests/codex/test-skill-activator.js` reads the paste prompts from
  the writing-plans handoff table and the resume prompts from the SDD skill,
  requires all three table rows and every resume prompt, and checks that only
  the Inline prompt fires the gate. `tests/review-gates/run-tests.sh` section
  17 checks that the wrong reason is absent and the corrected clause is present
  in the skill, the hook comment, the README and the guide.
- **Review.** Four independent reviewers (correctness, adversarial on the
  tests, plain English, code quality). Three Important findings were applied:
  the readiness pass was not stated, and a paste prompt or a resume prompt
  could drop out of the test's extraction while every test still passed. The
  adversarial reviewer also found the same false gate claim in
  `docs/FORK-IMPROVEMENTS.md`.
- **Known limits.** The absence checks match fixed strings, so a paraphrase of
  a false claim (for example "catches a mid-session start") is not detected.

## v7.25.0 — behavioural suites run in an empty work folder

**Problem.** Behavioural suites under `tests/claude-code/` ran `claude -p`
inside the plugin repository. A commit made in the clone during a run failed
checks (e)/(e2), whose message printed a `git reset --hard` that would destroy
that work. Test sessions also read the repository's `CLAUDE.md` and `state.md`.

**Change.** Each `claude` call runs in its own empty work folder through one
helper. (e)/(e2) now test that this folder stays empty. Session transcripts are
written outside the fixture repository.

**Effect.** A slow run of `test-multi-code-review.sh` passed in 389 s while a
commit was made in the clone. Only maintainers who run behavioural suites see
a change. Nothing to migrate.

Terms used below:

- **Behavioural suite:** a test script under `tests/claude-code/` that starts
  the real `claude` command in headless mode (`claude -p`, no interactive
  prompt) and checks what the session did.
- **Work folder:** a new, empty folder made by `mktemp -d` for one `claude -p`
  call. The call uses it as its working directory (the folder a process
  starts in).
- **Fixture repository:** the throwaway git repository that a suite builds
  for the skill under test (`$TEST_PROJECT`).
- **Transcript:** the text output of one `claude -p` session, saved by the
  suite to a file with `tee`.
- **(e)/(e2):** the checks of `test-multi-code-review.sh` and
  `test-multi-doc-review.sh` that fail when a run wrote somewhere it must not
  write. The two research suites have the same check.

Details:

- **The cases** (orchestration issue row 4, Case 004 and the 7.6.0 suite
  run). (e)/(e2) compared the developer's clone before and after the run
  (`HEAD` and `git status`). A review loop that committed in the clone at the
  same time made them fail, and the printed recovery command
  `git reset --hard <sha>` would have removed that loop's commits. In the
  7.6.0 suite run, a fixture session loaded the repository's `CLAUDE.md` and
  added a case about its throwaway fixture to the local issues log. The
  investigation found a third effect of the same cause: the plugin's hooks
  read `state.md`, `session-log.md` and `known-issues.md` from the working
  directory, so every test session received the developer's own files.
- **One call helper** (`tests/claude-code/test-helpers.sh`). The 9 direct
  `claude` calls in 6 suites and the helper `run_claude` (13 calls in 2
  suites) all go through `run_claude_in_workdir`. It runs `claude` inside the
  given work folder in a subshell and returns the exit status of `claude`.
  Every call gets a new folder (`create_claude_workdir`). The two
  `run_claude` suites now give the model an absolute `SKILL_FILE` path.
- **The checks.** (e), (e2) and the checks of the two research suites now
  call `assert_workdir_empty`. It fails when the folder holds any entry, and
  also when the folder is missing or the path is empty. The failure prints a
  listing of the folder. It prints no recovery command: the folder is
  disposable. A commit in the clone no longer affects any check.
  `check_no_superpowers_defaults_setting` now receives the work folder.
- **Safe creation and cleanup.** Review round 1 found that a failed
  `mktemp -d` left the path empty, `cd ""` did not move, and the helper
  printed the caller's own folder. The cleanup would then have removed that
  folder — the whole clone when a suite runs from the repository root. The
  reviewer reproduced this on a scratch copy. Now `create_claude_workdir`
  fails and prints nothing when `mktemp -d` fails, and every caller stops.
  `cleanup_claude_workdir` refuses an empty path, `/`, `$HOME`, the current
  folder and any path inside the plugin repository.
- **Transcripts outside the fixture repository.** This defect already existed
  on `main`. The suites wrote transcripts with `tee` into `$TEST_PROJECT`. The
  untracked file made the fixture's working tree not clean, and the
  multi-code-review skill stopped before its fix step. Slow run 1 on this
  branch failed 4 assertions for this reason (g, h, m, p1). Transcripts now
  go to a separate folder (`create_transcript_dir`). The EXIT trap removes it
  after a success and keeps it, with its path printed, after a failure
  (`finish_transcript_dir`).
- **Static check** (`tests/codex/test-claude-code-workdir.sh`, run by
  `tests/codex/run-unit-tests.sh`, 78 assertions). It rejects a `claude`
  command word outside `test-helpers.sh`, a `tee` of a transcript into
  `$TEST_PROJECT`, and any `reset --hard` under `tests/claude-code/`. It also
  tests the helpers: a failed `mktemp`, a planted file in the work folder,
  the refused cleanup paths, and `run_claude_in_workdir` with a fake
  `claude`.
- **Review.** Three independent reviewers (correctness, adversarial, tests
  and documentation). Two of them found the `mktemp` failure (one rated it
  Critical, one Important). They also found that the first static check
  passed the spellings it was meant to reject (a line break before `-p`,
  `--print`, a call after a closed subshell).
- **Acceptance.** Slow run 2 of `test-multi-code-review.sh` passed in 389 s,
  with a commit made in the plugin clone during the run. Only this one slow
  suite was run. The other 7 changed suites were checked with `bash -n` and
  the static check only.
- **Known limits.** When `GIT_DIR` is set in the environment, the
  `context-engine.js` hook treats the work folder as a git repository and
  writes two files into it, so (e) fails with no skill at fault. Each
  `claude -p` call creates a transcript folder under `~/.claude/projects/`,
  and nothing removes these folders. A write into the clone by absolute path
  is no longer detected by any check; the reviewers judged this unlikely,
  because a test session no longer receives the clone path.

## v7.24.0 — plans test a repository premise instead of asserting it

**Problem.** In three of twelve orchestrated runs, a plan task relied on the
git-ignored `CLAUDE.md` being tracked. Execution stopped or the change did
not ship, and the two later runs each spent one of their three in-run
resumes on a plan ruling. Plan reviewers read that step and did not test it.

**Change.** `writing-plans` tells the plan writer to test each repository
premise with one command (`git ls-files --error-unmatch`, `git check-ignore
-v`, `ls`, `command -v`). The round-1 plan-review lens runs the git commands
and reports a contradiction.

**Effect.** The false premise is caught when the plan is written or
reviewed, not during execution. Update the plugin; nothing to migrate.

Details:

- **The cases** (orchestration issue row 8). `git check-ignore -v CLAUDE.md`
  prints `.gitignore:7` in this repository. 2026-08-30,
  `reviewer-harness-claims`: Task 6 ran `git add CLAUDE.md` and the batch
  stopped `BLOCKED`. 2026-09-05, `prompt-pointer-dispatch`: Task 4 ran the
  same command, ruling 1 spent in-run resume 1 of 3. 2026-09-08,
  `review-gate-m-question`: Task 5 had to convey a line in `CLAUDE.md`; the
  plan review applied two findings on that step without testing whether the
  file is tracked, and the code review then found that the line never ships
  (`[CF4]`, resume 1 of 3).
- **The rule** (`skills/writing-plans/SKILL.md`, Task Rules). A premise is a
  fact about the repository before the plan runs; a file or command an
  earlier task creates is a dependency between tasks, not a premise. The
  writer tests whether git tracks a path (`git ls-files --error-unmatch`),
  whether git ignores it (`git check-ignore -v` prints a rule only for an
  ignored path), whether a file exists and whether a command exists, and
  writes the task from the output and exit status. A task that must edit an
  ignored file leaves it out of its commit step and states that the edit
  does not ship with the branch. The git facts were probed on four file
  states in a scratch repository: `git add` exits 1 only for the ignored,
  untracked file.
- **The reviewer clause** (`skills/multi-doc-review/SKILL.md`, the
  `Correctness & completeness` plan cell). A task that commits a path or
  relies on git tracking or ignoring it: the reviewer runs the command and
  reports the task only when the output contradicts the plan. It sits in the
  round-1 lens, not the `Feasibility & architecture risk` lens, because 7 of
  the 16 committed plan review logs ran N=2 and never reached round 3, while
  all 16 ran round 1. The `Execution readiness` pass was rejected as the
  place: its clause-removal table removes check (5) together with the text
  up to `Coverage, ambiguity, feasibility`, so a check (6) there would be
  removed with it. The file is 1078 lines, under its 1080-line budget.
- **How the item was chosen.** Three lenses (impact, feasibility, skeptic)
  and a rebuttal round; round 2 changed all three votes. Row 8 had two votes,
  rows 4 and 11 merged had one.
- **Review.** Three independent reviewers (evidence fit, adversarial,
  consistency) and one verification round. Round 1 found that
  `git check-ignore` cannot show a tracked path (two reviewers), that the
  rule had no scope, and that the Feasibility lens missed two of the three
  cases. The verification round found that the commit step would still run
  `git add` on the ignored file.
- **Tests.** `tests/writing-plans` gains 6 assertions (21 in total), scoped
  to the Task Rules section; `tests/reviewer-templates` gains 4 (230 in
  total), scoped to the extracted Correctness plan cell through a new
  `extract_plan_cell` helper that the Ambiguity check now shares.
- **Known limits.** A task that a review fix adds after round 1 is checked
  again only when the correctness lens runs again: in round 5 when N is 5 or
  more, and in round 9 when N is 9 or more. A task that an `amend plan` ruling
  adds later in the run is not checked again by a reviewer. No logged run has
  either shape. A git worktree holds no copy of an ignored file, so an edit made
  there is lost with the worktree; the rule does not cover this case.

## v7.23.0 — a `/pickup` skill resumes a handoff or an unfinished orchestrator run

**Problem.** A fresh session had no command to continue work. Nothing
checked whether a handoff (the continuation prompt `/handoff` writes) was
stale, its task already done: the row-26 handoff was followed again after
v7.21.0 shipped that task.

**Change.** A manual `/pickup [handoff path]` skill runs a scan: commits and
uncommitted changes since the handoff (status FRESH, CHECK or UNKNOWN), and
orchestrator runs (autonomous pipeline runs) stopped on unmerged branches,
resumed only after asking. `/handoff` writes a header with time, time zone,
branch and HEAD.

**Effect.** A stale handoff stops before work starts. Restart the CLI
(command-line interface) after updating; nothing to migrate. Older handoffs,
without a header, get a date-based check.

Details:

- **The case that started it.** Only one handoff file existed,
  `tmp/docs/2026-09-14-handoff-row-26-read-cap.md`. Session `62deafa9`
  followed it on 2026-09-14 and shipped row 26 as v7.21.0. Session
  `410da8d6` followed the same file again on 2026-09-15, although VERSION
  was 7.22.0 and row 26 had left the worklist. Both times the user named the
  path, so only a check of the named file itself would have caught it.
- **The skill** (`skills/pickup/SKILL.md`, 80 lines,
  `disable-model-invocation: true`, `argument-hint: "[handoff path]"`).
  Without an argument the candidates are the newest handoff plus every
  unfinished run; with two or more it lists each with the exact line to type
  (`/pickup <path>` with the handoff's status and commit counts, or
  `Resume orchestration for <path>`) and stops, never ranking one against
  the other. Handoff mode reads the handoff whole, tests its `Done when:`
  line, then acts on the status: FRESH → follow it; CHECK → compare the
  commits, the uncommitted changes and the branch with the task, and stop
  when the task looks done or the model is unsure; UNKNOWN → ask. Run mode
  shows the run (last log heading, age of the last commit), asks once,
  and on yes sends exactly `Resume orchestration for <path>` with nothing
  appended; the orchestrator's own Resume step asks for open answers. A
  run whose slug has two logs, or with neither plan nor spec, is reported
  as needing a human look. A path inside `docs/superpowers-orchestrator/`
  is not treated as a handoff: the user is told to type the Resume line.
  Text that is not a path (for example `with N_code=1 M=1`) is never sent to
  the orchestrator; the user is told to type it after the Resume line.
- **The scan** (`skills/pickup/scripts/pickup-scan.js`, Node.js 16 or later,
  no dependencies, git called with argument arrays and no shell, exit
  status 0 on every normal outcome). It prints `key: value` lines. Two
  commit lists: `commits-self`, every commit on HEAD after the handoff's
  head, merges included and whatever its date; `commits-other`, commits on
  other local branches made after the handoff's written time (passed to
  `--since` with its time-zone offset). `dirty` counts uncommitted changes,
  leaving out `tmp/docs`, `state.md` and `session-log.md`, which `/handoff`
  itself writes. FRESH needs both lists empty, a clean tree and the same
  branch; CHECK is any of those; UNKNOWN is no git work tree, no commit, or
  no head and no date. When the head is not in the repository, the window
  starts at 00:00 of the handoff date (a bare `--since=<date>` means that
  date at the current time of day: 0 against 17 commits measured). The
  header is validated (a commit id of 7-40 hex characters, a real date and
  time, an offset from -1200 to +1400). Runs: local `feature/*` branches
  not merged into the LOCAL default branch (origin/HEAD's local branch,
  else `main`, else `master`), with the log
  `<date>-<slug>/<slug>-orchestration-log.md` read from the branch, not the
  working tree; a single completed log is skipped; the resume path is the
  plan, else the spec.
- **The `/handoff` change** (`skills/handoff/SKILL.md`). The file's first
  line is now
  `Handoff: written=<YYYY-MM-DD>T<HH:MM><+hhmm> branch=<name|none> head=<short sha|none>`,
  from `date +%FT%H:%M%z` and the git lines; an optional second line
  `Done when: <one checkable condition>` covers a task that a commit may
  not show. A failing inline `!` command cancels the whole skill with zero
  turns (probed with `claude -p`), so `/handoff` used to abort outside git
  and in a repository with no commit. The branch and HEAD lines now end in
  `2>/dev/null || echo none`, and the branch line pipes through `grep .`
  so a detached HEAD prints `none` instead of an empty value.
- **No `hooks/skill-rules.json` entry.** The skill is manual only, and it
  can start work that another session is already doing, so an automatic
  hint has no use: a hint to a manual-only skill turns into "ask the user
  to type /pickup" (probed). Its natural words are also owned already:
  "pick up later" by context-management, "resume the plan" by
  subagent-driven-development, "resume orchestration" by
  orchestrating-development. The rule count stays 27.
- **How it was designed.** Five independent lenses (design, evidence,
  implementation, adversarial, premise) plus a rebuttal round, then the
  user's decisions; fixture tests first; a red-team, a code review and a
  behaviour walk-through, whose findings were fixed in round 1; one
  verification round (a second red-team and behaviour pass), fixed in
  round 2. The reports live under `tmp/docs/`, which is local and
  untracked.
- **Tests.** `tests/pickup/run-tests.sh` is new: fixture git repositories
  under `mktemp -d` with the user's git configuration switched off, 198
  assertions. It includes the four failure shapes of the first prototype
  (no HEAD comparison, a bare `--since` date, `commits: 0` outside git,
  origin/main as the merge base). All eleven fast suites are green: pickup
  198, orchestrating-development 212, reviewer-templates 226,
  measure-context 143, in-run-rulings 545, review-gates 134, writing-plans
  15, smart-compress 87, fill-prompt 166, sdd-scripts 193, and the 11 codex
  suites. Commits `028f38c`, `89d218c`, `36d3cc7`, `e14825f`, `19810b9`,
  `903b0bf`, `87c8587`.
- **Known limits.** Work that exists only on a fetched remote branch, or
  only on a detached HEAD in another linked worktree, is not listed. The
  `--source` label on a commit names the ref the walk came from, not the
  branch where the commit was made. A handoff with no header, written later
  on the same day, can sort behind an earlier one that has a header.
  `Done when:` is judged by the model; the scan only prints it. Delivery
  of the argument on Copilot CLI is untested, because Copilot is not
  installed on the test machine. A `written=` time later than the reading
  machine's clock (a wrong clock or a hand-edited header) still gives FRESH
  when the new work exists only on another branch; work reachable from HEAD
  is always listed.
- **Reinstall.** Nothing to migrate. Restart the CLI after updating the
  plugin: sessions read the installed copy under `~/.claude/plugins/cache/`.
  Handoffs written before this release have no header line; `/pickup` gives
  them the date-based check (commits since 00:00 of the file-name date).

## v7.22.0 — batch controllers read and fill the worker templates

**Problem.** On the `execution-readiness-pass` run, one batch controller of
six wrote its implementer prompt from scratch and never opened
`implementer-prompt.md`. Its implementer got none of the template's
escalation rules, self-review checklist or report sections. The batch
template named the two worker templates without a verb, and the
implementer step of the subagent-driven-development (SDD) skill named no
template.

**Change.** The batch template now says: Read each worker template whole
before its first dispatch; every worker prompt IS the template with only
its placeholders filled. The SDD implementer step names its template. The
measuring tool lists every file received whole.

**Effect.** A skipped template is now visible as a missing line in the
report. Reinstall the plugin; nothing to migrate.

Details:

- **The finding.** Worklist row 28 of the issues log. On the
  `execution-readiness-pass` run (plugin 7.13.0), batch controller 4 of 6
  composed its implementer prompt from scratch. Its transcript holds no
  read of `implementer-prompt.md`; it opened only
  `task-reviewer-prompt.md`, the one template its skill step named. The
  sonnet implementer of task 10 therefore received none of the template's
  escalation rules (permission to stop, the STOP triggers, the meaning of
  each status word), none of its self-review checklist, not the rule to
  re-test after findings, and not the report sections that carry the
  test-driven-development evidence. Task 10 still passed its review
  clean, so no defect is traced to the free-form prompt. The other five
  batch controllers of the two measured runs opened both templates with
  `cat`; four of the five did so on the verb-less fragment alone. Status
  of the row: risk without observed harm.
- **The three causes.** A five-lens deliberation with a rebuttal round
  converged on them without dissent. First, `batch-controller-prompt.md`
  named the two worker templates in a fragment with no verb ("Worker
  templates: X and Y."), so the v7.21.0 hand-over paragraph, which covers
  every file the prompt tells the controller to read, did not cover them.
  Second, the per-task flow of `subagent-driven-development/SKILL.md`
  named `./task-reviewer-prompt.md` in its reviewer step but no template
  in its implementer step; batch 4 opened exactly the template its step
  named. Third, the SDD section "## Prompt Templates", the only text that
  says "Use: ./implementer-prompt.md", was absent from the list of
  sections the batch template tells its controller to follow while
  "skipping all others".
- **The batch controller template** (commit `e4c8d09`). The fragment
  became: "Worker templates: [IMPLEMENTER_PROMPT_PATH] and
  [TASK_REVIEWER_PROMPT_PATH] — Read each one whole before its first
  dispatch. Every implementer prompt IS the implementer template with
  ONLY its placeholders filled, and every task-reviewer prompt IS the
  task-reviewer template with ONLY its placeholders filled; the five
  items "File Handoffs" lists for a dispatch go into the template's
  Context block and its brief-file and report-file placeholders, never
  into a prompt composed from scratch." The section list gained "Prompt
  Templates" after "Hard Rules". The verb "Read" places both templates
  under the v7.21.0 hand-over paragraph: Read tool, page on the PARTIAL
  notice.
- **The SDD skill** (same commit). Line 68, the implementer step, now
  reads "dispatch the implementer (`./implementer-prompt.md`) with the
  brief path, a report-file path (`task-N-report.md` beside the brief),
  and an explicit model", the same shape line 71 already used for the
  reviewer template.
- **The measuring tool** (same commit). `tools/measure-context.js` prints,
  under the existing line "Files fully received in one call: N", one
  indented line per file received whole. A file the controller never
  opened cannot appear there, so a `grep` of the report for a template
  path answers whether that controller opened it.
- **Tests** (commit `fd508c2`). `tests/orchestrating-development/run-tests.sh`
  gains section 5d with 4 assertions: "Prompt Templates" is in the section
  list, the instruction carries "Read each one whole before its first
  dispatch", and both "IS the ... template with ONLY its placeholders
  filled" sentences are present. `tests/reviewer-templates/run-tests.sh`
  gains section 20 with 2 assertions: the SDD implementer step and reviewer
  step each name their template. `tests/measure-context/run-tests.sh` gains
  2 assertions and an `assert_file_has_line` helper for the printed list.
  All ten fast suites are green: orchestrating-development 212,
  reviewer-templates 226, measure-context 143, in-run-rulings 545,
  review-gates 134, writing-plans 15, smart-compress 87, fill-prompt 166,
  sdd-scripts 193, and the 11 codex suites.
- **Rejected.** The row's own proposal, a "checked step" plus an
  expected-file table with controller-kind classification inside
  `measure-context.js`: no observer exists at run time, and the table
  would bind the tool to the naming of dispatch files. Filling the worker
  templates through `scripts/fill-prompt.js` as `multi-code-review` does:
  `implementer-prompt.md` carries informal tokens (`Task N`,
  `[task name]`, `[directory]`) the script does not fill, and the
  pointer's "read nothing else there" sentence collides with the brief's
  directory. An `--expect <path>` option on the tool: the same signal as
  the printed list for 25 more lines. Closing the row: its reopen
  condition, a defect traced to a free-form prompt, cannot be observed in
  any log.
- **Side finding.** SDD ships no template for a fix subagent, so every
  fix prompt is free-form (10 on the measured run). Recorded as a new
  worklist row; not part of this release.
- **Acceptance.** The fast suites accept the wording. Delivery is
  accepted on the next orchestrated run: every batch controller's
  measure-context report lists both worker templates under the files
  received whole. The row reopens on a report where one is missing.
- **Reinstall.** Nothing to migrate. Reinstall the plugin before any
  behavioural run: sessions read the installed copy under
  `~/.claude/plugins/cache/`, not this repository.

## v7.21.0 — subagents read every hand-over file whole, with the Read tool

**Problem.** The Read tool returns about 25,000 tokens per call and prints a
PARTIAL notice; a Bash `cat` above 30,000 characters returns a 2 KB preview.
No subagent prompt named the tool or a paging rule. On the two measured
runs all 21 controllers opened their skill body with `cat`, and 10 of them
received only part of it.

**Change.** Seven prompt files share one paragraph: open every file the
prompt tells you to read with the Read tool, never `cat`, and page on the
PARTIAL notice until it stops. The measuring tool reports per-file line
coverage.

**Effect.** Delivery is now measurable on the next real run. Reinstall the
plugin; nothing to migrate.

Details:

- **The finding, corrected.** Worklist row 26 said that on the
  `execution-readiness-pass` run 7 of 14 partial plan reads showed no
  follow-up. That was a miscount. Re-measured on the same two runs
  (`marker-position-tolerance` and `execution-readiness-pass`): 22 partial
  Read views, 21 by reviewers and 1 by a code-review controller, and all 22
  paged to the end of the file, 11 by a further Read with `offset` and 11
  by Bash `sed -n`. One reviewer skipped diff lines 547 to 864 on purpose.
  No wrong output was traced to a partial read.
- **The controller route.** All 21 controllers of the two runs opened their
  skill body with Bash `cat`, as bypass mode tells them to. Nineteen of
  those outputs exceeded the 30,000-character Bash cap and came back as a
  2 KB preview (37 to 46 lines) with the rest saved to a file; the two
  others were under the cap. Eleven controllers then received the whole
  body, by one Read of the saved file or by a sweep of adjacent `sed`
  ranges. Ten received 67.6 to 96.2 percent: each took a heading outline
  with `grep -n '^#'` and read the sections it judged relevant. Four of
  the ten code-review controllers never received `## Error Handling`. No
  error occurred in any of those sessions, so the harm is untested, not
  absent. Status of the row at closure: risk without observed harm.
- **Why the sentence names the tool.** The same eleven controllers of the
  `execution-readiness-pass` run received two hand-over sentences. The
  pointer sentence for the dispatch file, "Read that file once, with the
  Read tool", was obeyed 11 of 11 times: one Read call, no `cat`. The bare
  "Read [SKILL_PATH]" for the skill body was obeyed 0 of 11 times: every
  controller used `cat`. Same agents, same bypass-mode instruction, two
  outcomes. An explicit tool name wins over the harness preference for
  shell commands; a bare verb does not. Five independent lenses and a
  rebuttal round converged on this measure (issues-log Case 017 Follow-up
  of 2026-09-15).
- **The measure.** Seven prompt files gain, directly after their hand-over
  sentence and inside the `prompt: |` block the fill script copies, one
  identical paragraph: open every file this prompt tells you to read with
  the Read tool, not with a shell command such as `cat`, even when the
  session prefers shell commands; Bash output is cut at 30,000 characters
  and a file that size comes back as a 2 KB preview; one Read call returns
  about 25,000 tokens at most and then prints a PARTIAL notice naming the
  next `offset` and a `limit`; Read again with those values, halving the
  limit when a call is refused for size, until a result carries no PARTIAL
  notice; each section the prompt names is read whole; a file the prompt
  only passes on by path, or takes one block from, is not read whole (find
  the block with `grep -n` and Read it with offset and limit); on a
  platform without the Read tool, use the tool that pages by offset; never
  act from a first page or a preview alone. The hand-over sentences
  themselves now say "with the Read tool" and, where the whole file is
  meant, "whole": the four controller templates of
  `orchestrating-development` (`plan-writer-prompt.md`,
  `doc-review-loop-prompt.md`, `batch-controller-prompt.md`,
  `code-review-loop-prompt.md`), the two diff reviewer templates
  (`multi-code-review/reviewer-prompt.md`,
  `subagent-driven-development/task-reviewer-prompt.md`), where "Read the
  diff file once" becomes "Read the diff file whole, with the Read tool",
  and the document reviewer template (`multi-doc-review/reviewer-prompt.md`),
  whose `Document:` line now says "(read it whole, with the Read tool)".
  The batch controller's section list is unchanged: it is told to read the
  named sections whole, not the whole skill. The wording shipped in four
  commits: `a2c8c48`, `d7650c9`, `bb0fba6` and `b4bfb8a`; the last two came
  from a review round, which widened the paragraph from "every file this
  prompt names" to "every file this prompt tells you to read", added the
  exit on a size refusal, and exempted files the prompt only passes on by
  path.
- **The scope sentence.** `batch-controller-prompt.md` and
  `code-review-loop-prompt.md` carry a rule that caps background command
  output. One sentence after it now says that the rule governs the output
  files of background commands only, and that the files the prompt tells
  the controller to read are read whole.
- **Script comments.** The header comments of
  `subagent-driven-development/scripts/task-brief` and
  `scripts/review-package` said the implementer or reviewer "reads in one
  call"; both now say "reads whole".
- **Tests.** `tests/reviewer-templates/run-tests.sh` pins the paragraph in
  the three reviewer templates through four needles ("with the Read tool,
  not with a shell command", "until a result carries no PARTIAL notice",
  "halving the limit when a call is refused for size", "A file you only
  pass on by path") and asserts that "Read the diff file once" is gone
  from the two diff templates; the suite now runs 224 assertions.
  `tests/orchestrating-development/run-tests.sh` pins the same needles in
  the four controller templates and the scope sentence in the batch and
  code-review-loop templates only; the suite now runs 208 assertions.
- **The measuring tool (row 27).** `tools/measure-context.js` gains what
  the acceptance measure needs (commits a9d1064, 2aa8ae3, 4b26b67, 7b06cb6). A "File coverage"
  section prints one line per file whose first read was cut: the route of
  the first read, the total line count, the line ranges received, the
  coverage percentage, the uncovered ranges and the last line reached. A
  "PARTIAL notices" summary line gives the count of notices and how many
  were paged to the end, paged short, not paged, or raised on a persisted
  output file. A "Model-visible shares" table stands beside the unchanged
  shares table, so every share can also be read as a share of what the
  model actually saw. A "Skill body" line gives the tokens the Skill calls
  injected, plus the count of reads under `/skills/`.
  `tests/measure-context/run-tests.sh` covers the new output
  (141 assertions).
- **Acceptance.** The fast suites accept the wording. Delivery is accepted
  by the coverage counter on the next real orchestrated run: the row
  reopens on a PARTIAL notice with no paged follow-up, or on a controller
  whose coverage of the sections its prompt names is below 100 percent.
- **Reinstall.** Nothing to migrate. Reinstall the plugin before any
  behavioural run: sessions read the installed copy under
  `~/.claude/plugins/cache/`, not this repository.

## v7.20.0 — a `/handoff` skill writes the prompt for a fresh session

**Problem.** Clearing the context window mid-work meant writing the
continuation prompt by hand each time, and a prompt written from memory
drops the facts, decisions and conventions the session had established.

**Change.** A new manual-only skill, `/handoff [slug]`, collects those from
the files the session left behind (`state.md`, `session-log.md`, the
previous handoff, `CLAUDE.md`), writes
`tmp/docs/<date>-handoff-<slug>.md` in a fixed four-part shape, saves state
through `context-management`, and prints the prompt to copy.

**Effect.** One command before `/clear`, and the next session starts from
the same facts. Reinstall the plugin; nothing to migrate.

Details:

- **The skill.** `skills/handoff/SKILL.md`, `disable-model-invocation: true`
  so Claude never triggers it on its own. Today's date, the branch, the
  HEAD and the number of uncommitted files enter by inline shell
  substitution, never from memory. Every fact source is optional, so the
  skill runs in any project; `tmp/docs/` is created under the project root
  when missing, and the reply says whether it is gitignored.
- **The prompt's shape.** An opening paragraph (task, file and line,
  branch, version, tree state); "What is already known (do not re-derive)"
  with every figure sourced to a transcript id or file:line; "How to
  proceed" as numbered steps naming the design step, the user's decision
  point, the delivery shape and every fast suite; "Conventions that bit
  us", carried forward from the previous handoff; closing reminders
  (uncommitted files, running agents, a CLI restart owed, untracked files).
  This is the shape that carried the three worklist rows of 2026-09-13
  across sessions.
- **Routing.** `hooks/skill-rules.json` gains a `handoff` rule (27 rules,
  26 skills): keywords such as "clear the context", "fresh session",
  "continuation prompt", and intent patterns for "clear the context
  window" and "continue the work in a fresh session", so the activator
  hint names the skill when the user asks in their own words.
- **Docs.** The README skill list and the guide's memory-file table name
  the skill and the handoff file.

## v7.19.0 — the orchestrator recovers its skill text after a compaction

**Problem.** After an auto-compaction Claude Code re-attaches only the first
5,000 tokens of a skill: for the 55,000-token orchestrator skill, the
dispatch rules and nothing else. A compacted session held no ruling rule
and no sentence telling it to recover.

**Change.** A recovery paragraph at the top of the orchestrator skill makes a
session that opens on a compaction summary re-read the section it is
executing by paged Read, then run the incomplete-ruling scan. The
secrets-hook probe paragraph moves into the surviving prefix, and two wrong
sentences about the Read tool's limit are corrected.

**Effect.** A compacted orchestrator can recover its procedure; the manual
probe in `tests/claude-code/compaction-probe.md` is still owed. Reinstall
the plugin; nothing else to migrate.

Details:

- **Why this and not a smaller skill.** Worklist row 13 asked for a scribe
  subagent, then for a split of the skill body. A measure with
  `tools/measure-context.js` on the four orchestrator transcripts of the two
  most recent runs refuted both: all log writing is under a tenth of the
  window; the skill body is 13.6 to 18.6 percent of peak, but every session
  rules, so moving the rulings text to an on-demand file saves nothing, and
  one Read call pages near 25,000 tokens in any case. No session compacted
  on the 1M window; on the 200K default window each would have, one to
  three times. Five independent lenses and a rebuttal round converged on
  this guard as the only change the measure supports (issues-log Case 017
  Follow-ups of 2026-09-13).
- **The paragraph.** `## Required Start` of
  `skills/orchestrating-development/SKILL.md`, lines 35 to 52: defines a
  compaction summary, says why the paragraph sits at the top, names the four
  sections a session may be executing, prescribes `grep -n '^## '` for the
  section bounds and a Read with `offset` and `limit` paged on the PARTIAL
  notice, then Resume step 1's incomplete-ruling scan before any controller
  return is acted on.
- **The probe paragraph.** The secrets-hook probe is now the last paragraph
  of `## Controller Dispatch Rules` (lines 245 to 299), unchanged in wording
  except that its two "table above" references now name the Major-Error
  Stop Policy's table, which sits below it. No `##` heading moved.
- **Read cap sentences.** `skills/multi-code-review/SKILL.md` (the prompt-file
  cap rationale) and `skills/token-efficiency/SKILL.md` item 6 now state the
  token cap and the PARTIAL notice. The cap already cuts subagent views of
  the plan and the diff package on real runs; that is worklist row 26, not
  changed here.
- **Tests.** `tests/orchestrating-development/run-tests.sh` gains a Required
  Start range, pins the recovery paragraph's sentences and its position at
  or before line 60, and retargets the probe assertions to the Dispatch
  Rules range with a negative on the old range (184 assertions);
  `tests/reviewer-templates/run-tests.sh` item 18 pins both corrected Read
  sentences (207 assertions).
- **The probe.** `tests/claude-code/compaction-probe.md` is a manual
  checklist: run an orchestration to Phase 4 with one ruling, `/compact`,
  observe the next controller return; pass and fail criteria; what to
  record. Row 13 closes when its result is recorded.

## v7.18.0 — the decisions addendum's re-review gets a heading and a fix cycle

**Problem.** After a `fix it` ruling, the code-review controller ran one
verification re-review with no heading of its own, no budget and no fix
cycle. Three controllers behaved three ways under that text; two labelled
every new Important `unresolved: verification cap` and sent it up, one
orchestrator return per fixable item (issues-log Cases 007 to 024).

**Change.** The re-review is logged as `## Round <i> addendum <n> re-review
<c>`, runs at this controller's M, and when a Critical/Important stands
after it, one more fix subagent and re-review 2 follow. What still stands
is `unresolved: addendum re-review`.

**Effect.** A fixable leftover closes inside the loop, bounded at two
fixes and two re-reviews per addendum. Reinstall the plugin; nothing else
to migrate.

Details:

- **The rule.** After the Loop in `skills/multi-code-review/SKILL.md`:
  the addendum heading `### Post-loop addendum <n> — <date>` carries the
  log's addendum ordinal; the re-review entry has the fields of a round,
  reviews the regenerated package at this controller's M, and its
  `**Reviewers:**` line ends `— verifies <sha>`, the fix commit it
  reviews. It is never a `## Round <i> verification <c>` entry, so step 6's
  cycle cap and the next-round index ignore it. A re-review is clean when
  no Critical/Important stands after triage; a clean re-review ends the
  addendum. A retry after a lost return never re-runs a re-review whose
  heading stands, and never re-dispatches a fix whose commit is recorded.
- **Side rules.** Step 6's "same M" sentence now binds in-loop cycles
  only. The prompt-file table gains a reviewer row for the addendum
  (`addendum-<n>-cycle-<c>-reviewer.md`); the second fix of one addendum
  takes the next fix counter. The canonical disposition list names the
  three `unresolved:` reasons. The controller template's Deviation 5 and
  the orchestrator's answer-line rule name the addendum re-review, so an
  answer can say which entry its item came from.
- **Why one extra cycle.** On the execution-readiness run every addendum
  re-review verified its fix clean and raised a new Important on text the
  fix did not touch; seven of seven orchestrator or user answers on such
  items were `fix it`. Under this rule that run closes at return 4 instead
  of 6 with the same fix and reviewer work. A third cycle was rejected:
  measured across 30 invocations, the third in-loop cycle almost never
  closes anything. A fix-scoped re-review was rejected because it would
  change what "reviewed" means at Phase 5.
- **Explained.** The two cycle overruns the 2026-09-07 measurement called
  unexplained (cycle 7 on `reviewer-harness-claims`, cycle 5 on
  `plan-contracts-not-bodies`) were addendum re-reviews numbered as the
  round's series.
- **Tests.** `tests/in-run-rulings/run-tests.sh` section 8b pins the two
  headings, the M source, the `verifies <sha>` suffix, the bound, the
  label in the rule and in the canonical list, the prompt-table row, the
  template's Deviation 5 and the orchestrator's answer clause, and asserts
  the old undefined form is gone (545 assertions).
- **Issues log.** Worklist row 25 is closed; Cases 007, 008, 010 and 024
  carry a Follow-up.

## v7.17.0 — the in-run resume cap counts plan rulings

**Problem.** The in-run resume cap counted every open return of a phase,
whatever the ruling answered. A run whose four returns were all `fix it`
on leftovers of spent verification cycles was stopped and escalated as
`chain` (issues-log Case 024), though the orchestrator had ruled on nothing.

**Change.** A `## RULING` entry consumes a resume (`<r> of 3`) only when it
is a plan ruling: an `Items:` answer begins `amend plan` or `plan governs`.
A fix-only entry does not. Every entry still counts on a total ceiling,
`return <t> of 6`, on the same line.

**Effect.** Fix-only returns continue to the sixth; plan rulings stop at
the fourth as before. Reinstall the plugin; nothing else to migrate.

Details:

- **The rule.** The `**The cap.**` paragraph of
  `skills/orchestrating-development/SKILL.md` defines *plan ruling* and
  *fix-only entry* and the two figures. The `Re-dispatch:` line of the
  `## RULING` template reads `phase <p>, in-run resume <r> of 3, return
  <t> of 6`; both figures include the entry being written; a fix-only entry
  repeats the current `<r>` and advances `<t>` only. The stop is the return
  that would write `4 of 3` or `return 7 of 6`; anchors (latest first
  `_Invocation` line, latest `## STOPPED` entry) are unchanged, and so is
  Resume step 3's rebuild of a missing `## STOPPED` entry.
- **Why plan rulings.** On the two recorded stops, every `amend plan`
  ruling forced a whole new review invocation, while a `fix it` ruling
  re-dispatched as one verification cycle. Case 023's returns 1 to 3 each
  carried `amend plan`, so the new count reproduces its stop at return 4,
  including the one item the user overturned with `amend plan`. Case 024's
  returns 2 to 6 were all `fix it`, so the run closes at return 6 with no
  stop. No run that the old cap let through stops earlier.
- **How it was chosen.** Five independent perspectives (loop safety, plan
  author, implementer, cost, root cause) evaluated six candidate measures
  item by item against the five escalated items of Cases 023 and 024, then
  a rebuttal round changed four of five votes to this measure. Rejected:
  severity ceilings (every open item was Important), self-written-wording
  and anchor-reset rules (unbounded on a wording flip), fix-count trends
  and per-item repeat caps (no such field or identity in the log).
- **Tests.** `tests/in-run-rulings/run-tests.sh` pins the new template
  line in both places, the plan-ruling definition, the fix-only sentence,
  the two stop figures and the counter base, and asserts that the old
  undifferentiated count is gone (527 assertions).
- **Issues log.** Worklist row 17 is closed. The deliberation also found
  the source of Case 024's leftovers in `multi-code-review`: the decisions
  addendum's verification re-review runs outside the three-cycle rule with
  no fix cycle after it. That is filed as worklist row 25, not changed
  here.

## v7.16.0 — a plan review's spec deviation reaches the user

**Problem.** A plan review may leave the plan contradicting the spec on
purpose, as when a size budget the spec names cannot hold the review's
corrections. Nothing carried that decision to the user: on one run it
arrived only through `state.md`, a file every orchestrated run treats as
losable (issues-log Case 025).

**Change.** The review controller writes one fixed `- spec deviation:`
line under the change that made it, its completion report always carries
a `Spec deviations:` line, and the Phase 5 report lists every such line.

**Effect.** The decision to amend the spec or the plan is put to you at
completion. Reinstall the plugin; nothing else to migrate.

Details:

- **The line.** Procedure step 3 of `skills/multi-doc-review/SKILL.md`:
  when an applied finding or an inline self-review fix leaves the plan
  stating something the spec states differently, the controller writes,
  directly below the disposition or note that made it and at column 1,
  `- spec deviation: <what the plan now says> — spec: <what the spec
  says> (<spec path>) — <why kept>`. That line is the durable record and
  the only carrier; a prose remark such as "flag this to the user" never
  replaces it. The line takes no source annotation.
- **The report.** The completion report carries `Spec deviations:` with
  one item per such line, marked `(round <i>)` or `(self-review)`, or
  `Spec deviations: none`. Like `Harness probes owed:`, the line is
  always written and a report without it is defective.
- **The scan.** Phase 5 step 3 of `skills/orchestrating-development/SKILL.md`
  lists every `- spec deviation:` line of the plan-review log verbatim
  with its log path, or `none`, beside the owed probes and the readiness
  conflicts. The read allowance under In-run rulings names the shape, so
  the scan reads nothing else from that log.
- **Size budget.** The doc-review skill stood at 1079 of its 1080-line
  budget. The 17 added lines were recovered by reflowing Procedure step 3
  and the touched paragraphs at 88 columns, a width the file already used
  on 132 lines; a word-level diff shows whitespace-only changes there.
  The file stands at 1075 lines.
- **Tests and guide.** Six wording assertions across
  `tests/reviewer-templates`, `tests/orchestrating-development` and
  `tests/in-run-rulings`; the guide's harness-probe paragraph explains the
  new line. Closes worklist row 23 of `docs/orchestration-issues.md`.

## v7.15.0 — a stop's resume prompt carries its answer slots

**Problem.** A `## STOPPED` entry's `Resume:` line named the plan path
only, so sending it back answered none of the open items and the run
stopped again on the same question. The stop report could also offer an
answer the review loop refuses, such as a bare `fix it` against binding
plan text. Each cost one human round trip (issues-log Cases 023 and 024).

**Change.** The `Resume:` line ends with one `[<id>]: <answer>` slot per
open item. The stop report prints it with each slot filled by the
recommended answer, and offers only options the loop accepts.

**Effect.** One resume answers a stop. Reinstall the plugin; nothing
else to migrate.

Details:

- **The `Resume:` line.** The `## STOPPED` template in
  `skills/orchestrating-development/SKILL.md` writes
  `Resume orchestration for <plan path> [<id>]: <answer>; [<id>]: <answer>`,
  one slot per `Open:` line in the entry's order. A stop with no open
  item carries no slot. Resume step 3 already read answers by id, so the
  reading side is unchanged.
- **Reporting the stop.** A new paragraph of the Major-Error Stop Policy:
  print the `Resume:` line as the text to send back, every slot filled
  with the recommended answer, and the other options beside it. A
  recommendation that names a parameter override alone answers no open
  id and is named as the shape that produces a no-work resume.
- **Only acceptable options.** Every offered option must pass the
  self-check the orchestrator applies to its own answer lines. For an
  item whose clause names binding text under the plan's `**Body
  authority:**` note, the offer is `plan governs`, `amend plan: …; fix
  it: …` or a further escalation, never a bare `fix it` and never
  `accept`; on a Critical, never `accept` and never `plan governs`.
- **Tests and guide.** Six wording assertions in
  `tests/in-run-rulings/run-tests.sh` pin the template line, the slot
  rule and the four sentences of the new paragraph. The guide's stop and
  resume paragraphs describe the slots and the option rule.
- **Worklist.** Closes rows 19 and 24 of `docs/orchestration-issues.md`.

## v7.14.0 — the Execution readiness pass

**Problem.** Conflicts findable from the plan and the spec alone reached the
pre-flight plan read, after four review rounds had passed. One run of
2026-09-09 lost about 48 minutes to three pre-flight blocks before Task 1
began.

**Change.** The plan review gate now runs an Execution readiness pass —
five numbered conflict checks, including a sweep of every site each Global
Constraints entry binds — before the rotating rounds and after them, each
repeated until a pass changes nothing. `N_plan = 0` no longer skips Phase 2.

**Effect.** Decidable plan conflicts are fixed at the gate; the pre-flight
read stays as the net. Reinstall the plugin before the next run.

Details:

- **The lens cell.** `skills/multi-doc-review/SKILL.md` gains an
  `Execution readiness` cell with five numbered checks: tasks that
  contradict each other or a Global Constraint; anything the plan mandates
  that the review rubric treats as a defect; a task clause that contradicts
  the spec section it traces to; a mandated body that breaks its own task's
  contract; and, per Global Constraints entry, every site the entry binds.
  The sweep must end in a `coverage: GC<k> — <n> sites checked` line per
  entry — a report without it is unusable and is retried once, so a missing
  sweep can never settle a sequence.
- **The sequences.** A pre-sequence runs before rotating round 1 and a
  post-sequence after the last rotating round. Each runs at most three
  passes and ends at its first *settled* pass — one that applied no Critical
  and no Important finding with all M reviewers usable. Readiness passes are
  not counted in N and are not part of the two-consecutive-clean-rounds
  streak. The host self-review stays last, after the post-sequence.
- **Triage.** Both sides of a conflict are quoted from their files before
  any disposition. Fixed text — the spec, a spec-traced Global Constraints
  entry, an externally pinned `**Exact content:**` body, a `**Contract:**`
  invariant restating an external standard — is never amended; plan text is.
  A conflict nothing decides, and a defect the plan itself mandates, are
  rejected with a reason and listed in the log's `Owed:` block. A readiness
  finding never produces an `unresolved:` line, so no new human stop is
  created.
- **`N_plan = 0`.** Phase 2 now dispatches its controller for every value of
  `N_plan`; with 0 the controller runs the readiness pre-sequence, no
  rotating round, and returns `rounds=0 outcome=cap unresolved=0`. A
  `skipped (N_plan=0)` line written by an earlier release still means
  Phase 2 is complete.
- **Logs.** A readiness pass is written under `## Readiness <pre|post> <p>`
  with a `**Result:** <settled|open>` line, never under `## Round`, so a
  session running an older installed copy counts fewer rounds and
  re-reviews rather than skipping rounds.
- **Cost.** 2 to 6 further passes of M reviewers on top of N × M (1 to 3
  when N is 0), before retries. Where the platform cannot dispatch in
  parallel, the reviewers of a pass run one after another.

## v7.13.0 — the `<superpowers-defaults>` session block

**Problem.** Only M, reviewers per lens, could be set from the environment.
N, the number of review rounds, and the batch task cap had none, and each new
parameter cost its own tag, its own anti-injection rule, and a wording block
copied into every consuming skill.

**Change.** `hooks/session-start` now emits one `<superpowers-defaults>` block
carrying `reviewers-per-lens`, `review-rounds` and `batch-task-cap`, set by
`SUPERPOWERS_REVIEWERS_PER_LENS`, `SUPERPOWERS_REVIEW_ROUNDS` and
`SUPERPOWERS_BATCH_TASK_CAP`. One resolution rule, defined once in
`skills/multi-doc-review/SKILL.md`, replaces four copies of the old tag rule.

**Effect.** You can now set the review-round count and the batch size the way
you already set M. Nothing to migrate: `SUPERPOWERS_REVIEWERS_PER_LENS` keeps
its name and meaning. Restart the CLI after updating the plugin.

Details:

- **The parameter table.** `reviewers-per-lens` (env
  `SUPERPOWERS_REVIEWERS_PER_LENS`, accepts `1`–`5`, hardcoded default `1`);
  `review-rounds` (env `SUPERPOWERS_REVIEW_ROUNDS`, accepts `1`–`10`,
  hardcoded default `3`); `batch-task-cap` (env `SUPERPOWERS_BATCH_TASK_CAP`,
  accepts `1`–`5`, hardcoded default `3`). The block always carries all
  three lines, even when a value falls back to its default, and is emitted
  last in the session context — after every embedded workspace file. The
  table lives once, in `skills/multi-doc-review/SKILL.md`'s new `Resolving a
  default` section; every consuming skill cites it instead of copying it.
- **Why `0` is rejected for `SUPERPOWERS_REVIEW_ROUNDS`.** N = 0 skips a
  review loop entirely. An environment variable set once and forgotten would
  otherwise silently disable spec review, plan review and whole-branch code
  review on every future session, with no message anywhere. `0` stays
  available where you state it and see its consequence — in an invocation,
  and as an option at every gate question — but it is not an accepted block
  or environment value; an unset or invalid `SUPERPOWERS_REVIEW_ROUNDS`
  (including `0`) falls back to `3`, like any other rejected value.
- **Three offered-default labels.** A gate's offered value is labelled
  **current default** when it equals the hardcoded default, **recommended**
  when it is stronger (more review rounds, more reviewers, or — since a
  smaller cap means more human checkpoints — a lower `batch-task-cap`), and
  **session default** when it is weaker. This replaces M's old two-label
  rule and applies it to all three parameters.
- **N's option list and the recommended-to-current-default relabelling.**
  The option list is built by taking, in order and skipping any value
  already held, the offered value, then `3`, then `2`, then `4`, stopping at
  three values, then appending the zero option last. An offered N of 3 — the
  common case — reproduces the historical list, but its label changes: it
  was "3 (recommended)" at all three gates and is now "3 (current
  default)". This relabelling is intentional, not an accidental edit:
  labelling a stale environment setting as the project's advice would be
  wrong in the direction that weakens review.
- **The resume prompt carries X and N as well as M.** Batched Autonomous
  Mode's `/clear` handoff previously carried only `M=<m>` across the
  boundary; a task count X and a review-round count N fell back to the
  hardcoded default otherwise. Now the resume prompt carries `X=<x>` and
  `N=<n>` alongside `M=<m>`, so a value you stated survives the boundary
  instead of being silently re-resolved from the environment on the next
  batch.
- **Platform limits.** Claude Code runs `hooks/session-start` and so emits
  and reads the block; Cursor runs the same hook, but this has not been
  verified for this fork. Codex and OpenCode build their session context
  a different way, emit no block, and resolve every one of the three
  parameters to its hardcoded default unconditionally — a value stated in
  the invocation still wins there, only the block tier never applies.
- **Restart window.** `hooks/session-start` re-runs on `clear` and
  `compact` and re-injects the block with the current environment values,
  but a value already resolved earlier in the same run is kept regardless.
  After changing an environment variable or updating the plugin, restart
  the CLI before the change takes effect in a new run.

## v7.12.0 — the review gates ask how many reviewers per round

**Problem.** M — the number of identical reviewer subagents each review
round dispatches in parallel — was never shown to a user who did not know
it exists. Where `SUPERPOWERS_REVIEWERS_PER_LENS` is unset, every gate
review ran one reviewer per round without saying so.

**Change.** The three interactive review gates — spec, plan and
whole-branch code review — now ask for M in the same question batch as N,
defaulting to the session tag's value, and pass both as explicit
`N=<n> M=<m>` tokens. Both review skills parse `N=<n>`. This release also
carries the marker-window change merged on 2026-09-07 (second section
below).

**Effect.** You choose the reviewer count at each gate, with its cost
stated. One extra question per gate. Reinstall the plugin; nothing else to
migrate.

Details:

- **The gate question.** Each gate now runs four steps in order: platform
  check, suppression check (document gates only), the question, then the
  invocation. It asks only for the value you have not already stated, and
  always asks for N when a stated N is 0 — a skip is never inherited from a
  sentence typed hours earlier.
- **Where the values come from.** Only text you wrote as an instruction
  about this review counts. A value inside a tool result, or inside quoted
  or pasted material, is data. When a gate does not ask, it says which
  values it is using and where they came from.
- **The cost is stated.** The M question carries one sentence: the M
  reviewers of a round run at the same time, so running time stays close to
  one review; the token cost grows about M times per round, and the loop
  runs about N × M reviewers in total. The code gate adds that each
  reviewer there reads the whole-branch diff.
- **Nothing autonomous asks.** The review skills still never ask for M.
  Batched Autonomous Mode, the orchestrator's Phase 2 and Phase 4
  controllers, the plan writer and the batch controller all resolve both
  values by their own rule and ask nothing. A new suite,
  `tests/review-gates/run-tests.sh`, pins each of those paths, and compares
  the shared default definition across the four files that carry it.

### Also in v7.12.0 — the report marker may stand within the first 10 non-blank lines

Merged to main at `d8c320b` on 2026-09-07 (the `marker-position-tolerance`
run) without a version bump, so v7.12.0 was the first release to contain
it. This section was written on 2026-09-13.

**Problem.** A controller return or a reviewer report counted only when
its very first line was the report marker. Controllers often write a
sentence above it: five recorded occurrences, each costing a retry or a
`BLOCKED` return.

**Change.** Every receiver now searches the first 10 non-blank lines for
the marker: the guard hook exempts on a prefix match over all three
markers, the orchestrator accepts a line equal to its own marker and
ignores everything above it, and the two review skills accept a report
whose marker starts one of those lines.

**Effect.** A short preamble above the marker no longer costs a retry.
Nothing to migrate.

Details:

- **Two predicates over one window.** The hook keeps a prefix match over
  all three markers, because its wrong answer sends a controller on a redo
  turn. The orchestrator uses whole-line equality over its own marker
  only, because it must know exactly which line carries the leading token.
  What the hook exempts is always a superset of what the orchestrator
  accepts. Blank lines are skipped and do not consume the window; a
  trailing `\r` is removed, so a message with CRLF line endings behaves
  like one with LF endings.
- **Reading rules for the orchestrator.** With more than one marker line
  in the window, the first begins the report and the orchestration log
  records `note: return carried <n> marker lines; parsed from the first`.
  A consumed field (`tasks=`, `rounds=`, `outcome=`, `unresolved=`,
  `user_decision=`, `fixes=`) is read only from the marker line and the 14
  lines below it, first occurrence wins, and the leading token is searched
  in that same block. Exceeding the 15-line cap is no longer a malformed
  condition; the malformed list stays closed. A fork's reviewer return is
  read by the same rules with its own 25-line cap.
- **The review skills.** `multi-code-review` and `multi-doc-review` treat a
  report as usable when a line among the first 10 non-blank lines starts
  with `<!-- multi-review report -->` and a Verdict block stands below it;
  a report whose marker line is its last non-blank line is unusable.
  `researching-prior-art` keeps its first-line rules.
- **Accepted residual.** A message that quotes a bare marker line at the
  start of one of its first 10 non-blank lines is exempt from the guard
  for its whole length. This is recorded next to `MARKER_SEARCH_LINES` in
  `hooks/subagent-guard.js` and in the fix-dispatch step of
  `multi-code-review`.
- **Tests.** `tests/codex/test-subagent-guard.js` covers the window, the
  CRLF case and the single `MARKER_SEARCH_LINES` declaration;
  `tests/orchestrating-development/run-tests.sh` and
  `tests/reviewer-templates/run-tests.sh` pin the receiver wording.

## v7.11.0 — a user's own plan amendment now backs its marker

**Problem.** When the user answered an escalated item with `amend plan`,
the answer was appended to the ruling record as a `**Follow-up:**` line,
because that record is appended and never rewritten. The test that decides
whether an `(amended by ruling <n>)` marker carries authority read only the
entry's `**Resolution:**` line, which still said `escalated`. A clause the
user had personally decided was therefore treated as ordinary reference
text, and a review finding against it could be dropped with no escalation
and no visible sign — the exact case that test exists to prevent.

**Change.** The backing test now accepts either line: a `**Resolution:**`
beginning `amend plan`, or a `**Follow-up:**` answer beginning `amend
plan`. Two smaller rules ship with it. An answer to an item that shares a
bare finding id with another open item of the same invocation must name its
round in prose, so the controller matches it by that sentence and not by
the id alone. And the two controllers that run commands must read a
background command's output file through `tail`, never whole.

**Effect.** A finding against a user-amended clause is triaged as decided
wording again, and cannot be silently discarded. Nothing to migrate —
reinstall the plugin to pick the rules up.

Details:

- **The backing test reads both lines.** The rule lives in
  `skills/orchestrating-development/SKILL.md` under "The ruling record"
  and is mirrored in `skills/multi-code-review/SKILL.md`, so the
  orchestrator and the review loop apply one rule. The alternative fix —
  having Resume step 3 rewrite the Resolution line when it applies a
  user's amendment — was rejected: the ruling record is appended and
  never rewritten, and rewriting one line would break that property for
  every reader of the record.
- **An answer names its round when ids collide.** The `inv <i>` qualifier
  separates invocations, not rounds, and finding ids restart at `[C1]`,
  `[I1]` in every round and every verification cycle. One invocation can
  therefore hold two open `[I1]` items. Each answer for such an item now
  opens with a parenthesis naming its round. This is what already kept the
  two `[I1 inv 2]` rulings of the `prompt-pointer-dispatch` run on their
  correct findings; it is now a rule rather than a habit, and it costs
  nothing, since it changes only the answer text.
- **A background result is read through `tail`.** The
  `batch-controller` and `code-review-loop` templates forbid a whole read
  of a background command's output file and name `tail -n 50` plus a
  `grep` for the detail. One measured controller spent a single 125 KB
  read on a test-suite log — more of its window than every prompt it was
  given. The plan-writer and doc-review templates do not carry the rule,
  because those controllers run no commands.
- **Tests.** `tests/in-run-rulings/run-tests.sh` goes from 502 to 512
  assertions; two older pins that asserted the Resolution-only wording
  were rewritten, because they encoded the defect.
  `tests/orchestrating-development/run-tests.sh` goes from 147 to 155,
  including the two absences. All six fast suites pass.

## v7.10.0 — the orchestrator dispatches its controllers by pointer

**Problem.** The orchestrator (the session that drives the whole
pipeline) pasted a full controller template, 94 to 249 lines, into
every dispatch and every retry. Those copies accumulate in one context
window that must last the whole run, so the percentage of that window
spent on re-sent prompts grew steadily as the orchestration went on —
about a quarter of it on one measured run.

**Change.** The orchestrator now fills each template into a file in a
temporary directory and dispatches a three-sentence pointer to it. Any
failure of the mechanism stops the run.

**Effect.** The orchestrator keeps its window for the whole pipeline.
Reinstall the plugin: a run started before the reinstall uses the old
inline dispatch.

Field report: the orchestrator (the `orchestrating-development` session
that drives plan writing, plan review, batched implementation and the code
review loop) runs four kinds of controller subagent, one per phase, and it
used to send each one its instructions as a copy of the whole controller
template — `plan-writer-prompt.md`, `doc-review-loop-prompt.md`,
`batch-controller-prompt.md` or `code-review-loop-prompt.md`, 94 to 249
lines — pasted into the `prompt` field of the Agent call, on every
dispatch and on every retry. Case 017 in the orchestration issues log
measured the cost on the `autonomous-in-run-decisions` run: the Phase 4
template was pasted on all 16 dispatches, 13 of them byte-identical
retries after an environment kill, and those re-sends took about a
quarter of the orchestrator's own context window (the working memory the
model holds for the whole run). The orchestrator is the one session of a
run that cannot be restarted cheaply: its window has to last from Phase 0
to Phase 5. Worklist row 13 listed this as fix 1 of three.

v7.10.0 applies the v7.9.0 mechanism one level up. The orchestrator runs
`mktemp -d` once per session, which creates a temporary directory outside
the checkout (the prompt directory), and never holds that path in a shell
variable or writes it to any log. Before each dispatch it fills the
phase's template once with `skills/multi-code-review/scripts/fill-prompt.js`
— the v7.9.0 script, reused in place — into `dispatch-<k>-<label>.md` in
that directory (`<k>` is a counter of fills, `<label>` names the dispatch:
`plan-writer`, `plan-review`, `batch-<n>`, `code-review`), checks the file
with `test -s`, and dispatches the same three-sentence pointer v7.9.0
uses: the controller reads the file once with the Read tool, follows it as
its only instructions, and reads nothing else in that directory. The
orchestrator never opens a template and never holds a filled prompt. An
identical retry resends the same pointer to the same file, with no new
fill. A re-dispatch that carries answers — after an in-run ruling, after a
plan writer's `BLOCKED` question is answered, or on resume — is a new fill
under the next `<k>`; the answer lines go into a value file
`dispatch-<k>-answers.txt`, written with the Write tool only (never with a
heredoc, because answer text quotes plan clauses and findings that may
contain shell characters), and the script refuses to overwrite a prompt
file with different content. Design:
`docs/superpowers-orchestrator/2026-09-06-orchestrator-prompt-pointer/specs/orchestrator-prompt-pointer-design.md`.

Every failure of the mechanism is **fatal for the run**: the orchestrator
writes the log entry it owes, if any, appends a `## STOPPED` entry whose
first line names the cause, and stops. There is no inline fallback, for
the reason Amendment 1 of the v7.9.0 spec gave: a fallback that pastes
the template would hide the defect and silently bring the old cost back.
The skill's `## Major-Error Stop Policy` states the boundary of that rule
in two tables, so that the environment failures of today keep their
existing handling:

- **Failures OF the mechanism (fatal):** `mktemp -d` fails or prints a
  path under the repository; the fill script fails (a malformed template,
  a dispatched file name reused with different content, a second
  non-zero exit after a corrected command) or `test -s` finds the prompt
  file empty; Node is missing; a value file cannot be written; a value
  file is refused twice by `hooks/safety/protect-secrets.js` (before the
  second attempt the orchestrator applies the v7.9.0 rule — probe each
  line with one Write of a throwaway file, replace every refused line by
  its location plus `secret-bearing finding, value withheld`, retry once);
  a controller's final message, after the one identical retry, shows it
  could not read or did not follow its prompt file.
- **NOT failures of the mechanism (handled as before):** a controller
  that dies of its environment (usage limit, tool error, no final message)
  gets the identical retry and then today's stop; a slip in the
  orchestrator's own fill command (a wrong argument, a missing value) is
  corrected once; a return unusable on format alone is a malformed return
  and gets the identical retry; a prompt directory path lost from the
  orchestrator's context (after a compaction, typically) is never guessed
  or searched for — the orchestrator runs `mktemp -d` again and continues
  in the new directory with the counter restarted at 1. That last rule
  differs from `multi-code-review`, where a lost path ends the invocation:
  the orchestrator's files are named by a counter, so nothing can collide.

### What changed

- **`skills/orchestrating-development/SKILL.md`** — Controller Dispatch
  Rules gain "Prompt files and the pointer" (the prompt directory, the
  no-variable rule, the file-name table, the value-file rule, `test -s`,
  the pointer wording); Phase 0 creates the directory; Phases 1 to 4
  replace "fill the template and dispatch" by the fill command, the check
  and the pointer; `## Resume` creates a fresh directory before its
  re-dispatch; `## In-run rulings` writes the answer lines into the value
  file; the Major-Error Stop Policy carries the two tables above with the
  fixed `## STOPPED` cause texts; `## Prompt Templates` says the templates
  are filled by the script and never read by the orchestrator.
- **The four controller templates** — two changes forced by the script.
  `[M]` became `[M_REVIEWERS]` in `doc-review-loop-prompt.md` and
  `code-review-loop-prompt.md` (the script's placeholder pattern needs at
  least two characters; the controller-facing text is unchanged). The
  `## Resume Answer` section is now present on every dispatch of
  `plan-writer-prompt.md`, `batch-controller-prompt.md` and
  `code-review-loop-prompt.md`: a fixed sentence precedes the placeholder,
  and a section with no answer line below that sentence means the run has
  recorded no answer. Every rule that used to key on the section's
  presence keys on the presence of an answer line instead. Everything
  else in the templates is byte-identical.
- **Tests** — new `tests/orchestrating-development/run-tests.sh` (147
  assertions on the skill text and the templates: the pointer wording,
  the absence of any `$PROMPT_DIR` variable and of any inline fallback,
  the fill commands, the two stop-policy tables, the `## Resume Answer`
  shape); `tests/fill-prompt/run-tests.sh` grew from 102 to 166 tests and
  now fills the four orchestrator templates as well;
  `tests/in-run-rulings/run-tests.sh` pins the renamed placeholder and
  the new section heading. The Testing block of `CLAUDE.md` lists the new
  suite.

### First measurement of v7.9.0

The run that built this release was the first orchestrated run on the
installed 7.9.0 copy, so the acceptance measure owed by v7.9.0 (worklist
row 14 fix 1, Case 018) was taken on its two Phase 4 review-loop
controllers, by the rules of that spec's Acceptance measure section:

| Controller | Dispatches | Prompt material | Peak context |
|---|---:|---:|---:|
| invocation 1 (2 rounds, 1 fix) | 8 | 8.5% | 199K |
| invocation 2 (2 rounds, 2 verification cycles, 4 fixes) | 12 | 9.0% | 218K |
| largest pre-7.9.0 controller (Case 018 Follow-up) | 32 | 41.6% | 374K |

Both are under the 10 percent target. The pointers themselves are 0.7
percent; the rest is the fill commands and the value files the
controller writes. Row 14 fix 1 is closed.

### Not included

- **The orchestrator's own acceptance measure is not taken.** The run
  that built this release executed the installed 7.9.0 skill text and
  dispatched its controllers by pointer by hand, which is a practice and
  not this change. The target is all prompt material below 10 percent of
  the orchestrator session's content (the spec's Acceptance measure
  section defines the count); it is taken on the first orchestrated run
  after reinstall, and its number selects the next fix of row 13 — the
  scribe subagent when the target is met, a second measurement when it is
  not.
- **The compaction probe is still owed:** whether a compaction summary
  keeps the literal prompt directory path. Until it is run, the
  lost-path rule above is the designed answer either way.
- **The permissions question of v7.9.0 was probed once**, on 2026-09-06,
  in a session in auto permission mode (not bypass mode): a Write and a
  Read under a `mktemp -d` directory outside the checkout did not prompt.
  Other permission modes, and the Git Bash path form (`cygpath -m`),
  remain untested.
- **Not changed:** `multi-doc-review` still pastes its reviewer prompt
  inline, and a batch controller still pastes the
  `subagent-driven-development` prompts to its implementers and
  reviewers.

### Upgrading

Reinstall the plugin: a run started before the reinstall executes the old
inline dispatch. A `## STOPPED` entry whose cause begins `prompt directory
could not be created`, `prompt file <name> not produced`, `value file
<name> could not be written`, `value file <name> refused twice by
protect-secrets` or `prompt file <name> not read by <controller name>` is a
stop of this mechanism; the resume prompt is the existing one, and the
resumed session creates its own fresh prompt directory, so nothing from
the stopped session's directory is reused.

## v7.9.0 — reviewers and fixers receive their prompt by pointer

**Problem.** A code-review loop controller (the subagent that runs one
review loop) pasted the reviewer prompt and a hand-written fix prompt
into every dispatch. That text was 35 to 42 percent of the
controller's context window.

**Change.** The controller now fills the reviewer template into a file
with a script and dispatches a three-sentence pointer to it; the fix
subagent is dispatched the same way from a new template. Any failure
returns BLOCKED.

**Effect.** Reviewers read the same text as before, and the controller
keeps more of its window. Reinstall the plugin.

Field report: a `multi-code-review` controller is the subagent that runs
one code-review loop, and its context window (the working memory the model
holds for the whole loop) grows with every round. Measured on the three
largest controllers of the previous orchestrated run (Case 018 Follow-up in
the orchestration issues log; 374K, 373K and 333K tokens of context), the
largest single source of that growth was text the controller itself pasted
into its Agent dispatches: the filled reviewer prompt (about 9 KB, from
`reviewer-prompt.md`) once per reviewer, and a fix prompt it composed by
hand (about 11 KB) once per fix dispatch. Together they were 35 to 42
percent of each controller's window — ahead of the reviewer reports it
received (20 to 25 percent). The largest controller made 32 dispatches
over 4 rounds; a controller can make up to 33. The text was also redundant:
every placeholder of the reviewer template varies per round or per
invocation, none per reviewer, so the M reviewers of a round were sent
byte-identical prompts.

`multi-code-review` now dispatches every reviewer and every fix subagent by
**pointer**. Before round 1 the controller runs `mktemp -d` once, which
creates a temporary directory outside the checkout (the prompt directory).
Each round it writes the round's values — lens text, commit range, package
path, carried findings — into small files there, and runs
`scripts/fill-prompt.js`, a deterministic Node script, which fills the
template into one prompt file in that directory. The controller never reads
the template and never holds the filled text. It then dispatches a fixed
three-sentence message that names the file: the reviewer reads the file
once with the Read tool and follows it as its only instructions, and must
read nothing else in that directory. The reviewer reads exactly the text it
received inline before: `reviewer-prompt.md` is byte-identical, and the
fill test asserts the file is the template body filled under the legend's
rules. The fix subagent is dispatched the same way from a new template,
`fix-prompt.md`, which carries the rules the controller used to compose by
hand. Design:
`docs/superpowers-orchestrator/2026-09-05-prompt-pointer-dispatch/specs/prompt-pointer-dispatch-design.md`.

Every failure of the mechanism is **fatal**: the controller writes the
round entry it owes, if any, and returns `BLOCKED: <cause>`. There is no
inline fallback (author decision, Amendment 1 of the spec: a fallback that
pastes the prompt inline would hide the defect and silently bring the old
cost back; a stop makes the defect visible the moment it appears, and the
orchestrator already treats a controller `BLOCKED` as a stop with a resume
path). The run's review rounds bounded that rule with four refinements,
recorded as Amendments 2 to 4:

- A value-file Write refused by `hooks/safety/protect-secrets.js` (a
  finding quotes a credential-shaped string) is not fatal at once. The
  hook names only a credential kind, never a line, so the controller probes
  each line with one Write tool call of a throwaway file, replaces every
  refused line by its `file:line` plus the fixed text `secret-bearing
  finding, value withheld`, and retries the Write once. The finding keeps
  its id and severity, so the fix subagent still removes the credential at
  that location. A second refusal is fatal.
- A round in which every reviewer died of its environment (a usage limit,
  a tool error, no final message), or returned a report unusable on format
  alone, is not a failure of the mechanism: it is logged `inconclusive`
  and the loop continues, as before. A round in which no reviewer could
  read or follow its prompt file is fatal.
- A slip in the controller's own fill command (a mistyped argument, a
  missing value, a value file it never wrote) is corrected once; a second
  non-zero exit is fatal.
- A prompt file may be removed and filled again under the same name until
  a pointer to it has been dispatched; after that it is never rewritten.

### What changed

- **`skills/multi-code-review/scripts/fill-prompt.js`** — new. Fills the
  prompt body of a template into a file from `NAME=<value>` and
  `NAME=@<file>` arguments; untrusted text (findings, lens text, failure
  text) always goes through the `@<file>` form. Exit codes 1 to 5 name
  the cause (usage, malformed template, uncovered placeholder, unknown
  name, read or write failure); an `--out` file that already exists with
  different content is refused.
- **`skills/multi-code-review/fix-prompt.md`** — new template for the fix
  subagent, re-dispatch (`FAILURE_BLOCK`), verification-cycle and
  post-loop-addendum fixes. Every rule precedes the `[FINDINGS]` and
  failure blocks, so a truncated Read cannot drop a rule.
- **`skills/multi-code-review/SKILL.md`** — Procedure "Before round 1"
  (the prompt directory, Git Bash path conversion, the value-file rule,
  the file-name table, the pointer wording); step 2 (write values, fill,
  `test -s`, dispatch M pointers to the same file); the
  Critical/Important bullet (fix dispatch by pointer, the secrets probe);
  Error Handling (the fatal rule, the per-cause `BLOCKED` texts and the
  four refinements above). `reviewer-prompt.md` is unchanged.
- **Tests** — new `tests/fill-prompt/run-tests.sh` (102 unit tests on the
  script, including a fill of the real templates); section 10 of
  `tests/reviewer-templates/run-tests.sh` pins the pointer wording, the
  absence of any `$PROMPT_DIR` variable and of any inline fallback. The
  Testing block of `CLAUDE.md` lists the new suite.

### Not included

- **The acceptance measure is not taken.** The target is all prompt
  material below 10 percent of the controller's content (the spec's
  Acceptance measure section defines the count). The run that built this
  release executed the installed 7.8.0 copy and could not measure itself;
  the measure is taken on the first orchestrated run after reinstall.
- **Nine harness probes are owed.** All ask the same question: whether a
  Write or Read under a `mktemp -d` directory prompts for permission in a
  session that is not in bypass mode. Until one is run, treat the
  Prerequisites note of the guide as the safe assumption.
- The mechanism is specified for macOS and Linux; the Git Bash path form
  (`cygpath -m`) is an owed probe, not a tested path.
- The orchestrator's own dispatch of its controllers still pastes the
  controller templates inline (worklist row 13 in the orchestration issues
  log).

### Upgrading

Reinstall the plugin: a run started before the reinstall executes the old
inline dispatch. A `BLOCKED: prompt …` return from the loop stops an
orchestrated run with a `## STOPPED` entry and a resume prompt, like any
other controller `BLOCKED`; a resumed controller creates its own fresh
prompt directory, so nothing from the stopped invocation is reused.

## v7.8.0 — the orchestrator rules on in-run decisions

**Problem.** Most stops of the autonomous pipeline were not the user's
decisions: a review finding or a blocked task contradicted the plan.
In Case 007 one stop became a chain of four.

**Change.** The orchestrator (the session that drives the pipeline)
now classifies each open item as escalated, forced or design. It rules
on design items after two or three forked subagents review them under
different lenses. It records and commits every ruling before it
re-dispatches the phase.

**Effect.** Only escalated items reach you, and Phase 5 stays yours.
Reinstall the plugin.

Field report: in the recorded orchestrated runs (Cases 001, 007, 008 and
010 in the orchestration issues log), most stops of the autonomous pipeline
were not the user's decisions. In Phase 4 the code-review loop returned an
item as `user-decision` or `unresolved` because the correct fix
contradicted the plan's text; in Phase 3 a batch controller returned
`BLOCKED task=<n>` because the implementation had found a defect in the
plan, not in the code. In both cases the orchestrator — which holds the
spec, the plan and the run's history, and whose own artifact the plan is —
was better placed to decide than the user. Case 007 shows the cost of
stopping instead: one stop became a chain of four, because each decided
fix got a verification re-review that raised new items against the
decided wording.

`orchestrating-development` now settles those items inside the run. When a
Phase 4 return carries open items, or a Phase 3 return is a `BLOCKED
task=<n>` whose report holds a `### Conflict <k>` or `### Question <k>`
section, the orchestrator classifies each item with a **closed escalation
predicate**: `escalated` when its correct resolution changes the spec,
grows the scope, needs an irreversible or outward-facing action, concerns
an exposed secret, or hits the in-run resume cap (`chain`); `forced` when
one sentence names the fact that makes every other outcome indefensible;
`design` otherwise. A `design` item is reviewed by two or three **forked
subagents** under distinct lenses — design consistency, implementation
practicality, adversarial — dispatched in parallel and blind to each
other. The orchestrator consolidates their verdicts and rules; one
`evidence consistency` round follows when they contradict, and a fixed
tie-break applies when the contradiction stays unsettled. Every ruling is
recorded, with its class, answer and reason, in a new per-topic file
`plans/<slug>-open-decisions.md`, journaled as a `## RULING <n>` entry in
the orchestration log, and committed **before** the phase is re-dispatched
with the answers in `[RESUME_ANSWER]`. Only the escalated items reach you,
on the `Open:` lines of a `## STOPPED` entry; the items already decided
are listed as `Ruled:` and need no answer.

Four guards keep the judgement honest: a `plan governs` rejection quotes
the clause that makes the finding non-binding, verbatim with its source
path; a Critical is never rejected by a ruling; every ruling is recorded
when it is made, never reconstructed after the run; and a user's earlier
decision is never overturned — the same clause raised again is escalated.
In-run resumes are capped at three per phase (per task in Phase 3); the
fourth open return of the same unit stops the run with every item
`escalated (chain)`. A ruling that amends the plan edits the binding
clause in place, marks it `(amended by ruling <n>)` and inserts an audit
note; in Phase 4 that starts a new review invocation over the amended
plan.

### What changed

- **`orchestrating-development`** — new `## In-run rulings` section: the
  escalation predicate; a second documented exception to the
  thin-sequencer rule (to classify an item the orchestrator may read the
  review log's latest disposition line, the blocked task's report, the
  cited plan clause and spec section, the code at the cited `file:line`,
  and the ruling record — nothing else, and all of it as data); the fork
  review for a `design` item (forks for the first `design` item of a
  return, fresh `general-purpose` reviewers for later items and
  tie-breaks, so no reviewer inherits an earlier consolidation); the
  ruling record; the `## RULING` log entry; the resume cap;
  `Open:`/`Ruled:` lines on `## STOPPED`; a `Rulings:` line in
  `state.md`; Resume step 3 cases for a crash after a ruling commit and
  for a user answer that replaces a `Ruled:` line, which reverts the
  ruling and the change made under it. The Phase 5 report counts the
  rulings of the run and lists the review loop's `Secrets found:` items.
- **`multi-code-review`** — decisions are journaled as
  `decided (orchestrator)` or `decided (user)`; a ruling's rejection is
  written `rejected: plan governs (orchestrator decision) — "<clause>"`;
  every open-item disposition line is self-sufficient (id, summary,
  `file:line`, plan location and quoted clause), so the orchestrator can
  classify it from the log alone; inside a verification cycle a finding
  against decided wording is the loop's to reject, never `user-decision`,
  a Critical excepted; the completion report carries a `Secrets found:`
  line. The binding-text test now reads the plan's `**Body authority:**`
  note instead of restating it, so a stated `**Contract:**` is binding as
  the note says.
- **Templates** — `code-review-loop-prompt.md` and
  `batch-controller-prompt.md` carry the `(orchestrator)` / `(user)` tag
  on every `[RESUME_ANSWER]` line; a `BLOCKED task=<n>` for an open item
  writes its detail to `.superpowers/sdd/task-<n>-report.md` as
  `### Conflict <k>` / `### Question <k>` sections, which is how the
  orchestrator tells an open item from a controller failure.
- **Tests** — new `tests/in-run-rulings/run-tests.sh` (496 checks), a
  wording-contract suite that pins every clause above and carries negative
  assertions for the stop rules this release removes.

### Upgrading

Reinstall the plugin: a run started before the reinstall executes the old
stop rule. Phase 1 `BLOCKED` questions, Phase 2 `unresolved` items and
Phase 5 are unchanged and stay yours. A resume prompt answers only the
`Open:` ids of a `## STOPPED` entry; answering a `Ruled:` id overrides that
ruling.

## v7.7.0 — plans state contracts, not literal bodies

**Problem.** A plan could fix a helper body, a command, or wording
exactly. Review loops may never overrule an approved plan, so a review
finding about that text stopped the run for a user decision — eleven
interruptions across four runs.

**Change.** A task now states a contract: what its artifact must
guarantee. The code block beside it is one reference implementation.
Only the `**Global Constraints:**` block and a block marked
`**Exact content:**` bind as written.

**Effect.** A review finding against a body is now an ordinary fix, not
a stop. Nothing to migrate: older plans keep their old authority.

Field report: across four earlier runs, eleven interruptions of the
autonomous pipeline traced to one cause. A plan had fixed a helper's body,
a command, or a piece of wording **verbatim**, and the review loops may
never overrule an approved plan — so every later review finding about that
text became a `user-decision` stop the pipeline could not settle alone
(Cases 001, 003, 007 and 008 in the orchestration issues log). One run lost
three of its four stops to it; another turned a single stop into a chain of
six.

`writing-plans` now asks for the **contract** instead. A task states what
its artifact must guarantee — invariants, and the verification that would
falsify them, plus inputs and outputs when the artifact is code — and the
code block beside it is a *reference implementation*: one way to satisfy
that contract, not the contract itself. A later review finding against such
a body is an ordinary fix while the contract still holds. Only two things
in a plan bind as written: the `**Global Constraints:**` block, and a block
whose new `**Exact content:** <reason>` marker names a pin the plan does
not itself write or edit. A pin the plan creates or edits is a *self-pin* —
body and pin amend together as one ordinary fix — which is exactly the case
that produced the Case 008 chain.

The rule has to reach the reviewer that applies it, and a review controller
reads the plan, never `writing-plans`. So every generated plan's header now
carries a `**Body authority:**` note stating the binding set and declaring
everything else — the note included — a reference implementation. A finding
against the note's own wording is recorded against `writing-plans` and the
run continues; it is never a plan conflict.

### What changed

- **`writing-plans`** — new "Contracts and Literal Bodies" section; a
  `**Contract:**` field in the Task Template (`none — <reason>` allowed);
  the `**Body authority:**` note in the Plan Header template; Self-Review
  gains a contract audit that treats a vacuous contract, a false `none`,
  and a marker whose reason names no external pin as defects.
- **`multi-doc-review`** — the plan cell of the Ambiguity & testability
  lens gains contract targets: bodies with no stated contract, vacuous or
  unverifiable contracts, and self-pinned `**Exact content:**` markers. The
  targets apply only to a plan carrying the `**Body authority:**` label, so
  plans written before this release are reviewed exactly as before.
- **Tests** — new `tests/writing-plans/run-tests.sh` (15 checks) and a new
  section in `tests/reviewer-templates/run-tests.sh` (24 total), including
  a cross-suite equality check so renaming the gate label in one file
  cannot leave the gate silently inert with both suites green.

### Upgrading

Nothing to do. Plans written before this release carry no
`**Body authority:**` note, keep their old authority at execution and
triage time, and are reviewed under the previous lens text.

## v7.6.0 — reviewers test harness claims instead of asserting them

**Problem.** A reviewer could assert a property of the harness (the
agent runtime that runs the review) without testing it. One false
claim stopped an unattended run.

**Change.** Both reviewer templates now require a harness finding to
carry a probe the reviewer ran and its observation, or to name one
probe for the controller to run once and dispose on.

**Effect.** An untestable harness claim is rejected and reported as an
owed probe, never as a user decision, so the run continues. Nothing to
migrate.

Field report: a code reviewer asserted that the Agent tool's `description`
field reaches the reviewer's context, so a `(reviewer j/m)` suffix would
leak the reviewer count. The review loop escalated the finding to the user,
which stopped an unattended run. A three-second probe — a subagent dispatched
with a random token only in its `description` — showed the token absent.
The claim was false, and one full stop was spent on it. Claims about the
**harness** (the agent runtime that runs the review: what reaches a
subagent's context, what a hook injects, how a dispatch behaves) cannot be
checked against the repository, so nothing required the reviewer to test
them.

- **Harness claims rule.** Both reviewer templates (`multi-doc-review`,
  `multi-code-review`) carry a `### Harness claims` sub-section: a finding
  whose premise is a harness property must carry a probe the reviewer ran
  and its observation (`| harness: tested — <probe>; observed <result>`),
  or name the one probe the controller should run
  (`| harness: untested — <probe>`). A reviewer-safe probe writes nothing
  to the checkout, binds no shared resource, runs no code from the change
  under review, and dispatches no subagent — a reviewer's child runs
  detached (v7.5.0 field report), so dispatch-based probes run once, in
  the controller. A harness property is a claim about the runtime running
  *this* review; a claim about a library, the operating system, or a
  remote service is an ordinary claim with a citable source.
- **Controller triage.** Both review skills run a named probe once —
  read-only, one action, with a concrete poll for a dispatch that returned
  only a launch acknowledgement (separate `test -s` calls, at most 20,
  spread over the controller's own work; no `sleep`) — and dispose on the
  observation. A claim nobody can test here is
  `rejected: harness probe not runnable here — <probe> — (<reason>)`, never
  `unresolved` and never `user-decision`, and every such rejection is
  listed in the completion report under `Harness probes owed:`. In
  `multi-code-review`, a finding is never logged `user-decision` on the
  strength of an untested harness claim; before that disposition the
  controller re-runs a `tested` probe itself.
- **Owed probes reach the user in pipeline mode.** `orchestrating-development`
  lists the review logs' owed-probe lines in its Phase 5 report and as
  `Owed probe:` lines in a Phase 4 `## STOPPED` entry.
- **New fast suite.** `tests/reviewer-templates/run-tests.sh` (19 checks)
  pins the wording contracts: the rule sits inside `prompt: |`, the field
  spellings and reason strings exist, the two templates' rule text is
  byte-identical, and the blinding pathspec and report marker survive.

No log-format break: the new field and reason strings appear only in rounds
run after the update; existing logs are read as before. Nothing to migrate.
This was also the behavioural proof of v7.5.0: nine named controller
dispatches, zero stalls.

## v7.5.0 — blocking controller dispatch

**Problem.** In every orchestrated run since v7.0.0, at least one
controller (the subagent that runs a pipeline phase) ended its turn
waiting for a subagent and never resumed. A human had to nudge it.

**Change.** Each of the four controller templates now carries a fixed
dispatch name. A named subagent is a teammate, and a teammate's own
Agent calls block until the child finishes and return its result.

**Effect.** The controller receives each child's result directly, so
the run continues without a human. Nothing to migrate; no path or log
format changes.

Field report: in every orchestrated run since v7.0.0, at least one
controller (the subagent that runs a phase of `orchestrating-development`)
ended its turn with a line such as `Waiting for the round 1 reviewer to
finish.` and never resumed. The run stood still until a human sent the
controller a message. Four parallel research passes and two measured
experiments (2026-08-28 to 2026-08-30) traced it to Claude Code itself, not
to this plugin, not to a platform: a subagent dispatched without a `name`
runs its own children asynchronously, and each child's completion notice is
delivered to the main conversation — never to the controller that is waiting
for it (anthropics/claude-code#75043, open). A subagent dispatched *with* a
`name` is a teammate, and a teammate's own Agent calls block until the child
finishes and return its final message inline — measured 48 s against 8 s
for the same 30-second child.

- **Named controllers.** Each of the four controller templates in
  `skills/orchestrating-development/` now carries a fixed dispatch name
  (`orch-plan-writer`, `orch-plan-review`, `orch-batch-<n>`,
  `orch-code-review`), and the skill's Controller Dispatch Rules state the
  property this buys — the controller's own subagent calls return each
  child's result — and its form on a platform whose dispatch tool has no
  `name` parameter (Copilot CLI: foreground dispatch, never a background
  mode). Nested workers stay unnamed: a teammate cannot create teammates.
- **"Waiting on a subagent" rule.** Every controller prompt now says: never
  end a turn while a subagent you dispatched is outstanding; if a dispatch
  returned only a launch acknowledgement, do not wait for a notice that
  will not arrive — poll the file the child was told to write, on a bounded
  loop, and reconstruct the result from it; if the file never appears,
  retry once, then return `BLOCKED`.
- **`SendMessage` success is not delivery.** Measured on Claude Code
  2.1.251: a send to a recipient that does not exist returns
  `{"success": true}` and lands in the main conversation. Controllers
  confirm a child's work only through the file it writes.

No user-facing phrase, log format, or artifact path changes. Nothing to
migrate. Requires nothing newer than before; on Claude Code, 2.1.251 or
later also lets a child reply to an unnamed parent (fixed upstream in that
release).

## v7.4.0 — M reviewers per lens

**Problem.** Each review round dispatched exactly one reviewer.
Language models are not deterministic, so a round took one sample of
judgment and could miss what another run would report.

**Change.** A new parameter M (1–5, default 1) dispatches M reviewers
in parallel with the identical prompt. Their reports merge into one
finding set — every finding kept, duplicates merged at the highest
severity.

**Effect.** More findings per round; running time stays near one
review, token cost grows about M times. Nothing to migrate — at M=1
logs are unchanged. State `M=<m>`, or set
`SUPERPOWERS_REVIEWERS_PER_LENS`.

Field report: LLMs (large language models) are not deterministic — the same
reviewer prompt reports different findings on different runs, and one run can
miss a problem another run would report. Each round of `multi-doc-review` and
`multi-code-review` dispatched exactly one reviewer, so a round took one
sample of the reviewer's judgment under its lens.

- **M reviewers per lens.** A new parameter M (integer 1–5, default 1) sets
  how many reviewer subagents a round dispatches — in parallel, with the
  identical prompt, none told that the others exist. Their reports are
  consolidated into one finding set before triage: every finding of every
  usable report is kept (a union — no majority vote, which would drop exactly
  the findings this feature exists to catch), findings that name the same
  place and the same defect are merged at the highest severity given, and
  every reviewer-local id is traced to exactly one consolidated finding
  (`**Sources mapped:** k/k`). Running time stays close to one review; the
  token cost grows about M times per round. State it as `M=<m>`,
  `<m> reviewers per lens`, `<m> reviewers per round`, or
  `<m> parallel reviewers`: `/multi-doc-review <doc> [N] [M=<m>]`,
  `/multi-code-review [BASE] [N] [M=<m>]`. The skills never ask for M.
- **Convergence with M ≥ 2.** A round is clean only when the consolidated
  set has zero Critical and zero Important findings **and** all M reviewers
  returned a usable report; a partial round (a reviewer still unusable after
  one retry) is never clean. Verification re-reviews use the same M.
- **Log format.** Every invocation line now records `M=<m>` after `N=<n>`
  (a line without `M=` reads as M = 1). With M ≥ 2 a round entry gains
  `**Reviewers:**`, `**Reviewer verdicts:**`, and `**Sources mapped:**`
  lines, and every finding disposition line ends with
  ` ← <a>/<m>: <source ids>` — the agreement count and the
  reviewer-qualified ids (`r1:C1`). With M = 1 the entry is byte-identical
  to before. Readers of the `fixed — … → <sha>` line take the token right
  after `→ `.
- **Orchestration and SDD.** `orchestrating-development`'s Phase 0 batch
  asks for M (default: the environment variable's value, else 1); the
  orchestration-log header and `state.md` record `M=<m>`; `... with M=2`
  overrides it on resume, and a log written before 7.4.0 resumes with
  M = 1; both loop-controller templates carry `[M]`, because subagents never
  receive the session tag. The subagent-driven-development final gate and
  Batched Autonomous Mode never ask — they use the same default resolution,
  and a batch handoff carries a stated M across `/clear`.
- `SUPERPOWERS_REVIEWERS_PER_LENS` env var (integer 1–5, default 1) sets M
  for every invocation that does not state it; `hooks/session-start`
  carries it to the skills as a `<reviewers-per-lens>` session tag. Set it
  in settings.json's `env` block so it survives plugin updates; restart the
  CLI after changing it. Invalid or out-of-range values silently fall back
  to 1.
- **Tests.** `tests/codex/run-unit-tests.sh` gains a hermetic shell test of
  the tag (`tests/codex/test-session-start-reviewers-tag.sh`); the two
  behavioral review tests gain an M=2 case that cross-checks the round-1
  entry's counts against its source annotations.
- **Docs sync.** README (feature bullets, Skills Library, environment
  variables), `docs/guide/README.md` (stages, Phase 0 table, log sample,
  settings, cheat-sheet), `docs/FORK-IMPROVEMENTS.md`, and
  `docs/REVIEW-PROCESS-COMPARISON.md` updated for M.

## v7.3.0 — one folder per topic, committed code reviews

**Problem.** The documents of one feature were spread over three flat
directories, linked only by a shared file-name prefix, and the code
review history was never committed.

**Change.** Every document of a topic now lives in one folder,
`docs/superpowers-orchestrator/<date>-<slug>/`, with a sub-folder per
pipeline stage. Pipeline code reviews are committed there; reviewer
diffs hide those committed review files.

**Effect.** One folder now holds everything about a feature. Other
projects are not migrated automatically: old files stay readable, and a
run stopped mid-pipeline must be moved by hand. Git 2.32 or later is
required.

Field report: the documents of one feature were spread over three flat
directories, linked only by a shared `YYYY-MM-DD-<slug>` file-name prefix, and
the code review history was never committed. Finding, archiving, or deleting
"everything about feature X" meant matching prefixes across directories.

- **One folder per topic.** Every document of a feature now lives under
  `docs/superpowers-orchestrator/<YYYY-MM-DD>-<slug>/`, with one sub-folder
  per pipeline stage:

  ```
  docs/superpowers-orchestrator/<YYYY-MM-DD>-<slug>/
    specs/<slug>-design.md                 specs/<slug>-design-review-log.md
    plans/<slug>.md                        plans/<slug>-review-log.md
    plans/<slug>-open-decisions.md
    implementation/<slug>-review-log.md    implementation/<slug>-fix-reports.md
    <slug>-orchestration-log.md
  ```

  File names drop the date — the folder carries it — and keep the slug, so
  editor tabs and grep results stay distinguishable across topics. The rule is
  defined once, in the "Artifact Layout" section of the `brainstorming` skill;
  every other skill states its own exact paths and cites that section.
- **The plugin name returns to the path.** This reverses release v6.6.1, which
  removed it. The reason: the plugin's output is now a folder tree of its own,
  and separating it from the project's own `docs/` tree is worth the extra path
  segment.
- **Code reviews are committed.** A pipeline-driven `multi-code-review` run
  receives a new optional input, `TOPIC_DIR`, and writes its review log and fix
  reports under `<topic>/implementation/`, committing them after every round
  with the subject `chore(review): <slug> round <i> log`. A direct
  `/multi-code-review` run has no plan and therefore no topic folder: it keeps
  today's git-ignored `.superpowers/reviews/` behavior exactly.
- **Reviewers stay blind.** Committed review material is now part of the
  branch, so every whole-branch diff handed to a reviewer excludes the files
  whose names match the plugin's four sidecar patterns — `*-review-log.md`,
  `*-fix-reports.md`, `*-orchestration-log.md`, `*-open-decisions.md` —
  inside `docs/superpowers-orchestrator/*/` and at the legacy locations
  `docs/specs/` and `docs/plans/` (a sidecar moved out of those folders with
  `git mv` would otherwise appear as a deletion hunk carrying its whole old
  content). The reviewer's read prohibition lists the same set. This also
  closes a pre-existing leak: the committed spec and plan review-log sidecars
  were visible in whole-branch diffs before. Only a file matching one of the
  four names inside those folders is ever hidden; every other file is
  visible — a `*-review-log.md` anywhere else, or a file under
  `implementation/` whose name matches none of the four patterns (a
  `CLAUDE.md`, a note), reaches every reviewer. The plugin folder holds
  plugin output only, and a project must not put its own files there.
- **A Phase 4 stop is resumable with answers.** When the final code review
  leaves open items (`unresolved` or `user_decision` findings), the
  orchestrator's `## STOPPED` entry lists them by their review-log ids.
  `Resume orchestration for <plan> — [<id>]: <answer>` hands the answers to the
  code-review-loop controller, which journals each one as
  `decided (user): <answer>` in a committed addendum
  (`chore(review): <slug> decisions`). The completion skip — the rule that
  lets a re-dispatched controller reuse a finished review instead of running
  it again — now applies only when the recorded invocation ended with
  `unresolved = 0` and `user_decision = 0`; with open items, no answers and
  no new code since the stop, the orchestrator re-presents the open items
  and stops (Resume step 3) — a controller dispatched in that state returns
  `BLOCKED: … resume with answers` only as the retry backstop; code
  committed after the stop re-runs the review on resume, with or without
  answers.
- **A skipped review is committed too.** In pipeline mode an N=0 run writes
  its `skipped` entry into the tracked review log and commits it as
  `chore(review): <slug> skipped`, so the log never stays modified after a
  skipped gate.
- **This repository was migrated** with `git mv`; document contents are
  untouched. **Other projects are not migrated automatically:** existing
  `docs/specs/` and `docs/plans/` files stay readable as plain files, and new
  topics use the new layout. Skills, hooks and tests know only the new layout —
  a spec outside the layout stops orchestration with a message naming the
  expected location, `writing-plans` offers to move the spec there, and the
  subagent-driven-development review gate runs a plan outside the layout in
  direct mode (log under `.superpowers/reviews/`).
- **Minimum git version: 2.32**, stated explicitly for the first time (also in
  the README). It is needed for `git commit --trailer` and assumed by the
  pathspec magic above.
- **After updating:** an existing `.superpowers/sdd/plan.ref` that points at a
  moved plan makes the next `subagent-driven-development` run treat it as a
  plan switch and archive the workspace under `archive/<old plan basename>/`.
  This is expected after migration and loses nothing.

**Residual risk (accepted):** a second clone of the same branch — another
machine, or CI — that resumes the same committed in-progress review entry is
not detected. Today's batched mode already resumes automatically without such
detection; branch ownership prevents the scenario in practice, and a machine
token in the invocation entry would add state for nothing.

**Migrating a run stopped under the old layout (any project):** a run that
stopped before this release keeps its documents at the old flat paths, and
neither `orchestrate` nor `Resume orchestration` finds them there: the
orchestrator stops at intake because the old spec or plan path is outside
the layout, at the branch check because the branch exists but no
orchestration log is found in the layout (only the spec was moved), or at
resume because no orchestration log is found in the layout, and each of
those stops points here. Move the documents by hand, then resume:

1. Create `docs/superpowers-orchestrator/<date>-<slug>/` with the
   sub-folders `specs/` and `plans/` — `<date>` is the run's start date and
   `<slug>` its slug (the old file names minus the `YYYY-MM-DD-` prefix and,
   for the spec, the `-design` suffix).
2. `git mv` the spec and, when it exists, its `-review-log.md` sidecar into
   `specs/`, dropping the date prefix from the file names
   (`docs/specs/<date>-<slug>-design.md` becomes `specs/<slug>-design.md`).
3. `git mv` the plan and, when it exists, its `-review-log.md` sidecar into
   `plans/`, dropping the date prefix (`docs/plans/<date>-<slug>.md` becomes
   `plans/<slug>.md`).
4. `git mv` the open-decisions file, when present, into `plans/` as well
   (`docs/plans/<date>-<slug>-open-decisions.md` becomes
   `plans/<slug>-open-decisions.md`).
5. `git mv` the orchestration log to the topic root as
   `<slug>-orchestration-log.md`.
6. Edit the orchestration log's `_Invocation` header `spec` path and its
   `plan:` line, and the plan's `**Spec:**` header line, to the new paths.
7. Commit, then `Resume orchestration for <new plan path>`.

The code review log of a run stopped in Phase 4 is not migrated: under the
old layout it lived in the untracked `.superpowers/reviews/` folder, and
the new layout expects it under `<topic>/implementation/`. After migration
a Phase 4 stop therefore re-runs the final code review instead of resuming
it.

**Post-migration manual step for this repository:** the orchestration run that
implemented this change kept its own plan and orchestration log at
`docs/plans/2026-08-25-artifact-layout.md` and
`docs/plans/2026-08-25-artifact-layout-orchestration-log.md`, because moving
either mid-run would have broken every later checkbox-tick commit. After the
run ends, move them by hand:

```bash
# Task 19 Step 4 created only `.../2026-08-25-artifact-layout/specs`. `git mv`
# fails with "No such file or directory" when the destination directory does
# not exist, so create `plans/` first.
mkdir -p docs/superpowers-orchestrator/2026-08-25-artifact-layout/plans
git mv docs/plans/2026-08-25-artifact-layout.md \
       docs/superpowers-orchestrator/2026-08-25-artifact-layout/plans/artifact-layout.md
git mv docs/plans/2026-08-25-artifact-layout-review-log.md \
       docs/superpowers-orchestrator/2026-08-25-artifact-layout/plans/artifact-layout-review-log.md
git mv docs/plans/2026-08-25-artifact-layout-orchestration-log.md \
       docs/superpowers-orchestrator/2026-08-25-artifact-layout/artifact-layout-orchestration-log.md
```

(Skip any line whose source file does not exist.)

## v7.2.0 — prior-art research grounds technology decisions

**Problem.** Design sessions picked libraries, hosted services, and API
versions from model memory. That memory is old and does not know
versions, so specs carried technology claims nobody had checked.

**Change.** A new skill, `researching-prior-art`, adds a research gate
to brainstorming. One controller subagent runs N read-only researchers
in parallel and merges one evidence report; results are cached under
`docs/research/` for 90 days. Specs must carry a "Prior art and
alternatives" section.

**Effect.** Dependency decisions rest on verified sources, and
contradictions are listed instead of being resolved silently. Nothing
to migrate.

Field report: design sessions picked libraries, hosted services, and
API versions from model memory. Memory is stale and version-blind, so
the resulting specs carried unverifiable technology claims. Decisions
that add a dependency now pass through verified external evidence
before approaches are compared.

- **New skill `researching-prior-art`.** Brainstorming gains a research
  gate: when a decision would add or change a dependency-manifest
  entry, depends on version-sensitive external API behavior, or
  selects a hosted service, platform, or base image, it names the
  candidates and asks the user for N (0 skips; the skip is recorded in
  the spec). The sub-skill dispatches one controller subagent, which
  runs N read-only researcher subagents in parallel — candidate source
  reading, version verification anchored to the repo's own manifest,
  registry existence and OpenSSF health, prior art — spot-fetches
  citations, discards unusable reports, and merges the rest into
  `.superpowers/research/<slug>-research-report.md`. Contradictions
  are listed, never silently resolved. Platforms without the Agent
  tool skip and state the evidence gap.
- **Durable cache under `docs/research/`.** One committed file per
  candidate (`<registry>-<name>.md`). Research writes these files and
  the skill commits them for you, staging only the
  `docs/research/` cache files by explicit path — nothing else in your
  working tree is staged, and a commit that fails is reported but never
  blocks the session. A hit younger than 90 days
  removes that candidate's research assignment, but every hit still
  gets a cheap re-verifier — a committed header can be planted or
  edited.
- **Specs must carry the evidence.** Brainstorming's Design Contents
  gains a "Prior art and alternatives" section, required when the
  research predicate matched for at least one decision in the design
  (with per-finding dispositions); multi-doc-review's spec lens flags
  external-technology claims with neither a citation nor the label
  "unverified"; orchestrating-development's Phase 0 stops when a
  predicate-matching spec has neither the section nor the override
  sentence ("No decision in this design matched the prior-art trigger
  predicate.") — a documented exception to its thin-sequencer rule.
- **Guard marker `<!-- research report -->`.** Research reports quote
  skill-like phrases from external docs; subagent-guard exempts
  marker-first messages and adds the new skill to its roster and
  alternation (unit-tested). Routing rule added to skill-rules.json
  (26 rules covering 25 skills).
- Docs synced: README counts and Skills Library, guide Stage 1,
  lineage ranges.

## v7.1.0 — commit messages carry the workstream slug and stage

**Problem.** A pipeline run produced commits whose messages carried no
context. `chore(plan): task 3 complete` does not say which plan, and
`git log` could not separate two workstreams on one branch.

**Change.** Every skill derives the same *slug* from the plan file
name. Content commits add two git trailers, `Session: <slug>` and
`Stage: task <N>/<total>`; process commits put the slug in the subject.

**Effect.** `git log --grep "^Session: <slug>"` lists one whole
workstream. Nothing to migrate: `executing-plans` adds the trailers to
plans written before this convention.

Field report: a pipeline run produces many commits whose messages carry
no context — `chore(plan): task 3 complete` does not say which plan, and
a month later `git log` cannot separate two workstreams on one branch.

- **One convention, defined in `writing-plans`.** The *slug* is the
  plan's file basename with the `YYYY-MM-DD-` date prefix and `.md`
  stripped (`2026-08-17-auth-login.md` → `auth-login`); every skill in
  the pipeline derives it with the same rule. Content commits keep a
  conventional subject and add two git trailers: `Session: <slug>` and
  `Stage: task <N>/<total>`. `git log --grep "^Session: <slug>"` lists a
  whole workstream. The plan template's commit step now pre-fills the
  full command (No Placeholders applies to it).
- **Implementers inherit the format.** The SDD implementer prompt gains
  a Commit Messages section with `[SLUG]` / `[TASK_TOTAL]` placeholders;
  `executing-plans` adds the trailers when running a pre-convention plan.
- **Process commits name the slug in the subject** (they are the ones
  read via `git log --oneline`): checkbox ticks become
  `chore(plan): <slug> task <n> complete` (SDD per-task flow and the
  orchestration batch controller; the controller's crash-recovery search
  now greps `task <n> complete`, matching pre-slug ticks too);
  multi-code-review fix commits become
  `review fixes (<slug>, round <i>)` — still no finding text, so the
  reviewer-blinding rule is intact (behavioral test regex updated,
  accepts both shapes); orchestration boundary commits become
  `chore(orchestration): <slug> <boundary>` and Phase 2's revised plan
  `docs(plan): <slug> plan after review`.
- Docs synced: FORK-IMPROVEMENTS quotes the new tick subject.

## v7.0.1 — spec gate offers the fresh-session orchestration route

**Problem.** After the spec review rounds, the model could reword the
gate message and drop the orchestration option. The user then had to
search the guide for the phrase that starts the orchestrator (the
session that drives the whole pipeline).

**Change.** Brainstorming's User Review Gate message is now
verbatim-required and placed after the review loop. It offers two
paths: continue in-session to `writing-plans`, or run `/clear` and
paste `orchestrate the development of <path>`.

**Effect.** The prompt arrives ready to paste, with the real spec path.
Nothing to migrate.

Field report: after the spec review rounds, the gate message could be
paraphrased by the model and the orchestration option silently dropped —
the user had to find the orchestrator's trigger phrase in the guide.

- **brainstorming User Review Gate rewritten.** The message is now marked
  verbatim-required and anchored *after* the multi-doc-review loop (the
  previous header said "after the spec self-review passes", leaving the
  gate's position ambiguous). It presents two explicit paths: (1) review
  and continue to `writing-plans` in-session, or (2) run `/clear` and
  paste `orchestrate the development of <path>` — paste-ready with the
  real spec path, mirroring the writing-plans ready message. The prompt
  was verified to route uniquely to `orchestrating-development` through
  the skill activator.
- Stale wording fixed: the gate said "written and committed", but
  brainstorming leaves the spec uncommitted (orchestration commits it).
  Now "written and saved".
- Process-flow contradiction fixed: the flow said writing-plans is the
  only possible next step; orchestration hand-off is now a second
  terminal state (the user starts it in a fresh session — brainstorming
  still never invokes implementation skills itself).
- Guide synced: §3's quoted spec-gate dialog matches the new message
  verbatim; §4 "Starting a run" now recommends `/clear` first and notes
  the gate supplies the same prompt pre-filled.

## v7.0.0 — project renamed: superpowers-optimized → superpowers-orchestrator

**Problem.** The old name, `superpowers-optimized`, described the
fork's first change: token efficiency. The fork's main feature today is
the autonomous orchestration pipeline, so the name no longer matched.

**Change.** The plugin, the marketplace, and the GitHub repository are
renamed to `superpowers-orchestrator`. The skill prefix used in hints
and cross-skill references changes with them.

**Effect.** You must reinstall the plugin: an in-place update cannot
cross a rename. The entry lists the migration commands for Claude Code,
Codex, and OpenCode. GitHub redirects the old URLs and git remotes.

**Breaking change: the plugin and marketplace are renamed.** The installed
plugin id changes from `superpowers-optimized@superpowers-optimized` to
`superpowers-orchestrator@superpowers-orchestrator`, so the plugin must be
reinstalled — an in-place update cannot cross the rename.

- **Why the rename:** the old name described the fork's first change
  (token efficiency). The fork's main feature today is the autonomous
  orchestration pipeline (`orchestrating-development`, batched
  `subagent-driven-development`, `multi-code-review`). The name now matches.
- **Claude Code migration:** `/plugin uninstall superpowers-optimized`,
  remove the old marketplace entry, then
  `/plugin marketplace add brunob54/superpowers-orchestrator` and
  `/plugin install superpowers-orchestrator@superpowers-orchestrator`.
  If `~/.claude/settings.json` has an `extraKnownMarketplaces` entry for
  the old name, replace it — it re-seeds the marketplace list on start.
- **Codex migration:** rename the clone directory,
  `mv ~/.codex/superpowers-optimized ~/.codex/superpowers-orchestrator`
  (see `.codex/INSTALL.md`). The hook commands look for the new directory
  first and fall back to the old names.
- **OpenCode migration:** the plugin file is renamed to
  `superpowers-orchestrator.js`; remove the old
  `~/.config/opencode/plugins/superpowers-optimized.js` symlink and create
  the new one (see `.opencode/INSTALL.md`). The JS export is renamed
  `SuperpowersOptimizedPlugin` → `SuperpowersOrchestratorPlugin`.
- **GitHub repository** renamed to `brunob54/superpowers-orchestrator`;
  GitHub redirects the old URLs and git remotes.
- The skill prefix in this plugin's hints and cross-skill references is now
  `superpowers-orchestrator:`. The skill-name parser and the subagent guard
  accept both the old and the new prefix during the transition.
- Manifest `homepage`/`repository` fields and the session-start update
  check now point at `brunob54/superpowers-orchestrator` (previously the
  intermediate `REPOZY` fork, whose repo does not carry this fork's
  releases). The README lineage note keeps citing both upstreams as
  history.

## v6.15.1 — statusline bridge installer + configurable gate threshold

**Problem.** Wiring the statusline bridge by pointing settings.json at
the plugin cache path broke on every release, because that path
contains the version number. The start gate's block threshold was also
fixed at 60 percent and could not be changed.

**Change.** A new script, `tools/install-statusline-bridge.sh`, copies
the bridge to `~/.claude/statusline/` and prints the settings snippet.
The `SUPERPOWERS_PRESSURE_THRESHOLD` variable (10-90, default 60)
overrides the threshold.

**Effect.** The wiring survives plugin updates. Run the installer once,
and re-run it after each update.

- New `tools/install-statusline-bridge.sh` copies the statusline bridge to
  the version-independent `~/.claude/statusline/` and prints the
  settings.json snippet to wire it — pointing settings at the plugin cache
  path would break on every release, since that path embeds the version.
  Detects an existing `statusLine` and prints the delegate-mode variant
  instead, so a configured HUD keeps rendering. Re-run after plugin
  updates to refresh the installed copy.
- `SUPERPOWERS_PRESSURE_THRESHOLD` env var (a percentage, valid 10–90,
  default 60) overrides the start gate's block threshold on both the
  statusline-cache and transcript paths; the gate's STOP message reports
  the active value. Set it in settings.json's `env` block so it survives
  plugin updates. Invalid or out-of-range values fall back to 60.

## v6.15.0 — batched mode: fixed task cap replaces the measured batch boundary

**Problem.** Batched mode ended each batch using a context-pressure
measurement whose hardcoded 200K window overstated pressure about five
times on 1M-context models. Batches therefore ended near 13 percent of
real occupancy.

**Change.** A batch now ends at a fixed task cap: the count the user
gives, otherwise 3. An opt-in statusline bridge caches the true window
size, so the start gate reports the real number.

**Effect.** Batches run to their intended length. The 60 percent start
gate is unchanged. The bridge is optional and wired in settings.json.

- **subagent-driven-development** Batched Autonomous Mode now ends batches
  at a fixed task cap — the user's explicit count, otherwise 3 — instead of
  the in-batch 60% context-pressure measurement. Batches are expected to
  start in fresh sessions (the writing-plans handoff and resume flow both
  route through `/clear`), which made the measurement redundant; its
  hardcoded 200K window also overstated pressure ~5× on 1M-context models,
  ending batches at ~13% real occupancy.
- The 60% **start gate** on prompt submission is unchanged — it still
  catches implementation started mid-session with arbitrary existing
  context. The `--pressure` CLI remains as a manual inspection tool.
- orchestrating-development's cap-sizing note updated to match; the
  batched-mode behavioral test asserts the cap boundary instead of the
  pressure boundary; README and FORK-IMPROVEMENTS updated.
- **Statusline bridge (opt-in)** makes the start gate model-window-aware:
  new `hooks/statusline-context-cache.js` tees Claude Code's statusline
  `context_window` payload (which carries the TRUE window size — 200K, 1M,
  or larger) into `~/.claude/hooks-logs/context-window.cache.json`, and
  `getContextPressure()` prefers that cache when its session id matches
  the asking session (30-min staleness cutoff), falling back to transcript
  parsing against the 200K default otherwise. The gate's block message now
  reports the real window. Wire it in settings.json:
  `"statusLine": {"type": "command", "command": "node <plugin-cache-root>/hooks/statusline-context-cache.js"}`.
  Already have a statusline? Append `-- <your command>` and the bridge
  caches, then relays your renderer's output unchanged (falling back to
  its own line if the renderer fails).
  Subagents are unaffected — the statusline is main-session scoped, so the
  session-id match keeps the cache from ever misinforming them.

## v6.14.0 — orchestrating-development: autonomous spec→merge-gate pipeline

**Problem.** Turning an approved spec into reviewed code required the
user to start each stage by hand: plan writing, plan reviews,
implementation batches, then code reviews.

**Change.** A new skill, `orchestrating-development`, runs that whole
sequence from the spec: plan writing, N plan-review rounds, batched
implementation with a fresh controller subagent per batch, and N
code-review rounds. It stops only on major errors and ends before
merge or pull request.

**Effect.** One interactive Phase 0, then an autonomous run with a
committed log, plus resume and abandon procedures. Existing manual
workflows are unchanged.

- New skill **orchestrating-development**: from an approved spec, runs
  plan writing, N plan-review rounds, batched implementation (fresh
  controller subagent per ≤cap tasks, nested implementer/reviewer
  workers), and N code-review rounds fully autonomously — stopping only
  on major errors, ending before merge/PR. One interactive Phase 0
  (review counts, batch cap, branch-point + permission confirmations);
  committed orchestration log `docs/plans/…-orchestration-log.md`;
  resume and abandon procedures.
- `hooks/subagent-guard.js`: new `<!-- orchestration report -->` exempt
  marker for controller returns (free-text BLOCKED reasons may name
  skills); header now records that controller nested dispatch is
  sanctioned. Unit-tested in `tests/codex/test-subagent-guard.js`.
- `hooks/skill-rules.json`: routing entry for orchestrate / resume
  orchestration / abandon orchestration phrasings, rank-tested in
  `tests/codex/test-skill-activator.js`.
- `brainstorming` spec-review gate message now offers orchestration as
  an alternative to the manual writing-plans handoff. Existing manual
  workflows are unchanged.

## v6.13.0 — plan handoff starts a fresh session; batch phrasing routes correctly

**Problem.** Plan execution continued inside the planning session, so
planning context spent the batch budget before Task 1. A leftover
`state.md` could resume the wrong plan. The advertised phrase "execute
the plan in batches" routed to the wrong skill, and the trigger test
used `.some()`, so it never failed.

**Change.** `writing-plans` recommends `/clear` and seeds `state.md`
for the new plan. Batched mode checks `state.md` against the prompt and
ignores a stale one. Both routing patterns are fixed.

**Effect.** Execution starts clean and reaches the intended skill.
Nothing to migrate.

- `writing-plans` now recommends starting execution in a **fresh session**
  (`/clear`) rather than continuing in the planning session. Planning
  context — brainstorming, the plan itself, the multi-doc-review rounds —
  is dead weight for execution and spends the Batched Autonomous Mode
  context budget (60% pressure boundary) before Task 1 begins. The Ready
  Message now carries a paste-prompt table for batched / interactive
  subagent-driven / inline execution.
- `writing-plans` gained a **Seed `state.md`** step before the ready
  message: a full rewrite of the plan-execution sections pointing at the
  new plan. This is what makes the fresh session safe — without it, a
  `state.md` left over from a previous plan makes the next session resume
  the wrong plan.
- `subagent-driven-development` Batch Loop step 1 now cross-checks
  `state.md` against the prompt: if it names a different plan, or its plan
  file no longer exists, it is stale — ignored, and overwritten at batch
  end. Previously any `state.md` recording "a plan in progress" triggered
  the Resume Procedure, which then read *its* recorded plan path.
- **Fix (routing):** SDD's own advertised trigger "execute the plan in
  batches" routed to `executing-plans`, not `subagent-driven-development`
  — matches sort by priority before score, and `executing-plans` is
  `high` where SDD is `medium`. `executing-plans`' plan pattern now
  carries a distance-bounded negative lookahead
  (`(?![\s\S]{0,80}?\bin\s+batch)`), so batch phrasing drops it below the
  confidence threshold entirely instead of merely outranking it.
- **Fix (routing):** SDD's batch pattern required `plan` and `in batches`
  to be *adjacent*, so the phrasing users actually type — `execute the
  plan at docs/plans/X.md in batched autonomous mode` — matched SDD not at
  all. It now tolerates up to 80 characters between them
  (`plan\b[\s\S]{0,80}?\bin\s+batch`), which fits a plan path but excludes
  a distant unrelated mention of batching.
- The trigger test that should have caught both used `.some()` — asserting
  the skill was *present* among matches, not that it ranked first — so it
  stayed green throughout. `tests/codex/test-skill-activator.js` gains a
  `topSkill()` helper and 11 rank-asserting cases covering the batch
  phrasings, the writing-plans paste prompts, and the plain
  `executing-plans` phrasings that must not regress.

## v6.12.0 — SDD workspace is plan-scoped

**Problem.** A leftover `progress.md` from a finished plan read like a
completed record of the current plan, so the controller (the subagent
that executes the plan) could skip all work.

**Change.** `sdd-workspace` now takes the plan path and records it in
`.superpowers/sdd/plan.ref`; a workspace belonging to another plan, or
one without `plan.ref`, is archived first.

**Effect.** Each plan gets its own ledger. The first scoped run
archives any pre-6.12 workspace once; carried Minor findings then sit
in `archive/unknown-*/progress.md` — read them during final-review
triage.

- `scripts/sdd-workspace` now takes the plan path (`sdd-workspace PLAN_FILE`)
  and records it in `.superpowers/sdd/plan.ref`. A workspace belonging to a
  different plan — or a pre-6.12 workspace with no `plan.ref` — is archived
  to `.superpowers/sdd/archive/<slug>/` (moved, never deleted) before the
  new plan starts. Fixes the stale-ledger hazard where a leftover
  `progress.md` from a finished plan read exactly like a completed record
  of the current plan and could make the controller skip all work.
- Out-of-repo plans are supported: their identity is the absolute physical
  path (no error, no false mismatch).
- Arg-less calls (internal, from `task-brief`/`review-package`) are
  unchanged on stdout; they now print a stderr scoping line (or a legacy
  warning) so version-skewed sessions can see which plan the ledger
  belongs to. Archiving also prints an `archived previous workspace to
  archive/<slug>` notice on stderr.
- SDD SKILL.md: step 1 and the Batched Autonomous Mode Resume Procedure
  now pass `PLAN_FILE`; resume counts as a skill start for scoping.
  Checkboxes + `git log` stay authoritative for position.
- Upgrade note: the first scoped run archives any pre-6.12 workspace even
  when resuming the same plan (one-time cost); carried Minor findings are
  then in `archive/unknown-*/progress.md` — consult during final-review
  triage.

## v6.11.0 — multi-review renamed to multi-doc-review

**Problem.** Two loops had confusable names: `multi-review` reviewed
spec and plan documents, `multi-code-review` reviewed a branch diff. A
secret-protection rule also blocked writes whose text merely contained
`.env`.

**Change.** The document loop becomes `multi-doc-review`
(`/multi-doc-review <doc> [N]`); the old name no longer routes.
Behavior, lenses, and the report marker are unchanged. The `cat-env`
rule now stops at redirects, newlines, and `&`.

**Effect.** Rename the command in any script or note you keep; nothing
else to migrate. A 21-case unit suite covers the secret rule.

- **Breaking (invocation name):** the `multi-review` skill is now
  `multi-doc-review`; the slash form is `/multi-doc-review <doc> [N]`.
  The old name no longer routes. The rename disambiguates it from
  `multi-code-review` (v6.10.0) — this loop reviews spec and plan
  *documents*, that one reviews a branch diff.
- Renamed: `skills/multi-review/` → `skills/multi-doc-review/`,
  `tests/claude-code/test-multi-review.sh` →
  `tests/claude-code/test-multi-doc-review.sh`,
  `tests/skill-triggering/prompts/multi-review.txt` →
  `.../multi-doc-review.txt`; roster entry in `hooks/subagent-guard.js`
  and routing entry in `hooks/skill-rules.json` updated; brainstorming and
  writing-plans gate steps repointed.
- Unchanged: behavior, lenses, log format, and the reviewer report marker
  `<!-- multi-review report -->` — the marker is a shared wire protocol
  also emitted by `multi-code-review`, so renaming it would break both.
- Fix: the `cat-env` rule in `hooks/safety/protect-secrets.js` (and the
  opencode plugin's copy) blocked *writes* whose payload merely contained
  the token `.env` — `cat >> notes.md <<'EOF' … EOF` heredocs, generated
  docs — because its argument gap `[^|;]*` spanned redirects, newlines,
  and `&&`. The gap now excludes `>`, newlines, and `&`; `<` stays
  allowed so `cat < .env` is still caught. New unit suite
  `tests/codex/test-protect-secrets.js` (21 cases) covers both directions.

## v6.10.0 — multi-code-review: N-round independent whole-branch code review

**Problem.** A branch received a single final code-review pass. One
reviewer under one lens can miss defects.

**Change.** The new `multi-code-review` skill runs up to N rounds
(default 3, cap 10). Each round uses a fresh reviewer subagent under a
rotating lens plus one fix subagent, records a sidecar audit log, and
the loop exits early after two clean rounds.

**Effect.** subagent-driven-development now ends with this loop; direct
use is `/multi-code-review [BASE] [N]`. It needs Claude Code; other
platforms keep the single-pass review. Nothing to migrate.

- New `multi-code-review` skill: runs up to N (default 3, cap 10)
  independent review rounds on a branch diff — one clean-context reviewer
  subagent per round under a rotating lens (correctness/spec alignment,
  adversarial red-team, security, test quality, each with a
  prose/instruction-file adaptation) — with one fix subagent per round for
  Critical/Important findings, fresh review packages after fixes, a
  sidecar `.superpowers/reviews/<branch>-review-log.md` audit trail, and
  early exit after two consecutive clean rounds. No fix ships unreviewed:
  exits that would ship an unreviewed fix trigger a same-lens
  verification re-review (3-cycle cap).
- subagent-driven-development's final whole-branch review is now this
  loop (session model with sonnet floor, replacing the always-opus rule);
  direct use: `/multi-code-review [BASE] [N]`. Claude Code only —
  platforms without the Agent tool keep the single-pass final review.

## v6.9.0 — multi-review: N-round independent document review

**Problem.** A spec or plan reached its approval gate after a single
review pass. One reader under one lens misses issues.

**Change.** The new `multi-review` skill runs up to N document review
rounds (default 3, cap 10), each with a fresh reviewer subagent under a
rotating lens, merges Critical and Important findings between rounds,
and exits early after two clean rounds.

**Effect.** brainstorming and writing-plans run the loop automatically
before their approval gates; direct use is `/multi-review <doc> [N]`.
Plan headers now carry a `**Spec:**` line. Nothing to migrate.

- New `multi-review` skill: runs up to N (default 3, cap 10) independent
  review rounds on a spec or plan — one clean-context reviewer subagent per
  round under a rotating lens (correctness, ambiguity, feasibility,
  adversarial) — merging Critical/Important findings between rounds, with a
  sidecar `<doc>-review-log.md` audit trail and early exit after two
  consecutive clean rounds.
- brainstorming and writing-plans invoke the loop automatically before their
  user approval gates (once per gate); direct use: `/multi-review <doc> [N]`.
- writing-plans Plan Header gains a `**Spec:**` line so plan reviews can
  locate their spec.
- subagent-guard: reviewer reports (marker `<!-- multi-review report -->`)
  are exempt from skill-leakage blocking; `multi-review` added to the roster.
- Removed orphaned `spec-document-reviewer-prompt.md` /
  `plan-document-reviewer-prompt.md` (superseded).

## v6.8.0 (2026-07-18)

**Problem.** Each task was reviewed by two subagents — one for spec
compliance, one for quality — and dispatch prompts carried pasted
handoff text. That cost extra turns and tokens.

**Change.** One reviewer now returns both verdicts, and new scripts
(`sdd-workspace`, `task-brief`, `review-package`) write briefs,
reports, and review diffs to files that dispatch prompts reference by
path. Every dispatch must name its model.

**Effect.** Upstream measured about 2x faster runs and 50-60% fewer
tokens. Nothing to migrate.

### Subagent-Driven Development: token-optimized review flow (port of upstream v6.0.0)

Ports obra/superpowers v6.0.0's measured cost rework (~2x faster, ~50-60% fewer tokens in upstream evals), adapted to this fork's Parallel Waves and Batched Autonomous Mode.

- **One reviewer per task, two verdicts.** `spec-reviewer-prompt.md` and `code-quality-reviewer-prompt.md` are replaced by a single `task-reviewer-prompt.md` returning a spec-compliance verdict and a quality verdict, plus a "⚠️ cannot verify from diff" verdict the controller resolves itself. One fix pass clears both; reviewers are read-only and immune to implementer rationales.
- **Handoffs move as files.** New scripts `sdd-workspace`, `task-brief`, and `review-package` write task briefs, implementer reports, and review diffs (commit list + stat + `-U10` diff) to `.superpowers/sdd/`. Dispatch prompts carry paths, not pasted text.
- **Fork extension: `review-package --commits SHA...`** builds a wave task's package from its own reported commits — a BASE..HEAD range would mix interleaved sibling tasks' changes. Range fallback is banned in waves.
- **Every dispatch names its model.** Templates mark `model:` REQUIRED (an omitted model silently inherits the session's most expensive one), with turn-count-beats-token-price guidance; the final whole-branch review always runs on the most capable model.
- **Controller discipline:** at most one narration line between tool calls; a durable progress ledger (`.superpowers/sdd/progress.md`) prevents re-dispatching completed tasks after compaction; pre-flight plan review; ONE fix subagent per review's findings; reviewer coaching banned.
- **writing-plans:** plans now carry a Global Constraints block, handed verbatim to every reviewer.
- New fast test suite: `tests/sdd-scripts/run-tests.sh`.

## v6.7.1 (2026-07-18)

**Problem.** The systematic-debugging routing rule in
`hooks/skill-rules.json` contained neither "debug" nor "root cause", so
a prompt such as "debug this stack trace and identify the root cause"
scored below the confidence threshold and received no skill hint.

**Change.** Both words were added to that rule.

**Effect.** Canonical debugging prompts now route to
systematic-debugging. Three new matcher tests cover the change,
including a negative case for the `--debug` build flag. Nothing to
migrate.

Debug-prompt routing fix.

### Fixes

**systematic-debugging trigger keywords** — Added "debug" and "root cause" to the systematic-debugging rule in `hooks/skill-rules.json`. Canonical debugging prompts such as "debug this stack trace and identify the root cause" scored below the routing confidence threshold because the rule contained neither word, so no skill hint was injected. Surfaced by the repo-adapter smoke checks in the Codex post-push validation checklist — these run the hook scripts directly against fixture input and need no live Codex install, which is what was done here; covered by three new matcher tests (including a `--debug`-build-flag negative).

## v6.7.0 (2026-07-07)

**Problem.** A long plan had to finish inside one session. Nothing
ended execution at a safe point or carried the position forward.

**Change.** Batched Autonomous Mode executes up to N plan tasks per
session, ends the batch when context pressure reaches 60% (measured by
the new `--pressure` CLI, with a 3-task fallback), writes a handoff
into `state.md`, and resumes after `/clear` from plan.md checkboxes and
git.

**Effect.** Say "resume the plan" to start the next batch. A
path-encoding fix restores pressure measurement for project paths
containing underscores or dots. Nothing to migrate.

Batched Autonomous Mode: resumable, context-bounded plan execution.

### New Features

**Batched Autonomous Mode (subagent-driven-development)** — Execute up to N plan tasks per session, each via a fresh subagent with full review gates, ending the batch when context pressure reaches 60% (measured live via the new `--pressure` CLI on the skill-activator hook, with a conservative 3-task fallback cap when measurement fails). Execution inside a batch is strictly sequential and fully autonomous: blockers and plan ambiguities end the batch early with a journaled question instead of a guess, superseding the interactive escalation paths. At batch end the orchestrator writes a handoff into `state.md` (100-line cap, no cumulative re-summarizing) and prints exact resume instructions; after `/clear`, "resume the plan" reconciles position from plan.md checkboxes + git (authoritative) against the state.md narrative, refuses to run past unanswered blocking questions, and starts the next batch. Plan-complete batches skip resume instructions and route to the final whole-branch review. Spec: `docs/superpowers-orchestrator/2026-07-06-sdd-batched-autonomous-mode/specs/sdd-batched-autonomous-mode-design.md`.

**`--pressure` CLI on skill-activator** — `node hooks/skill-activator.js --pressure [cwd]` reports the current session's context pressure as JSON by reading the most recently modified session JSONL, reusing the v6.6.1 pressure-gate estimation. Prints `{"error":"unmeasurable"}` when no usable session data exists.

### Changes

**subagent-driven-development triggers** — `hooks/skill-rules.json` now routes "implement the next N tasks", "execute the plan in batches", and "resume the plan/implementation" to subagent-driven-development. Trigger vocabulary was deliberately kept narrow after false-positive analysis: generic terms ("handoff", "next tasks") were excluded, and the resume pattern ignores conversational tails ("resume the plan discussion").

**Test coverage** — Unit tests for session autodiscovery, the `--pressure` CLI, and trigger matching (incl. false-positive regressions) in `test-skill-activator.js`; new integration test `tests/claude-code/test-batched-autonomous-mode.sh`; skill-triggering prompt for batched execution.

### Fixes

**`cwdToProjectDir` encoding (skill-activator)** — Project paths are now encoded by normalizing every non-alphanumeric character to a dash, matching Claude Code's real session-directory naming. Previously underscores and dots were preserved, so on any project path containing them (e.g. `.../AI_Coding/My_tools/...`) the session JSONL lookup silently missed — which disabled both the new `--pressure` CLI and the pre-existing v6.6.1 context-pressure gate for those projects. Caught by a live smoke test in the final whole-branch review; the unit tests had passed because they round-tripped paths through the same (wrong) encoder on both sides. A regression test now asserts against the hardcoded real-world encoding.

**smart-compress test harness** — Repaired 10 chronic failures (some latent for multiple releases) in `tests/smart-compress/run-tests.sh`. The bash suite invoked `bash-compress-hook.js` twice per command under a shared session id — colliding with the hook's intentional once-per-session re-run skip, whose tmpdir tracking files also persist across runs for constant session ids (the source of the "flaky" pass-on-first-run-only behavior). Tests now use a unique session id per invocation; the end-to-end git-log test asserts on the live `HEAD` subject instead of a hardcoded commit message that had scrolled out of the truncated output window. Suite is 87/87 across repeated runs; hook behavior unchanged.

## v6.6.1 (2026-05-08)

Context pressure gate, Tailwind v4 reference, plan-level security flag, stub scan, and cleaner docs paths.

### New Features

**Context pressure gate** — The skill-activator hook (and its Codex adapter) now reads the live session JSONL to estimate context window usage, and hard-blocks plan-execution prompts when the last assistant turn exceeded 60% of the 200K window. When triggered, the hook replaces all skill hints with a compact-first instruction telling the model to save state.md via context-management, run /compact, and resume from state.md. This prevents Auto Compact from firing mid-implementation and destroying file paths, variable names, and discovered facts at the worst possible moment. Pressure is computed from `input + cache_creation + cache_read` of the last assistant turn — that is the actual current context size, not a cumulative sum across turns.

**Tailwind v4 reference (`skills/frontend-design/tailwind-v4.md`)** — A dedicated companion file with v4 install commands, `@theme` config syntax, renamed class scales, and new features. Frontend-design's training data is biased toward v3, which leads to broken setups when scaffolding for current Tailwind. The skill now routes to this file before any Tailwind work on greenfield or version-unknown projects.

### Changes

**Writing-plans: security flag per task** — Every task in a plan now carries a `Security flag: none | security` line. Setting it to `security` (for tasks handling auth, credentials, input validation, permissions, crypto, or data-access boundaries) triggers a pre-implementation security review before the implementer is dispatched. Catches the class of bug where security-relevant work ships without anyone explicitly checking it.

**Writing-plans: scope-reduction scan** — Plan self-review now searches the plan for "v1", "basic", "simple", "for now", "placeholder", "initial version", and "minimal", and verifies each hit was explicitly sanctioned by the user. Catches quiet scope downgrades where the model promises less than what was asked for without flagging it.

**Writing-plans: execution auto-selection** — Replaces the open "Which approach?" question with deterministic logic: ≥60% context or ≥5 tasks → subagent-driven; heavy inter-task state sharing → inline; default → subagent. The "Ready to execute" framing and explicit "Stop here" instruction give the user a real redirect window instead of the model chaining straight into execution.

**Verification-before-completion: stub scan** — Implementation tasks now require a grep pass for `TODO`, `FIXME`, `placeholder`, and `NotImplementedError` (excluding test files) before any "done" claim. Any hit in a file the task created or modified blocks completion until the stub is removed or explicitly justified. Catches the common failure mode of declaring success while leaving stub code in production.

**Frontend-design: framework & version awareness** — Before scaffolding any CSS framework, the skill now requires inspecting `package.json` and CSS entry files to detect the existing version (or stating the chosen version explicitly on greenfield). Mixing v3 config syntax with v4 CSS directives produces broken builds; this gate prevents that class of error.

**Dependency-management trigger refinement** — Removed "version bump" from the dependency-management trigger keywords. It was overlapping with the dedicated `version-bump` skill, causing the wrong workflow to load on plain version-bump requests.

**Cleaner docs output paths** — Brainstorming specs and writing-plans plans now save to `docs/specs/` and `docs/plans/` instead of `docs/superpowers-optimized/specs/` and `docs/superpowers-optimized/plans/`. The plugin name no longer surfaces in the folder structure of every project that uses these skills. CLAUDE.md, both skill files, both reviewer prompt templates, the autoimprove fixture, and all integration tests were updated. The `stop-reminders` decision-log detection was unaffected — its regex already matched any `specs/` or `plans/` parent folder rather than the plugin-namespaced one, so existing repos with the old path continue triggering reminders correctly.

**Test coverage** — ~290 lines of new tests in `test-skill-activator.js` cover the context pressure gate: execution-trigger pattern matching, Windows/Unix `cwdToProjectDir` encoding, JSONL pressure parsing, threshold behavior, and the block message format.

## v6.6.0 (2026-04-15)

Full-stack audit: 3 new skills, smarter cross-session memory, scope gates across 6 skills, and expanded hook coverage.

### New Features

**Refactoring skill** — Enforces behavior-locking tests before any structural change and incremental verification after each move. Four phases: lock current behavior with characterization tests, define the refactoring boundary, make one structural change at a time with tests green after each, then audit for stale references. Includes guidance on writing characterization tests for side-effectful code and detecting test runners automatically.

**Performance Investigation skill** — Measure-first methodology for performance work. Requires a quantitative baseline before any optimization, profiling to identify the actual bottleneck (not the guessed one), a hypothesis with predicted improvement, and re-measurement after every change. Profiling tool recommendations are CLI-friendly so the AI can read output directly; GUI-only tools prompt the user to share results.

**Dependency Management skill** — Structured incremental updates with verification at each step. Covers the full lifecycle: audit outdated packages, assess impact from changelogs, update one dependency at a time with test/build/smoke verification, and handle security vulnerabilities as a special case. Includes lockfile merge conflict resolution, version pinning strategy, and monorepo coordination guidance.

**Weighted memory scoring** — The skill-activator hook now ranks session-log and known-issues matches using a weighted score (70% keyword density + 30% recency) instead of flat boolean matching. More relevant entries surface first.

**Per-project watermark** — The context-engine hook now creates a per-project watermark file (md5 hash of cwd) so multiple projects sharing the same machine don't overwrite each other's session-start state.

**Cross-session diff base** — When a valid watermark exists from a previous session, the context-engine uses it as the git diff base instead of HEAD~1. This means the "what changed" snapshot reflects changes since your last session, not just the last commit.

**Blast radius import filtering** — The context-engine's blast radius analysis now applies a secondary filter checking for actual import/require/from references, reducing false positives from files that happen to contain the same basename but don't actually depend on the changed file.

### Changes

**6 scope gates added to existing skills** — frontend-design checks for an existing design system before generating a new one; TDD bootstraps test infrastructure before writing the first test; finishing-branch pulls decisions from session-log into PR descriptions; using-superpowers has a soft gate for existing projects without memory files; deliberation has a loop guard preventing infinite deliberation-premise-check cycles; context-management clarifies state.md vs plan.md roles.

**Subagent guard expanded** — The action verb pattern now catches activate/trigger/execute/launch/spawn/start in addition to the original invoke/use/run/call verbs. Also detects Skill tool invocation patterns (`Skill("superpowers..."`, `skill: "brainstorming"`).

**Stop-reminders pattern coverage widened** — The isSignificantSession check now detects edits to specs/*.md, plans/*.md, and plugin.universal.yaml in addition to SKILL.md, hooks/*.js, and CLAUDE.md.

**Session-log hard cap raised** — The per-entry hard cap was raised from 1000 to 1500 characters (~375 tokens) to accommodate multi-subsystem sessions that legitimately need more space.

**Session-start awk parser fix** — The parser that extracts recent [saved] entries now correctly flushes the previous block when encountering consecutive [saved] entries. Previously, consecutive entries without non-[saved] content between them would silently drop the earlier entry.

### Fixes

**Systematic-debugging post-fix improvement** — After resolving a bug, the skill now suggests promoting permanent discoveries to project-map.md Critical Constraints, ensuring hard-won architectural knowledge persists beyond the session-log.

**3 new test suites** — Added dedicated test files for context-engine.js (16 tests), stop-reminders.js (14 tests), and subagent-guard.js (25 tests). Combined with the existing skill-activator tests (41), the plugin now has 96 unit tests covering all major hooks.

## v6.5.2 (2026-04-11)

Stop hook reliability, session isolation, and subagent plan tracking improvements.

### Fixes

**Stats-only sessions no longer trigger stop-hook blocking** — In v6.5.1, the stop hook would emit `decision: "block"` even when the only available reminder was the informational session-stats summary (e.g., "6 min, 1 skill invocation"). Users saw "Stop hook error: Session summary: ..." after every turn in light sessions. The hook now checks for actionable reminders before blocking; stats-only sessions return `{}` silently.

**Edit log is now session-aware — no cross-session contamination** — The shared `~/.claude/hooks-logs/edit-log.txt` used a 3-field format (`timestamp | tool | path`) with no session identifier. Test sessions running via `claude -p` saw edits from the interactive session, triggering false-positive TDD and decision-log reminders inside headless test runs. The log format is now 4-field (`timestamp | session_id | tool | path`) and `stop-reminders.js` filters entries by the current session id, so each session only sees its own edits.

**Plan checkboxes now enforced after subagent-driven development** — The subagent-driven-development skill previously marked tasks complete without updating the `- [ ]` checkboxes in `plan.md`. The task-complete instruction now explicitly requires changing `- [ ]` to `- [x]` in `plan.md` and syncing `state.md` if present, matching the intent of the plan-tracking system.

**State.md staleness detection added to stop hook** — The stop hook now detects when `state.md` exists and contains plan status that appears out of date relative to recent edits (modified source files with no corresponding state update). Users see a targeted reminder to update `state.md` rather than silently leaving it stale across sessions.

**Context-management resets the decision-log reminder marker** — After saving context, the skill now writes a timestamp to `~/.claude/hooks-logs/last-saved-entry.txt`. The stop hook uses this marker to suppress the "update your decision log" reminder immediately after a context-management save, preventing redundant reminders in the same turn.

## v6.5.1 (2026-04-10)

Patch release focused on Stop-hook correctness and reminder signal quality.

### Fixes

**Claude Code `Stop` hook output contract corrected** — `hooks/stop-reminders.js` previously emitted `hookSpecificOutput` with `hookEventName: "Stop"`, which Claude rejects on Stop events with JSON validation errors. The Stop reminder path now emits a schema-valid continuation payload (`decision: "block"` + `reason`) and keeps `{}` for no-op cases. A regression suite (`tests/codex/test-stop-reminders.js`) now enforces this output shape.

**Stop-hook TDD reminders now recognize `test-*.js` under `tests/`** — Both Stop reminder implementations now classify repository-style test filenames such as `tests/codex/test-stop-reminders.js` as tests, preventing false-positive “source changed without tests” reminders when test files use `test-*.js` naming instead of `*.test.js`.

## v6.5.0 (2026-04-09)

Codex parity hardening: the plugin now follows the current Codex hook contract more closely, adds reactive Bash smart-compress on Codex, and tightens install/update guidance so complete Codex installs are easier to get right.

### New Features

**Codex `PostToolUse(Bash)` smart-compress** — Codex sessions can now replace noisy Bash output after execution with a compressed summary using the same compression rules already used by the Claude-side Bash compressor. Large `find`/`ls` output and long passing test runs can be collapsed to concise summaries with explicit `[smart-compress]` and `[compressed: X->Y lines | type]` markers, reducing context waste without hiding failures.

### Changes

**Codex hook set expanded to five native hooks** — The Codex build now wires `SessionStart`, `UserPromptSubmit`, `PreToolUse(Bash)`, `PostToolUse(Bash)`, and `Stop` through dedicated Codex adapters. This keeps the Codex path aligned with the current official hook model while still acknowledging the remaining platform limits versus Claude Code.

**Codex install/update docs now define a complete install** — The Codex docs now treat skills, custom agents, and macOS/Linux lifecycle hooks as the standard install on supported platforms, include a clean reinstall fallback for stale or inconsistent local installs, and call out `codex-cli 0.118.0+` as the minimum tested version for live hook behavior.

**Compiler/reporting language is now precise about Codex parity** — Generated loss reports and the Codex-facing docs now say only what they actually prove: native compilation for hooks targeted to Codex, not full Claude parity. This removes misleading wording that could imply unsupported Claude-only hook surfaces also existed on Codex.

### Fixes

**Codex hook output/registry compatibility hardened** — The Codex-generated hook registry now uses the current top-level `hooks` shape, the plugin manifest no longer carries the stale Codex `hooks` field, and the Codex-specific adapters now emit the output shapes expected by the current Codex docs. This addresses the class of failures where Codex would silently ignore hooks or reject invalid hook output.

**Codex `Stop` and `PostToolUse(Bash)` are now validated live, not just by unit tests** — The Codex `Stop` adapter now uses the continuation-block path (`decision: "block"` + `reason`) that Codex actually surfaces at turn end, and the reactive Codex `PostToolUse(Bash)` smart-compress path has been proven live on `codex-cli 0.118.0` for compressible commands such as `find . -type f`. This closes the earlier uncertainty where the adapters looked correct locally but had not yet been confirmed against the real Codex runtime.

**Codex JSON transcript interpretation is now documented correctly** — In `codex exec --json`, the `command_execution.aggregated_output` field can still show the original raw Bash output even when the model was actually continued from the hook-provided compressed replacement. The Codex test checklist and troubleshooting guidance now treat the final model-visible response and captured hook output as the source of truth for `PostToolUse(Bash)` verification.

**Codex Bash safety checks close more real shell read paths** — The Codex Bash safety path now catches additional `.env` read patterns such as `sed` and `awk`, reducing the chance that a secret file read slips past Codex's Bash-only interception surface.

## v6.4.0 (2026-04-07)

Native Codex hooks, OpenCode safety parity, hookbridge migration, and memory system improvements.

### New Features

**Native Codex hook adapters** — Three new adapter scripts in `hooks/codex/` bring full lifecycle hook support to Codex (macOS/Linux with hooks enabled):
- `session-start-adapter.js` — injects project context (project-map, session-log, state, known-issues) at session start, matching the Claude Code session-start hook behavior
- `stop-adapter.js` — generates discipline reminders at turn end using git uncommitted changes instead of edit-log.txt (which Codex cannot write)
- `pretool-bash-adapter.js` — single dispatcher for PreToolUse(Bash): runs dangerous-command and secret-protection checks in one process (required because Codex fires multiple matching hooks concurrently)

The `codex-hooks.json` now registers all four Codex hook events: `SessionStart`, `UserPromptSubmit` (skill activator), `Stop`, and `PreToolUse(Bash)`.

**Codex agent configs** — `codex-agents/code-reviewer.toml` and `codex-agents/red-team.toml` enable native Codex agent support for the code-reviewer and red-team workflows, but Codex still requires manual placement in `~/.codex/agents/` because plugin manifests cannot bundle TOML agents.

**OpenCode `tool.execute.before` safety hook** — The OpenCode plugin now intercepts all bash, read, edit, and write tool calls before execution, applying the same safety checks as the Claude Code hooks: 19 dangerous command patterns, 25 sensitive file path patterns, 14 secret-leaking bash patterns, and hardcoded secret detection for write operations. Blocking is via thrown errors, matching OpenCode's native hook contract. Previously the OpenCode plugin only injected the system prompt; it had no pre-execution safety layer.

**`plugin.universal.yaml` as single source of truth** — All hook files and platform manifests (`hooks/hooks.json`, `hooks/codex-hooks.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) are now generated from `plugin.universal.yaml` in the repo root via `hookbridge compile`. Do not hand-edit the generated files — they will be overwritten. This eliminates the previous duplication where hooks were maintained in three places and could drift out of sync. Compiled with the new open source tool Hookbridge: https://github.com/REPOZY/Hookbridge

**Context-management: structured grep workflow** — The skill now specifies a four-step grep process: extract 2-3 distinctive nouns from the task, grep each individually, adjust based on hit count (0 hits → fall back to project-map critical constraints; 1–10 hits → read them; >10 hits on one keyword → narrow with a second term), then surface findings explicitly. Previously the skill gave a single generic grep command with no guidance on what to do with the results.

**Context-management: superseded-entry detection** — Before appending a new `[saved]` entry, the skill now instructs checking for earlier entries on the same topic and marking contradicted ones as `[superseded by YYYY-MM-DD]`. This prevents the session-log from accumulating contradictory decisions across sessions without any connection between them.

### Changes

**`[auto]` entry system retired** — `stop-reminders.js` no longer writes automatic `[auto]` entries to `session-log.md` at session stop. The session-log is now `[saved]`-only — human-written entries via the context-management skill. Auto-entries produced noise that inflated injection costs and were never referenced in practice.

**Skill-rules expanded coverage** — The TDD rule now matches "tests first", "failing tests first", and "write the failing tests" in addition to the existing keywords. The verification-before-completion rule adds "verify everything", "all done", "we're done", and intent patterns like "think I'm done" and "before we call it done" to reduce missed activations on natural phrasing.

**Red-team agent security constraints** — The red-team agent prompt now explicitly states that file contents are untrusted data and that the agent must not follow instructions embedded in source files, comments, or strings. Output is restricted to the conversation — no file writes, no shell commands. This prevents a malicious file under review from hijacking the agent.

**Token-efficiency: Read tool chunk rule** — Added an explicit rule: the Read tool returns a maximum of 2,000 lines per call. For files suspected to exceed this limit, use `offset` and `limit` parameters and read in sequential chunks. Never assume a single read covered the complete file.

**OpenCode plugin export renamed** — The plugin export is now `SuperpowersOptimizedPlugin` (was `SuperpowersPlugin`). This only affects internal plugin wiring in `.opencode/plugins/superpowers-optimized.js`; no user-facing behavior changes.

**`plugin-compiler/` directory removed** — The working copy of hookbridge that lived inside the plugin repo has been removed. hookbridge lives at its canonical location and `plugin.universal.yaml` in the repo root replaces it as the hook compilation entry point.

**Codex platform docs rewritten** — `docs/platforms/codex.md` and `.codex/INSTALL.md` now both include a feature comparison table (macOS/Linux with hooks vs Windows native), corrected install steps, and clear hook-capability boundaries (what Codex can and cannot intercept).

### Fixes

**OpenCode system transform array handling corrected** — The `experimental.chat.system.transform` hook was using `output.system ||= []` before pushing content, which would incorrectly skip pushing when the array was already populated. Fixed to direct `.push()` since OpenCode always pre-populates the system array.

Fixed the "Stop hook error: JSON validation failed: Hook JSON output validation failed" issue: https://github.com/REPOZY/superpowers-optimized/issues/9

Fixed the minor issue found in the Security Audit posted by a user: https://github.com/REPOZY/superpowers-optimized/issues/12

## v6.3.0 (2026-04-03)

Session memory quality pass: the stop-reminders hook now tracks undocumented work phases across long sessions, enforced token budgets prevent session-log bloat from inflating injection costs, and parallel dispatch defaults are corrected in two skills.

### New Features

**Phase-aware decision-log reminders** — The stop-reminders hook previously asked "were significant files edited in the last 30 minutes?" — a window that fails in long sessions with multiple work phases (same edits stay in the window after a `[saved]` entry, while later phases can slip out entirely). It now asks "were significant files edited since the last `[saved]` entry?" The `track-edits` hook detects when a `[saved]` entry is written to `session-log.md` and records a timestamp marker; `stop-reminders` reads that marker at Stop time. Each logical work batch gets exactly one reminder at the right time, with no false positives between phases.

**Session-log token budget guard** — `stop-reminders` now measures the last 2 `[saved]` entries at every session Stop and warns when any entry exceeds the 250-token budget (~1,000 characters). These entries are injected into every future session; a bloated entry costs tokens forever. The warning identifies the specific over-budget entry and instructs what to trim.

**Strict `[saved]` entry template in context-management** — The context-management skill's `[saved]` entry template now has an explicit structure (Goal / Decisions / Rejected / Open only), a "Never include" list (test results, task checklists → `state.md`, how-it-works walkthroughs, speculative analysis → design docs, one-time confirmations), and a hard token budget. Without this enforcement, the AI defaulted to "more is safer" and wrote entries that were 5–10× over the optimal size.

**dispatching-parallel-agents skill hint added** — `skill-rules.json` now includes a rule for `dispatching-parallel-agents` — it was the only skill with no hint coverage, meaning prompts like "dispatch these tasks simultaneously" received no routing suggestion.

### Changes

**Parallel Waves is now the default in subagent-driven-development** — "Parallel Waves" was previously labeled "Optional Speed Mode". It is now the stated default for independent tasks; sequential execution is the explicit fallback for tasks with shared-file or state dependencies. The single-message dispatch requirement is now explicit in both `subagent-driven-development` and `dispatching-parallel-agents`, with a rationale: all subagents share the same cached system prompt prefix, and dispatching them in one message ensures every agent gets a cache hit on the heavy shared prefix.

**Anti-sycophancy rules added to global CLAUDE.md** — Four rules now govern position stability: don't revise a stated position under pushback without new evidence; proactively state the strongest objection to any non-trivial proposal; agreement must cite a specific reason, not just affirm; state confidence level explicitly when uncertain.

## v6.2.0 (2026-03-30)

Cross-session memory overhaul: the full memory stack is now injected automatically at session start, stop-reminders actually writes to session-log.md, and agents can no longer waste tokens as content relays.

### New Features

**Full memory stack injected at session start** — `session-log.md` (last 2 `[saved]` decisions), `state.md` (active task snapshot), `known-issues.md` (error map), and `context-snapshot.json` (changed files + recent commits) are now all injected into session context by the session-start hook — unconditionally, without requiring the AI to remember to read them. Previously only `project-map.md` was injected; the rest depended entirely on AI compliance with the entry sequence.

**Decision-log reminder in stop-reminders** — When the session modified SKILL.md files, hooks, or plugin config, the Stop hook now surfaces an explicit prompt to invoke `context-management` before ending the session. These are the sessions where the "why" matters most and is most likely to be lost.

### Changes

**Agent & External Content Rules added to token-efficiency** — Five new rules cover the behavioral characteristics of the Agent tool and WebFetch that the AI previously had to discover by failure: agent results are always compressed on return (never use agents as content relays), WebFetch returns AI summaries not raw text (use `curl -sf` for verbatim URL content), and local files should always be Read directly. These rules are always-on from session start.

**"When the User Names a Specific Skill" section added to using-superpowers** — Clarifies that phrases like "use brainstorming" or "use context management" are Skill tool invocations, not conceptual goals to achieve ad-hoc. This was the root cause of entry sequence bypass in analyzed session transcripts: the AI improvised with agents instead of calling the Skill tool.

**Mandatory first actions surfaced at injection point** — The session-start hook now prepends three concrete steps before the full using-superpowers body: activate token-efficiency, classify complexity, and invoke named skills via the Skill tool. Previously these were buried in the skill text where they competed with everything else for attention.

**Content-relay anti-pattern added to dispatching-parallel-agents** — "The task is content relay" is now an explicit entry in the "Do not use when" list, with a one-line explanation: agent results are compressed, raw content will be lost.

**using-superpowers step 4 extended** — Now requires a `[saved]` entry at the end of any session where significant decisions were made, not just sessions with ongoing incomplete work.

**`known-issues.md` added to auto-gitignore list** — `track-edits.js` now includes `known-issues.md` in the AI_ARTIFACTS list so it is automatically added to `.gitignore` on first write.

### Fixes

**stop-reminders.js never wrote to session-log.md** — The hook was documented as "auto-writes session-log.md `[auto]` entry" but only wrote to a private temp file at `~/.claude/hooks-logs/edit-log.txt`. The `[auto]` entries visible in prior session logs were written manually by the AI. Fixed: the hook now writes a proper `[auto]` entry to `session-log.md` in the project root on session stop, gated by the existing 2-minute guard to prevent duplicates.

**MANDATORY FIRST ACTIONS had invalid JSON** — The preamble added in the previous session contained literal unescaped double-quotes (`"use brainstorming"`) inside the bash string that produced the hook's JSON output. This caused `JSON.parse` failures on every session start for any platform that validated the JSON. Fixed by removing the quotes from the example text.

## v6.1.0 (2026-03-28)

Skill quality pass: two new automated review gates, richer subagent prompts, sharper stop conditions, and a fix to the project-map staleness loop.

### New Features

**Spec reviewer gate in brainstorming** — After a design is approved and saved, `brainstorming` now dispatches a spec-reviewer subagent using a calibrated prompt template (`spec-document-reviewer-prompt.md`) before handing off to `writing-plans`. The reviewer checks for placeholders, internal contradictions, ambiguous requirements, and scope creep. Critical issues block the handoff; minor issues become advisory recommendations. This catches design gaps before they propagate into the plan.

**Plan reviewer gate in writing-plans** — `writing-plans` now dispatches a plan-reviewer subagent using `plan-document-reviewer-prompt.md` after the plan is saved. The reviewer cross-checks the plan against the original spec — not just the plan in isolation — catching scope drift, vague steps, missing file paths, and incorrect TDD ordering. Both reviewer prompts include skill leakage prevention to keep subagents focused.

### Changes

`**dispatching-parallel-agents` strengthened** — Added a "Do not use when" block covering exploratory debugging, related failures, and shared-state scenarios. Added an assembled example prompt showing all required fields (scope, goal, constraints, output format, leakage prevention) wired together. Added a ❌/✅ common mistakes section. Updated the description to "2+" (more precise than "multiple") and added "sequential dependencies" as an explicit disqualifier alongside file and state conflicts.

`**executing-plans` stop conditions expanded** — The single "stop on repeated verification failures" bullet is replaced with a named list: missing dependency, plan gap preventing start, unclear/contradictory instruction, repeated verification failure. Added "never guess — ask for clarification" as an explicit directive. Added the main/master branch prohibition with a reference to the worktree step.

`**claude-md-creator` self-assesses redundancy** — The skill no longer asks the user "anything you'd cut?" It now applies the redundancy filter itself before presenting the draft: every line must pass "would the agent produce incorrect output without this?" Lines that don't survive the filter are cut before the user sees them.

**PR description required in `finishing-a-development-branch`** — Option 2 (push + open PR) now requires a structured description: what changed, why, how to verify, and notable decisions. Previously the skill just said "Create PR" with no guidance on content.

**Worktree path persistence clarified** — `using-git-worktrees` now explicitly states that the `cd` in the creation step does not persist across separate shell calls, and that all subsequent commands must use the full worktree path or `cd <path> && <command>` inline.

`**find-polluter.sh` surfaced for test pollution** — `systematic-debugging` Phase 1 now references the `find-polluter.sh` script for tests that fail only in certain orderings. Previously the script existed in the skill folder but was never mentioned in the skill itself.

### Fixes

**project-map.md staleness loop fixed** — The staleness check in `using-superpowers` entry sequence step 6 detected stale map entries and re-read changed files — but never wrote the updates back. Every session with a stale map would re-read the same files and leave the map unchanged for next time, repeating the cycle forever. The check now explicitly updates the changed Key Files entries and refreshes the git hash in the header after re-reading, breaking the loop.

**project-map.md version sync constraint was incomplete** — The constraint listed three manifest files that must stay version-synced, but omitted `.codex-plugin/plugin.json` and `VERSION` (both required per `CLAUDE.md`). A version bump following the map's constraint would silently miss two files. Updated to list all five.

**context-snapshot.json creation expectation clarified** — When `git init` runs mid-session via the fresh-project gate, `context-snapshot.json` is not created in that session (the context-engine hook already fired at session start before git existed). The confirm path in `using-superpowers` now states this explicitly and notes that the file will appear on the next session start from the project root.

## v6.0.0 (2026-03-24)

Comprehensive codebase audit and hardening. Twelve bugs, routing gaps, and safety issues found and fixed across hooks, skill routing, and the subagent guard.

### Fixes

**Gitignore corruption when section already exists** — When `track-edits.js` appended an AI artifact to an existing `# AI assistant artifacts` section in `.gitignore`, it omitted the newline prefix, causing the new entry to be concatenated onto the last line of the file if it lacked a trailing newline. The entry would be silently malformed and git would not recognize it. Fixed by applying the `prefix` variable in both branches.

**Dead export `appendAutoSessionEntry` in stop-reminders** — `stop-reminders.js` exported `appendAutoSessionEntry` in its `module.exports`, but the function was never defined anywhere in the file. Any consumer calling it would get a `TypeError`. Removed from exports.

**Cross-platform cache age check in session-start** — The update check used `date -r FILE +%s` to read a file's modification time, which behaves inconsistently on some Linux distributions. On failure the cache age defaulted to 0, causing a GitHub fetch on every session start. Replaced with `stat -c %Y` (GNU/Linux) falling back to `stat -f %m` (BSD/macOS) falling back to 0.

**Awk stderr leaked into session context** — The `session-start` hook used `2>&1` when capturing the using-superpowers skill body via awk. Any awk error (permission denied, missing file) would be injected into the AI's session context as part of the skill text. Changed to `2>/dev/null`.

`**premise-check` was unreachable via skill-activator hook** — Despite being the most important safety-net skill (validates whether work should exist before building it), `premise-check` had no entry in `skill-rules.json`. The skill-activator hook could never suggest it based on user input — it only fired if the model proactively read the Routing Guide text. Added a high-priority rule covering "design a system", "should we build this", "validate the premise", and related phrases.

`**receiving-code-review` was unreachable via skill-activator hook** — Same gap: no `skill-rules.json` entry. Phrases like "address review feedback" and "respond to review" never triggered it. Added a medium-priority rule.

`**error-recovery` missing from Routing Guide** — The skill existed and was in `skill-rules.json`, but was absent from the Routing Guide in `using-superpowers`. A model doing full-complexity routing would never find it as a destination. Added to the guide.

`**deliberation` missing from subagent-guard** — The subagent guard's violation patterns covered 20 skills but omitted `deliberation`. A subagent invoking `deliberation` by plain name (without the `superpowers-optimized:` prefix) would slip through. Added to the patterns. The guard was also refactored to use a verb-prefix pattern (`invoking/using/running + skill name`) that eliminates false positives from prose mentions of skill names.

**ReDoS vulnerability in block-dangerous-commands** — Six regex patterns used `(-.+\s+)*` which is a nested quantifier enabling catastrophic backtracking on adversarial input. Replaced with `(-\S+\s+)*` which eliminates the backtracking risk while preserving the same match semantics.

### Changes

**Routing Guide clarifies parallel execution paths** — The distinction between `dispatching-parallel-agents` (ad-hoc parallel work outside plan execution) and `subagent-driven-development` (plan execution with optional parallel waves) is now explicit in the Routing Guide. Previously the two entries looked equivalent, causing model confusion on which to pick.

**Internal skills documented in Routing Guide** — `self-consistency-reasoner` (invoked internally by `systematic-debugging` and `verification-before-completion`) and `token-efficiency` (always-on, invoked at Entry Sequence step 1) are now noted as intentional non-entries in the Routing Guide. Previously their absence was undocumented, which could be misread as orphaned skills.

**CMD arg limit documented in run-hook.cmd** — A comment now notes the 8-argument limit of the `%2-%9` forwarding pattern in the Windows batch wrapper, flagging it for future callers who need more.

## v5.8.0 (2026-03-24)

"Map this project" now correctly triggers the context-management skill and writes `project-map.md` to the project root.

### Fixes

**"map this project" routing was broken** — Saying "map this project" produced a chat response instead of a `project-map.md` file. Two bugs caused this: (1) `skill-rules.json` had no rule mapping map intent to `context-management`, so the skill was never suggested; (2) even when invoked manually, `context-management` defaulted to writing `state.md` because the project map procedure was buried below the state-saving procedure with no routing gate. Fixed by adding a dedicated high-priority rule in `skill-rules.json` covering "map this project", "map the project", "generate/create/update project map", updating the `context-management` skill description to include these trigger phrases, and adding an explicit routing table at the top of the skill that branches to the correct procedure before any other content is read.

## v5.7.0 (2026-03-23)

Context engine, pre-verified blast radius for code review and debugging, and a fix for false-positive update notices.

### New Features

**Context engine** — A new `context-engine.js` SessionStart hook runs automatically on every session start and writes `context-snapshot.json` to the project root. It captures the files changed in the last commit, a change summary, the last 5 commits, and blast radius (which other tracked files reference each changed file, computed via `git grep`). Zero dependencies — uses Node.js built-ins and git. Fails silently if git is unavailable. Automatically adds `context-snapshot.json` to `.gitignore` on first write.

**Code review uses context snapshot** — `requesting-code-review` now checks `context-snapshot.json` before dispatching the agent. If the snapshot is fresh (git hash matches HEAD), the changed files and blast radius are used to scope the review immediately — no exploration needed. If stale, changed files are used as a starting point. If absent, the skill falls back to `git diff` directly.

**Systematic debugging uses context snapshot** — Phase 1 of `systematic-debugging` now reads `context-snapshot.json` first when investigating what changed recently. The `changed_files` and `recent_commits` fields answer the question immediately, without running `git log` and `git diff` manually.

### Fixes

**Update check false positive** — The session-start hook was reading the installed version from its own directory, which could be an older cached copy after a Claude Code plugin update. The hook would then report a newer version as available even though the update was already applied. Fixed by reading the installed version from `~/.claude/plugins/installed_plugins.json` (the authoritative source) first, with a fallback to the hook's own `plugin.json`.

## v5.6.0 (2026-03-21)

Session memory enhanced, auto-gitignore for AI artifacts, and routing guide completeness. `project-map.md` is now injected directly into every session start by the hook — no instruction-following required. AI workspace files are automatically added to `.gitignore` the moment they're created. The routing guide now covers every user-invocable skill in the plugin.

### New Features

**project-map.md auto-injected at session start** — The session-start hook now reads `project-map.md` from the working directory and injects its content directly into context, unconditionally, before the first turn. Previously, reading the project map relied on Claude following the entry sequence — if the task was classified as micro, or if the first message was conversational, the file might never be read. Now it's always in context. For maps ≤200 lines the full content is injected; for larger maps only the `## Critical Constraints` and `## Hot Files` sections are injected, with a note pointing to the full file.

**Auto-gitignore for AI workspace artifacts** — When Claude creates `project-map.md`, `session-log.md`, or `state.md` in a project, they are now automatically added to `.gitignore` under a `# AI assistant artifacts` section header. These are tooling artifacts — generated by the AI, not part of the project — and should never appear in `git status` as untracked files. The gitignore check runs in the `PostToolUse` hook for files Claude writes directly, and in the stop hook for `session-log.md` entries written by the hook itself. Idempotent: if the entry already exists, nothing is changed.

### Changes

**Routing guide now covers all user-invocable skills** — `premise-check` and `using-git-worktrees` were missing from the routing guide in `using-superpowers` and had no coverage anywhere in the entry sequence. Both are now listed: `premise-check` at the top of the guide (run before brainstorming or planning when it's unclear whether work should exist at all), and `using-git-worktrees` before the implementation entries (run before implementation when the work needs branch isolation).

`**claude-md-creator` added to routing guide with explicit bypass protection** — CLAUDE.md creation was being classified as lightweight and implemented directly, bypassing the `claude-md-creator` skill that exists specifically for this task. The routing guide now includes an explicit entry for CLAUDE.md / AGENTS.md creation pointing to `claude-md-creator`, with a note that it applies at any complexity level. The lightweight action text now includes an exception: if a dedicated implementation skill exists for the task, invoke it — lightweight only skips workflow overhead, not implementation skills.

## v5.5.0 (2026-03-20)

Reasoning gap prevention and fresh project memory setup. The AI now catches its own design and implementation gaps earlier, classifies tasks more accurately, and proactively offers to set up the memory stack before building anything in a new directory.

### New Features

**Fresh project gate** — When you type "build", "create", "implement", or any creation-intent prompt in a directory with no `project-map.md`, the AI now pauses before starting and explains exactly what it will lose without the memory stack (re-exploring structure, re-reading known files, re-proposing rejected approaches, losing the "why" behind decisions). It offers to run `git init` and generate `project-map.md` in ~30 seconds before proceeding, or start immediately if you prefer. Previously this offer only appeared if git was absent — now it fires whenever no `project-map.md` exists, regardless of git status, so users who already have git initialized are no longer silently skipped.

**Failure-mode check in brainstorming** — Before any design can be approved, the AI must now state the top 2–3 ways the chosen approach could fail or not cover all cases. This is adversarial reasoning — actively trying to break the design — not a list of known assumptions. Critical failure modes (the design fails for a significant user scenario) must be fixed before proceeding; minor ones are documented as non-goals. This catches unknown assumptions at the design stage, where fixing them costs nothing, rather than discovering them after implementation.

**Assumption externalization in writing-plans** — The plan header now requires an `Assumptions` field listing what the plan rests on and what each assumption excludes ("Assumes X — will NOT work if Y"). Every task involving conditional logic now requires a `Does NOT cover` field stating which scenarios the condition excludes. If an excluded scenario should be covered, the task is revised before implementation begins. This catches known assumptions at the planning stage, complementing the adversarial failure-mode check in brainstorming.

**Condition coverage check in verification** — `verification-before-completion` now requires, as step 5 of its gate, that any change involving a condition or gate explicitly state what it does NOT cover before the task is marked done. If the answer reveals a gap that should be covered, it must be fixed before proceeding. This is the final catch in a three-stage adversarial pipeline: design → planning → completion.

### Changes

**Classification hard overrides** — The complexity classification in `using-superpowers` now has a hard override section that is evaluated before the lightweight criteria. If any of four conditions are true (adds/modifies/removes a condition or trigger, affects user experience, modifies a shared dependency, introduces a new outcome), the task is immediately classified as full regardless of file count. This prevents lightweight anchoring on file count for tasks that have significant behavioral impact.

**Lightweight articulation requirement** — Before classifying any task as lightweight, the AI must now explicitly state in one sentence why each of the four lightweight criteria is satisfied. If any criterion cannot be clearly articulated, the task is classified as full. Combined with the hard overrides, this closes the gap where tasks with new conditional logic were being mis-classified as lightweight, skipping brainstorming and the design-stage failure-mode check.

## v5.4.0 (2026-03-20)

Session memory, deliberation skill, social accountability, and ASI-guided auto-fix. The AI no longer starts every session amnesiac, makes better architectural decisions before committing to a direction, and its review agents now prioritize and fix findings more accurately.

### New Features

**Deliberation skill** — New `skills/deliberation/SKILL.md` for complex architectural or technology decisions where the options aren't yet well-defined or the problem may need reframing before brainstorming begins. The skill convenes 3–5 named stakeholder perspectives (Security Engineer, Developer Experience Advocate, Ops/Infrastructure Engineer, Maintainability Advocate, Performance Engineer, User/Product) — each speaks once without debate or rebuttal. The output surfaces where perspectives converge (load-bearing constraints that any solution must satisfy), where they genuinely disagree (live tensions that cannot be papered over), and optionally reframes the original question when deliberation reveals it was mis-stated. No forced conclusion — deliberation produces clarity about the decision space, not a recommendation. Routed by `using-superpowers` before brainstorming when the decision is unclear. Triggered by: "trade-off", "should we use", "evaluate these options", "architecture decision", "not sure which approach".

**Session memory stack** — The plugin now builds a four-file memory stack at your project root that eliminates re-discovery overhead across sessions. `session-log.md` accumulates a history of decisions, rejected approaches, and key facts. The stop hook auto-appends a minimal `[auto]` entry at every session end (skills used, files modified) at zero cost — no setup, no action required. When you explicitly invoke `context-management`, it writes a richer `[saved]` entry capturing goals, rationale, and what was tried and abandoned. At session start, the AI greps this log for keywords from the current task and surfaces relevant history before doing any work.

**Project map** — New `project-map.md` is the semantic memory layer: a persistent, AI-written map of the project's directory structure, key file purposes, and critical non-obvious constraints (e.g. "single quotes break Linux CI in hooks.json"). Generate it once with "map this project". After that, the AI reads it at every session start instead of re-globbing and re-reading files it already understands. Staleness is automatic: the AI checks the git hash in the map header against the current commit, then uses `git diff --name-only` to identify exactly which files changed and re-reads only those. Works on non-git projects too via file timestamp comparison. If no git repository is detected, the AI offers to run `git init` during map generation (creates a `.git` folder, touches no user files) with a clear explanation of what happens if you decline.

**Skill quality gate** — The `skill-creator` skill now includes a five-dimension quality check (Safety, Completeness, Executability, Maintainability, Cost-awareness) that must pass before moving to test cases. A skill that fails Executability or Completeness is redesigned, not just tested. This catches gaps and ambiguities at the design stage rather than discovering them during evaluation.

**Model selection guidance for subagents** — `subagent-driven-development` now specifies which model to use for each Agent tool call: Haiku for file reads, log scanning, and patch verification (output is data, not decisions); Sonnet for all implementation tasks (default); Opus for architecture analysis, complex spec review, and multi-system debugging. Reduces cost on lightweight review work and improves accuracy on reasoning-heavy tasks.

### Changes

**Social accountability in agent prompts** — The `code-reviewer`, `red-team`, and `implementer` agent prompts now include social accountability framing informed by 2389.ai research. Each agent is explicitly told that downstream work depends on the accuracy of its output: a false positive in the red team report triggers a full wasted fix cycle; a missed bug in code review ships to production; an implementer task that fails review cycles back and blocks the whole pipeline. The framing is factual, not motivational — it describes what actually happens, which is what improved accuracy in the research.

**ASI-guided iterative auto-fix pipeline** — The auto-fix pipeline in `requesting-code-review` was rewritten from a sequential batch (fix all Critical/High in order, run full suite once at end) to an ASI-guided iterative loop. The red team now marks one finding as the ASI (Actionable Side Information — the single finding that poses the greatest real-world risk if unaddressed). The pipeline starts there: write failing test → fix code → re-read only the files touched by the fix → check whether any other reported findings are now resolved or changed in severity → re-identify the new ASI → repeat until no Critical or High findings remain → run full suite once. This prevents fix collisions when multiple findings touch shared code, and catches side effects immediately rather than discovering them in a single final regression run.

**Proactive compaction breakpoints** — `token-efficiency` now includes explicit guidance to break context at logical seams before implementation begins (after research/exploration, after abandoning a failed approach) rather than waiting for auto-compaction at 95% context fill. Auto-compaction at 95% destroys the most recently gathered context — exactly the variable names, file paths, and evidence that implementation depends on. A proactive break at 50% preserves all of it.

**context-management expanded** — Now manages all four memory files (`project-map.md`, `session-log.md`, `state.md`, `known-issues.md`) as a unified stack with documented procedures for each. Session-start procedure updated to grep `session-log.md` for task keywords before diving in. Explicit cross-reference to `episodic-memory@superpowers-marketplace` for semantic cross-project recall that falls outside the scope of per-project grep-based memory.

**Entry sequence updated** — `using-superpowers` entry sequence now includes `project-map.md` as step 5: read the map if it exists, check staleness, re-read only changed files. This makes orientation at session start deterministic and zero-waste.

**Session-start hook** — Now detects when no git repository is present and injects a quiet background note into session context. The AI acts on this only when `project-map.md` is relevant — it does not announce it verbally on every session start.

## v5.3.0 (2026-03-17)

Frontend design intelligence and documentation improvements. The frontend skill was completely rewritten from a 62-line checklist into a comprehensive design reasoning system, and several docs were updated to reflect the current state of the plugin.

### New Features

**frontend-design skill (complete rewrite)** — The former `frontend-craftsmanship` skill has been renamed to `frontend-design` and rewritten from scratch. It now includes a 4-step design system generation framework that forces deliberate style, color, typography, and effects decisions before writing code. Adds a 25-style reference catalog (Minimalism through Cyberpunk), a 30-category industry design reference table mapping product types to recommended design directions, 8 common page structure patterns (dashboard, landing page, admin panel, etc.), 5-state UI state management (loading, error, empty, success, partial), frontend-backend integration patterns (API loading, optimistic updates, error boundaries, auth flows), dark mode implementation guidance, micro-copy and UX writing standards, and 10 priority quality standard categories covering accessibility, touch targets, performance, animation, forms, navigation, and charts. 353 lines, single file, zero dependencies.

**Red team pipeline documentation** — New `docs/architecture/red-team-pipeline.md` explains the end-to-end flow from code review through red team dispatch to auto-fix pipeline, including when each component fires, what the red team produces, how auto-fix processes findings, and merge blocking rules.

**Frontend design documentation** — New `docs/architecture/frontend-design.md` explains the skill's 7 capabilities with examples, what users can expect when prompting for frontend work, and how activation integrates with other Superpowers skills.

### Changes

**Testing documentation updated** — `docs/testing.md` (now `docs/architecture/testing-structure.md`) was rewritten to reflect the actual 5-directory test structure: claude-code, skill-triggering, explicit-skill-requests, subagent-driven-dev, and opencode. Added the subagent hook scope test, fixed stale plugin name references, and added a quick reference section with copy-paste commands for every test suite.

**AGENTS.minimal.md updated** — Added missing `premise-check` skill reference.

**frontend-craftsmanship → frontend-design rename** — All references across 9 files updated: SKILL.md frontmatter, skill-rules.json, subagent-guard.js, README.md, AGENTS.minimal.md, using-superpowers routing, executing-plans, subagent-driven-development, and RELEASE-NOTES.md.

## v5.2.0 (2026-03-15)

Adversarial red team analysis and auto-fix pipeline. Code review now goes beyond checklists — it actively tries to break your code, then fixes what it finds.

### New Features

**Red team agent** — New `agents/red-team.md` adversarially attacks completed implementations to find concrete failure scenarios that checklist-based review misses. Focuses on 7 attack categories: logic bugs, adversarial inputs, state corruption, concurrency & timing, resource exhaustion, error cascading, and assumption violations. Each finding includes a specific trigger, root cause with file:line references, and a test case skeleton. Explicitly does NOT overlap with the OWASP/CWE security review — its domain is adversarial logic analysis.

**Auto-fix pipeline** — When the red team report contains Critical or High findings, `requesting-code-review` now runs an auto-fix pipeline: for each finding, the test case skeleton is fleshed into a real test (must fail — proving the scenario is real), then the code is fixed to pass the test, then the full suite is verified for regressions. False positives are caught naturally (test passes → finding was invalid → skip). Medium findings are tracked for later, not auto-fixed.

**Red team integration in code review** — `requesting-code-review` now dispatches the red team agent in parallel with the code reviewer when changes touch complex logic, concurrency, state management, data transformation pipelines, retry/recovery logic, or performance-critical paths.

**Hardcoded secret content scanning** — `protect-secrets.js` now scans the content of Edit and Write operations for hardcoded secrets before the write happens. Detects 14 patterns: AWS access/secret keys, GitHub tokens, OpenAI keys, Anthropic keys, Stripe keys, private key PEM blocks, generic API key assignments, database connection strings with passwords, Slack tokens, SendGrid keys, Twilio keys, and Supabase keys. On detection, the write is blocked and the agent is instructed to move the value to an environment variable (e.g. `.env` file) and reference it via `process.env.VARIABLE_NAME` instead. Files where secrets are expected (`.env`, documentation) are allowlisted.

### Changes

**Subagent guard updated** — `hooks/subagent-guard.js` now includes violation patterns for `premise-check` and `red-team` skills, preventing subagents from invoking these skills via filesystem discovery.

---

## v5.1.0 (2026-03-14)

Upstream sync and hardening release. Adopts the most impactful changes from obra/superpowers, adds new safety mechanisms, and removes deprecated features.

### New Features

**Subagent context isolation** — All delegation skills (`subagent-driven-development`, `dispatching-parallel-agents`, `executing-plans`) now explicitly prohibit forwarding parent session context or history to subagents. Each subagent prompt is constructed from scratch with only task-scoped information. This prevents context pollution where subagents inherit the parent's reasoning chains and behave incorrectly (e.g., a reviewer acting as a lead developer).

**Subagent skill leakage prevention** — All subagent prompt templates now include an explicit instruction preventing subagents from discovering and invoking superpowers-optimized skills via filesystem access. Without this, a focused implementer subagent could discover workflow skills like `brainstorming` or `executing-plans` and derail into orchestration mode instead of doing its assigned task.

**Instruction priority hierarchy** — `using-superpowers` now declares an explicit priority order: (1) explicit user instructions, (2) project-level CLAUDE.md/AGENTS.md, (3) Superpowers skill instructions. Skills are defaults, not mandates — if a user explicitly overrides a skill's behavior, the agent follows the user.

**Plan review gate** — `writing-plans` now dispatches a plan-reviewer subagent after saving a plan, before offering execution options. The reviewer checks for vague steps, missing file paths, hidden dependencies, incorrect TDD ordering, and scope gaps against the approved design. Bad plans are revised before execution begins.

**Project scope decomposition** — `brainstorming` now assesses whether a project is too large for a single spec (4+ independent subsystems or 20+ tasks) and decomposes into sub-projects with separate specs. This prevents the common failure mode of trying to design an entire system in one monolithic document.

**Architecture guidance for existing codebases** — `brainstorming` now includes explicit guidance to study existing patterns before proposing new ones, match project conventions, and design for isolation (minimizing blast radius per change).

**Premise check skill** — New `premise-check` skill validates whether proposed work should exist before investing in it. Forces three questions (does the problem exist? is the solution proportional? what's the cost of not building?) and triggers reassessment when new evidence weakens the original motivation for in-progress work. Prevents over-engineering by catching unnecessary complexity before it's built.

### Changes

**Recommended subagent-driven-development** — `writing-plans` now labels `subagent-driven-development` as the recommended execution path (parallel with per-task review gates) and `executing-plans` as the alternative (sequential, simpler). User choice is preserved.

**Slash commands removed** — The `commands/` directory (`/brainstorm`, `/execute-plan`, `/write-plan`) has been removed. Skills are now the primary mechanism in Claude Code. Natural language routing via `skill-activator.js` and the `using-superpowers` router handle all workflow selection automatically — no manual command invocation needed.

**Gemini CLI support** — Added Gemini CLI installation instructions to README.

**Compatibility warning** — README now includes a prominent note about potential interference from other plugins or custom skills/agents that overlap with this plugin's domains.

### Fixes

**Linux hook variable expansion** — All 7 hook entries in `hooks.json` changed from single quotes to escaped double quotes around `${CLAUDE_PLUGIN_ROOT}`. Single quotes prevented shell variable expansion on Linux, causing "No such file or directory" errors (upstream issue #577).

---

## v5.0.0 (2026-03-13)

Major overhaul focused on signal-to-noise ratio: every skill must earn its place by changing behavior Claude wouldn't follow on its own. Role-play skills merged into the skills that use them, router redesigned for zero-cost micro-tasks, and two new killer features added (error recovery intelligence and progress visibility).

### Breaking Changes

**6 skills removed (merged or deleted)**

The following skills no longer exist as standalone skills. Their useful parts have been absorbed into the skills that invoke them:

- `senior-engineer` — Engineering rigor sections merged into `brainstorming` (design-phase) and `executing-plans` (implementation-phase). The role-play prompt ("you are an expert with 30 years experience") was removed as it didn't change behavior — specific rules do.
- `testing-specialist` — Advanced test strategy (integration, E2E, property-based, performance, flaky test diagnosis, coverage strategy) merged into `test-driven-development` as a new "Advanced Test Strategy" section.
- `security-reviewer` — Full OWASP/CWE security checklist, severity enforcement, and auto-trigger conditions merged into `requesting-code-review` as a built-in "Security Review" section. The `protect-secrets.js` hook continues to handle automated enforcement.
- `adaptive-workflow-selector` — 3-tier complexity classification (micro/lightweight/full) folded directly into `using-superpowers` as an inline "Complexity Classification" section. No longer requires a separate skill invocation.
- `prompt-optimizer` — Removed. Rarely triggered, marginal value. Brainstorming already handles ambiguous requests through clarifying questions.
- `writing-skills` — Removed. Developer-only meta-skill, not user-facing value. Contributing guide updated in README.

**Skill count: 24 → 19** (5 deleted, 1 new)

`**adaptive-workflow-selector` no longer exists as a standalone skill.** If your CLAUDE.md or custom workflows reference it, update them to use `using-superpowers` which now handles complexity classification inline.

### Added

**error-recovery — Project-specific error-to-solution intelligence**

New skill that maintains `known-issues.md` at the project root — a mapping of recurring errors to their proven solutions. Designed for errors that waste time when rediscovered each session: environment setup, missing services, platform-specific issues, configuration problems.

- Consulted automatically by `systematic-debugging` in a new Phase 0 (before investigation begins)
- Read by `using-superpowers` during the entry sequence when the file exists
- Updated after resolving bugs that meet recurrence criteria (environment-dependent, config, platform-specific)
- Entries kept concise: error pattern, cause, fix command, context
- File capped at 50 entries with pruning guidance

**track-session-stats.js — Progress visibility hook**

New PostToolUse hook (triggered on Skill tool calls) that tracks skill invocations to `session-stats.json`. Provides:

- Session duration
- Total skill invocations with per-skill breakdown
- Auto-expires after 2 hours (new session)
- Integrated into `stop-reminders.js` which now surfaces a session summary line

**Micro-task detection in skill-activator.js**

The UserPromptSubmit hook now detects micro-tasks (typo fixes, variable renames, import additions, etc.) and outputs `{}` — zero routing overhead. Patterns include:

- "fix the typo on line 42" → skipped
- "rename foo to bar" → skipped
- "add missing import" → skipped
- "build me a new auth system" → routed normally

**Confidence threshold in skill-activator.js**

Skill matching now requires a minimum score of 2 (was 1). Single-keyword matches that produced false positives are filtered out:

- "review" alone → no suggestion (was: suggested code review)
- "review my code before merge" → correctly routes to requesting-code-review

**3-tier complexity classification in using-superpowers**

Replaces the separate `adaptive-workflow-selector` skill with an inline classification:

- **Micro**: typo fix, single rename, 1-line config change → skip everything, just do it
- **Lightweight**: ~2 files, no new behavior/architecture → implement directly, only verification-before-completion at the end
- **Full**: anything else → complete pipeline (brainstorming → planning → execution → review → verify)

**Lightweight fast path**

Lightweight tasks now skip brainstorming, planning, worktrees, and parallel dispatch. Only gate: `verification-before-completion` when done. This eliminates the previous 3-skill-invocation overhead for small changes.

### Changed

**brainstorming: Added Engineering Rigor section**

Absorbed from senior-engineer: requirements verification, edge case identification, explicit trade-off evaluation, SOLID principles, architectural risk flagging. Removed prompt-optimizer reference.

**executing-plans: Added Engineering Rigor for Complex Tasks section**

Absorbed from senior-engineer: approach validation against requirements, edge case identification, simpler alternative consideration, hidden coupling prevention. Removed senior-engineer reference.

**test-driven-development: Added Advanced Test Strategy section**

Absorbed from testing-specialist: integration tests, E2E tests, property-based tests, performance tests, flaky test diagnosis, coverage strategy. Removed testing-specialist reference.

**requesting-code-review: Added Security Review (Built-In) section**

Absorbed from security-reviewer: OWASP Top 10/CWE scan, input validation, auth flow review, secrets handling, dependency vulnerabilities, logging hygiene. Auto-triggers when changes touch auth, data handling, APIs, secrets, crypto, or infrastructure. Critical/High findings block merge. Updated description to include security-related trigger keywords.

**receiving-code-review: Updated security finding reference**

Removed standalone security-reviewer reference. Security findings now come from the integrated security section in requesting-code-review.

**subagent-driven-development: Removed senior-engineer references**

Replaced "invoke senior-engineer subagent" with inline guidance: validate approach against requirements, consider simpler alternatives. Blocked task protocol updated similarly.

**writing-plans: Removed prompt-optimizer reference**

Replaced with direct guidance: ask clarifying questions for ambiguous features rather than invoking a separate prompt optimization step.

**systematic-debugging: Added Phase 0 (Check Known Issues)**

New first phase before investigation: check `known-issues.md` for the error message/code/test name, try documented solution first. If it works, stop — no further investigation needed. Added post-fix prompt to update known-issues.md for recurring errors.

**using-superpowers: Complete rewrite**

- Entry sequence simplified: token-efficiency → classify complexity → check state.md → check known-issues.md → follow appropriate path
- Removed adaptive-workflow-selector invocation
- Added inline complexity classification (micro/lightweight/full)
- Removed security-reviewer from routing guide (now built into requesting-code-review)
- Updated red flags section

**token-efficiency: Updated description**

Removed adaptive-workflow-selector reference. Added "exploration tracking" to description.

**skill-rules.json: Rebuilt**

- Removed 6 rules for deleted skills (adaptive-workflow-selector, senior-engineer, testing-specialist, security-reviewer, prompt-optimizer, writing-skills)
- Added error-recovery rule
- Merged security keywords into requesting-code-review rule
- Merged testing-specialist keywords into test-driven-development rule
- Total: 16 → 14 rules

**hooks.json: Added track-session-stats**

New PostToolUse hook entry for Skill matcher, running `track-session-stats.js`.

**stop-reminders.js: Added session stats summary**

Now loads `session-stats.json` and includes a session summary line (duration, skill count, breakdown) in stop-hook output alongside existing TDD and commit reminders.

**AGENTS.minimal.md: Updated to reflect new skill set**

Removed references to adaptive-workflow-selector, senior-engineer, security-reviewer, testing-specialist, prompt-optimizer. Added error-recovery and known-issues.md guidance.

**README.md: Complete rewrite**

- Added workflow diagram showing the complete hook and routing flow
- Updated feature comparison table (7 hooks, 3-tier routing, integrated security, error recovery, progress visibility)
- Updated Skills Library to 19 skills organized by category (Core Workflow, Design & Planning, Execution, Quality & Testing, Review & Integration, Intelligence)
- Listed all 7 hooks with their matchers and descriptions
- Updated contributing guide (removed writing-skills reference)
- Added "Proportional overhead" to philosophy section

## v4.6.0 (2026-03-11)

This release integrates self-consistency reasoning (Wang et al., ICLR 2023) into the two skills where single-chain reasoning failures are most expensive: root cause diagnosis and completion verification. Also includes plugin manifest fixes, marketplace metadata improvements, and README updates with research-driven optimization documentation and shields.io badges.

### Added

**self-consistency-reasoner — Multi-path reasoning technique for high-stakes inference**

New internal skill based on the Self-Consistency method (Wang et al., ICLR 2023). Generates N independent reasoning paths and takes majority vote to catch confident-but-wrong single-chain failures. Not invoked independently — embedded in the skills that need it. Key design decisions:

- Scoped to fire only during high-stakes multi-step inference where being wrong has real cost
- Path count scales to difficulty: 3 for binary verification, 5 for root cause diagnosis, 7 for complex multi-factor problems
- Low confidence (<=50% agreement) triggers a hard stop, not a best-guess — ambiguity is surfaced, not hidden
- Process is internal: users see only the aggregated result and confidence level

**systematic-debugging: Self-Consistency Gate in Phase 3**

Phase 3 (Hypothesize and Test) now requires multi-path reasoning before committing to a root cause hypothesis. The agent generates 3-5 independent hypotheses via different approaches (trace forward from inputs, backward from error, from recent changes, from similar past bugs), takes majority vote, and gates on confidence:

- High (80-100%): proceed to test
- Moderate (60-79%): proceed but note minority hypothesis as fallback
- Low (<=50%): hard stop — gather more evidence before choosing a direction

This directly addresses the most expensive debugging failure mode: latching onto the first plausible hypothesis and committing 3+ edits before discovering the root cause was different.

**verification-before-completion: Self-Consistency Verification**

Added multi-path verification for non-trivial completion claims. When the evidence evaluation requires multi-step inference, the agent generates 3 independent reasoning paths evaluating "does this evidence actually prove the claim?" — one checking what the evidence proves, one checking what it doesn't prove, one considering alternative explanations. Catches the failure mode where evidence is interpreted through a single (potentially wrong) lens, leading to false "done" declarations.

**README: Research-Driven Optimizations section**

Added comprehensive documentation of the three research papers that ground the fork's optimizations:

- arXiv:2602.11988 (AGENTbench) — why minimal context files outperform verbose ones
- arXiv:2602.24287 — why prior assistant responses degrade performance
- Wang et al., ICLR 2023 — why single reasoning chains fail on hard problems

Each paper section includes key findings, what was changed in the fork, and the four core principles that emerged.

**README: shields.io badges**

Added badges for GitHub stars, install command (links to Installation section), Cursor, Claude Code, Codex CLI, and MIT license.

### Fixed

**Plugin manifest: Duplicate hooks error**

Removed `"hooks": "./hooks/hooks.json"` from both `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json`. Claude Code auto-loads `hooks/hooks.json` from the standard path, so explicitly declaring it caused a "Duplicate hooks file detected" error on plugin installation.

**Plugin manifest: Invalid author.repository field**

Removed `repository` from inside the `author` object in `.claude-plugin/plugin.json`. The `author` field only supports `name` and `email` per the plugin schema. The top-level `repository` field was already correctly set.

### Improved

**Marketplace metadata**

Enhanced `.claude-plugin/marketplace.json` with `metadata.description`, plugin-level `homepage`, `repository`, `license`, `category`, and `tags` fields for better discoverability.

---

## v4.5.0 (2026-03-10)

This release adds a comprehensive hooks system with proactive skill routing, edit tracking, stop reminders, and two safety guard hooks. Also includes cross-session memory for the code-reviewer agent and README corrections.

### Added

**Hooks System — 5 new hooks for proactive workflow enforcement and safety**

The plugin now ships a full hooks pipeline registered in `hooks/hooks.json`:

- **skill-activator** (UserPromptSubmit) — Matches user prompts against 17 keyword/regex rules in `hooks/skill-rules.json` before Claude processes them. Injects up to 3 relevant skill suggestions wrapped in `<user-prompt-submit-hook>` tags, reinforcing the `using-superpowers` routing system deterministically. Returns `{}` for non-matching prompts (zero token cost).
- **track-edits** (PostToolUse, matcher: Edit|Write) — Logs every file edit to `~/.claude/hooks-logs/edit-log.txt` with ISO timestamp, tool name, and resolved file path. Auto-rotates at 500 lines with a size-based check (50KB threshold) to avoid reading the file on every write. Feeds data to `stop-reminders`. Never blocks.
- **stop-reminders** (Stop) — Generates contextual reminders when Claude finishes a response: TDD reminder (source files changed without corresponding test files), commit reminder (5+ files modified). Uses a file-based TTL guard (`stop-hook-fired.lock`, 2-minute expiry) to prevent the infinite loop where Stop hook output causes Claude to resume.
- **block-dangerous-commands** (PreToolUse, matcher: Bash) — Blocks destructive bash commands across 3 severity tiers (critical/high/strict). Default level: `high`. Covers 26 patterns including `rm -rf /`, `git push --force`, `DROP TABLE`, `chmod 777`, `mkfs`, `:(){ :|:& };:`, and more. Logs blocked operations to `~/.claude/hooks-logs/YYYY-MM-DD.jsonl`. Based on claude-code-hooks by karanb192 (MIT License).
- **protect-secrets** (PreToolUse, matcher: Read|Edit|Write|Bash) — Prevents reading, modifying, or exfiltrating sensitive files. 30 sensitive file patterns (`.env`, SSH keys, AWS credentials, PEM files, etc.) + 31 bash exfiltration patterns (`curl -d @.env`, `scp id_rsa`, `cat .env`, etc.). Allowlist for safe files (`.env.example`, `.env.template`). Allowlist intentionally NOT applied to bash commands to prevent bypass via chained commands like `cat .env.example && cat .env`. Based on claude-code-hooks by karanb192 (MIT License).

**code-reviewer agent: Cross-session memory**

Added `memory: user` to `agents/code-reviewer.md`. The code-reviewer agent now retains learnings about codebase patterns, recurring issues, and project conventions across reviews via `~/.claude/user-memory/`.

### Fixed

**README: Incorrect plugin names in install/update commands**

- Cursor install command: `/plugin-add superpowers` → `/plugin-add superpowers-optimized`
- Update command: `/plugin update superpowers` → `/plugin update superpowers-optimized`

**README: Missing documentation for hooks and agents**

- Added Hooks subsection to "What's Inside" listing all 5 hooks
- Added Agents subsection documenting the code-reviewer with `memory: user`
- Updated comparison table with Hooks system and Safety guards rows
- Updated intro and summary to mention hooks and safety guards

---

## v4.4.0 (2026-03-06)

This release closes the gap between what the skills document and what agents actually do wrong. Improvements are sourced from a systematic AI self-review of the plugin combined with the previously-documented real-session failure patterns from `docs/superpowers-optimized/specs/2025-11-28-skills-improvements-from-user-feedback.md`.

### Added

**verification-before-completion: Configuration Change Verification**

Added a dedicated section for changes that affect provider selection, feature flags, environment variables, or credentials. The core gap: agents verified that operations *succeeded* but not that outcomes reflected the *intended change*. The documented failure — a subagent testing an LLM integration, receiving status 200, and reporting "OpenAI working" while still hitting Anthropic — is now addressed with a gate that requires identifying, locating, and verifying the observable difference, not just operation completion. Includes a reference table of insufficient vs required evidence for common change types.

**testing-anti-patterns: Anti-Pattern 6 — Mock-Interface Drift**

Added the sixth anti-pattern: deriving mocks from implementation code rather than the interface definition. The documented failure: both the production code and the mock used `cleanup()` when the interface defined `close()`. Tests passed. Runtime crashed. TypeScript cannot catch this in inline `vi.fn()` mocks. The gate function requires reading the interface file *before* looking at the code under test, then mocking only methods with exactly the names defined in the interface. A failing test caused by a method-name mismatch is correctly treated as a bug in the code, not the mock.

**subagent-driven-development: E2E Process Hygiene section**

Added process cleanup instructions for subagents that start background services. Subagents are stateless and have no knowledge of processes started by previous subagents. Documented failure: 4+ accumulated server processes causing port conflicts and E2E tests hitting stale servers with wrong config. The section provides the exact `pkill`/`lsof`/`pgrep` pattern to include in subagent prompts for service-dependent tasks.

**subagent-driven-development: Blocked Task Protocol section**

Added escalation rules for fundamentally blocked tasks: stop after 2 failed attempts, surface the block to the user with evidence, invoke `senior-engineer` for architectural blocks, and document non-critical blocks in `state.md` rather than silently skipping them. Prevents the undefined behavior of infinite retry loops or silent task omission.

**adaptive-workflow-selector: Skill Invocation Guide**

Added concrete skill lists for each workflow path, solving the gap where the selector chose a path but never specified what that path contained. Three tiers: micro tasks (skip the selector entirely), lightweight (only `test-driven-development` + `verification-before-completion`), and full (follow the `using-superpowers` routing guide).

**frontend-design: Concrete Standards Checklist**

Replaced aspirational guidance ("accessible, responsive, Core Web Vitals") with a verifiable, output-changing checklist across four categories: structure (semantic HTML, heading hierarchy), accessibility (alt text, aria-label, focus-visible, WCAG AA contrast), CSS (design tokens, clamp() typography, prefers-reduced-motion, mobile-first), and performance (lazy loading, layout shift prevention).

### Fixed

**requesting-code-review: Reviewer file access**

Added explicit file reading instruction to both `skills/requesting-code-review/code-reviewer.md` and `agents/code-reviewer.md`. Documented failure: reviewer subagents reporting "file doesn't appear to exist" for files that did exist, because no instruction told them to explicitly load files before reviewing. Reviewers must now run `git diff --name-only` and use the Read tool on each file before analyzing the diff.

**subagent-driven-development/implementer-prompt: Self-review produces fixes, not just findings**

Enhanced step 5 of the implementer prompt: self-review now explicitly requires fixing identified issues and re-running verification before reporting, rather than just noting them. Eliminates the unnecessary round-trip where an implementer who already knows the fix has to report it and wait for a separate fixer subagent.

**context-management: state.md canonical location**

Specified that `state.md` should be written at the project root, or next to the active plan file if one exists. Previously unspecified, causing inconsistency across sessions.

### Improved

**using-superpowers: Routing guide now covers all specialist skills**

Added two missing routing entries: `frontend-design` for UI/frontend implementation tasks, and `security-reviewer` for security-sensitive changes before merge. The routing guide is now comprehensive across all active specialist skills.

**dispatching-parallel-agents: Integration verification strengthened**

Step 6 "Run integration verification" now specifies: execute the full project test suite plus any cross-domain checks, and do not mark the wave complete until integration passes. Removes ambiguity about what "integration verification" means in practice.

---

## v4.3.1 (2026-02-21)

### Added

**Cursor support**

Superpowers now works with Cursor's plugin system. Includes a `.cursor-plugin/plugin.json` manifest and Cursor-specific installation instructions in the README. The SessionStart hook output now includes an `additional_context` field alongside the existing `hookSpecificOutput.additionalContext` for Cursor hook compatibility.

### Fixed

**Windows: Restored polyglot wrapper for reliable hook execution (#518, #504, #491, #487, #466, #440)**

Claude Code's `.sh` auto-detection on Windows was prepending `bash` to the hook command, breaking execution. The fix:

- Renamed `session-start.sh` to `session-start` (extensionless) so auto-detection doesn't interfere
- Restored `run-hook.cmd` polyglot wrapper with multi-location bash discovery (standard Git for Windows paths, then PATH fallback)
- Exits silently if no bash is found rather than erroring
- On Unix, the wrapper runs the script directly via `exec bash`
- Uses POSIX-safe `dirname "$0"` path resolution (works on dash/sh, not just bash)

This fixes SessionStart failures on Windows with spaces in paths, missing WSL, `set -euo pipefail` fragility on MSYS, and backslash mangling.

## v4.3.0 (2026-02-12)

This fix should dramatically improve superpowers skills compliance and should reduce the chances of Claude entering its native plan mode unintentionally.

### Changed

**Brainstorming skill now enforces its workflow instead of describing it**

Models were skipping the design phase and jumping straight to implementation skills like frontend-design, or collapsing the entire brainstorming process into a single text block. The skill now uses hard gates, a mandatory checklist, and a graphviz process flow to enforce compliance:

- `<HARD-GATE>`: no implementation skills, code, or scaffolding until design is presented and user approves
- Explicit checklist (6 items) that must be created as tasks and completed in order
- Graphviz process flow with `writing-plans` as the only valid terminal state
- Anti-pattern callout for "this is too simple to need a design" — the exact rationalization models use to skip the process
- Design section sizing based on section complexity, not project complexity

**Using-superpowers workflow graph intercepts EnterPlanMode**

Added an `EnterPlanMode` intercept to the skill flow graph. When the model is about to enter Claude's native plan mode, it checks whether brainstorming has happened and routes through the brainstorming skill instead. Plan mode is never entered.

### Fixed

**SessionStart hook now runs synchronously**

Changed `async: true` to `async: false` in hooks.json. When async, the hook could fail to complete before the model's first turn, meaning using-superpowers instructions weren't in context for the first message.

## v4.2.0 (2026-02-05)

### Breaking Changes

**Codex: Replaced bootstrap CLI with native skill discovery**

The `superpowers-codex` bootstrap CLI, Windows `.cmd` wrapper, and related bootstrap content file have been removed. Codex now uses native skill discovery via `~/.agents/skills/superpowers/` symlink, so the old `use_skill`/`find_skills` CLI tools are no longer needed.

Installation is now just clone + symlink (documented in INSTALL.md). No Node.js dependency required. The old `~/.codex/skills/` path is deprecated.

### Fixes

**Windows: Fixed Claude Code 2.1.x hook execution (#331)**

Claude Code 2.1.x changed how hooks execute on Windows: it now auto-detects `.sh` files in commands and prepends `bash`. This broke the polyglot wrapper pattern because `bash "run-hook.cmd" session-start.sh` tries to execute the `.cmd` file as a bash script.

Fix: hooks.json now calls session-start.sh directly. Claude Code 2.1.x handles the bash invocation automatically. Also added .gitattributes to enforce LF line endings for shell scripts (fixes CRLF issues on Windows checkout).

**Windows: SessionStart hook runs async to prevent terminal freeze (#404, #413, #414, #419)**

The synchronous SessionStart hook blocked the TUI from entering raw mode on Windows, freezing all keyboard input. Running the hook async prevents the freeze while still injecting superpowers context.

**Windows: Fixed O(n^2) `escape_for_json` performance**

The character-by-character loop using `${input:$i:1}` was O(n^2) in bash due to substring copy overhead. On Windows Git Bash this took 60+ seconds. Replaced with bash parameter substitution (`${s//old/new}`) which runs each pattern as a single C-level pass — 7x faster on macOS, dramatically faster on Windows.

**Codex: Fixed Windows/PowerShell invocation (#285, #243)**

- Windows doesn't respect shebangs, so directly invoking the extensionless `superpowers-codex` script triggered an "Open with" dialog. All invocations now prefixed with `node`.
- Fixed `~/` path expansion on Windows — PowerShell doesn't expand `~` when passed as an argument to `node`. Changed to `$HOME` which expands correctly in both bash and PowerShell.

**Codex: Fixed path resolution in installer**

Used `fileURLToPath()` instead of manual URL pathname parsing to correctly handle paths with spaces and special characters on all platforms.

**Codex: Fixed stale skills path in writing-skills**

Updated `~/.codex/skills/` reference (deprecated) to `~/.agents/skills/` for native discovery.

### Improvements

**Worktree isolation now required before implementation**

Added `using-git-worktrees` as a required skill for both `subagent-driven-development` and `executing-plans`. Implementation workflows now explicitly require setting up an isolated worktree before starting work, preventing accidental work directly on main.

**Main branch protection softened to require explicit consent**

Instead of prohibiting main branch work entirely, the skills now allow it with explicit user consent. More flexible while still ensuring users are aware of the implications.

**Simplified installation verification**

Removed `/help` command check and specific slash command list from verification steps. Skills are primarily invoked by describing what you want to do, not by running specific commands.

**Codex: Clarified subagent tool mapping in bootstrap**

Improved documentation of how Codex tools map to Claude Code equivalents for subagent workflows.

### Tests

- Added worktree requirement test for subagent-driven-development
- Added main branch red flag warning test
- Fixed case sensitivity in skill recognition test assertions

---

## v4.1.1 (2026-01-23)

### Fixes

**OpenCode: Standardized on `plugins/` directory per official docs (#343)**

OpenCode's official documentation uses `~/.config/opencode/plugins/` (plural). Our docs previously used `plugin/` (singular). While OpenCode accepts both forms, we've standardized on the official convention to avoid confusion.

Changes:

- Renamed `.opencode/plugin/` to `.opencode/plugins/` in repo structure
- Updated all installation docs (INSTALL.md, README.opencode.md) across all platforms
- Updated test scripts to match

**OpenCode: Fixed symlink instructions (#339, #342)**

- Added explicit `rm` before `ln -s` (fixes "file already exists" errors on reinstall)
- Added missing skills symlink step that was absent from INSTALL.md
- Updated from deprecated `use_skill`/`find_skills` to native `skill` tool references

---

## v4.1.0 (2026-01-23)

### Breaking Changes

**OpenCode: Switched to native skills system**

Superpowers for OpenCode now uses OpenCode's native `skill` tool instead of custom `use_skill`/`find_skills` tools. This is a cleaner integration that works with OpenCode's built-in skill discovery.

**Migration required:** Skills must be symlinked to `~/.config/opencode/skills/superpowers/` (see updated installation docs).

### Fixes

**OpenCode: Fixed agent reset on session start (#226)**

The previous bootstrap injection method using `session.prompt({ noReply: true })` caused OpenCode to reset the selected agent to "build" on first message. Now uses `experimental.chat.system.transform` hook which modifies the system prompt directly without side effects.

**OpenCode: Fixed Windows installation (#232)**

- Removed dependency on `skills-core.js` (eliminates broken relative imports when file is copied instead of symlinked)
- Added comprehensive Windows installation docs for cmd.exe, PowerShell, and Git Bash
- Documented proper symlink vs junction usage for each platform

**Claude Code: Fixed Windows hook execution for Claude Code 2.1.x**

Claude Code 2.1.x changed how hooks execute on Windows: it now auto-detects `.sh` files in commands and prepends `bash` . This broke the polyglot wrapper pattern because `bash "run-hook.cmd" session-start.sh` tries to execute the .cmd file as a bash script.

Fix: hooks.json now calls session-start.sh directly. Claude Code 2.1.x handles the bash invocation automatically. Also added .gitattributes to enforce LF line endings for shell scripts (fixes CRLF issues on Windows checkout).

---

## v4.0.3 (2025-12-26)

### Improvements

**Strengthened using-superpowers skill for explicit skill requests**

Addressed a failure mode where Claude would skip invoking a skill even when the user explicitly requested it by name (e.g., "subagent-driven-development, please"). Claude would think "I know what that means" and start working directly instead of loading the skill.

Changes:

- Updated "The Rule" to say "Invoke relevant or requested skills" instead of "Check for skills" - emphasizing active invocation over passive checking
- Added "BEFORE any response or action" - the original wording only mentioned "response" but Claude would sometimes take action without responding first
- Added reassurance that invoking a wrong skill is okay - reduces hesitation
- Added new red flag: "I know what that means" → Knowing the concept ≠ using the skill

**Added explicit skill request tests**

New test suite in `tests/explicit-skill-requests/` that verifies Claude correctly invokes skills when users request them by name. Includes single-turn and multi-turn test scenarios.

## v4.0.2 (2025-12-23)

### Fixes

**Slash commands now user-only**

Added `disable-model-invocation: true` to all three slash commands (`/brainstorm`, `/execute-plan`, `/write-plan`). Claude can no longer invoke these commands via the Skill tool—they're restricted to manual user invocation only.

The underlying skills (`superpowers:brainstorming`, `superpowers:executing-plans`, `superpowers:writing-plans`) remain available for Claude to invoke autonomously. This change prevents confusion when Claude would invoke a command that just redirects to a skill anyway.

## v4.0.1 (2025-12-23)

### Fixes

**Clarified how to access skills in Claude Code**

Fixed a confusing pattern where Claude would invoke a skill via the Skill tool, then try to Read the skill file separately. The `using-superpowers` skill now explicitly states that the Skill tool loads skill content directly—no need to read files.

- Added "How to Access Skills" section to `using-superpowers`
- Changed "read the skill" → "invoke the skill" in instructions
- Updated slash commands to use fully qualified skill names (e.g., `superpowers:brainstorming`)

**Added GitHub thread reply guidance to receiving-code-review** (h/t @ralphbean)

Added a note about replying to inline review comments in the original thread rather than as top-level PR comments.

**Added automation-over-documentation guidance to writing-skills** (h/t @EthanJStark)

Added guidance that mechanical constraints should be automated, not documented—save skills for judgment calls.

## v4.0.0 (2025-12-17)

### New Features

**Two-stage code review in subagent-driven-development**

Subagent workflows now use two separate review stages after each task:

1. **Spec compliance review** - Skeptical reviewer verifies implementation matches spec exactly. Catches missing requirements AND over-building. Won't trust implementer's report—reads actual code.
2. **Code quality review** - Only runs after spec compliance passes. Reviews for clean code, test coverage, maintainability.

This catches the common failure mode where code is well-written but doesn't match what was requested. Reviews are loops, not one-shot: if reviewer finds issues, implementer fixes them, then reviewer checks again.

Other subagent workflow improvements:

- Controller provides full task text to workers (not file references)
- Workers can ask clarifying questions before AND during work
- Self-review checklist before reporting completion
- Plan read once at start, extracted to TodoWrite

New prompt templates in `skills/subagent-driven-development/`:

- `implementer-prompt.md` - Includes self-review checklist, encourages questions
- `spec-reviewer-prompt.md` - Skeptical verification against requirements
- `code-quality-reviewer-prompt.md` - Standard code review

**Debugging techniques consolidated with tools**

`systematic-debugging` now bundles supporting techniques and tools:

- `root-cause-tracing.md` - Trace bugs backward through call stack
- `defense-in-depth.md` - Add validation at multiple layers
- `condition-based-waiting.md` - Replace arbitrary timeouts with condition polling
- `find-polluter.sh` - Bisection script to find which test creates pollution
- `condition-based-waiting-example.ts` - Complete implementation from real debugging session

**Testing anti-patterns reference**

`test-driven-development` now includes `testing-anti-patterns.md` covering:

- Testing mock behavior instead of real behavior
- Adding test-only methods to production classes
- Mocking without understanding dependencies
- Incomplete mocks that hide structural assumptions

**Skill test infrastructure**

Three new test frameworks for validating skill behavior:

`tests/skill-triggering/` - Validates skills trigger from naive prompts without explicit naming. Tests 6 skills to ensure descriptions alone are sufficient.

`tests/claude-code/` - Integration tests using `claude -p` for headless testing. Verifies skill usage via session transcript (JSONL) analysis. Includes `analyze-token-usage.py` for cost tracking.

`tests/subagent-driven-dev/` - End-to-end workflow validation with two complete test projects:

- `go-fractals/` - CLI tool with Sierpinski/Mandelbrot (10 tasks)
- `svelte-todo/` - CRUD app with localStorage and Playwright (12 tasks)

### Major Changes

**DOT flowcharts as executable specifications**

Rewrote key skills using DOT/GraphViz flowcharts as the authoritative process definition. Prose becomes supporting content.

**The Description Trap** (documented in `writing-skills`): Discovered that skill descriptions override flowchart content when descriptions contain workflow summaries. Claude follows the short description instead of reading the detailed flowchart. Fix: descriptions must be trigger-only ("Use when X") with no process details.

**Skill priority in using-superpowers**

When multiple skills apply, process skills (brainstorming, debugging) now explicitly come before implementation skills. "Build X" triggers brainstorming first, then domain skills.

**brainstorming trigger strengthened**

Description changed to imperative: "You MUST use this before any creative work—creating features, building components, adding functionality, or modifying behavior."

### Breaking Changes

**Skill consolidation** - Six standalone skills merged:

- `root-cause-tracing`, `defense-in-depth`, `condition-based-waiting` → bundled in `systematic-debugging/`
- `testing-skills-with-subagents` → bundled in `writing-skills/`
- `testing-anti-patterns` → bundled in `test-driven-development/`
- `sharing-skills` removed (obsolete)

### Other Improvements

- **render-graphs.js** - Tool to extract DOT diagrams from skills and render to SVG
- **Rationalizations table** in using-superpowers - Scannable format including new entries: "I need more context first", "Let me explore first", "This feels productive"
- **docs/testing.md** - Guide to testing skills with Claude Code integration tests

---

## v3.6.2 (2025-12-03)

### Fixed

- **Linux Compatibility**: Fixed polyglot hook wrapper (`run-hook.cmd`) to use POSIX-compliant syntax
  - Replaced bash-specific `${BASH_SOURCE[0]:-$0}` with standard `$0` on line 16
  - Resolves "Bad substitution" error on Ubuntu/Debian systems where `/bin/sh` is dash
  - Fixes #141

---

## v3.5.1 (2025-11-24)

### Changed

- **OpenCode Bootstrap Refactor**: Switched from `chat.message` hook to `session.created` event for bootstrap injection
  - Bootstrap now injects at session creation via `session.prompt()` with `noReply: true`
  - Explicitly tells the model that using-superpowers is already loaded to prevent redundant skill loading
  - Consolidated bootstrap content generation into shared `getBootstrapContent()` helper
  - Cleaner single-implementation approach (removed fallback pattern)

---

## v3.5.0 (2025-11-23)

### Added

- **OpenCode Support**: Native JavaScript plugin for OpenCode.ai
  - Custom tools: `use_skill` and `find_skills`
  - Message insertion pattern for skill persistence across context compaction
  - Automatic context injection via chat.message hook
  - Auto re-injection on session.compacted events
  - Three-tier skill priority: project > personal > superpowers
  - Project-local skills support (`.opencode/skills/`)
  - Shared core module (`lib/skills-core.js`) for code reuse with Codex
  - Automated test suite with proper isolation (`tests/opencode/`)
  - Platform-specific documentation (`docs/platforms/opencode.md`, `docs/platforms/codex.md`)

### Changed

- **Refactored Codex Implementation**: Now uses shared `lib/skills-core.js` ES module
  - Eliminates code duplication between Codex and OpenCode
  - Single source of truth for skill discovery and parsing
  - Codex successfully loads ES modules via Node.js interop
- **Improved Documentation**: Rewrote README to explain problem/solution clearly
  - Removed duplicate sections and conflicting information
  - Added complete workflow description (brainstorm → plan → execute → finish)
  - Simplified platform installation instructions
  - Emphasized skill-checking protocol over automatic activation claims

---

## v3.4.1 (2025-10-31)

### Improvements

- Optimized superpowers bootstrap to eliminate redundant skill execution. The `using-superpowers` skill content is now provided directly in session context, with clear guidance to use the Skill tool only for other skills. This reduces overhead and prevents the confusing loop where agents would execute `using-superpowers` manually despite already having the content from session start.

## v3.4.0 (2025-10-30)

### Improvements

- Simplified `brainstorming` skill to return to original conversational vision. Removed heavyweight 6-phase process with formal checklists in favor of natural dialogue: ask questions one at a time, then present design in 200-300 word sections with validation. Keeps documentation and implementation handoff features.

## v3.3.1 (2025-10-28)

### Improvements

- Updated `brainstorming` skill to require autonomous recon before questioning, encourage recommendation-driven decisions, and prevent agents from delegating prioritization back to humans.
- Applied writing clarity improvements to `brainstorming` skill following Strunk's "Elements of Style" principles (omitted needless words, converted negative to positive form, improved parallel construction).

### Bug Fixes

- Clarified `writing-skills` guidance so it points to the correct agent-specific personal skill directories (`~/.claude/skills` for Claude Code, `~/.codex/skills` for Codex).

## v3.3.0 (2025-10-28)

### New Features

**Experimental Codex Support**

- Added unified `superpowers-codex` script with bootstrap/use-skill/find-skills commands
- Cross-platform Node.js implementation (works on Windows, macOS, Linux)
- Namespaced skills: `superpowers:skill-name` for superpowers skills, `skill-name` for personal
- Personal skills override superpowers skills when names match
- Clean skill display: shows name/description without raw frontmatter
- Helpful context: shows supporting files directory for each skill
- Tool mapping for Codex: TodoWrite→update_plan, subagents→manual fallback, etc.
- Bootstrap integration with minimal AGENTS.md for automatic startup
- Complete installation guide and bootstrap instructions specific to Codex

**Key differences from Claude Code integration:**

- Single unified script instead of separate tools
- Tool substitution system for Codex-specific equivalents
- Simplified subagent handling (manual work instead of delegation)
- Updated terminology: "Superpowers skills" instead of "Core skills"

### Files Added

- `.codex/INSTALL.md` - Installation guide for Codex users
- `.codex/superpowers-bootstrap.md` - Bootstrap instructions with Codex adaptations
- `.codex/superpowers-codex` - Unified Node.js executable with all functionality

**Note:** Codex support is experimental. The integration provides core superpowers functionality but may require refinement based on user feedback.

## v3.2.3 (2025-10-23)

### Improvements

**Updated using-superpowers skill to use Skill tool instead of Read tool**

- Changed skill invocation instructions from Read tool to Skill tool
- Updated description: "using Read tool" → "using Skill tool"
- Updated step 3: "Use the Read tool" → "Use the Skill tool to read and run"
- Updated rationalization list: "Read the current version" → "Run the current version"

The Skill tool is the proper mechanism for invoking skills in Claude Code. This update corrects the bootstrap instructions to guide agents toward the correct tool.

### Files Changed

- Updated: `skills/using-superpowers/SKILL.md` - Changed tool references from Read to Skill

## v3.2.2 (2025-10-21)

### Improvements

**Strengthened using-superpowers skill against agent rationalization**

- Added EXTREMELY-IMPORTANT block with absolute language about mandatory skill checking
  - "If even 1% chance a skill applies, you MUST read it"
  - "You do not have a choice. You cannot rationalize your way out."
- Added MANDATORY FIRST RESPONSE PROTOCOL checklist
  - 5-step process agents must complete before any response
  - Explicit "responding without this = failure" consequence
- Added Common Rationalizations section with 8 specific evasion patterns
  - "This is just a simple question" → WRONG
  - "I can check files quickly" → WRONG
  - "Let me gather information first" → WRONG
  - Plus 5 more common patterns observed in agent behavior

These changes address observed agent behavior where they rationalize around skill usage despite clear instructions. The forceful language and pre-emptive counter-arguments aim to make non-compliance harder.

### Files Changed

- Updated: `skills/using-superpowers/SKILL.md` - Added three layers of enforcement to prevent skill-skipping rationalization

## v3.2.1 (2025-10-20)

### New Features

**Code reviewer agent now included in plugin**

- Added `superpowers:code-reviewer` agent to plugin's `agents/` directory
- Agent provides systematic code review against plans and coding standards
- Previously required users to have personal agent configuration
- All skill references updated to use namespaced `superpowers:code-reviewer`
- Fixes #55

### Files Changed

- New: `agents/code-reviewer.md` - Agent definition with review checklist and output format
- Updated: `skills/requesting-code-review/SKILL.md` - References to `superpowers:code-reviewer`
- Updated: `skills/subagent-driven-development/SKILL.md` - References to `superpowers:code-reviewer`

## v3.2.0 (2025-10-18)

### New Features

**Design documentation in brainstorming workflow**

- Added Phase 4: Design Documentation to brainstorming skill
- Design documents now written to `docs/superpowers-optimized/specs/YYYY-MM-DD-<topic>-design.md` before implementation
- Restores functionality from original brainstorming command that was lost during skill conversion
- Documents written before worktree setup and implementation planning
- Tested with subagent to verify compliance under time pressure

### Breaking Changes

**Skill reference namespace standardization**

- All internal skill references now use `superpowers:` namespace prefix
- Updated format: `superpowers:test-driven-development` (previously just `test-driven-development`)
- Affects all REQUIRED SUB-SKILL, RECOMMENDED SUB-SKILL, and REQUIRED BACKGROUND references
- Aligns with how skills are invoked using the Skill tool
- Files updated: brainstorming, executing-plans, subagent-driven-development, systematic-debugging, testing-skills-with-subagents, writing-plans, writing-skills

### Improvements

**Design vs implementation plan naming**

- Design documents use `-design.md` suffix to prevent filename collisions
- Implementation plans continue using existing `YYYY-MM-DD-<feature-name>.md` format
- Design specs stored in `docs/superpowers-optimized/specs/`, implementation plans in `docs/superpowers-optimized/plans/`

## v3.1.1 (2025-10-17)

### Bug Fixes

- **Fixed command syntax in README** (#44) - Updated all command references to use correct namespaced syntax (`/superpowers:brainstorm` instead of `/brainstorm`). Plugin-provided commands are automatically namespaced by Claude Code to avoid conflicts between plugins.

## v3.1.0 (2025-10-17)

### Breaking Changes

**Skill names standardized to lowercase**

- All skill frontmatter `name:` fields now use lowercase kebab-case matching directory names
- Examples: `brainstorming`, `test-driven-development`, `using-git-worktrees`
- All skill announcements and cross-references updated to lowercase format
- This ensures consistent naming across directory names, frontmatter, and documentation

### New Features

**Enhanced brainstorming skill**

- Added Quick Reference table showing phases, activities, and tool usage
- Added copyable workflow checklist for tracking progress
- Added decision flowchart for when to revisit earlier phases
- Added comprehensive AskUserQuestion tool guidance with concrete examples
- Added "Question Patterns" section explaining when to use structured vs open-ended questions
- Restructured Key Principles as scannable table

**Anthropic best practices integration**

- Added `skills/writing-skills/anthropic-best-practices.md` - Official Anthropic skill authoring guide
- Referenced in writing-skills SKILL.md for comprehensive guidance
- Provides patterns for progressive disclosure, workflows, and evaluation

### Improvements

**Skill cross-reference clarity**

- All skill references now use explicit requirement markers:
  - `**REQUIRED BACKGROUND:`** - Prerequisites you must understand
  - `**REQUIRED SUB-SKILL:**` - Skills that must be used in workflow
  - `**Complementary skills:**` - Optional but helpful related skills
- Removed old path format (`skills/collaboration/X` → just `X`)
- Updated Integration sections with categorized relationships (Required vs Complementary)
- Updated cross-reference documentation with best practices

**Alignment with Anthropic best practices**

- Fixed description grammar and voice (fully third-person)
- Added Quick Reference tables for scanning
- Added workflow checklists Claude can copy and track
- Appropriate use of flowcharts for non-obvious decision points
- Improved scannable table formats
- All skills well under 500-line recommendation

### Bug Fixes

- **Re-added missing command redirects** - Restored `commands/brainstorm.md` and `commands/write-plan.md` that were accidentally removed in v3.0 migration
- Fixed `defense-in-depth` name mismatch (was `Defense-in-Depth-Validation`)
- Fixed `receiving-code-review` name mismatch (was `Code-Review-Reception`)
- Fixed `commands/brainstorm.md` reference to correct skill name
- Removed references to non-existent related skills

### Documentation

**writing-skills improvements**

- Updated cross-referencing guidance with explicit requirement markers
- Added reference to Anthropic's official best practices
- Improved examples showing proper skill reference format

## v3.0.1 (2025-10-16)

### Changes

We now use Anthropic's first-party skills system!

## v2.0.2 (2025-10-12)

### Bug Fixes

- **Fixed false warning when local skills repo is ahead of upstream** - The initialization script was incorrectly warning "New skills available from upstream" when the local repository had commits ahead of upstream. The logic now correctly distinguishes between three git states: local behind (should update), local ahead (no warning), and diverged (should warn).

## v2.0.1 (2025-10-12)

### Bug Fixes

- **Fixed session-start hook execution in plugin context** (#8, PR #9) - The hook was failing silently with "Plugin hook error" preventing skills context from loading. Fixed by:
  - Using `${BASH_SOURCE[0]:-$0}` fallback when BASH_SOURCE is unbound in Claude Code's execution context
  - Adding `|| true` to handle empty grep results gracefully when filtering status flags

---

# Superpowers v2.0.0 Release Notes

## Overview

Superpowers v2.0 makes skills more accessible, maintainable, and community-driven through a major architectural shift.

The headline change is **skills repository separation**: all skills, scripts, and documentation have moved from the plugin into a dedicated repository ([obra/superpowers-skills](https://github.com/obra/superpowers-skills)). This transforms superpowers from a monolithic plugin into a lightweight shim that manages a local clone of the skills repository. Skills auto-update on session start. Users fork and contribute improvements via standard git workflows. The skills library versions independently from the plugin.

Beyond infrastructure, this release adds nine new skills focused on problem-solving, research, and architecture. We rewrote the core **using-skills** documentation with imperative tone and clearer structure, making it easier for Claude to understand when and how to use skills. **find-skills** now outputs paths you can paste directly into the Read tool, eliminating friction in the skills discovery workflow.

Users experience seamless operation: the plugin handles cloning, forking, and updating automatically. Contributors find the new architecture makes improving and sharing skills trivial. This release lays the foundation for skills to evolve rapidly as a community resource.

## Breaking Changes

### Skills Repository Separation

**The biggest change:** Skills no longer live in the plugin. They've been moved to a separate repository at [obra/superpowers-skills](https://github.com/obra/superpowers-skills).

**What this means for you:**

- **First install:** Plugin automatically clones skills to `~/.config/superpowers/skills/`
- **Forking:** During setup, you'll be offered the option to fork the skills repo (if `gh` is installed)
- **Updates:** Skills auto-update on session start (fast-forward when possible)
- **Contributing:** Work on branches, commit locally, submit PRs to upstream
- **No more shadowing:** Old two-tier system (personal/core) replaced with single-repo branch workflow

**Migration:**

If you have an existing installation:

1. Your old `~/.config/superpowers/.git` will be backed up to `~/.config/superpowers/.git.bak`
2. Old skills will be backed up to `~/.config/superpowers/skills.bak`
3. Fresh clone of obra/superpowers-skills will be created at `~/.config/superpowers/skills/`

### Removed Features

- **Personal superpowers overlay system** - Replaced with git branch workflow
- **setup-personal-superpowers hook** - Replaced by initialize-skills.sh

## New Features

### Skills Repository Infrastructure

**Automatic Clone & Setup** (`lib/initialize-skills.sh`)

- Clones obra/superpowers-skills on first run
- Offers fork creation if GitHub CLI is installed
- Sets up upstream/origin remotes correctly
- Handles migration from old installation

**Auto-Update**

- Fetches from tracking remote on every session start
- Auto-merges with fast-forward when possible
- Notifies when manual sync needed (branch diverged)
- Uses pulling-updates-from-skills-repository skill for manual sync

### New Skills

**Problem-Solving Skills** (`skills/problem-solving/`)

- **collision-zone-thinking** - Force unrelated concepts together for emergent insights
- **inversion-exercise** - Flip assumptions to reveal hidden constraints
- **meta-pattern-recognition** - Spot universal principles across domains
- **scale-game** - Test at extremes to expose fundamental truths
- **simplification-cascades** - Find insights that eliminate multiple components
- **when-stuck** - Dispatch to right problem-solving technique

**Research Skills** (`skills/research/`)

- **tracing-knowledge-lineages** - Understand how ideas evolved over time

**Architecture Skills** (`skills/architecture/`)

- **preserving-productive-tensions** - Keep multiple valid approaches instead of forcing premature resolution

### Skills Improvements

**using-skills (formerly getting-started)**

- Renamed from getting-started to using-skills
- Complete rewrite with imperative tone (v4.0.0)
- Front-loaded critical rules
- Added "Why" explanations for all workflows
- Always includes /SKILL.md suffix in references
- Clearer distinction between rigid rules and flexible patterns

**writing-skills**

- Cross-referencing guidance moved from using-skills
- Added token efficiency section (word count targets)
- Improved CSO (Claude Search Optimization) guidance

**sharing-skills**

- Updated for new branch-and-PR workflow (v2.0.0)
- Removed personal/core split references

**pulling-updates-from-skills-repository** (new)

- Complete workflow for syncing with upstream
- Replaces old "updating-skills" skill

### Tools Improvements

**find-skills**

- Now outputs full paths with /SKILL.md suffix
- Makes paths directly usable with Read tool
- Updated help text

**skill-run**

- Moved from scripts/ to skills/using-skills/
- Improved documentation

### Plugin Infrastructure

**Session Start Hook**

- Now loads from skills repository location
- Shows full skills list at session start
- Prints skills location info
- Shows update status (updated successfully / behind upstream)
- Moved "skills behind" warning to end of output

**Environment Variables**

- `SUPERPOWERS_SKILLS_ROOT` set to `~/.config/superpowers/skills`
- Used consistently throughout all paths

## Bug Fixes

- Fixed duplicate upstream remote addition when forking
- Fixed find-skills double "skills/" prefix in output
- Removed obsolete setup-personal-superpowers call from session-start
- Fixed path references throughout hooks and commands

## Documentation

### README

- Updated for new skills repository architecture
- Prominent link to superpowers-skills repo
- Updated auto-update description
- Fixed skill names and references
- Updated Meta skills list

### Testing Documentation

- Added comprehensive testing checklist (`docs/TESTING-CHECKLIST.md`)
- Created local marketplace config for testing
- Documented manual testing scenarios

## Technical Details

### File Changes

**Added:**

- `lib/initialize-skills.sh` - Skills repo initialization and auto-update
- `docs/TESTING-CHECKLIST.md` - Manual testing scenarios
- `.claude-plugin/marketplace.json` - Local testing config

**Removed:**

- `skills/` directory (82 files) - Now in obra/superpowers-skills
- `scripts/` directory - Now in obra/superpowers-skills/skills/using-skills/
- `hooks/setup-personal-superpowers.sh` - Obsolete

**Modified:**

- `hooks/session-start.sh` - Use skills from ~/.config/superpowers/skills
- `commands/brainstorm.md` - Updated paths to SUPERPOWERS_SKILLS_ROOT
- `commands/write-plan.md` - Updated paths to SUPERPOWERS_SKILLS_ROOT
- `commands/execute-plan.md` - Updated paths to SUPERPOWERS_SKILLS_ROOT
- `README.md` - Complete rewrite for new architecture

### Commit History

This release includes:

- 20+ commits for skills repository separation
- PR #1: Amplifier-inspired problem-solving and research skills
- PR #2: Personal superpowers overlay system (later replaced)
- Multiple skill refinements and documentation improvements

## Upgrade Instructions

### Fresh Install

```bash
# In Claude Code
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

The plugin handles everything automatically.

### Upgrading from v1.x

1. **Backup your personal skills** (if you have any):
  ```bash
   cp -r ~/.config/superpowers/skills ~/superpowers-skills-backup
  ```
2. **Update the plugin:**
  ```bash
   /plugin update superpowers
  ```
3. **On next session start:**
  - Old installation will be backed up automatically
  - Fresh skills repo will be cloned
  - If you have GitHub CLI, you'll be offered the option to fork
4. **Migrate personal skills** (if you had any):
  - Create a branch in your local skills repo
  - Copy your personal skills from backup
  - Commit and push to your fork
  - Consider contributing back via PR

## What's Next

### For Users

- Explore the new problem-solving skills
- Try the branch-based workflow for skill improvements
- Contribute skills back to the community

### For Contributors

- Skills repository is now at [https://github.com/obra/superpowers-skills](https://github.com/obra/superpowers-skills)
- Fork → Branch → PR workflow
- See skills/meta/writing-skills/SKILL.md for TDD approach to documentation

## Known Issues

None at this time.

## Credits

- Problem-solving skills inspired by Amplifier patterns
- Community contributions and feedback
- Extensive testing and iteration on skill effectiveness

---

**Full Changelog:** [https://github.com/obra/superpowers/compare/dd013f6...main](https://github.com/obra/superpowers/compare/dd013f6...main)
**Skills Repository:** [https://github.com/obra/superpowers-skills](https://github.com/obra/superpowers-skills)
**Issues:** [https://github.com/obra/superpowers/issues](https://github.com/obra/superpowers/issues)
