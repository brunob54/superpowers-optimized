---
name: researching-prior-art
description: >
  Grounds one technology decision in verified external evidence before
  design approaches are compared. Dispatches a controller subagent that
  runs N read-only researcher subagents in parallel (candidate source
  reading, version verification anchored to this repository's manifest,
  registry existence and health, prior art) and merges their file-based
  reports into one evidence report. Invoked by brainstorming at its
  research gate with the decision, candidate list, N, topic slug, and
  project directory; or directly via /researching-prior-art. Triggers
  on: "research prior art", "prior-art research", "research the
  candidates", "verify the library", "research this dependency".
---

# Researching Prior Art

Gather verified external evidence for one technology decision, in
parallel, without touching the working tree outside `docs/research/` and
`.superpowers/research/`. Evidence only — this skill never chooses an
approach.

**When invoked by brainstorming, never ask the user anything** — all
user interaction already happened at brainstorming's research gate. The
one exception: invoked directly by the user without an explicit N,
present the gate message below yourself to obtain N (the user is the
invoker; no gate has happened yet). Never pick N silently.

On every invocation path — whether the gate message below is shown or
not — a non-zero N ends, on success, with findings cached under
`docs/research/` and committed to the currently checked-out branch in
this repository, unless HEAD is detached, in which case the commit is
skipped and the cache stays uncommitted on disk (step 6 item 5, sub-step
5e). State this to the invoker before that commit can run.

On that direct path, present this gate message verbatim — the same
block brainstorming presents, copied character-exactly (`<candidates>`,
`<S>`, and `<branch>` filled in — the backticks around them are
placeholder markup, dropped with the angle brackets when the values
are filled; the bracketed sentence appears only when the choice is
difficult to reverse):

> Research gate: this decision triggers prior-art research.
> Candidates: `<candidates>`.
> [This choice is difficult to reverse — consider a higher N.]
> How many research subagents should I dispatch? Suggested N=`<S>`
> (number of candidates + 3, at most 10). Reply with a number, or 0 to
> skip — a skip is recorded in the spec.
> On a non-zero reply, findings are cached under `docs/research/` and committed to this repository, on the branch checked out right now (`<branch>`).

A direct invocation usually has no spec. On a 0 reply, state the skip
in the conversation and stop; record it in a spec's "Prior art and
alternatives" section only when a spec exists. `<branch>` = the name
of the branch checked out at the moment the gate fires, resolved like
this: first run `git rev-parse --git-dir` at the repo root. A
non-zero exit means this is not a git repository — fill `<branch>`
with the text `not a git repository — the cache will not be
committed` and stop there; do not run `git symbolic-ref -q HEAD` in
that case, its exit status does not distinguish a non-git project
from a detached HEAD. When `git rev-parse --git-dir` succeeds, next
run `git symbolic-ref --short -q HEAD`. A non-zero exit here means
HEAD is detached — fill `<branch>` with the text
`detached HEAD — the cache will not be committed`. A zero exit means
HEAD is attached to a branch, and the command's output is the branch
name: `<branch>` = that output. This works on a branch with no
commits yet (a repository right after `git init`). Never use
`git rev-parse --abbrev-ref HEAD` for this: on a detached HEAD it
prints the literal string `HEAD`, and on a branch with no commits it
fails and still prints `HEAD`, so in both cases its output looks
like a branch name and is not one. A negative or
non-numeric reply → ask once more; a second unusable reply → treat it
as a skip, exactly as a `0` reply: state the skip and stop, and never
fall back to the suggested `<S>`. A non-zero N dispatches researchers
and ends with a commit to the user's checked-out branch, and a user
who twice answered something other than a number has not agreed to
either. This is the same rule brainstorming applies at its gate.

## Inputs (from the invoker)

- **Decision**: one sentence, with the candidate technologies named.
- **Candidates**: registry or ecosystem plus exact canonical name, per
  candidate.
- **N**: how many researcher subagents to dispatch. Valid N is 0-10; a
  larger value is clamped to 10. When brainstorming invokes this
  skill, N=0 never reaches it — brainstorming records the skip. On a
  direct invocation, a 0 reply is handled here (see the gate message
  above): state the skip and stop.
- **Topic slug**: kebab-case, no date (example: `http-retry-library`).
  **Validation:** the slug must match `^[a-z0-9]+(-[a-z0-9]+)*$`. A slug
  that does not match is rejected: ask the invoker for a corrected
  slug. Never use the slug in any path or delete command before it
  matches — it is interpolated into every written path and into the
  step-2 delete command, so an unvalidated slug containing `/` or `..`
  could write or delete outside `.superpowers/research/`.
- **Project directory** (optional): absolute path of the project the
  invoker's own context inspection used. Consulted only by the
  Non-git fallback below, to resolve `[REPO_ROOT]` when the project is
  not a git repository; when the invoker omits it, that fallback falls
  through to the session's current project directory instead (see
  Root anchoring below) — a different root than the invoker may have
  intended.

**Root anchoring:** everything this skill does — the git snapshot,
`.superpowers/research/`, `docs/research/` — is rooted at the top level
of the repository under research: resolve it once at invocation start
(`git rev-parse --show-toplevel`, from the repo path the invoker named
or the current repo) and use absolute paths from there, never the
session's incidental working directory. **Non-git fallback:** when
`git rev-parse --show-toplevel` fails because the project is not a
git repository, `[REPO_ROOT]` is the project directory the invoker
named, resolved to an absolute path. If the invoker named no project
directory, `[REPO_ROOT]` falls back to the session's current project
directory — never a silent guess: state in the conversation which
root was used. If that is also unavailable, the skill stops and says
so rather than guessing at a root. On this path, step 1's snapshot and step 6 item 4's comparison
against it both skip (there is no `git status --porcelain` to run), so
nothing detects a write outside `[REPO_ROOT]/.superpowers/research/clones/`
and `[REPO_ROOT]/docs/research/*.md`. State this to the invoker: on a
non-git project, the read-only boundary for the researchers and the
controller is instruction-only and unverified for this run.

## Trigger predicate (fired by the invoker's gate, restated here)

> This decision would add or change an entry in a dependency manifest (for
> example package.json, pyproject.toml, go.mod, Cargo.toml), or it depends
> on version-sensitive external API behavior, or it selects an external
> hosted service, platform, or base image that the system will depend on.

"Version-sensitive external API behavior" means behavior that has
changed, or is documented as changing, across the external API's
released versions — deprecations, breaking changes, or version-gated
features. The third branch covers decisions that change no manifest (a
hosted service, a CDN script tag, a Docker base image).

## Degradation ladder (detect the rung before anything else)

1. **Claude Code** — the only supported platform with nested dispatch
   (the same requirement orchestrating-development states): the full
   flow below.
2. **Agent tool present on another platform**, or the controller
   returns reporting it could not dispatch subagents: dispatch the N
   researchers directly from `research-prompt.md`; reports still go to
   files; apply the controller contract in `controller-prompt.md`
   yourself (budgets, discard rules, spot-fetch verification, merge
   rules, cache writes, re-verifier dispatch for cache hits).
   Procedure step 6 below still applies on this rung: run its checks
   after you write the merged report yourself.
3. **No Agent tool** (Codex, Cursor, OpenCode): skip. State in the
   conversation and in the spec which evidence is missing and that
   technology claims are provisional.

Researcher agent type: `Explore` where available; otherwise
`general-purpose` with the read-only instruction.

## Procedure

### 1. Snapshot the working tree

Run `git status --porcelain` at the repo root and keep the output. Not
a git repository → skip the check and state the skip in the
conversation.

### 2. Prepare the transient directory

Create `.superpowers/research/` at the repo root if missing, and write
a `.gitignore` containing exactly `*` inside it (the multi-code-review
pattern — nothing else ignores `.superpowers/`). Researchers may clone
candidate repositories under `.superpowers/research/clones/`.

Confirm the topic slug matches the validation rule under "Inputs"
above before this delete runs. Delete the invocation's own files by
matching a directory listing of `.superpowers/research/` against an
anchored pattern built from the exact slug — never by a bare prefix
glob (a bare prefix such as `.superpowers/research/<slug>-*` also
matches a different, longer slug that happens to start with this one,
for example slug `http` matching files that belong to slug
`http-retry`), and never by a fixed numeric range: a previous run's
re-verifier and follow-up reports are indexed by cache-hit position,
not by N, and cache-hit position is not bounded by the N≤10 cap — with
12 cached candidates a previous run can leave `<slug>-rv11-report.md`
and beyond, which a fixed 1-through-10 range would miss and leave on
disk to be read as this run's evidence. List the directory and delete
every entry whose name matches, for this exact slug:
- `^<slug>-research-report\.md$` (the merged report, per the Files
  table below)
- `^<slug>-r[0-9]+-report\.md$` (the per-researcher reports)
- `^<slug>-rv[0-9]+-report\.md$` (the re-verifier reports)
- `^<slug>-f[0-9]+-report\.md$` (the follow-up researcher reports)

Each pattern anchors the literal slug immediately against its own
separator and suffix, so it never matches a longer slug's files: slug
`http` cannot match `http-retry-r1-report.md`, because after the
literal `http-r` the pattern requires a digit, not `etry-...`. This is
a previous run's merged report and per-researcher, re-verifier, and
follow-up reports for this same topic slug, deleted before the
controller is dispatched, so the current run cannot inherit stale
files left by an earlier failed or partial run — including one left by
a run with more than 10 cache hits. Keep the delete confined to
`.superpowers/research/`.

### 3. Cache check (`docs/research/<candidate-slug>.md`)

**Slug rule:** prefix the registry or ecosystem in kebab-case, then the
candidate name: lowercase; drop `@`; replace `.` with `_`; replace `/`,
spaces, and every other non-alphanumeric character other than `.` with
`-`; collapse repeated `-`. Giving `.` its own replacement (`_`, not
`-`) keeps the `.` and `-` variants of a name distinct: npm
`lodash.merge` → `npm-lodash_merge` never collides with npm
`lodash-merge` → `npm-lodash-merge`.
Examples: npm `lodash.merge` → `npm-lodash_merge`; `@tanstack/react-query`
on npm → `npm-tanstack-react-query`; the Stripe service →
`service-stripe`. The rule is not fully injective: `_` and `-` in a
name both map to `-` (npm `ansi_up` and `ansi-up` share one slug), and
lowercasing merges case variants. The header's canonical-name field
catches such a collision at read time — a slug match with a different
canonical name is not a hit — and at write time the rule is: when two
candidates of one invocation map to the same slug, cache only the
first, never overwrite it with the second, and report the collision
to the invoker.

**Validation:** after applying the slug rule above, each resulting
candidate slug must match `^[a-z0-9]+([_-][a-z0-9]+)*$` — wider than
the topic slug's charset rule (see Inputs above), because the
candidate slug rule uses `_` as a distinct separator — before it is
used in any path or command. A slug that does not match: re-apply the
slug rule; if the result still does not match, stop using that
candidate slug in any path, `git add`, or `git commit` command, and
report the candidate as unable to be cached.

**Header line** (first body line of a cache entry):
`_Researched: YYYY-MM-DD | registry: <registry> | canonical name: <exact name> | versions inspected: <list> | verified: YYYY-MM-DD_`
The `verified:` field is absent until the entry's first confirmed
re-verification; from then on it holds the date of the most recent
confirmed re-verification. `versions inspected:` holds the literal
`n/a` when the candidate has no versioned artifact (a hosted service,
a platform); the re-verifier then checks existence and canonical name
only, and the version-mismatch rule does not apply to that entry. A
base image is versioned: its anchor is the tag the repository's
Dockerfile pins (the Dockerfile is its manifest). `Researched:` always holds the date the
entry's findings were actually gathered — health, vulnerability, and
maintenance evidence included — and a re-verification never touches
it, because a re-verification does not re-gather that evidence (see
"Re-verifier outcomes" below).
The `verified:` field is informational only — a record for human
readers of when the entry was last re-verified. No rule in this skill
reads it: the Fresh/Stale freshness test below reads `Researched:`
only.

**Hit rule:** a cache file counts as a hit ONLY when its registry and
exact canonical name match the candidate — a slug match alone is not a
hit. A future-dated `Researched:` header is invalid: treat it as no
cache hit at all — the candidate keeps its full assignment (angles
1+5) and N is not reduced for it.

- **Fresh** (`Researched:` date younger than 90 days): remove the candidate's
  per-candidate assignment (angles 1+5) and reduce N by exactly 1 —
  but every cache hit, fresh included, still gets a Haiku-class
  re-verifier (existence and the pinned or floor anchor version — not
  the newest upstream release, which is context only), because the
  header is self-reported and a committed cache file can be planted or
  edited.
  Fresh-hit findings may be used provisionally while re-verification
  runs.
- **Stale** (`Researched:` date 90 days or older): same reduction, but the entry's
  findings are used only after its re-verifier confirms.
- Post-cache N is floored at 1, unconditionally — never reduced to 0,
  whether or not any candidate remains un-researched. Report the
  reduction to the invoker.
- Re-verifiers are always dispatched in addition to the (reduced) N
  and sit outside the merge/split algorithm — the researcher total may
  exceed N by the number of cache hits plus any invalidated entries;
  the controller notes this in the merged report.
- All candidates cached and fresh → the controller is STILL dispatched
  as usual, with the reduced assignment set (the re-verifiers plus the
  angle-4 researcher — prior art is decision-scoped, not
  candidate-scoped, and can never be satisfied from per-candidate
  cache files). The controller performs all its normal duties and
  writes the merged report from the cache entries and those results
  ("Sources fetched: cache + re-verification" noted). The merged
  report is always controller-written, so the file-existence check in
  step 6 holds on this path too.

Re-verifier outcomes (mismatch → invalidate and re-research; confirmed
→ keep the reduction and set the `verified:` date — `Researched:`
stays untouched) are handled by the
controller; see `controller-prompt.md`.

### 4. Resolve assignments (deterministic)

The angle catalog:

1. **Candidate implementation** (per candidate): read the candidate's
   source and test files; APIs, patterns, edge cases, boundaries, with
   citations.
2. **Version and documentation verification**: anchored to THIS
   repository's manifest/lockfile versions, not the latest release.
3. **Health, risk, and existence**: registry existence (similar-name
   confusion check), then OpenSSF criteria — maintenance activity,
   known vulnerabilities, license, security posture. (OpenSSF is the
   Open Source Security Foundation; its criteria are a standard
   checklist for project health.)
4. **Prior art and community experience**: existing solutions NOT
   among the candidates; issue trackers, migration reports,
   postmortems.
5. **Local fit**: candidate versus this repository's declared runtime
   and framework versions, license compatibility, platform
   constraints.

With C candidates remaining after cache reduction, the **ordered
assignment list** is:

1. …C: one per candidate — candidate implementation plus local fit
   (angles 1+5 merged);
2. C+1: version and documentation verification (all non-cached
   candidates);
3. C+2: health, risk, and existence (all non-cached candidates);
4. C+3: prior art and community experience.

This makes the suggested N = C+3 exact. Cached candidates are excluded
from the shared assignments (C+1, C+2); those two drop out entirely
when no non-cached candidate remains. The prior-art assignment never
drops — it is decision-scoped.

**Merging (N below the list length):** fold from the bottom of the
list upward — first C+3 into C+2, then C+2 into C+1; if the count
still exceeds N, distribute ALL remaining assignments (the folded
shared assignment included) round-robin across exactly N researchers.
This terminates for every N ≥ 1; N=1 gives a single researcher
covering the whole list.

**Splitting (N above the list length):** in order — local fit (angle
5) out of each candidate assignment, then angle 3 into registry
existence vs OpenSSF health, then angle 4 into prior-art sweep vs
community experience. If N exceeds the maximum split count for this C,
dispatch the maximum and report the difference — never invent
assignments to fill N.

### 5. Fill and dispatch the controller

Fill `./controller-prompt.md` (this skill's directory):

- `[REPO_ROOT]` — the Root-anchoring result
  (`git rev-parse --show-toplevel`, absolute); it anchors every
  controller and researcher write,
- `[DECISION]`, `[CANDIDATES]` (registry + canonical name each),
- `[ASSIGNMENTS]` — the resolved ordered list from step 4,
- `[CACHE_STATE]` — per candidate: none / fresh / stale, with entry
  paths,
- `[REPORT_DIR]` = `<repo-root>/.superpowers/research`, where
  `<repo-root>` is the Root-anchoring result
  (`git rev-parse --show-toplevel`); pass the resolved absolute path,
  never the relative form,
- `[MERGED_REPORT_FILE]` =
  `<repo-root>/.superpowers/research/<slug>-research-report.md`
  (resolved absolute path, same rule),
- `[RESEARCHER_MODELS]` — the tier mapping per assignment,
- `[RESEARCH_PROMPT_PATH]` — absolute path of `./research-prompt.md`;
  its own placeholders (`[REPO_ROOT]`, `[DECISION]`, `[ASSIGNMENT]`,
  `[REPORT_FILE]`, `[MODEL]`, `[ASSIGNMENT_NAME]`, `[CANDIDATE_SLUG]`)
  are filled by the controller once per assignment, not here,
- `[SLUG]` — the topic slug.

Dispatch ONE controller subagent, agent type `general-purpose`. On
rung 1, never dispatch researchers from the main session.

### 6. After the research completes (rung 1: the controller returned; rung 2: you wrote the merged report)

**Items 1, 4 and 6 always run, whatever the controller's outcome** —
including a controller that died, timed out, or could not dispatch. A
failed controller is the case where stray writes are most likely, so
the working-tree comparison in item 4 matters most there. Items 2, 3
and 5 are conditional; each states its own condition.

1. Remove `<repo-root>/.superpowers/research/clones/` if it exists —
   researchers clone candidate repositories there, and clones must not
   linger in the working tree. Run this first, at the anchored
   repository root, not at the session's working directory.
2. If the controller returned a summary reporting that it could not
   dispatch subagents, drop to degradation rung 2 now: dispatch the N
   researchers yourself from `research-prompt.md`, apply the
   controller contract from `controller-prompt.md` yourself, and write
   the merged report. Remove `<repo-root>/.superpowers/research/clones/`
   again, at the anchored repository root, after your own researchers
   return. Then continue with the remaining items of this step. Only
   when this fallback also produces no merged report does the next
   item apply.
3. Verify `[MERGED_REPORT_FILE]` exists. Missing → report research as
   failed to the invoker: evidence gap, claims stay provisional. Never
   block the session. Item 5a covers any cache entry the controller
   wrote before the failure.
4. Compare `git status --porcelain` with the step-1 snapshot. Changes
   under `docs/research/` and `.superpowers/research/` are expected.
   Any other new path, or a newly-modified previously-clean path, is
   unexpected: report the diff to the invoker (brainstorming presents
   it and asks the user whether to continue — concurrent tooling such
   as format-on-save can legitimately dirty the tree mid-research).
   Item 5a covers what happens to the cache entries in that case.
   Do not halt unconditionally. Honest coverage statement: this
   comparison detects new paths and newly-modified previously-clean
   paths only — it cannot see writes to files that were already dirty
   or untracked at snapshot time, and it cannot see writes to any
   git-ignored path at all (`git status --porcelain` never reports
   them). `.superpowers/research/` is always self-ignored, by its own
   `.gitignore` containing `*`. The rest of `.superpowers/` —
   including `.superpowers/sdd/`, which holds orchestration
   control-flow files — is ignored only after the
   orchestrating-development skill's Phase 0 has added
   `.superpowers/` to `.git/info/exclude`. In a plain brainstorming
   session, that Phase 0 has not run, so such a write DOES appear in
   `git status --porcelain`. Report any `.superpowers/` entry OUTSIDE
   `.superpowers/research/` that appears in the status output to the
   invoker, the same as any other unexpected path.

   Accepted residual risk: this expected-change filter treats any
   change under `docs/research/` as expected, not only changes to the
   candidate slugs of this invocation. A prompt-injected controller
   could therefore overwrite an unrelated cache entry without the
   comparison flagging it. Accepted: the candidate slug is
   charset-validated before any path use, writes outside
   `docs/research/` and `.superpowers/research/` are still flagged,
   and the affected files are cache entries that this skill commits
   automatically once the comparison in this item finds no unexpected
   changes — no user review step stands between the write and the
   commit.
5. Commit this invocation's cache entries, and nothing else. Work
   through the sub-steps in order.

   - 5a. **When to skip.** Skip the rest of item 5 in two cases: item 3
     reported research as failed, or item 4 found unexpected changes.
     In both cases the cache entries stay uncommitted. Tell the invoker
     they must be committed or removed before
     orchestrating-development's clean-tree check will pass. This is
     the one disclosure sentence items 3 and 4 point at.
   - 5b. **Build the path list deterministically.** It holds exactly
     one path, `docs/research/<candidate-slug>.md`, per candidate slug
     THIS invocation validated in step 3 — the set of candidates named
     by the invoker, not a derivation from `git status` or from
     anything the controller reports. Include a path only when the
     file exists on disk (a candidate the controller could not cache,
     per step 3's Validation rule, contributes no path). This covers
     every shape a path can take: freshly researched, re-verified
     (whether or not its `verified:` date changed), or invalidated and
     re-researched — every one of them is still this invocation's own
     candidate, so its slug is already on the step-3 list. Never build
     this list from `git status --porcelain` output — that listing is
     used only in 5c below, to find paths that are NOT on this list,
     never to build the list itself.
   - 5c. **Entries this invocation did not write stay out of the list.**
     List `git status --porcelain -uall -- docs/research/` at the repo
     root and report every path it shows that is not on the 5b list.
     `-uall` is required: plain `--porcelain` defaults to `-unormal`,
     which collapses a directory holding only untracked files into one
     `?? docs/research/` entry — on the first prior-art run in any
     repository, before this invocation's own files exist on the 5b
     list, that collapsed entry would both false-alarm on every path
     under the directory and hide any foreign untracked file sitting
     inside it. A
     `docs/research/` entry for any other slug — one a compromised
     controller wrote for a candidate outside this invocation — is
     never staged. Report any such entry to the invoker.
   - 5d. **An empty path list ends item 5.** It is a normal outcome,
     not an error: report "nothing to cache" and run neither command.
     Never run `git commit -m "<subject>" --` with no path after the
     separator. That is not a no-op; it commits the whole index, and
     would sweep the user's unrelated staged work into your commit.
   - 5e. **Repository-and-HEAD check, before staging or committing.**
     Run `git rev-parse --git-dir` at the anchored repository root
     first. A non-zero exit means this is not a git repository: skip
     the rest of item 5 (staging and committing) — report "cache
     written, not committed" because the project is not a git
     repository, give the invoker 5a's disclosure sentence, and
     continue. When `git rev-parse --git-dir` succeeds, next run `git
     symbolic-ref -q HEAD`. A non-zero exit here means HEAD is
     detached: `git commit` would still succeed there, but the
     resulting commit is unreachable from any branch and is lost at
     the next checkout, while this skill would otherwise report the
     cache as committed. Skip the rest of item 5 (staging and
     committing) in this case too: report "cache written, not
     committed" because HEAD is detached, give the invoker 5a's
     disclosure sentence, and continue. Neither a non-git project nor
     a detached HEAD ever blocks the session.
   - 5f. **Stage the listed paths:** `git add -- docs/research/<slug-1>.md
     docs/research/<slug-2>.md`. Staging is required because
     `git commit -- <pathspec>` accepts only paths already in the index.
     An untracked first-research cache file would otherwise fail with
     "pathspec ... did not match any file(s) known to git". Check the
     exit status of this `git add`. A non-zero exit (for example the
     user's `.gitignore` ignores `docs/`, so git refuses the path; or
     `.git/index.lock` is held by another program) means nothing was
     staged: do not run 5g — 5g would find an empty stage and wrongly
     report "cache already up to date". Go straight to 5m instead,
     treating the failed `git add` as a commit failure.
   - 5g. **No-change check, before committing.** Run `git diff --cached
     --quiet -- docs/research/<slug-1>.md docs/research/<slug-2>.md`
     (the same paths staged in 5f) at the anchored repository root.
     Exit 0 means every staged file is byte-identical to what the
     branch already has: every candidate was a confirmed fresh cache
     hit and the controller wrote back an unchanged entry, or the "All
     researcher reports discarded" outcome left the pre-existing cache
     files untouched. This is a normal outcome, not an error. Unstage
     the same paths (`git restore --staged -- docs/research/<slug-1>.md
     docs/research/<slug-2>.md`), report "cache already up to date",
     do NOT give the invoker 5a's disclosure sentence — the files are
     already committed and the tree is already clean — and skip the
     rest of item 5. A non-zero exit from this check means at least
     one staged file differs from what the branch already has:
     continue to 5h.
   - 5h. **Probe for a time-bound wrapper.** The commit built in 5i
     should run under a time bound where one is available. Run
     `command -v timeout` (GNU coreutils); if that fails, run
     `command -v gtimeout` (Homebrew coreutils' name for it on macOS,
     which ships neither `timeout` nor `gtimeout` by default — confirm
     neither is on `PATH` before assuming one is).
   - 5i. **Build the commit command.** When 5h found one of the two
     wrappers, prefix the commit with it, 30-second bound:
     `GIT_TERMINAL_PROMPT=0 timeout 30 git commit -m "chore(research):
     prior-art cache for <topic-slug>" --
     docs/research/<slug-1>.md docs/research/<slug-2>.md` (use
     `gtimeout 30` in place of `timeout 30` when that is the one
     found). When 5h found neither, use the same commit without a
     wrapper: `GIT_TERMINAL_PROMPT=0 git commit -m "chore(research):
     prior-art cache for <topic-slug>" --
     docs/research/<slug-1>.md docs/research/<slug-2>.md`.
     `GIT_TERMINAL_PROMPT=0` is unconditional either way. A plain
     local commit asks for no credentials; the variable matters when a
     pre-commit hook contacts a remote (a fetch, a push, an API call
     through git) — it makes such a credential prompt fail instead of
     hanging with no tty to answer it.
   - 5j. **Run the command built in 5i.** Both `git add` and `git
     commit` are path-limited, so neither can sweep unrelated work in:
     `git add` stages only these paths, and the commit takes only
     these paths whatever else the user had staged. Never run `git add
     -A`. Never run a bare `git commit`. Keep the user's configured
     commit signing as-is: never pass `--no-gpg-sign`. Stripping it
     would silently produce an unsigned commit in a repository whose
     `commit.gpgsign=true` requires verified signatures, overriding
     the user's own configuration. A GPG passphrase prompt for a
     protected signing key can still block with no tty to answer it,
     because `GIT_TERMINAL_PROMPT=0` covers only the credential
     prompt, not a signing prompt; when a wrapper is available, the
     outer `timeout 30` (or `gtimeout 30`) bounds that wait so the
     call fails fast (or times out) instead of hanging until the
     tool's own timeout — treat a wrapper-caused exit (124) the same
     as any other non-zero exit from this command. When no wrapper is
     available, such a prompt can hang until the tool's own timeout;
     sub-step 5l's "commit fails" handling still applies once that
     timeout resolves the call one way or the other.
   - 5k. **Where.** Run every command in 5e-5j at the anchored
     repository root, not at the session's working directory.
   - 5l. **What counts as a commit failure.** A `git add` in 5f that
     exited non-zero, a failing pre-commit hook, a signing prompt that a
     `timeout`/`gtimeout` wrapper cut off (when 5h found one and 5i
     used it), or an exit code of 127 from the commit command. Exit
     127 means the shell did not find the wrapper that 5i put in front
     of `git commit`. That is a missing wrapper, not a git failure.
     5h's `command -v` probe exists to prevent it: it can only happen
     when 5h was skipped or its result was ignored. Name the missing
     wrapper as the cause when reporting it.
   - 5m. **What to do on a commit failure.** Unstage the same paths
     staged in 5f (`git restore --staged --
     docs/research/<slug-1>.md docs/research/<slug-2>.md`; this
     returns the index to what it held before 5f, so the user's next
     unrelated commit does not silently pick up these paths), report
     "cache written, not committed", give the invoker 5a's disclosure
     sentence, and continue. A commit failure never blocks the
     session, and the research result stays valid. (A non-git project
     and a detached HEAD are not commit failures: 5e skips the rest of
     item 5 before anything is staged, so on those paths there is
     nothing to unstage.)
6. Report to the invoker: the merged report path, the cache reduction
   (if any), the re-verifier count, the status-comparison result, the
   cache-commit outcome (committed; "cache already up to date"; or
   "cache written, not committed" plus 5a's disclosure sentence), and
   the controller's summary.

## Files

| Artifact | Path | Lifetime |
|---|---|---|
| Researcher report | `.superpowers/research/<slug>-r<K>-report.md` | transient (self-gitignored) |
| Merged report | `.superpowers/research/<slug>-research-report.md` | transient (self-gitignored); survives `/clear` |
| Durable cache | `docs/research/<candidate-slug>.md` | committed by step 6 |
| Spec section | "Prior art and alternatives" in the spec | committed (written by brainstorming) |

## Error handling

| Failure | Behavior |
|---|---|
| Controller subagent dies or times out (the Agent dispatch returns an error, or the platform's own timeout fires — no additional timer) | Still run step 6 items 1, 4 and 6: remove `.superpowers/research/clones/`, compare the working tree against the step-1 snapshot, and report. Item 4 matters most here — a failed controller is the case where stray writes are most likely. Item 5 then skips per 5a. Report the failure; the invoker states the evidence gap and continues with provisional claims (never blocks the session) |
| Merged report file missing after return, and degradation rung 2 (step 6 item 2) was not applicable or also produced no merged report | Research counts as failed: evidence gap, provisional claims; any `docs/research/` entry already written stays uncommitted — tell the invoker it must be committed or removed before orchestrating-development's clean-tree check will pass |
| Cache commit fails (the 5f `git add` exits non-zero, a failing pre-commit hook, a GPG signing prompt that a `timeout`/`gtimeout` wrapper cut off when one was available, or `timeout`/`gtimeout` not being installed), or is skipped by 5e (not a git repository, or HEAD detached) | If 5f staged the paths, unstage them (a 5e skip stages nothing — there is nothing to unstage); report "cache written, not committed"; tell the invoker `docs/research/` entries stay uncommitted and must be committed or removed before orchestrating-development's clean-tree check will pass; research result stays valid; never block the session |
| Post-research status differs from the snapshot outside `docs/research/` and `.superpowers/research/` | Report the diff; the invoker presents it and asks the user whether to continue; on continue, `docs/research/` entries from this run stay uncommitted — tell the invoker they must be committed or removed before orchestrating-development's clean-tree check will pass |
| Project is not a git repository | Cleanliness check skipped; the skip stated in the conversation. `[REPO_ROOT]` falls back to the invoker-named project directory, then to the session's current project directory, stating which was used (see Root anchoring); with neither available, the skill stops and says so |
| All researcher reports discarded | Merged report contains only evidence gaps; surfaced to the user |
| N=0 or platform skip | Brainstorming-invoked: never reaches this skill; brainstorming records the skip in the spec. Direct invocation answered 0: state the skip in the conversation and stop |

## Report Marker

Research reports open with `<!-- research report -->`. The report
verification of `controller-prompt.md` discards a researcher's report
file when that marker is not the file's first line, and records the
discard as an evidence gap. No step of this skill tests the marker in a
subagent's final message; there it only marks the summary as research
output for the invoking skill and the user. Never remove the marker
instruction from `research-prompt.md` or `controller-prompt.md`; without
it, report files are discarded and assignments degrade to evidence gaps.
