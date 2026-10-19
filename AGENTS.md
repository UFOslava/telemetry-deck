# Agent Guidelines & Operational Protocols

All autonomous and semi-autonomous coding agents operating on this repository must adhere to the following directives:

1. **Run Full Test Suite Upon Task Completion**:
   - Immediately after finishing any code change or task, execute the full test suite (backend verification, frontend builds, and all test runners).

2. **Sandbox Testing & Environmental Safety**:
   - Run and verify all tests strictly within an isolated sandbox environment.
   - Never run unverified or test code in production.
   - Always perform a thorough cleanup of temporary test fixtures, scratch files, or transient artifacts created during testing.

3. **Iterative Verification & Version Control Protocol**:
   - **If tests fail**: Analyze the failure, implement the fix, and repeat the full test suite until all checks succeed.
   - **If all tests pass**: Commit the validated changes and push them directly to git.
