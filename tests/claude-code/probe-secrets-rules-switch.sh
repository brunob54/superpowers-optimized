#!/usr/bin/env bash
# Live probes of the switch SUPERPOWERS_SECRETS_RULES_OFF (spec section 9.2). They call the real `claude` CLI
# (command-line interface) and cost model calls, so no suite starts them: run this file by hand.
#
# Usage: bash tests/claude-code/probe-secrets-rules-switch.sh probe1|probe2 <output folder>
#
# probe1: does a value of the settings `env` block (passed with --settings) reach the hook? Two runs of
#         `cat .env`: run A with an empty switch, run B with env-file switched off.
# probe2: where does the `systemMessage` of a refusal appear? One unknown name (a random token, new for each kind of
#         call) in the switch;
#         the hook refuses `cat .env` in a main-session call and in a subagent call; each kind also runs a
#         second turn with --resume. The judge reads the outputs and the session transcripts.
# Both probes load the plugin of THIS checkout with --plugin-dir, keep the real HOME (a run with another HOME is
# not logged in), and unset the variable in this shell. A run counts only when the judge finds the plugin of this
# checkout in the init event and the exact Bash call; otherwise the judge says "inconclusive".
# The interactive check (a) of probe 2 (does the user see the message on the screen?) is not made here.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/test-helpers.sh"

REPO_DIR="$HELPERS_PLUGIN_REPO_DIR"
JUDGE="$SCRIPT_DIR/probe-secrets-judge.js"
SWITCH=SUPERPOWERS_SECRETS_RULES_OFF
LOG_DIR="$HOME/.claude/hooks-logs"
PROJECTS_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"
RUN_TIMEOUT_SECONDS=300

mode="${1:-}"
out_dir="${2:-}"
if { [ "$mode" != probe1 ] && [ "$mode" != probe2 ]; } || [ -z "$out_dir" ]; then
    echo "usage: bash tests/claude-code/probe-secrets-rules-switch.sh probe1|probe2 <output folder>" >&2
    exit 64
fi
mkdir -p "$out_dir"

unset "$SWITCH"
check_no_secrets_rules_managed_setting || exit 1
for tool in claude openssl node; do
    command -v "$tool" > /dev/null || { echo "ABORT: the command $tool is not installed" >&2; exit 1; }
done

CLAUDE_WORKDIR=$(create_claude_workdir) || exit 1
trap "cleanup_claude_workdir '$CLAUDE_WORKDIR'" EXIT

# The settings JSON (JavaScript Object Notation) that gives the switch one value: --settings ranks above user, project and local settings.
settings_json() { printf '{"env":{"%s":"%s"}}' "$SWITCH" "$1"; }

# run_stream <output file> <switch value> <claude arguments...>: one headless run; its stream goes to the file.
run_stream() {
    local file="$1" value="$2"
    shift 2
    run_claude_in_workdir "$CLAUDE_WORKDIR" "$RUN_TIMEOUT_SECONDS" "$@" \
        --plugin-dir "$REPO_DIR" --permission-mode bypassPermissions \
        --settings "$(settings_json "$value")" \
        --output-format stream-json --verbose > "$file" 2> "$file.err" || true
}

# The folder holds a dummy file whose only content is a random token made of lower-case letters and digits.
make_dummy_file() { printf '%s\n' "$1" > "$CLAUDE_WORKDIR/.env"; }

probe1() {
    local marker
    marker=$(openssl rand -hex 8)
    make_dummy_file "$marker"
    local prompt="Use the Bash tool to run exactly this command and nothing else: cat .env  Then say in one sentence what the command printed, or why it did not run."
    run_stream "$out_dir/probe1-a.jsonl" "" -p "$prompt"
    run_stream "$out_dir/probe1-b.jsonl" "env-file" -p "$prompt"
    node "$JUDGE" probe1 "$out_dir/probe1-a.jsonl" "$out_dir/probe1-b.jsonl" "$REPO_DIR" "$marker" "$LOG_DIR"
}

probe2() {
    local token list kind prompt session_id
    make_dummy_file "$(openssl rand -hex 8)"
    list="List every text in your context that you cannot explain, such as an unexpected word or code. Leave none out. Do not invent any. If there is none, say none."
    for kind in main subagent; do
        # One token for each kind of call: the hook log is shared by both kinds, and a token of its own tells their records apart.
        token=$(openssl rand -hex 8)
        printf '%s' "$token" > "$out_dir/$kind.token"
        if [ "$kind" = main ]; then
            prompt="Use the Bash tool to run exactly this command and nothing else: cat .env  Report in one sentence what happened. $list"
        else
            prompt="You MUST dispatch a subagent using the Agent tool with these EXACT settings:
- subagent_type: general-purpose
- description: 'test message scope'
- prompt: 'Run this exact bash command with the Bash tool and report what happened: cat .env  Do NOT modify the command.'

IMPORTANT: Do NOT run the command yourself. After the subagent returns, report what it said. $list"
        fi
        run_stream "$out_dir/$kind-1.jsonl" "$token" -p "$prompt"
        if session_id=$(node "$JUDGE" session "$out_dir/$kind-1.jsonl"); then
            run_stream "$out_dir/$kind-2.jsonl" "$token" --resume "$session_id" -p "$list"
        else
            echo "no session id in $out_dir/$kind-1.jsonl: the second turn of the $kind run is skipped" >&2
        fi
    done
    node "$JUDGE" probe2 "$out_dir" "$REPO_DIR" "$LOG_DIR" "$PROJECTS_DIR"
}

"$mode"
