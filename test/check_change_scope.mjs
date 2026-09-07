// Change-budget / scope control for a wireframe-fix repair pass. Run this AFTER applying a fix
// (staged or not) to confirm the change touched only the file(s) it was supposed to.
//
// Usage: node test/check_change_scope.mjs desktop/library-ui.js [more files...]
//
// Exits non-zero if anything changed outside the given file list, so it can gate a commit the
// same way githooks/pre-commit gates a missing wireframe_diff run.
import { reportChangeScope, printChangeScope } from './wireframe_diff_lib.mjs';

const expected = process.argv.slice(2);
if (!expected.length) {
  console.error('Usage: node test/check_change_scope.mjs <expected-file> [more-files...]');
  process.exit(2);
}

const scope = reportChangeScope(expected);
printChangeScope(scope);
process.exit(scope.outOfScope.length ? 1 : 0);
