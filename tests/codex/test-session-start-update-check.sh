#!/usr/bin/env bash
# Unit test: the update check of hooks/session-start fetches and fast-forwards
# only a clone of the plugin. A clone of the plugin is a plugin folder that is
# itself the top level of a git work tree and has branch main checked out.
#
# The defect that these cases pin (finding 3 of the whole-project review of
# 2026-10-03): the hook asked only "git rev-parse --git-dir", which also
# succeeds in a folder that merely lies inside the work tree of another
# repository. A marketplace install under a ~/.claude that the user keeps in
# git was then treated as a clone: the hook ran "git fetch origin" and
# "git merge --ff-only origin/main" in the user's own repository, and the
# update notice of a marketplace install never ran. The merge also moved
# whatever branch was checked out, not only main.
#
# Cases:
#   1. The plugin folder lies inside the user's own repository, which is one
#      commit behind its origin: that repository is unchanged (HEAD, branch,
#      origin/main, files, no fetch), and the hook reaches the update notice
#      of a marketplace install.
#   2. As case 1, but ~/.claude is a symbolic link into the user's repository.
#   3. Control: a clone of the plugin on branch main, one commit behind its
#      origin, is fast-forwarded, and the hook announces the new version.
#   4. As case 3, but the hook is started through a symbolic link to the clone.
#   5. A clone of the plugin with a branch other than main checked out, and
#      one with a detached HEAD (no branch checked out): unchanged, no fetch,
#      no notice of either kind. The branch names main-old, mainline and
#      feature/main start with "main" or end with "/main"; they fail a hook
#      that compares only a part of the name.
#   6. A clone of the plugin on branch main that also has a tag named main is
#      fast-forwarded. Git then prints the short name of the branch as
#      "heads/main", so the hook must compare the full reference name.
#
# No network: every remote is a local bare repository, and a stand-in for
# curl, first on PATH, answers the version request of the marketplace path.
# Each case has its own HOME and its own plugin copy inside a temporary
# folder. The output is parsed with JSON.parse (Node).
#
# The git commands of the fixtures must reach only the fixture repositories.
# GIT_DIR and the other GIT_* variables (git sets them for a hook that it
# starts) would send every git command to another repository, so the suite
# removes them all at its start, and init_repo stops the suite when it cannot
# prove that git uses the repository of the fixture folder.
set -euo pipefail

for git_variable in $(env | sed -n 's/^\(GIT_[A-Za-z0-9_]*\)=.*/\1/p'); do
  unset "$git_variable"
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REMOTE_VERSION="999.0.0"
OLD_VERSION="1.0.0"
NEW_VERSION="1.1.0"
MAIN="main"
MAIN_REF="refs/heads/${MAIN}"
# What "git rev-parse --git-dir" prints in the top folder of a repository.
OWN_GIT_DIR=".git"
AVAILABLE_NOTICE="Superpowers Orchestrator v${REMOTE_VERSION} is available"
UPDATED_NOTICE="Superpowers Orchestrator has been updated to v${NEW_VERSION}** (was v${OLD_VERSION})"
UPDATED_NOTICE_START="Superpowers Orchestrator has been updated"

export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
# pwd -P resolves macOS's /var -> /private/var symbolic link.
TMP=$(mktemp -d)
TMP=$(cd "$TMP" && pwd -P)
trap 'rm -rf "$TMP"' EXIT
# Git does not search for a repository above TMP, so a new fixture folder is
# in no repository until init_repo makes one there.
export GIT_CEILING_DIRECTORIES="$TMP"

PASS=0
FAIL=0
ok()  { PASS=$(( PASS + 1 )); echo "  ok   - $1"; }
bad() { FAIL=$(( FAIL + 1 )); echo "  FAIL - $1"; }

# assert_eq <label> <actual> <expected>
assert_eq() {
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi
}
# assert_contains <label> <haystack> <needle>
assert_contains() {
  case "$2" in
    *"$3"*) ok "$1" ;;
    *) bad "$1" ;;
  esac
}
# assert_absent <label> <haystack> <needle>
assert_absent() {
  case "$2" in
    *"$3"*) bad "$1" ;;
    *) ok "$1" ;;
  esac
}

# The stand-in for curl: it records one line for each call in the file named
# by CURL_LOG and prints a plugin.json with version REMOTE_VERSION.
BIN="${TMP}/bin"
mkdir -p "$BIN"
cat > "${BIN}/curl" <<EOF
#!/usr/bin/env bash
printf 'curl %s\n' "\$*" >> "\$CURL_LOG"
printf '{\n  "name": "superpowers-orchestrator",\n  "version": "${REMOTE_VERSION}"\n}\n'
EOF
chmod +x "${BIN}/curl"

# The working directory of every hook run: an empty folder outside every
# fixture repository.
PROJECT="${TMP}/project"
mkdir -p "$PROJECT"

# fx_git: git with a fixed identity and a fixed name for the first branch.
fx_git() {
  git -c user.name=fixture -c user.email=fixture@example.invalid \
      -c init.defaultBranch="$MAIN" "$@"
}

# init_repo <folder>: makes <folder> a new git repository. It stops the whole
# suite, before any command writes to a repository, when git already finds a
# repository from the new folder, and after "git init" when the repository
# that git uses is not the one of the folder. In both states the fixture
# commands would write commits to a repository that is not a fixture.
init_repo() {
  mkdir -p "$1"
  if git -C "$1" rev-parse --git-dir > /dev/null 2>&1; then
    refuse_to_run "$1"
  fi
  fx_git -C "$1" init -q
  [ "$(git -C "$1" rev-parse --git-dir 2>/dev/null)" = "$OWN_GIT_DIR" ] || refuse_to_run "$1"
}

# refuse_to_run <folder>: ends the suite with a failure.
refuse_to_run() {
  echo "  STOP - git does not use the repository of the fixture folder $1; no test was run after this point" >&2
  exit 1
}

# copy_plugin <dest>: copies the files that the hook reads from the plugin
# folder into <dest>, with the same relative layout.
copy_plugin() {
  mkdir -p "$1/hooks" "$1/skills/using-superpowers" "$1/.claude-plugin"
  cp "${REPO_ROOT}/hooks/session-start" "${REPO_ROOT}/hooks/session-start-assemble.js" "$1/hooks/"
  cp "${REPO_ROOT}/skills/using-superpowers/SKILL.md" "$1/skills/using-superpowers/"
  cp "${REPO_ROOT}/.claude-plugin/plugin.json" "$1/.claude-plugin/"
}

# commit_all <repository> <message>: commits every file of the work tree.
commit_all() {
  fx_git -C "$1" add -A
  fx_git -C "$1" commit -q -m "$2"
}

# origin_one_commit_ahead <repository> <file> <content>: gives the repository
# a local bare repository as "origin", pushes branch main to it, and then adds
# one commit to origin's main from a second clone. That commit writes
# <content> to <file>. The repository is then one commit behind origin/main
# and has not fetched that commit.
origin_one_commit_ahead() {
  local remote="${F}/remote.git" other="${F}/other"
  fx_git init -q --bare "$remote"
  fx_git -C "$1" remote add origin "$remote"
  fx_git -C "$1" push -q origin "$MAIN"
  fx_git clone -q "$remote" "$other"
  printf '%s\n' "$3" > "${other}/$2"
  commit_all "$other" "a change made on another machine"
  fx_git -C "$other" push -q origin "$MAIN"
  REMOTE_HEAD=$(git -C "$other" rev-parse HEAD)
}

# new_case <name>: sets F to a new folder for one case, with an empty HOME.
new_case() {
  F="${TMP}/$1"
  mkdir -p "${F}/home"
}

# user_repo_fixture <name> [link]: the user's own repository R holds a tracked
# settings.json, ignores the folders plugins and hooks-logs, and is one commit
# behind its origin. Without "link", R is ~/.claude itself. With "link", R is
# a separate folder, and ~/.claude is a symbolic link to its sub-folder
# "claude". PLUG is a marketplace install (a plain copy of the plugin, with no
# repository of its own) under ~/.claude/plugins/cache.
user_repo_fixture() {
  local settings_dir
  new_case "$1"
  if [ "${2:-}" = link ]; then
    R="${F}/dotfiles"
    settings_dir="${R}/claude"
    mkdir -p "$settings_dir"
    ln -s "$settings_dir" "${F}/home/.claude"
  else
    R="${F}/home/.claude"
    settings_dir="$R"
  fi
  init_repo "$R"
  printf 'plugins/\nhooks-logs/\n' > "${R}/.gitignore"
  printf '{"theme":"dark"}\n' > "${settings_dir}/settings.json"
  commit_all "$R" "first commit"
  origin_one_commit_ahead "$R" .gitignore "$(cat "${R}/.gitignore"; echo 'tmp/')"
  PLUG="${F}/home/.claude/plugins/cache/marketplace/plugin/${OLD_VERSION}"
  copy_plugin "$PLUG"
}

# clone_fixture <name>: PLUG is a clone of the plugin with VERSION
# OLD_VERSION on branch main; its origin is one commit ahead, and that commit
# sets VERSION to NEW_VERSION.
clone_fixture() {
  new_case "$1"
  PLUG="${F}/plugin"
  R="$PLUG"
  init_repo "$PLUG"
  copy_plugin "$PLUG"
  printf '%s\n' "$OLD_VERSION" > "${PLUG}/VERSION"
  commit_all "$PLUG" "release ${OLD_VERSION}"
  origin_one_commit_ahead "$PLUG" VERSION "$NEW_VERSION"
}

# checked_out_ref: prints the full reference name of the branch that
# repository R has checked out, or nothing for a detached HEAD.
checked_out_ref() {
  git -C "$R" symbolic-ref -q HEAD || true
}

# repo_state: prints the state of repository R that the hook must not change:
# the checked-out branch (empty for a detached HEAD), the commits of HEAD and
# of origin/main, the changed and untracked files, and whether a fetch ran
# (every fetch writes the file FETCH_HEAD).
repo_state() {
  local fetched=no
  [ -e "${R}/.git/FETCH_HEAD" ] && fetched=yes
  printf 'branch=%s HEAD=%s origin/main=%s status=[%s] fetched=%s' \
    "$(checked_out_ref)" \
    "$(git -C "$R" rev-parse HEAD)" "$(git -C "$R" rev-parse "origin/${MAIN}")" \
    "$(git -C "$R" status --porcelain)" "$fetched"
}

# run_hook [<plugin folder>]: runs the hook of the plugin folder (default:
# PLUG) with the HOME of the case and the update check enabled. Sets CTX to
# the additionalContext string of the Claude Code output branch and
# CURL_CALLS to the number of calls of the stand-in for curl. A hook that
# writes no valid JSON output counts as one failure and leaves CTX empty.
run_hook() {
  local plugin="${1:-$PLUG}"
  local raw="${F}/hook-output.json" curl_log="${F}/curl.log" code=0
  local pass=()
  [ -n "${SYSTEMROOT:-}" ] && pass+=("SYSTEMROOT=$SYSTEMROOT")
  [ -n "${TEMP:-}" ] && pass+=("TEMP=$TEMP")
  (cd "$PROJECT" && env -i PATH="${BIN}:${PATH}" HOME="${F}/home" \
      GIT_CEILING_DIRECTORIES="$TMP" CURL_LOG="$curl_log" \
      CLAUDE_PLUGIN_ROOT="$plugin" SUPERPOWERS_AUTO_UPDATE=1 \
      ${pass[@]+"${pass[@]}"} bash "${plugin}/hooks/session-start") > "$raw" || code=$?
  CTX=$(node -e '
    const j = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    process.stdout.write(j.hookSpecificOutput.additionalContext);' "$raw" 2>/dev/null) \
    || { CTX=""; bad "the hook wrote no valid JSON output (exit status ${code})"; }
  CURL_CALLS=0
  [ -f "$curl_log" ] && CURL_CALLS=$(wc -l < "$curl_log" | tr -d ' ')
  return 0
}

# assert_user_repo_untouched <label>: runs the hook on the fixture made last
# by user_repo_fixture and asserts that the user's repository is unchanged
# and that the hook took the path of a marketplace install.
assert_user_repo_untouched() {
  local before
  before=$(repo_state)
  run_hook
  assert_eq "$1: the user's repository is unchanged, and no fetch ran in it" "$(repo_state)" "$before"
  assert_contains "$1: the hook announces the version that the marketplace offers" "$CTX" "$AVAILABLE_NOTICE"
  assert_absent "$1: the hook announces no applied update" "$CTX" "$UPDATED_NOTICE_START"
  assert_eq "$1: the hook asks the remote version once" "$CURL_CALLS" "1"
}

# assert_clone_updated <label> [<plugin folder>]: runs the hook on the fixture
# made last by clone_fixture and asserts that the clone was fast-forwarded.
assert_clone_updated() {
  run_hook "${2:-}"
  assert_eq "$1: HEAD is the newest commit of origin" "$(git -C "$R" rev-parse HEAD)" "$REMOTE_HEAD"
  assert_eq "$1: branch main is still checked out" "$(checked_out_ref)" "$MAIN_REF"
  assert_eq "$1: the VERSION file is the new one" "$(cat "${R}/VERSION")" "$NEW_VERSION"
  assert_contains "$1: the hook announces the applied update" "$CTX" "$UPDATED_NOTICE"
  assert_eq "$1: the hook does not take the marketplace path" "$CURL_CALLS" "0"
}

# assert_clone_untouched <label>: runs the hook on the fixture made last by
# clone_fixture and asserts that the clone is unchanged and that the hook
# wrote no update notice of either kind.
assert_clone_untouched() {
  local before
  before=$(repo_state)
  run_hook
  assert_eq "$1: the clone is unchanged, and no fetch ran in it" "$(repo_state)" "$before"
  assert_eq "$1: the VERSION file is the old one" "$(cat "${R}/VERSION")" "$OLD_VERSION"
  assert_absent "$1: the hook announces no applied update" "$CTX" "$UPDATED_NOTICE_START"
  assert_absent "$1: the hook announces no marketplace update" "$CTX" "$AVAILABLE_NOTICE"
  assert_eq "$1: the hook does not take the marketplace path" "$CURL_CALLS" "0"
}

# ── Case 1: the plugin folder lies inside the user's own repository ────────
user_repo_fixture enclosing
assert_user_repo_untouched "plugin folder inside the user's repository"

# ── Case 2: ~/.claude is a symbolic link into the user's repository ────────
user_repo_fixture enclosing-link link
assert_user_repo_untouched "~/.claude is a symbolic link into the user's repository"

# ── Case 3: control, a clone of the plugin on branch main ──────────────────
clone_fixture clone
assert_clone_updated "a clone of the plugin on branch main"

# ── Case 4: the hook is started through a symbolic link to the clone ───────
clone_fixture clone-link
ln -s "$PLUG" "${F}/link-to-plugin"
assert_clone_updated "a clone of the plugin reached through a symbolic link" "${F}/link-to-plugin"

# ── Case 5: a clone of the plugin that has not branch main checked out ─────
# The fast-forward moves whatever is checked out, so the hook must leave a
# clone alone when that is not branch main.
for branch in work main-old mainline feature/main; do
  clone_fixture "clone-branch-${branch//\//-}"
  fx_git -C "$PLUG" checkout -q -b "$branch"
  assert_clone_untouched "a clone of the plugin with branch ${branch} checked out"
done

clone_fixture clone-detached
fx_git -C "$PLUG" checkout -q --detach
assert_clone_untouched "a clone of the plugin with a detached HEAD"

# ── Case 6: a clone on branch main that also has a tag named main ──────────
clone_fixture clone-tag-main
fx_git -C "$PLUG" tag "$MAIN"
assert_clone_updated "a clone of the plugin on branch main with a tag named main"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
