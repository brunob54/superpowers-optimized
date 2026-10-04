# Superpowers Orchestrator for Codex

Guide for using Superpowers Orchestrator with OpenAI Codex CLI.

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
| 30+ workflow skills (debugging, TDD, code review, brainstorming, etc.) | ✅ | ✅ |
| Explicit skill invocation (`$skill-name`, `/skill-name`) | ✅ | ✅ |
| Implicit skill matching (Codex picks skill for task) | ✅ | ✅ |
| AGENTS.md workflow guidance | ✅ | ✅ |
| Startup context injection (project map, state, known issues) | ✅ with hooks | ❌ |
| Proactive skill routing on every prompt | ✅ with hooks | ❌ |
| Dangerous Bash command blocking | ✅ with hooks | ❌ |
| Stop-time discipline reminders | ⚠️ implemented; never seen live | ❌ |
| Custom agents (code-reviewer, red-team) | ✅ manual install | ✅ manual install |
| Bash command compression | ✅ reactive `PostToolUse(Bash)` smart-compress | ❌ |
| Read/Edit/Write interception | ❌ (Codex limitation) | ❌ |
| Subagent leakage guard | ❌ (Codex limitation) | ❌ |

**Skills work on all platforms including Windows. Lifecycle hooks require macOS or Linux with hooks enabled.**

**Important:** The standard install for this plugin should be the complete install for the current platform. That means skills + custom agents everywhere, plus lifecycle hooks on macOS/Linux. Skipping the custom agent files should be treated as a fallback or constrained setup, not the default install path.

**Codex CLI the hook registry shape targets:** `codex-cli 0.118.0`. Older Codex builds are expected to ignore the current top-level `hooks` registry shape. This floor is taken from the Codex documentation; no version was tested.

---

## Quick Install

Tell Codex:

```
Fetch and follow instructions from https://raw.githubusercontent.com/brunob54/superpowers-orchestrator/refs/heads/main/.codex/INSTALL.md
```

---

## Manual Installation

### Prerequisites

- OpenAI Codex CLI (`npm i -g @openai/codex`)
- Git

### Step 1 — Clone the repo

```bash
git clone https://github.com/brunob54/superpowers-orchestrator.git ~/.codex/superpowers-orchestrator
```

### Step 2 — Create the skills symlink

**macOS / Linux:**
```bash
mkdir -p ~/.agents/skills
ln -s ~/.codex/superpowers-orchestrator/skills ~/.agents/skills/superpowers
```

**Windows (PowerShell — use a junction, works without Developer Mode):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills"
cmd /c mklink /J "$env:USERPROFILE\.agents\skills\superpowers" "$env:USERPROFILE\.codex\superpowers-orchestrator\skills"
```

### Step 3 — Install custom agents

Install the native Codex `code-reviewer` and `red-team` agents:

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

These agents are part of the standard Codex install for this plugin. If you skip this step, the install is intentionally incomplete.

### Step 4 — (macOS/Linux only) Enable lifecycle hooks

Hooks add startup context injection. Hooks are disabled on Windows native — skip this step on Windows.

**4a.** Enable hook support in `~/.codex/config.toml`:
```toml
[features]
codex_hooks = true
```

**4b.** Link the hook registry:
```bash
ln -s ~/.codex/superpowers-orchestrator/hooks/codex-hooks.json ~/.codex/hooks.json
```
If `~/.codex/hooks.json` already exists, merge this plugin's Codex entries from the top-level `hooks` object in `codex-hooks.json` into your existing file instead of replacing it.

### Step 5 — Restart Codex

Quit and relaunch. Skills, hooks, and custom agents are discovered at startup.

### Step 6 — Verify the complete install

**macOS / Linux:**
```bash
ls -la ~/.agents/skills/superpowers
ls -la ~/.codex/agents/code-reviewer.toml ~/.codex/agents/red-team.toml
```

**Windows (PowerShell):**
```powershell
Get-Item "$env:USERPROFILE\.agents\skills\superpowers"
Get-Item "$env:USERPROFILE\.codex\agents\code-reviewer.toml","$env:USERPROFILE\.codex\agents\red-team.toml"
```

**macOS/Linux hooks:**

```bash
grep -n "codex_hooks" ~/.codex/config.toml
test -f ~/.codex/hooks.json && echo "hooks.json present"
grep -n '"hooks"' ~/.codex/hooks.json
```

Also confirm:

```bash
codex --version
```

Use `0.118.0` or newer. That floor comes from the Codex documentation; no version has been tried.

---

## How It Works

Codex has native skill discovery — it scans `~/.agents/skills/` at startup, parses SKILL.md frontmatter, and loads skills on demand. Superpowers skills become visible through a single symlink:

```
~/.agents/skills/superpowers/ → ~/.codex/superpowers-orchestrator/skills/
```

The `using-superpowers` skill is discovered automatically and enforces workflow discipline — it directs Codex to use the right skill for each task type. No additional configuration required for skills.

### Lifecycle hooks (macOS/Linux only)

When hooks are enabled, Codex uses the Codex-specific hook subset shipped by this plugin: `SessionStart` for context injection, `UserPromptSubmit` for routing, `PreToolUse(Bash)` for safety checks, `PostToolUse(Bash)` for reactive smart-compress of noisy shell output, and `Stop` for discipline reminders.

**Not verified live.** The adapters for `SessionStart`, `UserPromptSubmit`
and `PreToolUse(Bash)` have been exercised only as scripts, by feeding them
fixture JSON in this repository's own test suite. Nobody has run them inside
a live Codex session on any `codex-cli` version. `Stop` is implemented in
what the Codex documentation describes as the correct output shape, but its
reminder has never been seen surfacing in a real session.

Codex still cannot match Claude Code's full hook surface. There is no Codex parity today for `PostToolUse(Edit|Write|Skill)`, `SubagentStop`, or `Read/Edit/Write` interception. The Codex `PostToolUse(Bash)` smart-compress hook replaces verbose Bash output after execution. The Claude Code hook now does the same (it no longer rewrites the command before execution); the two hooks share the compression rules, but the Claude Code hook returns the `updatedToolOutput` field and has extra rules (alert lines, size rule) that the Codex adapter does not have.

---

## Usage

### Skills are discovered automatically

Codex activates skills when:
- You mention a skill by name: `use systematic-debugging`, `$brainstorming`
- The task matches a skill's trigger description
- The `using-superpowers` skill routes you to the appropriate skill

### Verify your setup

**Check skills are linked:**
```bash
ls -la ~/.agents/skills/superpowers   # macOS/Linux
```
```powershell
Get-Item "$env:USERPROFILE\.agents\skills\superpowers"   # Windows
```

**Check custom agents are installed:**
```bash
ls -la ~/.codex/agents/code-reviewer.toml ~/.codex/agents/red-team.toml   # macOS/Linux
```
```powershell
Get-Item "$env:USERPROFILE\.codex\agents\code-reviewer.toml","$env:USERPROFILE\.codex\agents\red-team.toml"   # Windows
```

**Check hooks (if you enabled them):**
```bash
grep -n "codex_hooks" ~/.codex/config.toml
test -f ~/.codex/hooks.json && echo "hooks.json present"
grep -n '"hooks"' ~/.codex/hooks.json
codex --version
```

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
- hooks still behave inconsistently after update
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

### Skills not showing up

1. Verify the symlink: `ls -la ~/.agents/skills/superpowers`
2. Check skills exist: `ls ~/.codex/superpowers-orchestrator/skills`
3. Restart Codex — skills are discovered at startup, not dynamically

### Windows junction issues

Junctions normally work without special permissions. If creation fails, run PowerShell as administrator.

### Hooks not running (macOS/Linux)

1. Confirm `codex --version` is `0.118.0` or newer
2. Confirm `codex_hooks = true` is set in `~/.codex/config.toml`
3. Confirm `~/.codex/hooks.json` exists and includes this plugin's Codex hook entries under a top-level `hooks` object
4. Restart Codex after any hook-file change
5. If hooks still do not fire, inspect the installed `~/.codex/superpowers-orchestrator/hooks/codex-hooks.json` and validate the JSON syntax

### Hooks on Windows

Codex lifecycle hooks are disabled on Windows native. This is a Codex platform limitation with no current workaround. Use WSL if you need hook functionality on Windows.

---

## Getting Help

- Report issues: https://github.com/brunob54/superpowers-orchestrator/issues
- Main documentation: https://github.com/brunob54/superpowers-orchestrator
