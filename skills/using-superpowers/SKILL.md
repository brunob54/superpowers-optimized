---
name: using-superpowers
description: >
  BLOCKING REQUIREMENT — invoke this skill BEFORE writing any code, editing
  files, debugging, planning, reviewing, or making any technical tool calls
  beyond reading files. This is the mandatory workflow router for ALL technical
  tasks. Matches: "implement", "build", "fix", "debug", "refactor", "optimize",
  "add feature", "change", "update", "create", "develop", "plan", "review",
  "test", or ANY request that involves code changes. Do NOT skip this skill
  even if the task seems simple. Invoke FIRST, then follow its routing.
---

# Using Superpowers

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip this skill entirely.
</SUBAGENT-STOP>

## Trigger Conditions

This skill MUST be invoked when any of the following occur:

- A new session starts with a technical request
- The user gives a new task or changes topic mid-session
- Any technical work is about to begin without a skill selected
- The user asks "what should I use" or "which workflow"

**Exception:** Micro tasks (typo fix, single variable rename, 1-line config change) can skip the entry sequence entirely. Just do them.

## When the User Names a Specific Skill

If the user's prompt references a skill by name (e.g., "use brainstorming," "use context management," "run verification"), that is a **Skill tool invocation request**:

1. Still complete Entry Sequence steps 1–6 (token-efficiency, staleness check, etc.) — these are always-on prerequisites, not routing.
2. **Invoke the named skill via the `Skill` tool.** Do not re-implement the skill's purpose with ad-hoc agents, manual file reads, or improvised workflows. The skill contains tested, structured logic — use it.
3. Skip complexity classification and routing (step 7) — the user already chose the route.

This is the most common cause of entry sequence bypass: the AI interprets "use X skill" as a goal to achieve creatively rather than as a tool invocation. It is always a tool invocation.

## Instruction Priority (highest to lowest)

1. Explicit user instructions in the current conversation
2. Project-level CLAUDE.md / AGENTS.md
3. Superpowers skill instructions

If a user explicitly overrides a skill's behavior, follow the user. Skills are defaults, not mandates.

## Core Rule

Before technical execution, select workflow skills explicitly and follow them.

Technical execution includes code edits, debugging, planning, review, test status claims, and branch integration actions.

## Entry Sequence

1. Invoke `token-efficiency` at session start — applies to all sessions, always.
2. **Fresh project gate** — evaluate both conditions in order:
   - The user's request contains creation/build intent: any of "build", "create", "make", "implement", "scaffold", "set up", "write", "generate", "develop", "start"
   - Run a filesystem check: `ls project-map.md 2>/dev/null` — gate only fires if the file does **not** exist

   If both are true, follow the section **Fresh project gate** of this skill before continuing (load the whole skill with the `Skill` tool if only its first part is in context): it holds the exact message to show the user and the steps for each answer. When the gate does not fire, apply **step 2b** from the same section (a one-time note when a non-trivial task runs in a project of 10+ files that has no `project-map.md`).
3. Classify the task as **micro**, **lightweight**, or **full** (see Complexity Classification below).
4. If resuming work from a prior session, read `state.md` if it exists. Before ending any session where significant decisions were made (design choices, rejected approaches, non-obvious constraints discovered), invoke `context-management` to write a `[saved]` entry — even if the work is complete. This is the only mechanism that preserves the "why" across sessions.
5. If `known-issues.md` exists at the project root, read it to avoid rediscovering known error→solution mappings.
6. If `project-map.md` exists at the project root, read it to orient to the project structure without re-globbing or re-reading known files. The map tells you what exists and where — when you need a file's actual content (for modification, comparison, or debugging), read it directly with the Read tool. Staleness is detected automatically by the session-start hook: if the map is stale, a `<project-map-stale>` tag is injected into session context with the mismatched hashes. When you see that tag, follow the section **Project map staleness update** of this skill (load the whole skill with the `Skill` tool if only its first part is in context).
7. Follow the path for the classified complexity level.

## Complexity Classification

Classify every task into one of three levels. Do not invoke a separate skill for this — decide inline.

### Hard overrides — check these first, before anything else

If any of the following are true, classify as **full** immediately — do not evaluate the lightweight criteria:

- The change adds, modifies, or removes a condition, gate, or trigger that determines when behavior fires
- The change affects what the user sees or experiences (excluding cosmetic text changes to existing UI — e.g., updating a label, rewording a message, or changing static copy that doesn't alter flow or behavior)
- The change modifies a file that other components depend on (routing rules, entry sequences, config registries, shared hooks)
- The change introduces a path or outcome that didn't exist before

**When in doubt, classify as full.** An unnecessary brainstorming session costs one extra round. Skipping brainstorming on a task that needed it ships a gap. The asymmetry is not equal — always err toward full.

### Micro (skip everything)
- Typo fix, single variable rename, 1-line config change
- **Action:** Just do it. No skills needed.

### Lightweight (fast path)
All of these must be true:
- Change scope is small (~2 files or fewer)
- No new behavior or architecture change
- No cross-module dependency risk
- No migration or data-shape change

**Before classifying as lightweight:** explicitly state in one sentence why each of the four criteria above is satisfied. Do not assume. If you cannot articulate any one of them clearly, classify as full.

**Action:** Go directly to implementation. Only gate: invoke `verification-before-completion` when done. Skip brainstorming, planning, worktrees, and parallel dispatch.

**Exception:** If a dedicated implementation skill exists for this specific task (check the Routing Guide), invoke it — lightweight skips workflow overhead, not implementation skills.

### Full (complete pipeline)
Anything that doesn't qualify as micro or lightweight.

**Action:** Follow the Routing Guide for the full skill pipeline. The guide is in the second part of this skill; if only the first part is in context (this skill arrived through the session-start hook), load the whole skill with the `Skill` tool first.

<!-- session-start-injection-ends. On Claude Code, hooks/session-start injects only the text above this line into every session. This keeps the hook's whole output under Claude Code's 10,000-character limit for hook output; above that limit Claude Code writes the text to a file and keeps only a 2,000-character preview in context. The Skill tool loads the whole file, and the Codex adapter embeds the whole file. Keep the text above this line at or under 6,400 characters: tests/codex/test-session-start-budget.sh asserts it. -->

## Fresh project gate (Entry Sequence step 2, full text)

When both conditions of Entry Sequence step 2 are true, first run this check in the session folder (the folder the session was opened in), before you show the message below:

```bash
LC_ALL=C git rev-parse --show-toplevel 2>&1
```

Read the output of the check. It decides the `git init` line of the message and what you run on confirm:
- **The output starts with `fatal: not a git repository (or any`:** no git repository holds this folder. Show the message as written. Other errors can also contain `not a git repository`, for example `fatal: not a git repository: <path>` in a linked worktree whose main repository was moved; they belong to the last case below.
- **The output is a folder path:** this folder is already inside the git repository at that path. In the message, replace the `git init` line with this line: "- git: this folder is already inside the git repository at <path>; I will not create another one. If you want a separate repository for this folder, say so." (<path> is the output of the check.) The reason: in a sub-folder, a `git init` creates a second repository inside the first one, and later commits go to the wrong repository. When `git rev-parse --show-prefix` prints an empty line, the session folder is the top folder of the repository, not a sub-folder: end the line after "I will not create another one." and offer no separate repository, because a `git init` there creates no second repository.
- **Any other output (an error):** leave the `git init` line out of the message, quote the error to the user, and run no `git init`.

Then **pause before proceeding** and tell the user exactly this, with the `git init` line changed as the check decided:

> Before I start: this directory has no memory files set up yet. That matters for how well I perform across sessions.
>
> **Without setup, every future session on this project starts from scratch:**
> - I re-explore the project structure even if I mapped it last session
> - I re-read files I already understood
> - I may re-propose approaches that were already tried and rejected
> - I lose the "why" behind every decision the moment the session ends
>
> **A ~30-second setup changes that permanently:**
> - `git init` — enables staleness tracking so I only re-read files that actually changed *(creates `.git` only, nothing else)*
> - `project-map.md` — I read this at every future session start instead of re-exploring blind
> - `session-log.md` — auto-captures what was built and decided, so future sessions start with: *"I see from last session that X was rejected because Y — building with that constraint already applied"* instead of rediscovering it
>
> **Set this up before we build, or start immediately?**

Wait for the user's answer before continuing.
- **If they confirm:** run `git init --quiet` only when no git repository holds this folder (the first case above; do not ask again — the user just confirmed). In every other case, run no `git init`, with one exception: the check printed a folder path, the `git init` line of the message was replaced by a line that offered a separate repository, and the user asked for one. In that case, run `git init --quiet` and tell the user this: if the outer repository tracks no file in this folder, a `git add -A` in the outer repository records this folder as an embedded repository (a pointer to the new repository, without any of its files), unless the outer repository ignores this folder; if the outer repository already tracks files in this folder, it keeps tracking them, also when it ignores this folder, so both repositories track the same files. After that, in every case, invoke `context-management` for map generation only, and tell it to write `project-map.md` in the session folder, also when that folder is a sub-folder of a repository: step 2 and the session-start hook look for the map only in the session folder, not at the top folder of the repository. Return to step 3 when done. Only in the first case above (no git repository held this folder), note: `context-snapshot.json` will not be created in this session — the context-engine hook already ran at session start before git existed. It will be created on the next session start, provided the session is opened from this project's root directory. If no commits exist yet it will be mostly empty; it populates fully after the first commit.
- **If they decline:** proceed to step 3.

**Step 2b — Existing project memory check** (runs only when step 2 did NOT fire):
If the user's request is non-trivial (not micro) AND `project-map.md` does not exist AND the project has 10+ files:
- Mention once (do not block): *"Note: this project has no project-map.md. I'll work fine without it, but if you want faster orientation in future sessions, I can generate one after this task. Just say 'map this project'."*
- Do not repeat this notice in subsequent tasks within the same session.

## Project map staleness update (Entry Sequence step 6, full text)

When the `<project-map-stale>` tag is in the session context:
- **With git:** run `git diff --name-only <map_hash> HEAD` to find changed files. Re-read only those; everything else in the map is still valid. Update the corresponding Key Files entries in `project-map.md` and refresh the git hash and date in the header.
- **Without git:** compare the map's generation timestamp to the modification time of files listed in the map's Hot Files section. Re-read any that are newer than the map. Then update their Key Files entries and refresh the generation timestamp in the header.

## EnterPlanMode Intercept

If Claude is about to enter plan mode (`EnterPlanMode`), check whether brainstorming has been completed for the current task:

- **No brainstorming done for this task**: invoke `brainstorming` first — plan mode without a validated design leads to plans built on unexamined assumptions.
- **Brainstorming already completed and design approved**: proceed to plan mode / `writing-plans`.

```dot
digraph planmode_intercept {
    "About to EnterPlanMode?" [shape=doublecircle];
    "Already brainstormed?" [shape=diamond];
    "Invoke brainstorming skill" [shape=box];
    "Proceed to writing-plans" [shape=box];

    "About to EnterPlanMode?" -> "Already brainstormed?";
    "Already brainstormed?" -> "Invoke brainstorming skill" [label="no"];
    "Already brainstormed?" -> "Proceed to writing-plans" [label="yes"];
    "Invoke brainstorming skill" -> "Proceed to writing-plans";
}
```

## Routing Guide

- Uncertain whether work should exist at all: `premise-check` (run before brainstorming or planning)
- Complex decision with unclear options or possible mis-framing: `deliberation` → `brainstorming` → `writing-plans`
- New behavior or architecture (problem is well-framed): `brainstorming` → `writing-plans`
- Plan execution (same session, with optional parallel waves): `subagent-driven-development`
- Plan execution (separate session): `executing-plans`
- Experimental or risky work needing branch isolation: `using-git-worktrees` (run before implementation)
- Bug/test failure: `systematic-debugging` → `test-driven-development`
- Completion claim: `verification-before-completion`
- Branch integration: `finishing-a-development-branch`
- Code review (includes security): `requesting-code-review` / `receiving-code-review`
- Independent parallel tasks outside of plan execution: `dispatching-parallel-agents`
- Cross-session state persistence: `context-management`
- Known issue tracking / save recurring fixes: `error-recovery`
- Tracking document for one piece of multi-part work across sessions (create, update or close a work log): `worklog`
- Status page of the repository on claude.ai (refresh it, sync the owner's page edits back into the Markdown files, share it): `dashboard`
- Code restructuring without behavior change: `refactoring` (lock behavior with tests, then restructure incrementally)
- Performance issues (slow, high memory/CPU, latency): `performance-investigation` (measure → profile → fix → re-measure)
- Dependency updates, security vulnerabilities, migrations: `dependency-management` (audit → assess impact → update incrementally → verify)
- UI/frontend implementation: apply `frontend-design` standards
- CLAUDE.md / AGENTS.md creation or update: `claude-md-creator` (applies at any complexity level — never implement directly)
- *(Internal skills — not directly routed):* `self-consistency-reasoner` is invoked internally by `systematic-debugging` and `verification-before-completion`; do not invoke it directly. `token-efficiency` is always-on and invoked at step 1 of the Entry Sequence.

## Context Hygiene

For subagent handoffs, include only current task scope, constraints, evidence, and references to `state.md` when needed.

Avoid carrying forward long assistant reasoning chains unless they contain required artifacts.

## Structured Output Preference

When output feeds another agent/tool step, prefer JSON or YAML schemas defined by the active skill.

## Red Flags

- "I'll just do this first without a skill"
- "Keep all prior assistant text in context"
- Claiming "done" without running verification

If a red flag appears, restart from Entry Sequence.
