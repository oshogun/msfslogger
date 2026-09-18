# Specification: Upgrade Runtime Baseline to Node.js 24 LTS

## Summary
The project is currently constrained to Node.js 20 due to dependency on `better-sqlite3`. Node.js 20 is end-of-life. The runtime baseline must be upgraded to **Node.js 24 LTS**, including dependency changes if required.

## Problem Statement
- `better-sqlite3` prevents or complicates adoption of newer Node versions.
- Remaining on Node 20 introduces security and maintenance risk.
- The project must run and ship on a supported LTS runtime.

## Goals
1. Set **Node.js 24 LTS** as the supported and required runtime.
2. Remove technical blockers tied to `better-sqlite3`.
3. Preserve current application behavior and data integrity.
4. Ensure CI/CD, local development, and release workflows are Node 24 compatible.

## Non-Goals
- Major feature additions unrelated to runtime upgrade.
- Database schema redesign not required by migration.
- Broad refactor beyond what is necessary to replace incompatible dependencies.

## Scope

### In Scope
- Runtime and tooling upgrade to Node 24 LTS.
- Dependency audit focused on Node 24 compatibility.
- Replacement of `better-sqlite3` if it cannot reliably support Node 24.
- Minimal database access layer adjustments needed by chosen library.
- Test, build, and CI updates for Node 24.
- Documentation updates for development and deployment requirements.

### Out of Scope
- Multi-database support expansion.
- Performance tuning unrelated to regression fixes.

## Requirements

### Functional Requirements
1. The application must execute successfully on Node.js 24 LTS in development and production modes.
2. All existing database operations (read/write/query/transaction paths currently used by the app) must behave equivalently after migration.
3. If `better-sqlite3` is replaced, a compatible alternative must be selected and integrated (examples include `sqlite3`, `node:sqlite` when stable and suitable, or another maintained option).
4. Startup, logging, and shutdown behavior must remain functionally equivalent.

### Compatibility Requirements
1. `package.json` must declare Node 24 support via `engines`.
2. Lockfile and dependency graph must resolve without Node 20-only constraints.
3. Native module compilation, if any, must succeed on Node 24 across supported environments.

### Quality Requirements
1. Test suite must pass on Node 24 in CI.
2. No critical or high-severity vulnerabilities introduced by dependency changes.
3. No data corruption or migration side effects in SQLite files used by the project.

## Proposed Approach
1. Audit all runtime dependencies for Node 24 support.
2. Evaluate `better-sqlite3` status for Node 24:
	 - If confirmed stable and maintainable: upgrade and validate.
	 - If not: replace with a supported library.
3. Introduce/adjust a small persistence adapter boundary (if needed) to isolate library-specific calls.
4. Update scripts, CI matrix, and environment docs to Node 24 LTS.
5. Run full regression tests and targeted DB behavior validation.

## Migration Plan
1. Create upgrade branch and pin Node 24 in local/CI configs.
2. Perform dependency upgrades and/or SQLite library replacement.
3. Refactor only required DB access code paths.
4. Execute automated tests plus manual smoke checks.
5. Release with rollback instructions (prior known-good version) documented.

## Acceptance Criteria
- Node.js 24 LTS is the default and required runtime.
- CI passes on Node 24 for build, lint, and tests.
- Application runs end-to-end with no functional regressions in DB workflows.
- `better-sqlite3` is either:
	- upgraded with confirmed Node 24 support, or
	- replaced with a maintained, Node 24-compatible alternative.
- README/developer docs explicitly state Node 24 requirement and setup steps.

## Risks and Mitigations
- **Risk:** API differences when replacing SQLite library.
	- **Mitigation:** Adapter layer and focused regression tests for DB operations.
- **Risk:** Native build issues in CI/containers.
	- **Mitigation:** Validate on all target build images and pin compatible toolchains.
- **Risk:** Runtime behavior drift (transactions, locking, sync/async semantics).
	- **Mitigation:** Add integration tests around transaction and concurrency-sensitive paths.

## Deliverables
- Updated runtime/dependency configuration targeting Node 24 LTS.
- Code changes required for SQLite dependency compatibility.
- Updated CI configuration and project documentation.
- Test evidence demonstrating parity and successful upgrade.
