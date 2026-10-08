# Project Memory System

How `session-log.md`, `project-map.md`, and `state.md` work together to give the agent persistent memory across sessions.

---

## The Problem

LLMs have no memory between sessions. Every time you start a new Claude Code session, the agent starts from scratch — it doesn't know what decisions were made last week, what approaches were tried and rejected, which files are the most frequently changed, or what non-obvious constraints exist in the codebase. You end up re-explaining context, re-discovering known bugs, and losing the accumulated knowledge built up over weeks of work.

Superpowers Orchestrator solves this with three plain markdown files placed at the project root. No database, no embeddings, no external services — just files that Claude can read and write like any other project file.

---

## The Three Files

| File | Created by | Purpose |
|---|---|---|
| `session-log.md` | `context-management` skill, on request or after a stop-hook reminder | Episodic history of what happened across all sessions |
| `project-map.md` | `context-management` skill (on demand) | Semantic map of the project structure and critical constraints |
| `state.md` | `context-management` skill (on demand) | Task continuity when work spans multiple sessions |

---

## session-log.md

### What it is

A chronological log of the decisions made in past sessions. The AI writes each entry with the `context-management` skill. It lives at the project root alongside `CLAUDE.md` and `package.json`.

### How it's written

No hook writes to `session-log.md`. The AI writes each entry with the `context-management` skill, in two cases:

- You ask for it, for example with "save state".
- The `stop-reminders` hook reminds it. When files such as skills, hooks, `CLAUDE.md`, specs or plans were edited since the last `[saved]` entry, the hook blocks the end of the turn and asks the AI to write a `[saved]` entry. Set `SUPERPOWERS_STOP_REMINDERS_OFF=decision-log` to switch this reminder off.

Each `[saved]` entry contains the goal, decisions made, approaches rejected, and open questions — structured for future recall.

```markdown
## 2026-03-18 16:45 [saved]
Goal: Fix emoji rendering in session-start hook
Decisions:
- Use literal 🔄 character; bash does not expand \U escapes in double-quoted strings
Approaches rejected: $'\U0001F504' syntax works but reduces readability
Key facts: escape_for_json doubles backslashes, so \U → \\U in JSON output
Open: Verify emoji renders correctly in Claude's context injection
```

### How it helps

The `session-start` hook automatically injects the **last two `[saved]` entries** into every session before your first message arrives. This means recent decisions are always available without any instruction-following required.

For older history — decisions from earlier in a project's lifetime — Claude can grep `session-log.md`, then `session-log-archive.md`, for keywords relevant to the current task. The log is keyword-searchable and per-project. When it holds more than 200 entries, the context-management skill says so after a save and offers an archive; on the user's request, a script keeps the newest 100 entries and moves the older ones to `session-log-archive.md`, which the automatic recall does not read.

This prevents:
- Rediscovering the same bug twice
- Proposing an approach that was already tried and rejected
- Forgetting why a non-obvious constraint exists

**Why injection rather than grep-only:** Relying on the AI to proactively grep is fragile — it might skip the step. Injecting the last two entries is unconditional and reliable. The cost is bounded: two entries is a fixed overhead regardless of how large the log grows.

---

## project-map.md

### What it is

A compact semantic map of the project: what the key directories do, what the load-bearing files are, what non-obvious constraints exist, and which files are changed most frequently. Generated once, updated when the project changes significantly.

### How it's generated

Invoke the `context-management` skill and ask Claude to "map this project" or "generate project map." Claude will:

1. Check for a git repository (to use commit hashes as staleness markers)
2. Glob the project structure and identify directory purposes
3. Document 10–20 key files that are non-obvious or frequently referenced
4. Capture critical constraints — the non-obvious facts that are invisible in the code itself
5. Identify hot files from `git log --name-only` over recent commits (the most often changed files, without release and version files)

The output is a structured markdown file capped at 150 lines. If it grows larger, it's not a map — it's documentation. Entries for files whose purpose is now obvious are pruned.

```markdown
# Project Map
_Generated: 2026-03-18 14:00 | Git: a3f92b1_

## Directory Structure
hooks/ — Node.js hooks registered in hooks/hooks.json
skills/ — One SKILL.md per workflow; loaded by Claude via Skill tool
.claude-plugin/ — Claude Code plugin manifest and marketplace registration

## Key Files
hooks/run-hook.cmd — Polyglot CMD/bash wrapper; enables bash hooks on Windows
hooks/session-start — Injects using-superpowers routing on every session start
hooks/hooks.json — Hook registration; uses \" quoting (not ') for variable expansion on Linux
.claude-plugin/plugin.json — Version field must stay in sync with all three manifests

## Critical Constraints
- Version must match across plugin.json, cursor plugin.json, and marketplace.json
- hooks.json requires escaped double quotes around ${CLAUDE_PLUGIN_ROOT} paths
- Every SKILL.md must have YAML frontmatter with name and description fields

## Hot Files
hooks/session-start, hooks/stop-reminders.js, hooks/skill-activator.js
```

### How it helps

Future sessions can orient to the project instantly — no re-globbing, no re-reading known files, no re-learning constraints that caused bugs before. The map is especially valuable when:

- Resuming work after a gap
- A new contributor starts on the project
- A session starts on an unfamiliar part of the codebase
- The agent needs to know which files are "hot" without scanning git history

---

## state.md

### What it is

A short-lived task continuity file for when work spans multiple sessions. It captures the current goal, decisions made, plan status, verified facts, and open issues — condensed to under 100 lines.

### When to use it

When a complex multi-step task will continue in a future session, invoke `context-management` to save state before ending the session. The next session reads `state.md` first to restore context. Then it greps `session-log.md` for relevant history, and then `session-log-archive.md`, which holds the older entries after an archive.

Unlike `session-log.md` (which is permanent history), `state.md` represents active in-progress work. Once the task is complete, it can be deleted or left as-is.

---

## How the Three Files Work Together

```
Session starts (session-start hook fires automatically)
    │
    ├── Inject project-map.md (full content if ≤200 lines, else Critical Constraints + Hot Files)
    ├── Inject state.md in full (if exists — means work is in progress)
    ├── Inject last 2 [saved] entries from session-log.md (if exists)
    ├── Inject known-issues.md in full (if exists)
    └── Inject context-snapshot.json summary (changed files + recent commits), only when its git_hash is the present HEAD
            │
            ▼
        Work happens
            │
            ├── For older session history: Grep session-log.md, then session-log-archive.md, for task keywords
            ├── [reminder] Stop hook asks for a [saved] entry after edits of skills, hooks, specs or plans
            └── [manual] context-management writes rich [saved] entry + updates state.md

Over time:
    project-map.md ──► fast orientation for any future session
    session-log.md ──► "what happened before" for any task (recent: injected; older: grep)
    state.md       ──► "where we were" for the current task
    known-issues.md ──► error→solution map, always injected so debugging starts with it
```

---

## Design Philosophy

**File-based, not database-based.** Everything is plain markdown in the project root. The files are readable by humans, editable with any text editor, searchable with grep, and committable to git. No external services, no embeddings API, no local SQLite — just files.

**Additive, never destructive.** The save step of the `context-management` skill appends a new `[saved]` entry to `session-log.md` and never deletes an entry: when a new decision contradicts an old one, it only adds `[superseded by YYYY-MM-DD]` to the heading line of the old entry. The archive step runs only when you ask for it; it moves the oldest entries, unchanged, to `session-log-archive.md`. You can inspect, edit, prune, or delete any of these files at any time without breaking anything.

**Zero setup for new projects.** `session-log.md` starts with the first `[saved]` entry, which the AI writes when you say "save state" or when the stop hook reminds it. `project-map.md` is generated on demand, not required for the plugin to function.

**Works on existing projects.** Installing the plugin on a large existing codebase works exactly the same way — the memory files start accumulating from the first session forward. `project-map.md` can be generated at any time to map the existing structure.

**Token-efficient by design.** The session-start hook injects only the last two `[saved]` entries from session-log.md — not the full file. For older history, Claude greps rather than reads. The project map is capped at 150 lines. State is capped at 100 lines. known-issues.md is injected in full but stays short by design (one entry per error signature).

---

## Research & Inspiration

**Jesse Vincent — "Fixing Claude Code's amnesia" (October 2025)**
[blog.fsck.com/2025/10/23/episodic-memory](https://blog.fsck.com/2025/10/23/episodic-memory)

This blog post by the original Superpowers author is the direct source for the memory system. Jesse identified the core problem — Claude Code has no persistent memory between sessions — and framed the solution around the concept of **episodic memory**: the human cognitive faculty for remembering specific things that happened, as distinct from semantic or journaling-based memory.

His original implementation used a SQLite database with vector search, a conversation archive, an MCP integration tool, and a Haiku subagent to manage context retrieval — powerful, but with external dependencies.

This fork (superpowers-orchestrator) implements the same episodic memory concept as a lighter-weight, dependency-free variant: plain markdown files, keyword grep instead of vector search, and entries that the AI writes with the `context-management` skill (on request or after a stop-hook reminder) instead of a separate archiving process. The tradeoff is that retrieval is lexical rather than semantic — you find entries by keyword, not by meaning — but the system requires no database, no embeddings API, and no extra services. Everything stays in project files.

**CLAUDE.md / AGENTS.md pattern.** The broader convention of using project-root markdown files as persistent context for AI coding assistants — established by Anthropic's CLAUDE.md and OpenAI's AGENTS.md guidance — inspired the file-based storage approach. `project-map.md` and `session-log.md` extend this pattern from static human-written configuration to dynamic, session-generated memory.

**Self-consistency reasoning (Wang et al., ICLR 2023).** The `self-consistency-reasoner` skill embedded in debugging and verification uses this paper's technique of sampling multiple reasoning paths and taking a majority vote. Unrelated to the memory system, but the one explicitly cited research technique elsewhere in the plugin.

---

## See Also

- `skills/context-management/SKILL.md` — full procedure for generating maps, saving state, and reading history
- `hooks/stop-reminders.js` — the stop hook: when a turn ends, it reminds the AI about source edits without test changes, uncommitted files of the session, a missing `[saved]` entry (the decision-log reminder), a `state.md` older than the latest edits, and large `session-log.md` entries; it writes no session-log entry
- `docs/superpowers-orchestrator/2026-03-16-meta-memory-behavioral-self-evolution/specs/meta-memory-behavioral-self-evolution-design.md` — proposed future extension: behavioral preference distillation across sessions
