#!/usr/bin/env bash
# verification-before-completion test suite: the stub-scan command of
# skills/verification-before-completion/SKILL.md. The suite copies the
# command out of the skill text, runs it on a fixture folder under bash and
# under zsh, and compares the files that the command prints with the
# expected list. A change to the command in the skill text is tested here
# without a change to this file.
# Pure bash, zsh and grep; no claude invocation.
# Windows note: never reads standard input through its device path.
#
# The defect behind this suite (finding 4 of the review of 2026-10-03): the
# old command ended with `grep -v -i "test\|spec\|__tests__"`. That filter
# read the whole output line: the path, the line number and the code text.
# It dropped a stub in production code when the code text held "latest" or
# "special", or when the path held "test" or "spec" inside another word
# (components/Inspector.ts, attestation/verify.go). Measured with BSD grep:
# the old command printed 2 of the 9 production stubs of the fixture below.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL="$ROOT/skills/verification-before-completion/SKILL.md"
SCAN_HEADING='## Stub Scan (Implementation Tasks)'
SRC_PLACEHOLDER='<src-dir>'
# The fixture folder, relative to $TMP. The scan runs from $TMP with this
# relative name, so the path of the temporary folder never reaches a filter.
FIXTURE_DIR='src'
NL=$'\n'
PASS=0
FAIL=0
ERRORS=()

green() { printf '\033[0;32m%s\033[0m\n' "$1"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$1"; }
bold()  { printf '\033[1m%s\033[0m\n' "$1"; }
note()  { printf '  NOTE: %s\n' "$1"; }

ok()  { green "  PASS: $1"; PASS=$((PASS+1)); }
bad() { red "  FAIL: $1"; ERRORS+=("$1"); FAIL=$((FAIL+1)); }

# Lists are shown on one line in a FAIL message: "|" separates the lines.
one_line() { printf '%s' "$1" | tr '\n' '|'; }
assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$(one_line "$3")', got '$(one_line "$2")')"; fi
}

TMP=$(mktemp -d)
: "${TMP:?mktemp failed — refusing to run with an empty fixture path}"
trap 'rm -rf "$TMP"' EXIT

# block_after <heading>: the lines of the first ```bash block after the line
# <heading> in the skill file, without the fence lines.
block_after() {
  awk -v h="$1" '$0 == h { f = 1; next } f && /^```bash$/ { c = 1; next } c && /^```$/ { exit } c { print }' "$SKILL" 2>/dev/null
}
SCAN_CMD=$(block_after "$SCAN_HEADING")

# stub <path> <line>: writes a fixture file under $TMP that holds <line>.
stub() {
  mkdir -p "$(dirname "$TMP/$1")"
  printf '%s\n' "$2" > "$TMP/$1"
}
# prod <path> <line>: a stub in a production file. The scan must print it.
EXPECTED=''
prod() {
  stub "$1" "$2"
  EXPECTED="$EXPECTED$1$NL"
}
# test_file <path> <line>: a stub in a test file. The scan must not print it.
test_file() { stub "$1" "$2"; }

# Production files. Each one breaks the old filter in a different way.
prod "$FIXTURE_DIR/app/version.ts"           '// TODO: read the latest version from the server'
prod "$FIXTURE_DIR/app/pricing.py"           '# FIXME: the special price rule is missing'
prod "$FIXTURE_DIR/components/Inspector.ts"  '// TODO: draw the panel'
prod "$FIXTURE_DIR/attestation/verify.go"    '// TODO: check the signature'
prod "$FIXTURE_DIR/latest/build.rs"          '// TODO: add the build step'
# A file name that ends in "test.go" without the "_test.go" form, and a file
# name that holds "test_" after its first letter.
prod "$FIXTURE_DIR/app/contest.go"           '// TODO: rank the players'
prod "$FIXTURE_DIR/app/attest_report.py"     '# TODO: write the report'
# Code text that names a test folder. Only the path of a line may decide.
prod "$FIXTURE_DIR/app/loader.py"            '# TODO: read the files in data/tests/ too'
# Two production files that the old filter printed too.
prod "$FIXTURE_DIR/app/main.js"              '// FIXME: handle the error'
prod "$FIXTURE_DIR/app/service.py"           '    raise NotImplementedError'

# Test files: one for each test form that the skill text names.
test_file "$FIXTURE_DIR/test/a.py"           '# TODO: a test folder'
test_file "$FIXTURE_DIR/tests/b.rs"          '// TODO: a tests folder'
test_file "$FIXTURE_DIR/__tests__/c.js"      '// TODO: a __tests__ folder'
test_file "$FIXTURE_DIR/spec/d.ts"           '// TODO: a spec folder'
test_file "$FIXTURE_DIR/specs/e.go"          '// TODO: a specs folder'
test_file "$FIXTURE_DIR/pkg/tests/unit/f.py" '# TODO: a tests folder deeper down'
test_file "$FIXTURE_DIR/app/g.test.ts"       '// TODO: a .test. file name'
test_file "$FIXTURE_DIR/app/h.spec.js"       '// TODO: a .spec. file name'
test_file "$FIXTURE_DIR/app/i_test.go"       '// TODO: a _test.go file name'
test_file "$FIXTURE_DIR/app/j_test.py"       '# TODO: a _test.py file name'
test_file "$FIXTURE_DIR/app/test_k.py"       '# TODO: a test_*.py file name'

EXPECTED=$(printf '%s' "$EXPECTED" | LC_ALL=C sort)

# run_scan <shell>: runs the scan command from $TMP with <shell>; sets FILES
# to the sorted list of the files that the command printed. A line that does
# not have the form <path>:<line number>:<text>, for example an error
# message, stays whole in FILES, so the comparison shows it.
run_scan() {
  printf '%s\n' "${SCAN_CMD//$SRC_PLACEHOLDER/$FIXTURE_DIR}" > "$TMP/scan.sh"
  FILES=$(cd "$TMP" && "$@" scan.sh 2>&1 | sed -E 's/:[0-9]+:.*$//' | LC_ALL=C sort -u)
}

bold "1. The skill text holds the stub-scan command"
case "$SCAN_CMD" in
  *"$SRC_PLACEHOLDER"*) ok "the block after '$SCAN_HEADING' holds $SRC_PLACEHOLDER" ;;
  *) bad "the block after '$SCAN_HEADING' holds $SRC_PLACEHOLDER (block: '$(one_line "$SCAN_CMD")')" ;;
esac

bold "2. The stub scan prints the production stubs and drops the test files"
run_scan bash
assert_eq "bash: the scan prints every production stub and no test file" "$FILES" "$EXPECTED"
if command -v zsh >/dev/null 2>&1; then
  run_scan zsh -f
  assert_eq "zsh: the scan prints every production stub and no test file" "$FILES" "$EXPECTED"
else
  note "zsh is not installed; the zsh check is skipped"
fi

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
