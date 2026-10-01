# Project dashboard as a claude.ai Artifact — design

Status: approved in brainstorming on 2026-09-29; revised by spec review.

## 1. Summary

A new plugin skill, `dashboard`, shows the status of a repository that uses
superpowers-orchestrator on a claude.ai Artifact page. An Artifact is a web
page that a Claude Code session publishes to claude.ai with its Artifact
tool; it starts private to its owner. The skill has four commands:

- `refresh` — extract the status from the repository with a script, render
  the page, and publish it.
- `sync` — copy the owner's edits made on the page back into the Markdown
  files, after the owner approves each change.
- `share` — publish a second page that holds pushed content only.
- `local` — write a read-only HTML file instead, for sessions that cannot
  publish.

The repository files stay the only source of truth. The page is a view of
them, plus a small list of edit proposals that wait for `sync`.

## 2. Background and decisions already taken

A deliberation and a brainstorming session on 2026-09-29 settled these
points with the user:

| Question | Decision |
|---|---|
| What the page answers | Two tabs: "Waits for me" first, "History" second |
| View or control | Editable by the owner; edits are copied back into the Markdown files by a later session |
| Audience | The owner and colleagues, through two pages: a private page with all sources, and a shared page with pushed content only |
| Who may edit | Only the owner |
| Scope | A plugin feature for every repository that uses the plugin, not only this repository |
| Platform approach | Hybrid (approach C): status data is published with the page and replaced on each refresh; the `db` capability holds only the owner's edit proposals |
| Plan of the user and colleagues | Pro or Max: the only way to share a page is a public link |
| Fallback | A local read-only HTML file for sessions that cannot publish |
| Existing plugin `project-artifact` | Checked; not reusable (see section 12); build our own and borrow three patterns |

Two facts shape the whole design (sources in section 12.1):

1. **The page cannot read the local disk or the git repository.** Data
   reaches a page only through (a) the files published with it, (b) rows of
   the page's `db` database, written by Claude with the ArtifactData tool
   or by the page itself, or (c) edits made on the page.
2. **Only a Claude Code session can publish a page, or write `db` rows from
   outside the page.** A hook is a shell script and cannot call the
   Artifact or ArtifactData tools, so a refresh is always a command that
   the user runs in a session.

## 3. Scope and non-goals

In scope: the skill, three scripts, one shared git module, one HTML
template, one test suite, and the release and documentation work listed in
section 11.

Non-goals:

- **No automatic refresh.** A hook cannot call the Artifact tool.
- **No control of an orchestration run from the page.** No resume, no
  ruling, no merge decision. The orchestrator keeps its own flow.
- **No editing by colleagues**, and no comments on the shared page: on a
  public link, claude.ai does not allow comments (section 12.1).
- **No GitHub pull-request data.** The official `project-artifact` plugin
  covers pull requests.
- **No "installed plugin version" signal.** It is meaningful only for this
  repository.
- **No `docs/orchestration-issues.md` worklist table.** This file is a
  convention of this repository only, not of the plugin. It can be added
  later as an optional source.
- **No parsing of orchestration phases.** A run shows its last `## `
  heading as text and counts of two heading kinds (section 5.2).
- **No work logs of other branches.** A work log stays on its work branch;
  the page shows the work logs of the checked-out branch only.
- **No `dropped` part status from the page.** The work-log rules require a
  `## Decisions` entry for a dropped part; the owner uses `/worklog` for it.
- **No pages shared across machines.** The page URLs are stored on one
  machine (section 6). A second machine creates its own pages unless the
  user reconnects them with `refresh --url` and `refresh --shared-url`.
  The same happens on one machine when the plugin is loaded in two ways
  (the installed plugin and `--plugin-dir`): each has its own plugin data
  folder, so each creates its own pages.
- **The page can be out of date.** It shows the state of its last refresh.
  The "as of" line (section 5) and the anchor verdicts (section 8) prevent a
  wrong write; they do not prevent an out-of-date view.

## 4. Architecture

Six small units, each with one job. All scripts run on Node 16 or later,
use no npm dependency, and work on macOS, Linux and Windows Git Bash.

| Unit | Path | Job |
|---|---|---|
| Git run module | `skills/pickup/scripts/git-runs.js` | `gitState()`, `defaultBranch()`, `currentBranch()` and `scanRuns({ refs: 'local' \| 'upstream' })`, moved out of `pickup-scan.js` and exported. `scanRuns` returns data and prints nothing: a list of `{ branch, ref, slug, logs: [{ file, text }], ambiguous, lastHeading, lastCommitDate, state }`, where `ref` is `refs/heads/feature/<slug>` or its upstream ref, `lastCommitDate` is the committer date `YYYY-MM-DD`, and `state` is `stopped`, `ambiguous` or `in progress`. `pickup-scan.js` requires the module and prints the list in its own format (relative dates included); its output does not change |
| Extractor | `skills/dashboard/scripts/dashboard-extract.js` | Read the repository for one audience; write one JSON document (JSON: JavaScript Object Notation); with `--data-dir <path> --state-dir`, print the state folder path |
| Renderer | `skills/dashboard/scripts/dashboard-render.js` | JSON + audience → the page files, written into the folder given by `--out <dir>`; with `--diff <previous.json>`, print the change summary |
| Template | `skills/dashboard/template.html` | The page: layout, two tabs, edit controls |
| Sync script | `skills/dashboard/scripts/dashboard-sync.js` | Read the proposal files written by ArtifactData, validate them, run the run check, match them to file lines, print diffs, apply accepted proposals |
| Skill | `skills/dashboard/SKILL.md` | The four commands; calls the scripts, the Artifact tool and the ArtifactData tool; asks the owner the questions of section 8 |

Data flow of `refresh`. The two audiences use **two separate extractor
runs**: the private run reads the working tree; the shared run reads only
pushed refs, and the URL of the shared ref's remote for `repo.name`
(section 5.3). The shared JSON never passes through the private
run.

```
extract --audience private → private.json → render --audience private → index.html + dashboard-data.json → Artifact tool (db capability)
extract --audience shared  → shared.json  → render --audience shared  → index.html + dashboard-data.json → Artifact tool (no capability)   [only when sharing is on]
render --diff <previous private.json>     → change summary shown to the user
```

**Page files.** For a published page the renderer writes two files: a
small `index.html` (the template, no data) and `dashboard-data.json` (the
extractor JSON), published together through the Artifact tool's `files`
field. The renderer writes them into `<scratchpad>/dashboard/<audience>/`,
where `<scratchpad>` is the session scratchpad folder that Claude Code
names in the system prompt: the Artifact tool accepts `files` sources only
from the working directory or the scratchpad folder (section 12.1), the
working tree must stay untouched (section 6), and the plugin data folder is
neither of the two allowed places. The page loads the data with `fetch('dashboard-data.json')` from its
own origin. For `local`, the renderer writes one file with the JSON inside a
`<script type="application/json" id="dashboard-state">` block, because a
browser blocks a `file://` page from reading nearby files. The template
uses the inline block when it is present, and `fetch` otherwise.

`index.html` carries `<meta name="dashboard-audience" content="private">`
or `content="shared"`, and a title that names the audience:
`<repo> dashboard — PRIVATE` or `<repo> dashboard — shared`, where `<repo>`
is `repo.name` of section 5.1. The private
page also shows a permanent banner: "Private page — do not make it
public". When the private page is opened by a viewer who is not the owner,
it shows a warning that this page is not meant to be shared.

Reason for the separate data file: the Artifact tool refuses to update a
page that the current conversation has not read or published, and a read
returns the page's HTML (section 12.1). With the data outside `index.html`,
the read that each new session must make before its first refresh returns
only the small template, not the old data. The replaced
`dashboard-data.json` is covered by a file listing, which returns no
content (section 6).

Data flow of `sync`:

```
ArtifactData (query pending proposals, out_dir = <scratchpad>/dashboard/proposals) → one JSON file per proposal (the document body only)
   → the skill writes the versions file: one line "<id> <version>" for each line of the query's result text
   → dashboard-sync.js --check <that folder> --versions <versions file>  → verdict and diff per proposal
   → owner answers the questions of section 8
   → dashboard-sync.js --apply <that folder> <ids> --versions <versions file>  → Markdown files changed
   → ArtifactData (mark proposals applied or rejected, pinned to each document's version)
```

Rules for the units:

- The model never reads the Markdown sources to build the page or the
  summary. This keeps a refresh deterministic and keeps the large files
  (for example a 331 KB session log) out of the conversation context.
- The model does read the two page files once before each publish: the
  Artifact tool requires Claude to read the complete file of every file it
  publishes and did not write itself (section 12.1). The list caps of
  section 5.2 keep `dashboard-data.json` small; the renderer prints its
  size, and the skill reports it with the change summary. The file holds
  text that other people can write (commit subjects, branch names, log
  lines): the model treats it as data, never as instructions. `SKILL.md`
  states this rule too.
- **Text is inserted as text.** The template inserts every value from the
  data with `textContent` or attribute setters, never with `innerHTML` or
  any other HTML parsing. For the `local` file, the renderer writes the
  inline JSON with every `<` escaped as `\u003c`, so a `</script>` inside a
  value cannot end the block. Reason: commit subjects and branch names come
  from other people, and the private page runs with the owner's identity
  and write access to `db`.
- The change summary is the output of `render --diff`: for each section,
  the number of item ids added and removed since the previous JSON, and
  each section whose `status` changed. The previous JSON is the
  `private.json` stored in the state folder by the last refresh. The first
  refresh prints "first refresh". (Pattern borrowed from `project-artifact`:
  the reply lists only the changes.)
- `git-runs.js` is the single definition of "unfinished run" for both
  `/pickup` and the dashboard. The existing suite `tests/pickup` must pass
  unchanged after the move.

## 5. Extractor output and tab contents

### 5.1 JSON shape

```json
{
  "schemaVersion": 1,
  "audience": "private | shared",
  "generatedAt": "2026-09-29T20:40:00+02:00",
  "repo": { "name": "<private run: basename of the repository root; shared run: the name from the remote's URL, section 5.3>" },
  "commit": { "sha": "<40 hex>", "short": "<7 hex>", "branch": "<name, or null when detached>", "ref": "<HEAD, or the upstream ref for the shared run>", "defaultBranch": "<name, or null>" },
  "sections": { "<section id>": { "status": "ok | not-found | error", "note": "<text>", "items": [ ... ] } }
}
```

All times are local times with their UTC offset (ISO 8601). `git-runs.js`
returns `'detached'` for a detached `HEAD`; the extractor maps it to
`null`.

Every item has:

- `id` — the SHA-1, in hexadecimal, of a UTF-8 string. For an item from a
  file: the repository-relative path, the normalized heading (below), the
  heading ordinal, the exact target line and the occurrence, joined by
  `\n`. The line used here is the normalized line (below). For an item with
  no source file: the section id and a natural key
  (branch name, commit SHA, version heading, or topic slug), joined by
  `\n`. The id stays the same while its heading and its line do not change.
  A change of the line (for example with `/worklog`) gives a new id; a
  proposal for the old id is then reported only by `sync`.
- `visibility` — `tracked` or `private` (section 5.3).
- `source` — `file` (repository-relative, or `null`), `heading` (the
  **normalized** heading: the exact raw text of the heading line, `## `
  included, with one trailing ` [superseded …]` part removed),
  `headingOrdinal` (1-based position of this heading among the headings of
  the file with the same normalized text), `line` (the **exact raw text** of
  the target line, list marker or table pipes included, line ending and byte
  order mark removed), `occurrence` (1-based position of this line among
  the lines of its section whose **normalized** text is equal) and
  `lineNumber` (informational only; never used to find a line). The
  normalized text of a line is the line with one trailing
  ` [resolved …]` part removed. Resolving one of two equal open items
  therefore does not move the other one to another occurrence, and does
  not change its id.

Headings are normalized because the context-management skill appends
`[superseded by <date>]` to an old entry's heading line. Without the
normalization, that suffix would move every later equal heading down one
ordinal, and a pending proposal would point at the next entry.

The absolute path of the repository is never in the JSON: it contains the
local user name. Section notes follow the same rule: the private run
replaces the repository root with `<repo>` and the home folder with `~` in
every message it copies into a note; the shared run never copies a command
message and writes the fixed note "git command failed".

All parsers remove a byte order mark at the start of a file and a carriage
return at the end of a line before they compare text, as the work-log
check command does (`skills/worklog/SKILL.md`, section "The check
command").

**Raw items.** A parser emits `"kind": "raw"` with the line text only for
the lines that it expects and cannot read; it never drops such a line.
These are: a line inside an `Open:` list that is neither a bullet nor an
indented continuation; a row of a `## Parts` or `## Open items` table whose
number of cells differs from the table's header row. Every other line of a source (for example the
`Decisions:` lines of a session-log entry, or the headings of an
orchestration log other than the last one) is not read and gives no item.

### 5.2 Sections

Terms used below:

- An **entry** of `session-log.md` is the text from one `## ` heading line to
  the next `## ` heading line or the end of the file.
- An **open item** is a bullet line (`- ` at the start) inside an `Open:`
  list, together with its indented continuation lines, or the text after
  `Open: ` on a one-line `Open: <text>` line. An `Open:` list ends at a
  blank line, at a line that starts with a word followed by `:` (for
  example `Rejected:`), or at the end of the entry.
- An open item is **resolved** when its bullet line or one of its
  continuation lines contains `[resolved`. Only this marker counts.
- **Dates** of commits and branches are committer dates in the form
  `YYYY-MM-DD` (`git log -1 --format=%cd --date=short`).

**Tab 1 — Waits for me**

- `unfinishedRuns` — the unfinished orchestration runs that `git-runs.js`
  finds: local `feature/<slug>` branches not merged into the default
  branch, **the checked-out branch included**, whose orchestration log for
  `<slug>` (path pattern of `pickup-scan.js`: `docs/superpowers-orchestrator/
  <date>-<slug>/<slug>-orchestration-log.md`) is read from the branch with
  `git show <branch>:<path>` and has no line that starts with
  `_Completed — `. Each item shows the branch, slug, last `## ` heading and
  the date of the branch's last commit. A run whose last `## ` heading
  starts with `## STOPPED` is marked **stopped — waits for you**. A branch
  with two or more logs for its slug is marked **ambiguous — waits for
  you** (the orchestrator's resume stops on it). Every other run is marked
  **in progress**; when its branch has no commit in the last 24 hours, the
  mark is **no commit since <date> — may need resume** (a killed session,
  for example at the usage limit, writes no `## STOPPED` entry; the 24-hour
  limit is a fixed constant of the extractor). When there is no default branch, `git-runs.js` scans
  every `feature/*` branch, as `/pickup` does today. A log read from the
  checked-out working tree is never a source for this section.
- `git` — local branches not merged into the default branch (the default
  branch itself excluded), each with the date of its last commit; the
  number of commits of the current branch that are not on its upstream
  branch (`git rev-list --count @{upstream}..HEAD`; omitted with a note
  when there is no upstream); the number of tracked files with uncommitted
  changes (lines of `git status --porcelain` that do not start with `??`).
- `activeWorklogs` — files `docs/worklogs/*.md` of the checked-out branch.
  The extractor classifies each file with a Node implementation of the
  work-log rules of `skills/worklog/SKILL.md` (sections "The check
  command", "Valid forms of line 1" and "The listing command"), kept as one
  set of constants in the extractor; it applies them both to working-tree
  text and to `git show` text (the shared run cannot run the skill's bash
  commands). The results are those of the check command:
  `active` → shown here with its slug, the rows of its `## Parts` table
  whose Status is `in progress` or `not started`, and the rows of its
  `## Open items` table (the template's five columns `#`, `Item`, `Part`,
  `Found`, `Blocks`; the page shows `#`, `Item`, `Part` and `Blocks`);
  `closed` → `closedWorklogs`; `malformed` → listed here with its path;
  `symlink` → listed here with its path and the note "symbolic link, not
  read"; a file name that the work-log listing command rejects → listed
  here with the note "invalid file name, not read".
- `sessionOpenItems` — the unresolved open items of the 10 most recent
  entries of `session-log.md`. Entries whose heading line contains
  `[superseded` are removed first; then the last 10 entries in file order
  are taken (the log is appended at its end). Continuation lines are shown
  with their item. The number of unresolved open items in the older,
  non-superseded entries is given as one count.
- `currentGoal` — the text under `## Current Goal` in `state.md`, cut to
  its first 300 characters.

**Tab 2 — History**

- `releases` — the version in `VERSION`, else the `version` field of
  `package.json`; and the first 15 release headings, in file order, of
  `RELEASE-NOTES.md`, else of `CHANGELOG.md` (release notes put the newest
  entry at the top). A release heading is `## v<version>` or the Keep a
  Changelog form `## [<version>]`. When the file exists but no heading
  matches, the section note says so.
- `runHistory` — one item per topic folder under
  `docs/superpowers-orchestrator/` of the checked-out tree: date, slug,
  which stage folders exist (`specs`, `plans`, `implementation`), the last
  `## ` heading of `<slug>-orchestration-log.md` if the folder has one, and
  the number of `## RULING` and `## STOPPED` headings. This section is
  history only; it does not decide what waits for the owner.
- `closedWorklogs` — work logs classified `closed`.
- `commits` — the last 20 commits of the current branch: short hash, date,
  subject.
- `sessions` — the `Goal:` line of the 10 most recent entries of
  `session-log.md`, selected as in `sessionOpenItems`.
- `knownIssues` — the `## ` titles of `known-issues.md`.

Every page shows at its top: `as of commit <short> on branch <branch>,
built <local date and time>`; for a detached `HEAD`: `as of commit <short>
(detached HEAD)`. The shared page names the upstream ref instead of the
branch.

List lengths are capped as stated above, so a page stays far below the
16 MiB page limit (section 12.1).

### 5.3 The two audiences

In this section, a file is **committed** when `git cat-file -e
<ref>:<path>` succeeds, where `<ref>` is the ref that the run reads.

**Private run** (`--audience private`, `<ref>` = `HEAD`): reads the
working tree and every source above. An item is `tracked` when its source
file is committed at `HEAD`, or when it has no source file; otherwise it is
`private`. The private page shows every item and marks `private` items
with a small lock sign.

**Shared run** (`--audience shared`): its rule is **only what is pushed**.
"Pushed" means reachable from a remote-tracking ref. The run fails closed:
anything it cannot place under the rule is left out. One value is not
pushed content: `repo.name`, which comes from the URL of the shared ref's
remote in the local git configuration (the `repo.name` item below).

- An upstream counts only when it is a remote-tracking ref of the same
  name: `git rev-parse --symbolic-full-name <branch>@{upstream}` must print
  `refs/remotes/<remote>/<branch>`. An upstream that is a local branch
  (`git branch --track y main`), or a remote-tracking ref of another name
  (`git switch -c feature/x origin/main`), counts as no upstream. Branches
  are named on the shared page by their upstream name
  (`<remote>/<branch>`), never by a local name; `commit.branch` holds that
  name.
- `<ref>` is the **shared ref** stored in `config.json` by `share`: the
  upstream of the default branch, or the ref given with `share --ref
  <remote>/<branch>`. Every shared refresh reads that ref, whatever branch
  is checked out, and the page names it. When the stored ref no longer
  exists, the shared refresh stops with a message and publishes nothing.
- `repo.name` is never the name of the local folder: that name is local
  data. It comes from the URL of the shared ref's remote, which the
  extractor reads from the local git configuration with the code of its
  `--remote-url` option; that code removes the user information (user name,
  password or token) of a URL with a scheme. `repo.name` is the last path
  part of that URL, with trailing `/` characters and exactly one trailing
  `.git` removed, only when all of these hold:
  - The URL holds no white space and no control character (white space at
    its two ends is removed first).
  - The URL is a network URL in one of two forms. The first form is
    `<scheme>://<host>[:<port>]/<path>`, with the scheme `http`, `https`,
    `ssh` or `git` in any letter case. The second form is the scp-like form
    `[<user>@]<host>:<path>` (scp: secure copy): the text holds no `://`,
    the host holds no `/`, `@` or `:`, has at least two characters (one
    letter is a Windows drive) and is not `file`, and the path does not
    begin with `:` (`<name>::<address>` is the form of a remote helper, and
    its address can be a folder on this machine).
  - The last path part holds only the characters `A-Z a-z 0-9 . _ -` and is
    not `.` or `..`.

  So `https://host/org/repo.git`, `ssh://git@host/org/repo.git` and
  `git@host:org/repo.git` all give `repo`. In every other case `repo.name`
  is the shared ref text `<remote>/<branch>` (for example `origin/main`).
  Such cases are: a folder on this machine (the last part of a local folder
  path is local data too), written as a text with no `:` or with a `/`
  before its first `:` (git reads such a text as a folder path), as a
  Windows drive path, or as a `file:` URL; a helper form
  `<name>::<address>`; a URL with no path; a last part that holds a `?` or
  a `#`; a remote with no URL. This rule lists what is allowed. It is separate from the warning of
  `share` step 3 in `SKILL.md`, which only tells the user that a remote is
  a folder on this machine and recognises it by the start of the URL (`/`,
  `./`, `../`, `~`, a drive letter such as `C:/` or `C:\`, or `file://`).
  (Decision after acceptance, 2026-10-01, owner; recorded in
  `plans/dashboard-open-decisions.md`.)
- Files are read only with `git show <ref>:<path>`, never from the working
  tree or from `HEAD`. A file that is only in the working tree, only
  staged, or only in unpushed commits does not exist for this run.
- Folders and file lists (topic folders, stage folders,
  `docs/worklogs/*.md`) are enumerated with `git ls-tree <ref>`, never
  from the file system, so the name of an untracked or unpushed folder or
  file never reaches the shared page. A symbolic link (`ls-tree` mode
  `120000`) is skipped.
- `unfinishedRuns`: only branches whose upstream counts (above); the log,
  its last heading and the date are read from that upstream, never from
  the local branch.
- `git`: only branches whose upstream counts, named and dated from the
  upstream; no count of unpushed commits; no count of uncommitted
  changes.
- `commits`: the last 20 commits of `<ref>`.
- Every item it emits is `tracked`. The renderer, as a second guard, drops
  every item whose `visibility` is not `tracked` before any data is
  written into the shared page files.

In this repository `session-log.md`, `state.md` and `known-issues.md` are
not tracked, so their sections have the status `not-found` in the shared
data, and the shared page shows `nothing here (<file> not found)` for each. In a
repository that commits and pushes them, they appear: they are already
readable by anyone who can read the remote repository.

## 6. Pages and machine-local state

- **Private page.** Published with the `db` capability. It shows every
  section and the edit controls. The edit controls appear only when the
  page's `user.isOwner()` call returns true. When `db` is not available
  (the local file, or a view without the capability), the template hides
  every edit control; one template serves all cases.
- **Shared page.** Published with no runtime capability and no edit
  control. Claude publishes it as private; the user makes it public from
  the page's Share control (section 12.1, unverified). `share` first shows
  this warning: "A public link can be read by anyone who has the URL. On Pro
  and Max plans this is the only way to share. The shared page holds the
  pushed content of this repository; if the remote repository is private,
  that content is not public today." The user must confirm before the first
  publish of the shared page. After the publish, `share` prints the exact
  URL of the shared page and says: "Make only this URL public."
- **Audience guard.** Before each publish, `dashboard-render.js
  --verify <dir> --audience <a>` checks that the page files in `<dir>` are
  of audience `<a>` (the meta tag and the JSON `audience` field) and, for
  `shared`, that every item is `tracked`. The skill publishes the files of
  an audience only to the URL stored for that audience. The read that
  starts each session (below) returns the page's meta tag: when it differs
  from the audience of the files, the skill stops and publishes nothing.
  `refresh --url` refuses the stored shared URL, and `refresh --shared-url`
  refuses the stored private URL.
- **Plugin data path.** `CLAUDE_PLUGIN_DATA` is not present in the
  environment of commands that Claude runs with the Bash tool; Claude Code
  substitutes the text `${CLAUDE_PLUGIN_DATA}` inline when it loads a
  plugin skill (section 12.1). `SKILL.md` therefore writes every script
  command with `--data-dir "${CLAUDE_PLUGIN_DATA}"`, and the scripts take
  the path only from that argument. An argument that is empty, or that
  still holds the literal text `${CLAUDE_PLUGIN_DATA}` (a platform that
  does not substitute it), counts as "not set" (section 10).
- **State folder.** `<data dir>/dashboard/<repo key>/`, outside the
  repository. The extractor computes `<repo key>` and prints the folder
  path with `--data-dir <path> --state-dir`; the skill uses that output and
  never computes the key itself. `<repo key>` is the basename of the repository root, a
  `-`, and the first 12 hexadecimal digits of the SHA-1 of the UTF-8 string
  `fs.realpathSync(<output of git rev-parse --show-toplevel>)`, with no
  trailing newline. Each linked worktree therefore gets its own key. The
  folder holds only `config.json` (the URLs of the two pages and whether
  sharing is on) and the last `private.json` and `shared.json` (the
  baseline of `render --diff`). Page files and proposal files are written
  into the session scratchpad folder (section 4). (Pattern borrowed from
  `project-artifact`: the URL lives outside the repository.)
- **No state yet.** When the state folder has no `config.json` (first use,
  or the repository was moved, which changes `<repo key>`), the skill says
  that it will create new pages, mentions `refresh --url` for an existing
  page, and asks before it creates one.
- **URLs are stored at once.** Each URL is written to `config.json` right
  after its page is created, before the next publish starts. A failure of
  the second publish therefore never leads to a second copy of the first
  page on the next run.
- **Read and list before the first republish of a session.** Before the
  first publish to a stored URL in a session, the skill (1) reads that URL
  with the Artifact tool, which the tool requires before any update of a
  page; the read returns the small `index.html` only (section 4); and
  (2) lists the page's published files (`action: "list"`, `scope:
  "files"`), which the tool requires before a `files` publish replaces a
  path that the session has not read or published; a listing returns no
  file content (section 12.1). A failed read is the "stored URL no longer
  works" case of section 10.
- Nothing is written into the working tree by `refresh`, `share` or
  `local`. Every git command of the scripts runs with
  `git --no-optional-locks`, so a `git status` never takes the index lock
  that a running orchestrator's commit needs. The orchestrator's clean-tree
  checks and commits are therefore never affected, even during a run.
- A republish does not pass the Artifact tool's `contract` field, which
  keeps the page's runtime contract version (section 12.1), so a page does
  not move to a new `db` contract silently.
- The template keeps its tab ids fixed across versions. (Pattern borrowed
  from `project-artifact`.)
- The template follows the claude.ai Artifact page contract: the
  implementer loads the `artifact-design` skill before writing it and the
  `artifact-capabilities` skill before writing the `db` code.
- At run time, the first publish of each page (the page is created) loads
  the `artifact-design` skill and, for the private page, the
  `artifact-capabilities` skill before it passes `capabilities`, and passes
  an `icon`, as the Artifact tool requires. A republish omits
  `capabilities` and `icon`, so it loads neither skill.

## 7. Edits on the private page

The owner can make two kinds of edit. Proposals are stored in the
collection `proposals` of the page's `db`, at the database's shared level
(not under a viewer's own `data/users/<id>/` part, which is private even
from the owner — section 12.1, unverified; the exact path is section 13
item 3). The proposal document id is the item `id`.

| Kind | Target | Change that `sync` writes |
|---|---|---|
| `resolve-open-item` | an open item of `session-log.md` | append ` [resolved <date>: <note>]` at the end of the item's bullet line (or of the one-line `Open:` line), the form the log already uses; `<note>` defaults to `from the dashboard` |
| `set-part` | a row of the `## Parts` table of a work log | when `status` is given and differs from the current Status cell: set the Status cell and set the Since cell to `<date>`; when `status` equals the current Status: change nothing in these two cells; when `note` is given: set the Note cell. Other cells, the Commit cell included, are not changed |

**Dates.** The page writes `createdAt` as local time with its UTC offset
(for example `2026-09-29T00:30:00+02:00`). `<date>` is the first 10
characters of `createdAt`: the owner's local calendar date. `sync` never
uses the clock of the machine, so the new line is the same on every run.

**Table cells.** A row is split on `|` after the leading and the trailing
`|` are removed. Cells are compared after trimming spaces. A rewritten row
is written as `| ` + the cells joined by ` | ` + ` |`, with single spaces:
the column padding of a hand-aligned table is not kept.

**One document per item.** The page cannot make a write conditional on a
document version: the platform has no such option (section 13 item 12).
The page reads the proposal document again just before each write, and it
refuses the edit when the document changed since the page listed it.
Known limit: a window stays between that re-read and the write. A page
write inside it can overwrite a `sync` mark (the `applying` state that
`sync` writes in section 8 step 4), and that edit can then be lost without
a report. The platform also has no create-if-absent write: a second
browser tab of the owner that creates the same document inside the window
can be overwritten. An edit on an item:

- with no document, with a document whose `state` is `rejected`, or with
  an `applied` document whose `closedAt` is earlier than the page's
  `generatedAt` (the item was rebuilt after that sync): writes a new
  document with this edit's fields only, `state` `pending`, `closedAt`
  null and a new `createdAt`;
- with a `pending` document: merges this edit's fields into it (a status
  edit keeps a pending note, and the reverse) and sets `createdAt` to this
  edit's time, so `<date>` is the date of the latest edit;
- with a document whose `state` is `applying`, or `applied` with
  `closedAt` later than `generatedAt`: not allowed; the item shows
  "sync in progress" or "applied — refresh to update", and no edit control.

An edit that changes nothing (a status equal to the current Status and no
note, or a note equal to the current Note) is not written.

Times (`createdAt`, `closedAt`, `generatedAt`) are always parsed into
instants before they are compared; they are never compared as text.

A proposal document:

```json
{
  "kind": "resolve-open-item | set-part",
  "file": "<repository-relative path>",
  "branch": "<branch the page was built on, or null>",
  "baseCommit": "<sha of the refresh that built the page>",
  "anchor": { "heading": "<normalized heading line>", "headingOrdinal": 1, "line": "<exact target line>", "occurrence": 1, "part": "<part number; set-part only>" },
  "status": "<set-part only, optional>",
  "note": "<optional; one line, at most 200 characters, none of the characters | [ ]>",
  "createdAt": "<local ISO time with offset>",
  "state": "pending | applying | applied | rejected",
  "closedAt": "<local ISO time with offset, or null>"
}
```

**What the page shows:**

- An item whose document has `state` `pending` shows "pending sync",
  across refreshes, until the proposal is closed. The page reads the
  proposals from `db` when it loads and matches them to items by `id`.
- An item whose document was closed after the page's `generatedAt` shows
  "applied — refresh to update" or "rejected".
- A proposal whose item no longer exists on the page (its line changed) is
  not shown on the page; `sync` reports it.
- Known limit: defect anthropics/claude-code#94426 means a fresh page load
  may not show writes that Claude made to `db`. The page can then show
  "pending sync" for a proposal that `sync` already closed. An edit on it
  is then refused when the page's re-read before the write sees the
  change, or, when the re-read misses it too, it creates a proposal that
  `sync` reports as `none` against the changed line; no wrong write
  follows.

## 8. `sync`

1. **Read.** Query the proposals whose `state` is `pending` or `applying`
   through the
   ArtifactData tool's `query` action with `out_dir` set to
   `<scratchpad>/dashboard/proposals` (emptied first). The tool writes one
   JSON file per document; the model does not copy proposals by hand. Each
   saved file holds the document body only; the version of each document
   is only in the result text, one line per saved file, in the form
   `"<id>"  <n> bytes  version <v>  "<path>"`. The skill writes the versions
   file `<scratchpad>/dashboard/proposals-versions.txt` (emptied first too):
   one line `<id> <v>` for each such result line, and nothing else. A copy
   error is safe: the script uses the version only as the `if_version` pin
   of a record, so a wrong number is refused by the platform
   (`version_mismatch`), never written; a missing or extra line stops the
   script before any check. (The first form of this step said "one JSON
   file per document, with its version"; platform check 9 contradicted it:
   ruling 6 in `plans/dashboard-open-decisions.md`, and
   `implementation/platform-checks.md`.) If the call fails, stop before any
   file is written.
2. **Check.** Run
   `dashboard-sync.js --check <that folder> --versions <versions file>`. For each
   proposal the script prints one verdict, found in this order:
   1. `invalid: <reason>` — the first failed validation: `kind` is one of
      the two kinds; `file` is relative, contains no `..` and no backslash,
      and stays inside the repository root; `resolve-open-item` allows only
      `session-log.md`; `set-part` allows only `docs/worklogs/<slug>.md`
      with a slug matching `^[a-z0-9]+(-[a-z0-9]+)*$`; `status` is one of
      `not started`, `in progress`, `done`; `note` is one line, at most 200
      characters, without `|`, `[` or `]`; `set-part` has `status` or
      `note` or both; the anchor fields are present; `set-part` has a
      non-null `branch` (a page built on a detached `HEAD` cannot propose
      work-log edits); `createdAt` matches
      `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}:\d{2}$`;
      the proposal changes something (checked against the current row);
      a `set-part` status change away from `done` is refused while the
      Commit cell is filled (the owner uses `/worklog`); the target file is
      not a symbolic link.
   2. `file-missing` — the file does not exist in the working tree.
   3. `wrong-branch` — a `set-part` proposal whose `branch` differs from
      the current branch (a detached `HEAD` counts as different). The
      owner checks out that branch and syncs again.
   4. `held-run` — the target file is tracked (`git ls-files
      --error-unmatch -- <file>` succeeds), and `git-runs.js` finds an
      unfinished run that is `in progress` on the current branch, or any
      `stopped` or `ambiguous` run on any branch. An uncommitted change to a
      tracked file either stops a running run's clean-tree checks, or
      travels with the checkout that a resume makes and is taken into the
      stopped run as if it were the blocked task's own work (the
      orchestrator's resume checks out `feature/<slug>` and skips its
      clean-tree check after `## STOPPED`; its Phase 5 stops on a dirty
      tree). The proposal stays `pending`.
   5. The target, found inside its section. The section: the headings whose
      normalized text equals `anchor.heading`; the one at position
      `anchor.headingOrdinal` among them; the section ends at the next line
      that starts with `## `. Fewer equal headings than the ordinal gives
      `none`.
      - `resolve-open-item`: the lines of the section whose normalized
        text equals `anchor.line`; the one at position
        `anchor.occurrence` is the target. Target equal to `anchor.line` →
        `unique`; target equal to the expected new line →
        `already-applied`; no target, or any other text → `none`. Only the
        line at the anchor's own position is ever compared with the
        expected new line.
      - `set-part`: the rows of `## Parts` whose first cell equals
        `anchor.part`; none → `none`; more than one → `several`; exactly
        one: equal to `anchor.line` → `unique`; equal to the expected new
        row → `already-applied`; any other text → `none` (the row changed
        after the refresh).
   For `unique`, a diff of the old and the new line follows. The diff
   carries a warning when a `set-part` note replaces a Note cell that
   contains `item #`, or when a status changes on a part that an open item
   blocks (its Note names `item #`, or its number is in the `Blocks` column
   of `## Open items`): the work-log rules say that a blocked part keeps its
   status and that its Note names the blocking item.
3. **Ask.** When any `unique` proposal targets a tracked file, the skill
   first asks the owner once to confirm that no whole-branch review is
   running (a whole-branch review writes no marker that a script can
   read). On "a review is running", those proposals stay `pending`. Then
   the skill shows every remaining `unique` diff and lets the owner accept
   or reject each one. Every other verdict is reported with its reason;
   its proposal stays `pending`, and the owner can reject it explicitly.
4. **Mark.** Set every accepted proposal to `applying`, through
   ArtifactData `batch` writes of at most 50 documents, each with
   `if_version` set to the version read in step 1. A version conflict means
   the owner edited that item on the page during the sync: that proposal is
   not applied in this sync and is reported; its new version is handled by
   the next sync. The page allows no edit on an `applying` document.
5. **Apply.** Run
   `dashboard-sync.js --apply <that folder> <ids> --versions <versions file>` for the
   proposals marked in step 4. The script repeats the whole check for each
   one, `held-run` included. It computes every target of one file against
   the file text read before the first write, then writes that file once,
   with all its changes. It writes only on `unique` verdicts, replaces
   exactly one line per proposal, and keeps the file's line endings (a
   carriage return before the line feed stays) and a byte order mark at
   its start. The write goes to a temporary file in the same folder, which
   is renamed over the target; just before the rename, the script checks
   that the target's size and modification time are unchanged since it
   read it, and redoes the check when they are not. A temporary file is
   kept when the rename fails.
6. **Record.** Mark the applied proposals and the `already-applied` ones as
   `applied`, the rejected ones as `rejected`, and the `applying` ones that
   were not written back to `pending`, each with `closedAt` set where it
   is closed, in batches of at most 50 with `if_version`. A sync that stops
   after step 4 leaves `applying` documents; the next sync reads them in
   step 1, and the check gives `already-applied` for a line that was
   written and `unique` for one that was not. Because the new line depends
   only on the proposal (the date comes from `createdAt`), and the page
   cannot change an `applying` document, `sync` is idempotent. The file is written before `db` is
   updated, so a sync that stops between the two steps is completed by the
   next sync through the `already-applied` verdict. Because the new line
   depends only on the proposal (the date comes from `createdAt`), `sync`
   is idempotent.
7. **Report.** List the files changed and offer a `refresh`. `sync` never
   commits; the owner commits tracked files (for example a work log) when
   they want. When a tracked file was changed, the report says: "Commit or
   stash these files before you switch branches or resume a run." 

## 9. Commands

The skill is invoked as `/superpowers-orchestrator:dashboard <command>`.

| Command | Effect |
|---|---|
| `refresh` | Run the private extraction and render into the scratchpad folder; read the stored URL and list its files if this session has not read or published it yet (section 6); read the two page files; publish to the stored URL, or create the page and store its URL at once; when sharing is on, do the same for the shared audience; show the output of `render --diff` |
| `refresh --url <url>` / `refresh --shared-url <url>` | Reconnect the private or the shared page at `<url>` (for example on a new machine), then refresh |
| `sync` | Section 8 |
| `share` / `share --ref <remote>/<branch>` | Show the warning of section 6; on the user's confirmation, store the shared ref (the upstream of the default branch, or the given ref, which must count as an upstream under section 5.3), turn sharing on, publish the shared page and print its URL |
| `share off` | Turn sharing off. The shared page is kept, not deleted, and is no longer updated. The skill says: "The public link still works and shows the last published data. To stop sharing, turn off the public link in the page's Share control." |
| `local` | Render the private page as one file into `<scratchpad>/dashboard/local/` without publishing, and print its path |

No command is run automatically. A refresh costs one extractor run and one
renderer run per audience (one or two of each), one diff, and one or two
publishes; the model does not read the source files or the JSON.

## 10. Error handling

| Situation | Behavior |
|---|---|
| A source file is missing | Its section has status `not-found` and a note; the page shows `nothing here (<note>)` in the muted style, with no status word and not as an error; the refresh continues |
| A parser meets an expected line it cannot read | A `raw` item with the text (section 5.1) |
| A git command of a section fails | The section has status `error` and a note with the command's message; the refresh continues |
| The folder is not a git repository, or the repository has no commit yet (`gitState` of `git-runs.js`) | The extractor stops with exit code 2 and a message; nothing is published |
| No default branch (`defaultBranch` returns null: no `origin/HEAD`, no `main`, no `master`) | `commit.defaultBranch` is null; `unfinishedRuns` scans every `feature/*` branch, as `/pickup` does; the `git` section lists no merge information and says so |
| The current branch has no upstream branch | Private run: the unpushed-commit count is omitted with a note. The shared run does not depend on it: it reads the stored shared ref |
| The default branch has no upstream that counts, at `share` time | `share` stops and asks for `--ref <remote>/<branch>` |
| The stored shared ref no longer exists | The shared refresh stops with a message; nothing is published |
| The Artifact tool is not available (a session with an API key, a gateway token, Bedrock, Google Cloud or Microsoft Foundry; `claude -p`, section 12.1) | The skill says so and offers `local` |
| The stored URL no longer works (the Artifact tool's read of the URL fails) | The skill tries to query the pending proposals of that page. It reports their number, or says that the number is unknown when the query fails too. Then it asks before it creates a new page |
| ArtifactData fails during `sync` | Stop before any file is written |
| A proposal gets `invalid`, `file-missing`, `wrong-branch`, `held-run`, `none` or `several` | Reported with its reason; the proposal stays `pending` |
| The `--data-dir` argument is empty or still holds the literal `${CLAUDE_PLUGIN_DATA}` | `refresh`, `sync` and `share` stop and say so; nothing falls back to a folder inside the repository. `local` still works: it needs no state folder |
| The system prompt names no session scratchpad folder | `refresh`, `share` and `sync` stop and say so, and offer `local` written to a folder the user names; a folder inside the repository is refused |
| No `config.json` in the state folder | Section 6 "No state yet": the skill says so and asks before it creates pages |
| The page's audience (read before the first republish) differs from the audience of the files | The skill stops and publishes nothing (section 6 "Audience guard") |
| A `files` publish is refused for a path the session has not read or listed | The skill lists the page's files once and publishes again; a second refusal stops the refresh and is reported |
| An ArtifactData write fails on `if_version` | That proposal is not applied in this sync, is reported, and stays as the page left it (section 8 steps 4 and 6) |

## 11. Testing and rollout

A new fast suite, `tests/dashboard/run-tests.sh`, that loads
`tests/lib/undefined-command-guard.sh` like every suite:

- **Git run module** — the existing suite `tests/pickup/run-tests.sh`
  passes unchanged after the move to `git-runs.js`; `scanRuns` with
  `refs: 'upstream'` reads an unpushed heading from neither the log nor
  the date.
- **Work-log rule parity** — the check command and the listing command are
  copied out of `skills/worklog/SKILL.md` (as `tests/worklog` does) and run
  on the same fixtures as the extractor's Node rules; the results must be
  equal.
- **Extractor** — fixture repositories built by the suite:
  - a `feature/<slug>` branch, not checked out and not merged, whose log
    ends with `## STOPPED` (in `unfinishedRuns` as stopped);
  - the same run with its branch checked out (still in `unfinishedRuns`);
  - the same log merged into the default branch (in `runHistory` only);
  - a log with a `_Completed — ` line (not in `unfinishedRuns`); a branch
    with two logs (ambiguous);
  - an active, a closed, a malformed and a symbolic-link work log, and one
    with an invalid file name;
  - a work-log `## Open items` table and a `## Parts` row with a wrong
    number of cells (raw);
  - a session log with a list `Open:`, a one-line `Open:`, a continuation
    line, a `[resolved` item, two entries with the same heading, and a
    `[superseded` entry;
  - missing sources, a detached `HEAD`, no default branch, no upstream, a
    repository with no commit (exit code 2);
  - files with a byte order mark and carriage returns.
  The tests check the JSON output.
- **Change summary** — `render --diff` against a previous JSON: added and
  removed ids per section, a changed section status, and "first refresh".
- **Privacy** — every private fixture file contains a marker string, and
  so do the **names** of an untracked topic folder and an untracked
  work-log file. Tests on the shared page files: (1) no marker appears;
  (2) a tracked file with an uncommitted marker line does not show it;
  (3) a staged but never committed file with a marker does not appear;
  (4) a committed but unpushed marker line in a tracked file does not
  appear; (5) a marker in an unpushed `## STOPPED` heading of a run branch
  that has an upstream does not appear; (6) a commit subject with a marker
  on a branch that was never pushed does not appear; (7) a branch whose
  upstream is a local branch holding a marker commit, in a repository with
  no remote, gives no marker; (8) a local branch with a marker in its name
  that tracks `origin/main` does not appear; (9) `render --verify` refuses
  private files for the shared audience; (10) a section note of the shared
  run holds no path. These are the most important tests of the feature.
- **Markup in data** — a commit subject, a branch name and a session-log
  line holding `</script><img src=x onerror=…>`: the `local` file's inline
  block stays one block, and the template test finds no element created
  from the text.
- **Sync script** — every verdict (`unique`, `already-applied`, `none`,
  `several`, `invalid` for each validation rule, `file-missing`,
  `wrong-branch`, `held-run`); a repeated `Open:` line in one entry
  (resolved by the occurrence); two entries with the same heading (resolved
  by the ordinal); a proposal on entry 2 of three equal headings, after
  entry 1 was marked `[superseded by …]` (writes entry 2, never entry 3);
  apply twice on two different dates (second run gives `already-applied`
  and writes nothing); a `createdAt` whose local date differs from its UTC
  date; status and note on the same row in one proposal; a status equal to
  the current one (Since unchanged); a padded table row; a file changed
  after the refresh; a file with carriage returns and a byte order mark
  (both kept); `held-run` with a tracked and an untracked `session-log.md`,
  and with a stopped run on the current branch; a Note containing
  `item #` (warning); records split into batches of 50; an `if_version`
  conflict at step 4 (no write); two proposals on two equal lines of one
  entry, applied in both orders (both lines resolved, never one line
  twice); a sync stopped after step 4 (the next sync completes it); a
  stopped run on another branch (`held-run`); a symbolic-link target
  (`invalid`); a no-op proposal (`invalid`); a status change away from
  `done` with a filled Commit cell (`invalid`); a status change on a
  blocked part (warning); a file changed between the read and the rename
  (check redone).
- **Skill text** — wording tests as in the other suites, a
  `hooks/skill-rules.json` entry, and one skill-triggering case.
- **Manual acceptance** — one real `refresh`, one edit on the page and one
  `sync` on this repository, recorded in the release entry. The plan's first
  task checks whether `claude -p` has the Artifact tool (section 13 item 8);
  if it does, this step becomes a behavioral test.

Rollout: a new skill; the `skill-rules.json` entry; a release entry in
`RELEASE-NOTES.md` with the three-line summary; a `docs/guide/` section; the
new suite added to the test list in `CLAUDE.md`. Nothing to migrate.

## 12. Prior art and alternatives

Research ran with N=7 researchers on 2026-09-29. The merged report is
`.superpowers/research/dashboard-platform-research-report.md` (transient,
not committed); the cache entries are committed in `docs/research/`
(commit `f3dce66`).

### 12.1 Platform facts and their sources

| Fact | Source |
|---|---|
| Publishing needs a session logged in to a claude.ai account; not with an API key, a gateway token, Bedrock, Google Cloud Agent Platform or Microsoft Foundry | `docs/research/service-claude_ai-artifact-snapshot.md`, quoting https://code.claude.com/docs/en/artifacts |
| The Artifact tool is not available in `claude -p` sessions | the official `project-artifact` skill text (`~/.claude/plugins/marketplaces/claude-plugins-official/plugins/project-artifact/skills/project-artifact/SKILL.md`: "the Artifact tool is not available in non-interactive (`claude -p`) sessions"); not tested here — section 13 item 8 |
| On Pro and Max plans, a public link is the only way to share | `docs/research/service-claude_ai-artifact-snapshot.md` |
| Viewers of a public link cannot comment | `docs/research/service-claude_ai-artifact-snapshot.md` ("If you share an artifact publicly, viewers can't comment on it") |
| A new session must be given a page's URL, or it creates a new page | `docs/research/service-claude_ai-artifact-snapshot.md` |
| A publish to a page that the conversation has not read or published is refused; a read returns the page's HTML | the Artifact tool description delivered to this session |
| `files` sources must be under the working directory or the session scratchpad folder | the Artifact tool description (`files` field) |
| A `files` publish may replace only paths that the session read by path, saw in a file listing, or published itself | the Artifact tool description (`overwrite_unread` field) |
| Claude must read the complete file of every file it publishes and did not write | the Artifact tool description ("Files you did not write") |
| The first publish of a page passes an `icon`; `artifact-capabilities` must be loaded before `capabilities` is passed; a republish omits both | the Artifact tool description |
| `CLAUDE_PLUGIN_DATA` is not in the environment of Bash tool commands; `${CLAUDE_PLUGIN_DATA}` is substituted in plugin skill text; the folder survives plugin updates | https://code.claude.com/docs/en/plugins-reference ("Environment variables") and https://code.claude.com/docs/en/skills ("Available string substitutions"), as cited by two reviewers; the first point observed in this session (`echo "${CLAUDE_PLUGIN_DATA-unset}"` printed `unset`) |
| ArtifactData `query` with `out_dir` writes one file per document; `batch` takes at most 50 writes; writes accept `if_version` | the ArtifactData tool schema, as read by a reviewer in this session |
| Leaving out the `contract` field keeps the page's runtime contract version | the Artifact tool description delivered to this session |
| A page is at most 16 MiB | `docs/research/service-claude_ai-artifact-snapshot.md` |
| A page's `fetch` reaches its own origin | `docs/research/service-claude_ai-artifact-snapshot.md`; that a supporting file published through `files` can be fetched is section 13 item 6 |
| The `db` capability exists and changes often (contract 0.2.49 on 2026-09-15; 0.2.66 on 2026-09-29 per the installed `artifact-capabilities` skill, not verified); open defect anthropics/claude-code#94426 | `docs/research/service-claude_ai-artifact-db.md` |
| A viewer's own `data/users/<id>/` part of `db` is private even from the owner | the installed `artifact-capabilities` skill (runtime contract 0.2.66), as summarized in this session; **unverified** — section 13 item 3 |
| The user makes a page public from its Share control; a public link shows the latest republish; the public link can be turned off there; a republish after sharing asks for permission | **unverified**; the last point is stated in `docs/research/service-claude_ai-artifact-snapshot.md` ("republishes run without asking, except ... after the page is shared") — section 13 item 7 |

### 12.2 Findings that changed the design

- The publishing restrictions → the `local` command.
- A public link is the only way to share on Pro and Max → the shared page
  is opt-in with a warning, and holds pushed content only.
- A new session must be given a page's URL → the state folder stores the
  URLs.
- The `db` capability changes often and has the reload defect #94426 →
  status data is not stored in `db`; `db` holds only proposals written by
  the page itself (approach C).
- The official plugin `project-artifact` (Anthropic, Apache 2.0, not
  installed here; files read at
  `~/.claude/plugins/marketplaces/claude-plugins-official/plugins/project-artifact/`:
  `SKILL.md`, `swe.md`, `template.html`, `README.md`) builds a tabbed
  project-status page. The model builds it from instructions each time
  (no script); it reads GitHub pull requests and not Markdown logs; it
  declares no runtime capability; its text says "This skill reads and
  publishes; it does not edit PRs, trackers, or post anywhere"; it has no
  way to plug in new data sources. → we build our own and borrow three
  patterns: the URL stored outside the repository, fixed tab ids, and a
  reply that lists only the changes. (Its fourth pattern, a JSON block
  inside the page, is used only by the `local` file: a published page keeps
  its data in a separate file, section 4.)
- The "staged intents" pattern of `claude-orchestrator`
  (github.com/phahadek/claude-orchestrator): a change is stored as a
  proposal and a person approves it before it takes effect. → the
  proposals of section 7.

### 12.3 Alternatives rejected

- **A. `db` for everything** (page code fixed, status data pushed as `db`
  rows): the status display would depend on the reload defect #94426 and on
  the fastest-changing capability.
- **B. HTML snapshot with a "copy changes" button**: no capability at all,
  but edits are lost when the page is reloaded before they are copied, and
  every edit needs two manual steps.
- **A local HTML file as the main page**: browsers block a `file://` page
  from reading nearby files, `localStorage` on `file://` is undefined
  behavior, and colleagues cannot open it. Kept only as the read-only
  `local` fallback.
- **GitHub Pages**: a site is public unless the organization has GitHub
  Enterprise Cloud, even for a private repository, and a page has no way to
  send edits back.

### 12.4 Contradictions left open by the research

1. Plans that include artifact storage (Free plan or not): no effect; the
   user is on Pro or Max.
2. `localStorage` on `file://` (error or undefined): no effect; the `local`
   file does not use browser storage.
3. Reading an owned artifact back into a later session (documented, but
   issue #87673 reports a failure through WebFetch): this design reads
   proposals through ArtifactData and pages through the Artifact tool,
   never through WebFetch. Checked in section 13 items 4 and 6.
4. and 5. Whether `db` exists and is documented: it exists; this session has
   the ArtifactData tool, and the Claude Code changelog records `db` fixes.
6. Two products called "artifact" (claude.ai chat artifacts and Claude Code
   artifacts): this design uses only Claude Code artifacts.

## 13. Checks owed before the plan is written

These are facts the design depends on that nobody has verified yet. The
plan's first task verifies each one; a failed check returns the design to
the user.

1. The text `${CLAUDE_PLUGIN_DATA}` is substituted in the plugin skill
   text both for the installed plugin and with `--plugin-dir`.
2. `db` access rules can restrict writes to the owner. If they can, the
   private page adds such a rule as a second guard next to
   `user.isOwner()`.
3. The exact `db` path of the shared level where the page writes
   `proposals`, and that a viewer's `data/users/<id>/` part is not readable
   by the owner through ArtifactData.
4. The ArtifactData tool can query the `proposals` collection of the
   owner's own page from a later session, with a filter on `state`.
5. `user.isOwner()` exists under this name in runtime contract 0.2.66.
6. A page can `fetch` a supporting file published with it through the
   Artifact tool's `files` field from the scratchpad folder; an Artifact
   tool read of the page returns `index.html` without that file's content;
   a `list` with `scope: "files"` is enough to replace the data file in a
   new session.
7. On a Pro or Max plan: a public link shows the latest republish; the
   Share control can turn the public link off; whether a republish of a
   shared page asks for permission each time.
8. Whether a `claude -p` session has the Artifact tool.
9. The per-document files written by ArtifactData `query` with `out_dir`
   carry each document's version. **The measurement contradicted this
   check:** a saved file holds the document body only, and the version of
   each document is only in the tool's result text. The skill therefore
   writes a versions file from the result lines, and every
   `dashboard-sync.js` mode takes `--versions <file>` (section 8 step 1;
   ruling 6 in `plans/dashboard-open-decisions.md`; item 9 of
   `implementation/platform-checks.md`).
10. The `_Completed — ` line and the `## STOPPED` heading are the markers
   that the 13 existing orchestration logs use for a finished and a stopped
   run. The extractor fixtures copy real headings.
11. The size of `dashboard-data.json` for this repository, to confirm that
    reading it once per publish is small.
12. The page's `db` writes can be conditional on the version the page read.
    If they cannot, the page re-reads the document just before each write,
    and the design states the remaining window as a known limit. **The
    measurement found no such condition:** `set(data)` and `update(data)`
    take no version option, a page `DocumentSnapshot` carries no version,
    and the platform has no create-if-absent write. The page therefore
    uses the re-read (section 7, "One document per item"; item 12 of
    `implementation/platform-checks.md`).
