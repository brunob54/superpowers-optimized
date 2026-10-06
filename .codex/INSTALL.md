# Installing Superpowers Orchestrator for Codex

> **No longer supported (since 2026-09-21).** Codex is no longer a supported
> platform of Superpowers Orchestrator. The Codex files (`.codex/`,
> `.codex-plugin/`, `hooks/codex/`, `hooks/codex-hooks.json`) stay in the
> repository, and their unit tests still run, but Codex is no longer
> maintained or reviewed as a platform. Use Claude Code or GitHub Copilot CLI.

> **Status: never run on Codex.** Everything here was written from the Codex
> documentation and this repository's own script-level tests. The plugin has
> not been used inside a live Codex session. A `✅` below means the feature
> is implemented and wired for Codex, not that it was seen working. Only
> Claude Code and GitHub Copilot CLI have actually been used to run this
> plugin.

## What you get

| Feature | macOS / Linux (hooks enabled) | Windows native |
|---|---|---|
| 30+ workflow skills | ✅ | ✅ |
| Explicit/implicit skill activation | ✅ | ✅ |
| AGENTS.md workflow guidance | ✅ | ✅ |
| Startup context injection (project map, state, known issues) | ✅ with hooks | ❌ |
| Proactive skill routing on every prompt | ✅ with hooks | ❌ |
| Dangerous Bash command blocking | ✅ with hooks | ❌ |
| Stop-time discipline reminders | ⚠️ implemented; never seen live | ❌ |
| Custom agents (code-reviewer, red-team) | ✅ manual install | ✅ manual install |
| Bash command compression | ✅ reactive `PostToolUse(Bash)` smart-compress | ❌ |
| Read/Write interception | ❌ Codex limitation | ❌ |

**Skills are expected to work on all platforms. Lifecycle hooks require macOS or Linux.**

**Important:** This document treats the **standard install** as the complete install for the current platform. On macOS/Linux that means skills + hooks + custom agents. On Windows native that means skills + custom agents; hooks remain unavailable because Codex does not support them there. A reduced setup may still function, but it should be treated as a fallback, not the default install story.

**Codex CLI the hook registry shape targets:** `codex-cli 0.118.0`. Older Codex builds are expected to ignore the current top-level `hooks` registry shape. This floor is taken from the Codex documentation; no version was tested.

---

## Prerequisites

- OpenAI Codex CLI (`npm i -g @openai/codex`)
- Git

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/brunob54/superpowers-orchestrator.git ~/.codex/superpowers-orchestrator
```

### 2. Create the skills symlink

**macOS / Linux:**
```bash
mkdir -p ~/.agents/skills
ln -s ~/.codex/superpowers-orchestrator/skills ~/.agents/skills/superpowers
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\superpowers" "$env:USERPROFILE\.codex\superpowers-orchestrator\skills"
```

### 3. Install custom agents

Installs `code-reviewer` and `red-team` agents for use in Codex subagent workflows.

These agent files are part of the standard Codex install for this plugin. Without them, the install is intentionally incomplete.

**macOS / Linux:**
```bash
mkdir -p ~/.codex/agents
cp ~/.codex/superpowers-orchestrator/codex-agents/*.toml ~/.codex/agents/
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.codex\agents"
Copy-Item "$env:USERPROFILE\.codex\superpowers-orchestrator\codex-agents\*.toml" "$env:USERPROFILE\.codex\agents\"
```

After installing, these agents are available by name in Codex subagent workflows (e.g., "Use the code-reviewer agent to review this branch").

> **Why this is a separate filesystem step:** Codex does not officially support bundling TOML custom agents via the plugin manifest. Manual placement in `~/.codex/agents/` is required by the platform.

### 4. (macOS/Linux only) Enable lifecycle hooks

Hooks add startup context injection (project map, known issues, session state). They are **disabled on Windows native** — skip this step on Windows.

**4a.** Add to `~/.codex/config.toml`:
```toml
[features]
codex_hooks = true
```

**4b.** Link the hook registry:
```bash
ln -s ~/.codex/superpowers-orchestrator/hooks/codex-hooks.json ~/.codex/hooks.json
```

If `~/.codex/hooks.json` already exists, merge this plugin's Codex entries from the top-level `hooks` object in `~/.codex/superpowers-orchestrator/hooks/codex-hooks.json` into your existing file instead of replacing it.

### 5. Restart Codex

Quit and relaunch the CLI. Skills, hooks, and custom agents are discovered at startup.

### 6. Verify complete setup

**Check skills:**
```bash
ls -la ~/.agents/skills/superpowers
```

**Check custom agents:**
```bash
ls -la ~/.codex/agents/code-reviewer.toml ~/.codex/agents/red-team.toml
```

**Check hooks (macOS/Linux, if you completed step 4):**
```bash
grep -n "codex_hooks" ~/.codex/config.toml
test -f ~/.codex/hooks.json && echo "hooks.json present"
grep -n '"hooks"' ~/.codex/hooks.json
```

Confirm `codex --version` reports `0.118.0` or newer. That floor comes from the Codex documentation; no version has been tried.

---

## Hook behavior notes

**What the hooks are intended to do (not confirmed live):**
- **SessionStart:** Inject project context (project map, state, known issues, using-superpowers skill) at session start. Check for plugin updates (non-destructive: only applies if the clone is clean and can fast-forward to `origin/main`). Since v7.59.0 the check runs only when the plugin folder is itself the top level of a git work tree (the folder that holds the checked-out files) and branch `main` is checked out. A clone with another branch checked out, or with a detached HEAD (a checked-out commit with no branch), gets no automatic update and no notice; update it with `git pull`.
- **UserPromptSubmit:** Proactive skill routing — analyzes each prompt and injects skill suggestions before the model responds.
- **PreToolUse (Bash):** Safety dispatcher — blocks dangerous shell commands (rm -rf ~, curl|sh, fork bombs, etc.) and secret exfiltration attempts before execution.
- **PostToolUse (Bash):** Reactive smart-compress — replaces verbose Bash output after execution with a compressed summary when an existing compression rule matches and the summary is materially smaller.
- **Stop:** Discipline reminders — TDD warning if source files changed without test changes, commit reminder if many files are uncommitted, decision log prompt if core files were modified. Treat visible live surfacing as a required post-install verification step until confirmed in the actual installed environment.

Hooks are helpful Codex guardrails, not full Claude Code parity. Codex still does not expose Claude's `PostToolUse(Edit|Write|Skill)`, `SubagentStop`, or `Read/Edit/Write` interception. The Codex `PostToolUse(Bash)` smart-compress hook replaces noisy Bash output after execution. The Claude Code hook now does the same: it no longer rewrites the command before execution.

**Windows:** Codex lifecycle hooks are disabled on Windows native. This is a Codex platform limitation. Skills still work. Use WSL for hook functionality on Windows.

To disable startup update checks:
- Set `SUPERPOWERS_AUTO_UPDATE=0`, or
- Create `~/.config/superpowers/update.conf` with `auto_update=false`

---

## Migrating from old install path

If you previously installed to `~/.codex/superpowers-optimized` (name before v7.0.0) or `~/.codex/superpowers` (oldest path):

```bash
# Update and rename
if [ -d ~/.codex/superpowers-optimized ] && [ ! -d ~/.codex/superpowers-orchestrator ]; then
  mv ~/.codex/superpowers-optimized ~/.codex/superpowers-orchestrator
fi
if [ -d ~/.codex/superpowers ] && [ ! -d ~/.codex/superpowers-orchestrator ]; then
  mv ~/.codex/superpowers ~/.codex/superpowers-orchestrator
fi
cd ~/.codex/superpowers-orchestrator && git pull

# Recreate symlink to new path
rm -f ~/.agents/skills/superpowers
ln -s ~/.codex/superpowers-orchestrator/skills ~/.agents/skills/superpowers
```

**Windows (PowerShell):**
```powershell
if ((Test-Path "$env:USERPROFILE\.codex\superpowers-optimized") -and -not (Test-Path "$env:USERPROFILE\.codex\superpowers-orchestrator")) {
  Rename-Item "$env:USERPROFILE\.codex\superpowers-optimized" "superpowers-orchestrator"
}
if ((Test-Path "$env:USERPROFILE\.codex\superpowers") -and -not (Test-Path "$env:USERPROFILE\.codex\superpowers-orchestrator")) {
  Rename-Item "$env:USERPROFILE\.codex\superpowers" "superpowers-orchestrator"
}
cmd /c rmdir "$env:USERPROFILE\.agents\skills\superpowers"
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\superpowers" "$env:USERPROFILE\.codex\superpowers-orchestrator\skills"
```

Also remove any old bootstrap block from `~/.codex/AGENTS.md` referencing `superpowers-codex bootstrap` — no longer needed.

---

## Updating

```bash
cd ~/.codex/superpowers-orchestrator && git pull
cp ~/.codex/superpowers-orchestrator/codex-agents/*.toml ~/.codex/agents/
```

Skills and hooks update from the clone automatically. Custom agents are copied files, so re-copy them after pulling updates.

After updating hooks, restart Codex and run the live smoke checks against the actual installed home. They have never been run, so treat the whole set as outstanding, `Stop` reminder visibility most of all.

### Clean reinstall fallback

Use a clean reinstall instead of the standard update flow when:

- the installed clone is dirty or diverged
- the install path changed
- hooks do not appear to fire after an update
- custom agent files are stale or missing
- you want a pristine known-good install and are fine losing local changes inside the installed clone

**Warning:** this removes the installed clone and any local changes inside `~/.codex/superpowers-orchestrator`.

**macOS / Linux:**
```bash
rm -f ~/.agents/skills/superpowers
rm -f ~/.codex/agents/code-reviewer.toml ~/.codex/agents/red-team.toml
test -L ~/.codex/hooks.json && rm ~/.codex/hooks.json
rm -rf ~/.codex/superpowers-orchestrator

git clone https://github.com/brunob54/superpowers-orchestrator.git ~/.codex/superpowers-orchestrator
mkdir -p ~/.agents/skills ~/.codex/agents
ln -s ~/.codex/superpowers-orchestrator/skills ~/.agents/skills/superpowers
cp ~/.codex/superpowers-orchestrator/codex-agents/*.toml ~/.codex/agents/
ln -s ~/.codex/superpowers-orchestrator/hooks/codex-hooks.json ~/.codex/hooks.json
```

**Windows (PowerShell):**
```powershell
cmd /c rmdir "$env:USERPROFILE\.agents\skills\superpowers"
Remove-Item -Force "$env:USERPROFILE\.codex\agents\code-reviewer.toml","$env:USERPROFILE\.codex\agents\red-team.toml" -ErrorAction SilentlyContinue
Remove-Item -Force "$env:USERPROFILE\.codex\hooks.json" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\.codex\superpowers-orchestrator"

git clone https://github.com/brunob54/superpowers-orchestrator.git "$env:USERPROFILE\.codex\superpowers-orchestrator"
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills","$env:USERPROFILE\.codex\agents" | Out-Null
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\superpowers" "$env:USERPROFILE\.codex\superpowers-orchestrator\skills"
Copy-Item "$env:USERPROFILE\.codex\superpowers-orchestrator\codex-agents\*.toml" "$env:USERPROFILE\.codex\agents\"
```

After a clean reinstall:

1. On macOS/Linux, confirm `codex_hooks = true` is still set in `~/.codex/config.toml`
2. Restart Codex
3. On macOS/Linux, run the live hook smoke checks against the actual installed home (never yet run)

---

## Uninstalling

**macOS / Linux:**
```bash
rm ~/.agents/skills/superpowers
rm -f ~/.codex/agents/code-reviewer.toml ~/.codex/agents/red-team.toml
test -L ~/.codex/hooks.json && rm ~/.codex/hooks.json
rm -rf ~/.codex/superpowers-orchestrator   # optional: delete the clone
```

**Windows (PowerShell):**
```powershell
cmd /c rmdir "$env:USERPROFILE\.agents\skills\superpowers"
Remove-Item -Force "$env:USERPROFILE\.codex\agents\code-reviewer.toml","$env:USERPROFILE\.codex\agents\red-team.toml" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:USERPROFILE\.codex\superpowers-orchestrator"
```

---

## Troubleshooting

### If hooks do not run (macOS/Linux) — untested checklist

1. Confirm `codex --version` is `0.118.0` or newer
2. Confirm `codex_hooks = true` is set in `~/.codex/config.toml`
3. Confirm `~/.codex/hooks.json` exists and includes this plugin's Codex hook entries under a top-level `hooks` object
4. Restart Codex after any hook-file change
5. If hooks still do not fire, inspect the installed `~/.codex/superpowers-orchestrator/hooks/codex-hooks.json` and validate the JSON syntax
