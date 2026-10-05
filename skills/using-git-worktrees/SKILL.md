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

### 2. Check the spec and the plan

A new worktree holds only committed files. A spec or a plan that is not committed is absent there. Step 4 moves such a file into the worktree and commits it on `<BRANCH_NAME>`. This step runs before the worktree exists, because some results forbid a worktree. Skip this step and step 4 when the calling skill names no spec and no plan, and for a file that is already inside a worktree.

`<file-path>` is the path of the spec or of the plan that the calling skill names. Write it as an absolute path: git reads a relative path from the folder the command runs in, so a relative path fails in a sub-folder.

Run this check, both lines, one time for the spec and one time for the plan.

```bash
[ -e "<file-path>" ] || echo "no such path: <file-path>"
git status --porcelain --ignored --untracked-files=all -- "<file-path>"
```

For each file, apply the first list item that matches the result.

- A line `no such path`: the path is wrong. Correct it and run the check one more time. When the line comes again: show it to the user, and step 4 does not move this file.
- An error text, or an exit status that is not 0: create no worktree. Show the error to the user.
- A line that starts with `!!`: git ignores the file, so no commit can carry it into a worktree. Create no worktree. Create the branch in this folder with `git checkout -b <BRANCH_NAME>`, which keeps the untracked and the ignored files. Then go on with step 5 in this folder.
- A line that starts with `??`: the file is untracked, and step 4 moves it. When a rule of the user or of the project (for example in `CLAUDE.md` or `AGENTS.md`) forbids a commit without approval, ask the user once, before step 3, whether step 4 may commit the file on `<BRANCH_NAME>`. On "no": create no worktree and create the branch in this folder, as the list item before this one says.
- A line that starts with another mark (` M` is a modified file): git tracks the file, and the file holds a change that is not committed. The worktree gets the committed state of the file, without that change. Ask the user to choose one of two ways: the user commits the file, or the branch is created in this folder. After a commit by the user, run the check for this file one more time. For the other way: create no worktree and create the branch in this folder, as the list item about `!!` says.
- No output: the file is committed. The worktree will hold it, and step 4 does not move it.

### 3. Create worktree and branch

```bash
git worktree add <path> -b <BRANCH_NAME>
```

**Critical:** The `cd <path>` in this step does not persist across separate shell calls. Use the full worktree path — `cd <path> && <command>` — in every subsequent Bash call rather than assuming the working directory carried over.

### 4. Move the spec and the plan into the worktree

Run this step only when the command of step 3 has ended with exit status 0, and only for a file whose check in step 2 printed a `??` line. Each file is named by its own path: no other file of its folder is moved or committed.

`<worktree-file-path>` is the place of the file inside the worktree: the path of the worktree, then the path of the file from the top of the repository. For the file `docs/a/plan.md` of the repository it is `<path>/docs/a/plan.md`.

Run these four commands for one file, one command at a time, in this order. Then run them for the next file.

```bash
[ ! -e "<worktree-file-path>" ] || echo "already in the worktree: <worktree-file-path>"
mkdir -p "$(dirname "<worktree-file-path>")"
mv "<file-path>" "<worktree-file-path>"
git -C "<path>" add -- "<worktree-file-path>"
```

- The first command prints a line `already in the worktree`: never overwrite that file. Run no later command of this step. Tell the user that both files exist, and ask what to do.
- A command ends with an exit status that is not 0: run no later command of this step. Show the error to the user. Say where the file is now: in the folder of step 2 when the `mv` command has not succeeded, and in the worktree, not committed, when it has.

After the last file, commit the moved files with this command. Name every moved file in it, each path between its own quotes, and no other path.

```bash
git -C "<path>" commit -m "docs: spec and plan of <BRANCH_NAME>" -- "<worktree-file-path>"
```

- The commit ends with an exit status that is not 0 (for example, a commit hook refuses it): run it no second time, and do not switch the hook off. Show the error to the user. Say that the moved files are in the worktree, staged and not committed, and that the folder of step 2 holds no copy of them.
- The commit ends with exit status 0: go on with step 5.

From then on, the spec and the plan of this work are the files inside the worktree: use the path inside the worktree in every command and in every edit. A commit of the plan that runs in the folder of step 2 lands on the branch of that folder, not on `<BRANCH_NAME>`.

Tell the user the new absolute path of each moved file. When `state.md` at the top of the repository of step 2 names the old path of a moved file, write the path inside the worktree there, as an absolute path, in this step. `grep -n -F "<path-from-the-top>" state.md`, run in that top folder with the path of the file from the top of the repository, prints the lines that name the file; a line that already holds the path inside the worktree needs no change. When this session gives the user a prompt for a later session, that prompt names the path inside the worktree.

### 5. Run project setup

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

### 6. Run baseline tests

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
