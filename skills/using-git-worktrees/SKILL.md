---
name: using-git-worktrees
description: >
  Use before implementation when work should be isolated from the current
  branch. Triggers on: "use a worktree", "isolate this work",
  "don't touch main", experimental or risky changes that need isolation.
---

# Using Git Worktrees

Create an isolated branch workspace with safe defaults.

## Required Start

Announce: `I'm using the using-git-worktrees skill to set up an isolated workspace.`

## Directory Selection Priority

Check in order:

```bash
ls -d .worktrees 2>/dev/null     # Preferred (hidden)
ls -d worktrees 2>/dev/null      # Alternative
```

1. If `.worktrees/` exists — use it. If both exist, `.worktrees/` wins.
2. If `worktrees/` exists — use it.
3. Check project guidance file (e.g. `CLAUDE.md`) for a stated preference:
   ```bash
   grep -i "worktree.*director" CLAUDE.md 2>/dev/null
   ```
4. Ask user.

## Safety Check

For project-local worktree directories, verify ignore rules before creating:

```bash
git check-ignore -q .worktrees 2>/dev/null || git check-ignore -q worktrees 2>/dev/null
```

If **not** ignored:
1. Add the appropriate line to `.gitignore`.
2. **Commit the `.gitignore` change immediately** before proceeding — an uncommitted ignore entry is easy to lose and leaves the worktree contents exposed to accidental staging.

## Creation Steps

### 1. Detect project root and branch name

```bash
project=$(basename "$(git rev-parse --show-toplevel)")
```

Choose a descriptive `BRANCH_NAME` for the feature being isolated.

### 2. Commit the spec and the plan

A new worktree holds only committed files. A spec or a plan that is not committed is absent there. Skip this step when the calling skill names no spec and no plan.

The topic folder is the folder `docs/superpowers-orchestrator/<date>-<slug>/` that holds the spec and the plan of this work: the folder above the `specs/` or `plans/` folder of the path that the calling skill names. For a spec or a plan that is not under `docs/superpowers-orchestrator/`, run this step once for each such file, with the path of the file in place of the topic folder. Write the path as an absolute path: git reads a relative path from the folder the command runs in, so a relative path fails in a sub-folder.

Run this check, both lines.

```bash
[ -e "<topic-folder>" ] || echo "no such path: <topic-folder>"
git status --porcelain --ignored --untracked-files=all -- "<topic-folder>"
```

Apply the first list item that matches the result.

- A line `no such path`: correct the path and run the check again.
- An error text, or an exit status that is not 0: create no worktree. Show the error to the user.
- A line that starts with `!!` and names the spec or the plan: git ignores that file, so no commit can carry it into a worktree. Create no worktree. Create the branch in this folder with `git checkout -b <BRANCH_NAME>`, which keeps the untracked and the ignored files. Then go on with step 4 in this folder.
- A line that starts with another mark than `!!` (`??` is an untracked file, ` M` is a modified file): the file is not committed. When a rule of the user or of the project (for example in `CLAUDE.md` or `AGENTS.md`) forbids a commit without approval, ask the user once. On "no": create no worktree and create the branch in this folder, as the list item before this one says. On "yes", and when no such rule exists: run `git add -- "<topic-folder>"`, then `git commit -m "docs: spec and plan of <BRANCH_NAME>" -- "<topic-folder>"`, on the current branch. Then run the check again.
- No output, or only `!!` lines: go on with step 3. The worktree will not hold a file of a `!!` line.

After step 3 the worktree holds its own copy of the topic folder. From then on, the spec and the plan of this work are the copies inside the worktree: use the path inside the worktree in every command and in every edit. A commit of the plan that runs in the folder of this step lands on the branch of that folder, not on `<BRANCH_NAME>`.

### 3. Create worktree and branch

```bash
git worktree add <path> -b <BRANCH_NAME>
```

**Critical:** The `cd <path>` in this step does not persist across separate shell calls. Use the full worktree path — `cd <path> && <command>` — in every subsequent Bash call rather than assuming the working directory carried over.

### 4. Run project setup

Auto-detect the project ecosystem and run the appropriate setup:

```bash
# Node.js
if [ -f package.json ]; then npm install; fi

# Rust
if [ -f Cargo.toml ]; then cargo build; fi

# Python
if [ -f requirements.txt ]; then pip install -r requirements.txt; fi
if [ -f pyproject.toml ]; then poetry install; fi

# Go
if [ -f go.mod ]; then go mod download; fi
```

If none of these files exist, skip dependency installation and note it in the output.

### 5. Run baseline tests

Run the project-appropriate test command to confirm the worktree starts clean:

```bash
# Use whichever applies
npm test
cargo test
pytest
go test ./...
```

## Failure Handling

If baseline tests fail, report the failures and ask whether to continue or investigate before proceeding.

## Success Output

Report:
- Worktree path (full absolute path)
- Branch name
- Ecosystem detected and setup command(s) run
- Baseline test status (passing count or failure summary)

## Integration

Use with:
- `writing-plans`
- `subagent-driven-development` — REQUIRED before executing any tasks
- `executing-plans` — REQUIRED before executing any tasks

Cleanup is handled by `finishing-a-development-branch`.
