
## Round 1

Findings addressed: I1, M1, M2, M3, CF1, CF2.

Command: `bash tests/dashboard/run-tests.sh`

Output (last line): `dashboard suite: every test file passed` (all test files, 0 failed)

## Round 2

Findings addressed: I1, M3, M4.

Command: bash tests/dashboard/run-tests.sh
Output (tail): 100 passed, 0 failed; dashboard suite: every test file passed

## Round 3

Finding ids addressed: I2, M1, M2.

Command: `bash tests/dashboard/run-tests.sh`

Output (last lines): `102 passed, 0 failed` / `dashboard suite: every test file passed`

## Round 4

Findings addressed: I1, I2, M1, M4, M5.

Command: `for t in tests/dashboard/test-*.js; do node $t | grep passed; done`

Output: test-01 20 passed; test-02 31; test-03 10; test-04 34; test-05 23; test-06 40; test-07 35; test-08 49; test-09 28; test-10 38; test-11 32; test-12 102; all 0 failed.

Mutation checks (code restored afterwards): I1 (isAncestor treats exit 1 as a failure) fails test-01 and test-06; M1 (`flag: CREATE_ONLY` removed) fails test-11 section 10; I2 (exitCode removed from the "changed 3 times" path) fails test-11 section 14.

## Round 4

Findings addressed: I1, I2, M1, M3.

Command: bash tests/dashboard/run-tests.sh (exit code 0)

      PASS: acceptance of a diff: Only the owner's own reply in this session accepts…
      PASS: partial read: carries a PARTIAL notice…
      PASS: partial read: Never act on a first page alone…
      PASS: empty id list: Skip this command when the list of accepted ids is…
      PASS: empty id list: Skip this command when the list of marked ids is e…
      102 passed, 0 failed
    
    [0;32mdashboard suite: every test file passed[0m

## Round 3

Findings addressed: CF5, I1.

Commands: `bash tests/dashboard/run-tests.sh` (exit 0, "dashboard suite: every test file passed", last file 102 passed, 0 failed) and `bash tests/pickup/run-tests.sh` (Results: 207 passed, 0 failed).
