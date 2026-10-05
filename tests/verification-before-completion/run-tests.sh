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
#
# A second defect (review of 2026-10-05): the filter of commit 4f76ec9 read
# the whole path that grep printed, also the part above the scanned folder.
# With an absolute <src-dir> under a parent folder named "tests" (for example
# /x/tests/myproj/src), the filter dropped every line and the scan printed
# nothing. The fixture folder of this suite has such a parent folder, and the
# suite runs the scan with a relative and with an absolute <src-dir>.

set -u
# Stop the suite when a command is not found; the file explains the reason.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/undefined-command-guard.sh"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SKILL="$ROOT/skills/verification-before-completion/SKILL.md"
SCAN_HEADING='## Stub Scan (Implementation Tasks)'
SRC_PLACEHOLDER='<src-dir>'
# The scanned folder, relative to $TMP. Its parent folder is named "tests" on
# purpose: the part of a path above the scanned folder must never decide.
FIXTURE_DIR='tests/proj/src'
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

# stub <path> <line>: writes a fixture file that holds <line>. <path> is
# relative to the scanned folder $TMP/$FIXTURE_DIR.
stub() {
  mkdir -p "$(dirname "$TMP/$FIXTURE_DIR/$1")"
  printf '%s\n' "$2" > "$TMP/$FIXTURE_DIR/$1"
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
prod "app/version.ts"                         '// TODO: read the latest version from the server'
prod "app/pricing.py"                         '# FIXME: the special price rule is missing'
prod "components/Inspector.ts"                '// TODO: draw the panel'
prod "attestation/verify.go"                  '// TODO: check the signature'
prod "latest/build.rs"                        '// TODO: add the build step'
# A file name that ends in "test.go" without the "_test.go" form, and a file
# name that holds "test_" after its first letter.
prod "app/contest.go"                         '// TODO: rank the players'
prod "app/attest_report.py"                   '# TODO: write the report'
# Code text that names a test folder. Only the path of a line may decide.
prod "app/loader.py"                          '# TODO: read the files in data/tests/ too'
# Two production files that the old filter printed too.
prod "app/main.js"                            '// FIXME: handle the error'
prod "app/service.py"                         '    raise NotImplementedError'
# A file at the top of the scanned folder. Some grep programs print it as
# "./index.ts", others as "index.ts"; both forms must reach the list.
prod "index.ts"                               '// TODO: export the public names'
# Production files that pin the exact list of test forms: each one is close
# to a test form, and a filter that drops more than the listed forms drops it.
prod "app/x.spectrum.ts"                      '// TODO: draw the spectrum'
prod "mocks/server.ts"                        '// TODO: answer the requests'
prod "fixtures/data.py"                       '# TODO: load the data'
prod "app/lib_test.rs"                        '// TODO: parse the input'
prod "app/contests.py"                        '# TODO: list the contests'
# Go compiles only *_test.go files as tests, so tests.go is production code.
prod "app/tests.go"                           '// TODO: count the tests'
# Folder names match with case: a "Tests" folder is not a test folder. This
# is a known limit in the safe direction: the scan prints too much, and it
# never drops a production stub.
prod "lib/Tests/m.py"                         '# TODO: a folder named Tests'

# Test files: one for each test form that the skill text names.
test_file "test/a.py"                         '# TODO: a test folder'
test_file "tests/b.rs"                        '// TODO: a tests folder'
test_file "__tests__/c.js"                    '// TODO: a __tests__ folder'
test_file "spec/d.ts"                         '// TODO: a spec folder'
test_file "specs/e.go"                        '// TODO: a specs folder'
test_file "pkg/tests/unit/f.py"               '# TODO: a tests folder deeper down'
test_file "app/g.test.ts"                     '// TODO: a .test. file name'
test_file "app/h.spec.js"                     '// TODO: a .spec. file name'
test_file "app/i_test.go"                     '// TODO: a _test.go file name'
test_file "app/j_test.py"                     '# TODO: a _test.py file name'
test_file "app/test_k.py"                     '# TODO: a test_*.py file name'
test_file "app/tests.py"                      '# TODO: a Django tests.py file'
test_file "conftest.py"                       '# TODO: a pytest conftest.py file at the top'

EXPECTED=$(printf '%s' "$EXPECTED" | LC_ALL=C sort)

# run_scan <src-dir> <shell> [<shell option>...]: puts <src-dir> in place of
# the placeholder and runs the scan command from $TMP with <shell>. Sets
# FILES to the sorted list of the files that the command printed, each one
# relative to the scanned folder: a leading "<src-dir>/" or "./" is removed.
# A line that does not have the form <path>:<line number>:<text>, for
# example an error message, stays whole in FILES, so the comparison shows it.
# The script also writes the current folder before and after the command
# into $CWD_BEFORE and $CWD_AFTER.
CWD_BEFORE="$TMP/cwd-before"
CWD_AFTER="$TMP/cwd-after"
run_scan() {
  local dir="$1"
  shift
  rm -f "$CWD_BEFORE" "$CWD_AFTER"
  {
    printf 'pwd > "%s"\n' "$CWD_BEFORE"
    printf '%s\n' "${SCAN_CMD//$SRC_PLACEHOLDER/$dir}"
    printf 'pwd > "%s"\n' "$CWD_AFTER"
  } > "$TMP/scan.sh"
  FILES=$(cd "$TMP" && "$@" "$TMP/scan.sh" 2>&1 | sed -E 's/:[0-9]+:.*$//' \
    | while IFS= read -r p; do p=${p#"$dir"/}; printf '%s\n' "${p#./}"; done \
    | LC_ALL=C sort -u)
}

# check_scan <label> <src-dir> <shell> [<shell option>...]: runs the scan
# and checks the printed files and the current folder after the command.
check_scan() {
  local label="$1" dir="$2"
  shift 2
  run_scan "$dir" "$@"
  assert_eq "$label: the scan prints every production stub and no test file" "$FILES" "$EXPECTED"
  assert_eq "$label: the scan leaves the caller in its folder" \
    "$(cat "$CWD_AFTER" 2>/dev/null)" "$(cat "$CWD_BEFORE" 2>/dev/null)"
}

# scan_with <shell> [<shell option>...]: checks a relative and an absolute
# <src-dir>. Both hold the parent folder named "tests".
scan_with() {
  check_scan "$1, relative <src-dir>" "$FIXTURE_DIR" "$@"
  check_scan "$1, absolute <src-dir>" "$TMP/$FIXTURE_DIR" "$@"
}

bold "1. The skill text holds the stub-scan command"
case "$SCAN_CMD" in
  *"$SRC_PLACEHOLDER"*) ok "the block after '$SCAN_HEADING' holds $SRC_PLACEHOLDER" ;;
  *) bad "the block after '$SCAN_HEADING' holds $SRC_PLACEHOLDER (block: '$(one_line "$SCAN_CMD")')" ;;
esac

bold "2. The stub scan prints the production stubs and drops the test files"
scan_with bash
if command -v zsh >/dev/null 2>&1; then
  scan_with zsh -f
else
  note "zsh is not installed; the zsh check is skipped"
fi

bold ""
bold "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  for e in "${ERRORS[@]}"; do red "  - $e"; done
  exit 1
fi
