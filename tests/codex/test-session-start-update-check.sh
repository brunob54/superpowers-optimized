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
#   7. A marketplace install without network (item 7 of the review of
#      2026-10-03): a failed version request is cached like a successful one.
#      The next session start inside the cache interval of 24 hours runs no
#      curl and announces nothing; the first session start after the interval
#      asks again and announces the new version.
#   8. As case 7, for a clone of the plugin whose origin cannot be reached: a
#      failed fetch is cached, the next session start inside the interval
#      runs no fetch even when origin can be reached again, and the first
#      session start after the interval fast-forwards the clone.
#   9. A clone of the plugin and a marketplace install on one HOME, in both
#      orders: the check of one path does not stop the check of the other
#      path inside the cache interval, because each path has its own cache.
#  10. A marketplace install whose HOME holds a recent, empty
#      update-check.cache (findings C2 and A5 of the review of 7d174ca..de39a39):
#      the clone path of older versions created that file with touch. An
#      empty file is no record of a failed request: the hook asks the remote
#      version and announces it.
#  11. A cache whose modification time is in the future (a clock that was set
#      back; finding A4 of the same review), on both paths: the negative age
#      counts as old, so the marketplace install asks again after a failed
#      request, and the clone is fetched and fast-forwarded.
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
# The end of the marketplace notice for any version, also an empty one.
AVAILABLE_NOTICE_END="is available**"
# The files in which the hook records its last update check, relative to
# HOME: one for a marketplace install and one for a clone of the plugin.
MARKETPLACE_CACHE=".claude/hooks-logs/update-check.cache"
CLONE_CACHE=".claude/hooks-logs/update-check-clone.cache"
# Modification times for a cache, in the format of "touch -t": one older than
# the cache interval of 24 hours, and one in the future.
PAST_STAMP="202001010000"
FUTURE_STAMP="209901010000"

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
# by CURL_LOG. When CURL_OFFLINE is 1, it prints nothing and ends with exit
# status 6, as curl does when it cannot resolve the host name (no network).
# Otherwise it prints a plugin.json with version REMOTE_VERSION.
CURL_OFFLINE=0
BIN="${TMP}/bin"
mkdir -p "$BIN"
cat > "${BIN}/curl" <<EOF
#!/usr/bin/env bash
printf 'curl %s\n' "\$*" >> "\$CURL_LOG"
[ "\$CURL_OFFLINE" = 1 ] && exit 6
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
# a local bare repository as "origin" (its folder is REMOTE), pushes branch
# main to it, and then adds one commit to origin's main from a second clone.
# That commit writes <content> to <file>. The repository is then one commit
# behind origin/main and has not fetched that commit.
origin_one_commit_ahead() {
  local other="${F}/other"
  REMOTE="${F}/remote.git"
  fx_git init -q --bare "$REMOTE"
  fx_git -C "$1" remote add origin "$REMOTE"
  fx_git -C "$1" push -q origin "$MAIN"
  fx_git clone -q "$REMOTE" "$other"
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

# install_from_marketplace: sets PLUG to a marketplace install (a plain copy
# of the plugin, with no repository of its own) under ~/.claude/plugins/cache
# of the case.
install_from_marketplace() {
  PLUG="${F}/home/.claude/plugins/cache/marketplace/plugin/${OLD_VERSION}"
  copy_plugin "$PLUG"
}

# user_repo_fixture <name> [link]: the user's own repository R holds a tracked
# settings.json, ignores the folders plugins and hooks-logs, and is one commit
# behind its origin. Without "link", R is ~/.claude itself. With "link", R is
# a separate folder, and ~/.claude is a symbolic link to its sub-folder
# "claude". PLUG is a marketplace install under ~/.claude/plugins/cache.
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
  install_from_marketplace
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

# marketplace_fixture <name>: PLUG is a marketplace install in no git
# repository.
marketplace_fixture() {
  new_case "$1"
  install_from_marketplace
}

# touch_cache <cache> [<stamp>]: gives the update-check cache <cache>
# (relative to the HOME of the case) the modification time <stamp> (in the
# format of "touch -t"), or the current time when <stamp> is not given. It
# creates the cache, empty, when the hook wrote none.
touch_cache() {
  local cache="${F}/home/$1"
  local stamp=()
  if [ -n "${2:-}" ]; then
    stamp=(-t "$2")
  fi
  mkdir -p "$(dirname "$cache")"
  touch ${stamp[@]+"${stamp[@]}"} "$cache"
}

# expire_cache <cache>: gives the update-check cache <cache> a modification
# time older than the cache interval, as if the last check had run long ago.
expire_cache() {
  touch_cache "$1" "$PAST_STAMP"
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
# CURL_CALLS to the number of calls of the stand-in for curl during this run.
# A hook that writes no valid JSON output counts as one failure and leaves
# CTX empty.
run_hook() {
  local plugin="${1:-$PLUG}"
  local raw="${F}/hook-output.json" curl_log="${F}/curl.log" code=0
  local pass=()
  [ -n "${SYSTEMROOT:-}" ] && pass+=("SYSTEMROOT=$SYSTEMROOT")
  [ -n "${TEMP:-}" ] && pass+=("TEMP=$TEMP")
  rm -f "$curl_log"
  (cd "$PROJECT" && env -i PATH="${BIN}:${PATH}" HOME="${F}/home" \
      GIT_CEILING_DIRECTORIES="$TMP" CURL_LOG="$curl_log" CURL_OFFLINE="$CURL_OFFLINE" \
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
  assert_marketplace_notice "$1"
}

# assert_marketplace_notice <label>: asserts that the hook run last took the
# path of a marketplace install: it asked the remote version once and
# announced the version that the marketplace offers.
assert_marketplace_notice() {
  assert_contains "$1: the hook announces the version that the marketplace offers" "$CTX" "$AVAILABLE_NOTICE"
  assert_absent "$1: the hook announces no applied update" "$CTX" "$UPDATED_NOTICE_START"
  assert_eq "$1: the hook asks the remote version once" "$CURL_CALLS" "1"
}

# assert_marketplace_quiet <label> <curl calls>: runs the hook on the fixture
# made last by marketplace_fixture and asserts the number of calls of the
# stand-in for curl and that the hook announces no update of either kind.
assert_marketplace_quiet() {
  run_hook
  assert_eq "$1: the number of curl calls is $2" "$CURL_CALLS" "$2"
  assert_absent "$1: the hook announces no marketplace update" "$CTX" "$AVAILABLE_NOTICE_END"
  assert_absent "$1: the hook announces no applied update" "$CTX" "$UPDATED_NOTICE_START"
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
  assert_clone_not_updated "$1"
}

# assert_clone_not_updated <label>: asserts that the hook run last left the
# old VERSION file in the clone made last by clone_fixture and wrote no
# update notice of either kind.
assert_clone_not_updated() {
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

# ── Case 7: a marketplace install without network ──────────────────────────
# The empty answer of a failed request must not give an update notice, and
# the cache of a failed request must not stop the check after the interval.
marketplace_fixture offline-marketplace
CURL_OFFLINE=1
assert_marketplace_quiet "no network, first session start" 1
assert_marketplace_quiet "no network, next session start inside the cache interval" 0
CURL_OFFLINE=0
expire_cache "$MARKETPLACE_CACHE"
run_hook
assert_marketplace_notice "network again, first session start after the cache interval"
# The cache of that successful request expires, and the next request fails.
CURL_OFFLINE=1
expire_cache "$MARKETPLACE_CACHE"
assert_marketplace_quiet "no network after an expired check that succeeded" 1
assert_marketplace_quiet "no network, next session start inside the new cache interval" 0
CURL_OFFLINE=0

# ── Case 8: a clone of the plugin whose origin cannot be reached ───────────
clone_fixture offline-clone
# The failed fetch of the first run writes the file FETCH_HEAD, so only the
# second run can show that no fetch ran.
mv "$REMOTE" "${REMOTE}.away"
run_hook
assert_clone_not_updated "a clone whose origin cannot be reached, first session start"
mv "${REMOTE}.away" "$REMOTE"
assert_clone_untouched "a clone whose origin can be reached again, next session start inside the cache interval"
expire_cache "$CLONE_CACHE"
assert_clone_updated "a clone whose origin can be reached again, first session start after the cache interval"

# ── Case 9: a clone and a marketplace install that share one HOME ──────────
# Each path keeps its own cache: the check of one path, inside the cache
# interval, must not stop the check of the other path.
clone_fixture shared-home-clone-first
assert_clone_updated "one HOME, the clone checks first"
install_from_marketplace
run_hook
assert_marketplace_notice "one HOME, the marketplace install checks inside 24 hours after the clone"

clone_fixture shared-home-marketplace-first
clone_plugin="$PLUG"
install_from_marketplace
run_hook
assert_marketplace_notice "one HOME, the marketplace install checks first"
assert_clone_updated "one HOME, the clone checks inside 24 hours after the marketplace install" "$clone_plugin"

# ── Case 10: an empty cache file left by the clone path of older versions ──
# Up to version 7.64.0 the clone path created update-check.cache, the cache
# of the marketplace path, with touch. That empty file must not stop the
# request of the marketplace path for 24 hours.
marketplace_fixture empty-cache-marketplace
touch_cache "$MARKETPLACE_CACHE"
run_hook
assert_marketplace_notice "a recent, empty cache file left by an older clone path"

# ── Case 11: a cache whose modification time is in the future ──────────────
# A negative age must count as old, or the check stays silent until the
# future date plus 24 hours. The first run records a failed request.
marketplace_fixture future-cache-marketplace
CURL_OFFLINE=1
run_hook
CURL_OFFLINE=0
touch_cache "$MARKETPLACE_CACHE" "$FUTURE_STAMP"
run_hook
assert_marketplace_notice "a failed request whose cache time is in the future, network again"

clone_fixture future-cache-clone
touch_cache "$CLONE_CACHE" "$FUTURE_STAMP"
assert_clone_updated "a clone whose cache time is in the future"

echo "  ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
