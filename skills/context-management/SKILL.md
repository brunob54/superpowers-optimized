---
name: context-management
description: >
  Use in long or noisy sessions to persist durable state across session
  boundaries via state.md. Also generates project-map.md when asked to map
  the project. Triggers on: user explicitly asks to "save state", "compress
  context", "map this project", "generate project map", "create project map",
  "archive the session log", cross-session handoff needed, or repeated failures indicate context is
  getting stale.
---

# Context Management

## Route first — read this before anything else

| User said | Go to |
|---|---|
| "map this project" / "generate project map" / "create project map" / "update project map" | [Project Map](#project-map) section |
| "save state" / "compress context" / session ending with ongoing work | [Procedure](#procedure) section |
| "archive the session log" | [session-log.md Format and Maintenance](#session-logmd-format-and-maintenance) section |
| Starting a task on a project with existing history | Grep `session-log.md` first, then proceed |

Do not default to `state.md` for a map request. Do not default to `project-map.md` for a save-state request.

---

## Purpose

Claude Code automatically compresses context within a session. This skill has two complementary responsibilities:

1. **Cross-session persistence** — `state.md` preserves decisions and progress for the *current task* when a session ends mid-work.
2. **Accumulated project memory** — `session-log.md` builds a searchable history of decisions, rejected approaches, and hard-won facts across sessions. Written manually via this skill — only when there is something worth preserving.

## When to Use

- User explicitly asks to save state or compress context
- Work will continue in a new session and progress must be preserved
- Complex multi-step task has significant accumulated decisions/evidence
- Starting a new task on a project with existing history — grep the log first
- Repeated failures suggest the session has accumulated stale/conflicting context

## Procedure

### At the start of any non-trivial task

Before diving in, grep `session-log.md` for history relevant to the current task.

**Step 1 — Extract keywords.** Take the 2-3 most distinctive nouns from the task description. Avoid generic words ("fix", "update", "file") — use domain nouns ("hook", "auth", "deploy", "staleness").

**Step 2 — Grep each keyword individually first:**
```bash
grep -i "<keyword1>" session-log.md | tail -20
grep -i "<keyword2>" session-log.md | tail -20
```
Check the hit count before reading results. This tells you whether to narrow or widen before committing to any output.

**Step 3 — Adjust based on hit count:**
- **0 hits on all keywords** → when `session-log-archive.md` exists, run the same `grep` commands on it. With 0 hits there too, fall back to `project-map.md` Critical Constraints. Relevant history may have been promoted there instead of staying in the log. If still nothing, proceed without history.
- **1–10 hits** → read them. Surface past decisions, rejected approaches, and constraints.
- **>10 hits on one keyword** → narrow with a second term: `grep -i "<kw1>" session-log.md | grep -i "<kw2>" | tail -20`

**Step 4 — Surface what matters.** If relevant entries are found, state them explicitly before proceeding: what was decided, what was rejected, what constraints apply. Don't silently absorb them — make them visible so the user can confirm or override.

### When saving state (explicit invocation)

1. Extract durable artifacts only:
   - Approved design decisions
   - Active plan tasks and their status
   - Verified facts/evidence
   - Open questions/risks

   **state.md vs plan.md:**
   - `plan.md` (or `docs/superpowers-orchestrator/*/plans/*.md`): the authoritative task list with checkboxes. Owned by `executing-plans`. Updated as tasks complete.
   - `state.md`: a session-boundary snapshot of *where you are* in the plan — current task, blockers, what's verified. It references the plan but does not duplicate the task list.
   
   If a plan exists, state.md should say "Executing plan at docs/superpowers-orchestrator/<date>-<slug>/plans/<slug>.md, currently on Task 3" — not copy the full task list.

2. Write `state.md` at the project root with concise sections:
   - `Current Goal`
   - `Decisions`
   - `Plan Status`
   - `Evidence`
   - `Open Issues`

3. **Check for superseded entries before appending.** Grep `session-log.md` for 2-3 keywords from the current decision:
   ```bash
   grep -i "<keyword>" session-log.md
   ```
   Read any matching `[saved]` entries and ask: does the new decision *directly contradict* an old one? If yes, append `[superseded by YYYY-MM-DD]` to the old entry's header line — do not delete it. If the old entry is merely related but not contradicted, leave it unchanged. This is a judgment call, not a mechanical keyword match.

4. Append a `[saved]` entry to `session-log.md`:

**What belongs here vs state.md:**
- `session-log.md [saved]`: permanent decisions, anti-patterns to avoid, carry-forward open items
- `state.md`: active task status, in-progress plans, checklists, version bump readiness — anything that will be resolved soon

**Never include in a [saved] entry:**
- Test results or verification confirmations ("11/11 tests pass")
- Task checklists, file changelogs, or release notes → use `state.md`
- "How it works" walkthroughs → read the code
- Speculative analysis not approved for implementation → use a design doc in `docs/`
- One-time confirmations ("file deleted", "folder removed")
- Newly discovered permanent architectural constraints → add to `project-map.md` Critical Constraints instead

**Hard limits per component — enforce while writing, not after:**
- Goal: 1 line, ≤15 words
- Decisions: ≤5 bullets for multi-subsystem sessions, ≤3 for single-topic. Each bullet: decision + one-sentence why, ≤25 words total. No prose, no rationale beyond the why.
- Rejected: ≤3 bullets, ≤15 words each. What to avoid — not the full story of why it failed.
- Open: ≤2 items, ≤12 words each.

If a decision doesn't fit in 25 words, the explanation belongs in a design doc. Cut the explanation, not the decision.

Total entry backstop: 250 words / 1500 chars. If exceeded, a bullet violated its limit — find it and cut it. Typical single-topic sessions should target ~120 words; the higher cap exists for multi-subsystem sessions that genuinely touched 5+ areas.

```markdown
## YYYY-MM-DD HH:MM [saved]
Goal: <one line>
Decisions:
- <what was chosen and the one-sentence why — not how it works>
Rejected: <what NOT to try, one line each — the anti-pattern knowledge>
Open: <carry-forward items only>
```

Append the entry and move the stop-hook marker with ONE Bash command. It uses a here-document: shell syntax that gives the lines after the command to the command as its input. Replace only the placeholder line with the entry. Keep the blank line, the first line and the closing `SAVED_ENTRY_END_7Q` line unchanged:

```bash
cat >> session-log.md <<'SAVED_ENTRY_END_7Q' && node -e "const fs=require('fs'),path=require('path'),id=String(process.env.CLAUDE_CODE_SESSION_ID||'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64),dir=path.join(process.env.HOME||process.env.USERPROFILE||'.','.claude','hooks-logs');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'last-saved-entry'+(id?'-'+id:'')+'.txt'),new Date().toISOString())"

<the entry, in the format above>
SAVED_ENTRY_END_7Q
```

- The delimiter `'SAVED_ENTRY_END_7Q'` is in single quotes, and it must stay so. With a quoted delimiter the shell copies the entry text unchanged: quotes, backticks and `$` stay literal. With an unquoted delimiter the shell EXECUTES every command that the entry text holds between backticks.
- The entry must hold no line that is equal to the delimiter. Such a line ends the here-document early, and the shell then RUNS the rest of the entry as commands. The delimiter is an unusual word for this reason; do not replace it with a common word.
- The part after `&&` writes the save marker of this session. The save marker is a file under `~/.claude/hooks-logs/` that holds the time of the last `[saved]` entry; the stop hook compares it with the time of each edit. The file name holds the session id, which Claude Code gives to every Bash command in the environment variable `CLAUDE_CODE_SESSION_ID`, so a save in one session does not reset the reminder of another session. When the variable is not set, the command writes the older marker file that all sessions share; the stop hook reads that file as well.
- Fallback: a hook can block this command. For example, a safety hook refuses a command that it cannot read to its end. In that case write the entry with the Edit tool instead (or with the Write tool when `session-log.md` does not exist yet). Write the `## ... [saved]` heading at the start of a line: the hook counts a heading only when at most three spaces stand before its `#`. The edit-tracking hook sees the new `[saved]` heading and moves the marker itself, so step 5 is not needed.
- Save AFTER the edits that implement a decision. The stop hook reports every significant edit that is later than the marker, and it cannot know that an earlier entry already covers a later edit. An entry saved before its edits therefore gives one more reminder. This is a known limit; step 5 handles it.
- After the save, count the entries of the log with `grep -c -a -E '^## [0-9]{4}-[0-9]{2}-[0-9]{2}' session-log.md`. This is the rule of the archive script: an entry starts at a line with `## ` and a date (the script also skips such a line inside a fenced code block). The option `-a` makes `grep` read the file as text: without it, the `grep` of the Claude Code Bash tool prints nothing for a file that holds a byte that is not valid UTF-8 (Unicode Transformation Format, 8-bit). When the count is above 200, add one line to your reply that gives the count and offers to archive the log; the user can answer, for example, "archive the session log". Write this line only once per session. Do not ask a question that waits for an answer, and do not move any entry before the user says yes. The archive procedure is in [session-log.md Format and Maintenance](#session-logmd-format-and-maintenance).

5. When the `[saved]` entry already exists, do not write a second entry. This is the case when the stop hook asks for a decision-log entry again, and an entry of this session already covers the edits that it reports. Run the marker command alone, so that the decision-log reminder resets:
   ```bash
   node -e "const fs=require('fs'),path=require('path'),id=String(process.env.CLAUDE_CODE_SESSION_ID||'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64),dir=path.join(process.env.HOME||process.env.USERPROFILE||'.','.claude','hooks-logs');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'last-saved-entry'+(id?'-'+id:'')+'.txt'),new Date().toISOString())"
   ```
   Without this command the stop hook repeats the decision-log reminder on every later stop in the same session.

6. In a new session, read `state.md` first to restore task context, then grep `session-log.md` for relevant history. With 0 hits there, grep `session-log-archive.md` too when it exists.

## session-log.md Format and Maintenance

The log contains a single entry type:

- **[saved]** — written by this skill when explicitly invoked: full decision record including goals, rationale, rejected approaches, and key facts.

**File management:**
- Lives at the project root alongside `CLAUDE.md` and `package.json`
- Archive old entries when the user asks for it, for example with "archive the session log". After a save, step 4 offers this when the log holds more than 200 entries. Run `node "<skill-dir>/scripts/archive-session-log.js"` with the Bash tool from the folder that holds `session-log.md` (`<skill-dir>` is this skill's base directory). The script keeps the newest 100 entries in `session-log.md` and moves the older entries, unchanged, to the end of `session-log-archive.md` in the same folder. To keep another number of entries, give that number as the only argument. Report the one line that the script prints. When the script exits with a non-zero code, report its output and change no file by hand. The automatic recall (the session-start hook and the prompt hook, which add log entries to the context of a session) does not read `session-log-archive.md`; search it with `grep` when you need older history.
- When a decision is permanently superseded (e.g., the approach was replaced), mark it rather than deleting: append `[superseded by YYYY-MM-DD]`
- Do NOT log trivial sessions (the stop hook already filters these out)

**For cross-project recall** (finding how a similar problem was solved in a different codebase): `session-log.md` is per-project and keyword-searchable only. Cross-project recall is outside the scope of this system.

## Project Map

`project-map.md` is the semantic memory layer — it captures the project's structure, key file purposes, and critical non-obvious constraints so that future sessions can orient without re-globbing or re-reading known files. Generate it once; update it when the project changes.

### When to generate or update

- User says "map this project", "generate project map", or "update project map"
- First time setting up memory on a new project
- After a major refactor where many files moved or changed purpose

### Generation procedure

1. **Check for git:**
   ```bash
   git rev-parse --git-dir 2>/dev/null
   ```
   - If git exists → record `git rev-parse HEAD` as the staleness hash.
   - If git does NOT exist → offer: *"No git repository detected. Shall I run `git init`? It enables precise staleness tracking for `project-map.md` — creates a `.git` folder, touches none of your files. If you'd prefer not to, I'll fall back to file timestamp comparison instead, which works fine but is slightly less precise."*
     - User confirms → run `git init --quiet`, then proceed with git hash.
     - User declines → use generation timestamp as the staleness marker.

2. **Map the structure:** Glob the project, identify the top-level directories and their purpose. Do not enumerate every file — summarise by directory.

3. **Document key files:** For each file that is load-bearing, non-obvious, or frequently referenced, write one line describing what it does and why it matters. Aim for 10–20 entries. Skip files whose purpose is obvious from their name.

4. **Capture critical constraints:** The highest-value section. These are non-obvious facts that are not visible in the code itself — quoting rules, platform differences, version sync requirements, things that caused bugs before. Pull these from `session-log.md` `[saved]` entries and from `known-issues.md` if they exist.

5. **Identify hot files:** From `session-log.md` history, list the files most frequently appearing in `Files:` lines. These are the ones most likely to need freshness checks on future sessions.

6. **Write `project-map.md` at the project root** — same level as `CLAUDE.md` and `package.json`, never in `docs/` or any subdirectory. The session-start hook looks for it with `ls project-map.md 2>/dev/null` from the project root — if it's anywhere else, the hook cannot find it and every future session loses the map. Use this format:

```markdown
# Project Map
_Generated: YYYY-MM-DD HH:MM | Git: <short-hash> | (or: Staleness: timestamps)_

## Directory Structure
<dir>/ — <one-line purpose>
<dir>/ — <one-line purpose>

## Key Files
<path> — <what it does and why it matters>
<path> — <what it does and why it matters>

## Critical Constraints
- <non-obvious fact that would cost time to rediscover>
- <non-obvious fact that would cost time to rediscover>

## Hot Files
<path>, <path>, <path>
```

### Update procedure

When the staleness check in the entry sequence flags changed files:
1. Re-read only the flagged files.
2. Update their entries in the Key Files section.
3. Update the git hash / timestamp in the header.
4. If any new critical constraints were discovered this session, add them.

Keep `project-map.md` under 150 lines. If it grows beyond that, it is not a map — it is documentation. Prune file entries for things that are now obvious from context.

## Guardrails

- Do not drop user-provided constraints.
- Do not rewrite requirements; preserve intent.
- If uncertain whether old context matters, keep a short reference in `Open Issues`.
- Keep `state.md` under 100 lines — if it's longer, it's not compressed enough.
