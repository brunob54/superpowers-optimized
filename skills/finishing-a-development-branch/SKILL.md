---
name: finishing-a-development-branch
description: >
  MUST USE when implementation is verified and you need to choose the
  branch outcome: merge, PR, keep, or discard. Triggers on: "merge this",
  "create a PR", "squash and merge", "we're done with this branch",
  "clean up the branch", "push this", "get it merged", after
  verification-before-completion passes. Routed by using-superpowers
  or executing-plans at completion.
---

# Finishing a Development Branch

Close development work with explicit integration choice.

## Step 1: Verify

Run full project verification before offering options.

If verification fails, stop and return to implementation.

## Step 2: Identify Base Branch

Detect merge base (`main`/`master` or repo default) and confirm if unclear.

## Step 3: Offer Exactly Four Options

1. Merge back to `<base-branch>` locally
2. Push branch and open PR
3. Keep branch/worktree as-is
4. Discard branch/worktree

## Step 4: Execute Safely

### Option 1
- Checkout base
- Pull latest
- Merge feature branch
- Re-run verification
- Remove worktree (follow "Removing a worktree" below)
- Delete merged branch

### Option 2
- Push feature branch
- Create PR with a description that includes:
  - **What changed** — one-paragraph summary of the change set
  - **Why** — the motivation or problem this solves (link to plan doc if one exists)
  - **How to verify** — exact commands or steps a reviewer can run to confirm the change works
  - **Notable decisions** — any trade-offs made, alternatives rejected, or non-obvious choices.
    If `session-log.md` has `[saved]` entries written during this branch's lifetime, extract the Decisions and Rejected bullets from the most recent entry and include them here. This ensures PR reviewers see the "why" without needing to read the log.
- Keep worktree by default (remove only if user asks; then follow "Removing a worktree" below)

### Option 3
- Keep branch and worktree
- Report exact path and branch name

### Option 4
- Show destructive impact summary
- Require exact confirmation: `discard`
- Remove worktree (follow "Removing a worktree" below), then delete branch

### Removing a worktree

Options 1, 2 and 4 remove a worktree (a second working folder of the same
repository) only with this procedure.

`git worktree remove` refuses when the worktree holds a modified file or an
untracked file. It does not refuse for a file that git ignores: it deletes
that file with no message. Git ignores the workspace files of this plugin
(`session-log.md`, `state.md`, `known-issues.md`, `project-map.md`),
because the hooks of the plugin hide them from git.

Run this check first. Give the path of the worktree: without
`-C <worktree-path>` the command reports on the folder it runs in.

```bash
git -C <worktree-path> status --porcelain --ignored
```

- No output: run `git worktree remove <worktree-path>`.
- Any output: do not remove the worktree yet. Each line names a file or a
  folder that the removal deletes; `!!` marks one that git ignores. Show
  the lines to the user. Say which lines are workspace files of the plugin:
  `session-log.md`, `state.md` and `known-issues.md` hold content that
  exists nowhere else. Ask the user which files to move to the main
  checkout and which files to delete.
- A file to move: move it to the same relative path in the main checkout
  (the first line of `git worktree list`). Never overwrite a file there:
  when the destination already exists, leave both files in place and ask
  the user what to do with them.
- After the user has answered for every line: run
  `git worktree remove <worktree-path>`. If git refuses because of a
  modified or an untracked file, the answer of the user to delete that file
  allows `--force`.
- Never pass `--force` to `git worktree remove` before the user has
  answered.

## Hard Rules

- Never merge with failing tests.
- Never delete work without explicit confirmation.
- Never force-push unless explicitly requested.

## Final Report

Include:
- Selected option
- Commands executed
- Final branch/worktree status
- PR link (if created)
