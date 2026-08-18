# EXTRACTION-NOTES

Staging of `@dielime/verify-arch` (monorepo workspace package) into standalone publishable
`verify-arch`. Source: `dielime/packages/verify-arch` (read-only; nothing in the source repo was
modified). `during.day` was checked and has no copy — this is a single-source extraction.

## Name decision

**`verify-arch`** — kept. Checked against the npm registry on 18 Aug 2026: `npm view verify-arch`
returns E404 (name free). The fallback `medusa-verify-arch` is also free; not needed.

## Every change from the source

### package.json (rewritten)

- `name`: `@dielime/verify-arch` → `verify-arch`; `private: true` removed; `version` kept at 0.1.0.
- Added: `license: MIT`, `author: Bayram Ali Basgul`,
  `repository: github.com/bayraak/verify-arch`, keywords, `engines: node >=20`, `files`,
  `main`/`types`/`exports`, `prepublishOnly` (test + typecheck + build).
- `description` rewritten: the original embedded internal plan codes (P18/P60/H111, R-numbers);
  the new one says what the tool does and cites medusajs/medusa#15442.
- **Workspace deps removed:** `@dielime/tsconfig: workspace:*` (tsconfig inlined),
  `vitest: catalog:testing` → `^3.2.4`, `tsx: latest` → dropped entirely (see bin below),
  `@types/node: latest` → `^22.10.0`, `typescript` kept at `^5.9.3`.
- **`bin` now points at compiled output**: source had `bin: ./src/cli.ts` with a
  `#!/usr/bin/env -S node --import tsx` shebang — fine inside a monorepo that has tsx, wrong for
  `npx verify-arch` (would force tsx as a runtime dependency). Now: `tsc` build to `dist/`,
  `bin: ./dist/cli.js`, plain `#!/usr/bin/env node` shebang. Zero runtime dependencies.
- Dropped the monorepo-only `verify:arch` script (`tsx src/cli.ts ../..`).

### tsconfig

- The workspace `@dielime/tsconfig/base.json` was inlined (target ES2022, strict, etc.).
- `module`/`moduleResolution` changed `ESNext`/`Bundler` → `NodeNext`, because the package now
  emits real ESM that Node must resolve at runtime. Consequently **every relative import gained an
  explicit `.js` extension** (`./run` → `./run.js`) across all source and test files.
  `allowImportingTsExtensions` and `ignoreDeprecations` dropped (no longer needed).
- New `tsconfig.build.json`: emits `dist/` with declarations, excludes `*.test.ts`.

### Rule ids (breaking rename, deliberate)

The `Violation['rule']` union used dielime's internal register numbers (`R3.7`, `R3.8`, `R4.3`,
`R5.1`–`R5.6`, `#15442`), which mean nothing outside that repo. Renamed to stable slugs:

| old | new |
|---|---|
| R3.7 | `service-name-unique` |
| R3.8 | `route-namespace` |
| #15442 | `loader-index` (message still cites medusajs/medusa#15442) |
| R4.3 | `duplicate-query-step` |
| R5.1 | `route-mutation` |
| R5.2 | `step-retry` |
| R5.3 | `route-shadow` |
| R5.4 | `subscriber-id` |
| R5.5 | `named-when` |
| R5.6 | `step-compensation` |

Violation messages and doc comments were scrubbed of the internal plan codes (P18, P60, H111, P75,
S47, R2.1, "oxlint alpha") and now explain each rule on its own terms. Upstream Medusa source
references (`transformModules`, `routes-loader.ts`, `resource-loader.ts`, `create-step.ts`,
`orchestrator-builder.ts`) were kept — minus source line numbers, which drift with Medusa releases.
The Medusa-specific rule semantics are untouched: that specificity is the product.

### scan.ts — the two genericizations with behavior consequences

1. **`pkgNameForFile` no longer hardcodes dielime's layout.** Source logic: a path segment
   `medusa-plugins` → `@dielime/<name>`, `apps/<name>` → `app:<name>`, else relative path. New
   logic (still pure, positional): `apps/<name>` → `app:<name>`, root `src/` → `app:root`, else
   the dir path up to the `src` segment (e.g. `packages/b2b`). The route-namespace rule's "is this
   a plugin?" test changed from `/^@dielime\//` to `!pkg.startsWith('app:')`.
   *Semantic delta:* in dielime, only `packages/medusa-plugins/*` were namespace-checked
   (`medusa-providers/*` fell through to the relative-path fallback and was exempt). Now
   **everything under `packages/` is namespace-checked**. Broader, defensible for a generic tool,
   documented in the README. Verified no false positives on dielime itself (see Verification).
2. **Scan roots.** Source scanned `packages/` (modules, workflows) and `packages/`+`apps/`
   (routes, loader files). Now all four collectors scan `packages/`, `apps/`, **and a root-level
   `src/`** — so a plain single-app Medusa project (the common non-monorepo layout) is scannable.
   Root-`src` files get pkg `app:root`.

### Workflow factory names: hardcoded → configurable

The source regexes hardcoded dielime's two project helpers
(`createScheduledWorkflow`, `createCartMutatingWorkflow`) next to `createWorkflow` in three places
(collectWorkflowSources, duplicate-query-step, loader-index). Hardcoding another project's wrapper
names into a published tool is wrong, and silently dropping them would blind the workflow rules to
wrapped factories. Resolution: `DEFAULT_WORKFLOW_FACTORIES = ['createWorkflow']` plus a repeatable
`--workflow-factory <name>` CLI flag / `VerifyArchOptions.workflowFactories`, threaded through
`runVerifyArch` → scanner and the two rules. New tests cover the wrapper path.

### CLI

- Shebang `#!/usr/bin/env -S node --import tsx` → `#!/usr/bin/env node` (compiled JS).
- Added `--help` and `--workflow-factory` parsing; unknown flags exit 2. Positional root arg and
  exit-code contract (0 clean / 1 violations) unchanged.
- PASS line now lists the new rule slugs instead of R-numbers.

### index.ts barrel

The source barrel exported only the four original rules; the six hygiene/write-baseline checks
were never exported (only wired into `runVerifyArch`). The standalone barrel exports all ten
checks plus `deriveRoutePath`, `pkgNameForFile`, `scanRoots`, `workflowFactoryRegex` — a library
consumer can compose a subset.

### Tests / fixture scrub

All 7 test files carried over with logic intact; fixtures scrubbed:

- `@dielime/b2b|a|b|search|procurement` → `packages/...` pkg ids; `app:backend` kept; `app:root`
  cases added.
- `hooks/aftership` (real vendor) → `hooks/shipping`; the `easypost` provider-fallback test
  replaced by the new fallback semantics test.
- dielime domain vocabulary in write-baseline fixtures (`createCertificates`, `updateLoadPlans`,
  `listScenarios`, `retrieveLoadPlan`) → neutral commerce vocabulary (`createInvoices`,
  `updateOrders`, `listDrafts`, `retrieveOrder`). Same syntactic shapes, so the rules are exercised
  identically. `/cs/tickets` → `/support/tickets`.
- `company`/`quote`/`approval`/`tickets` service names kept — generic commerce terms, no client
  reference.
- New tests: wrapper-factory cases for `duplicate-query-step` and `loader-index`; nested package
  group and root-`src` cases for `pkgNameForFile`; `app:root` exemption for `route-namespace`.
- No `/Users/` paths, `dielime`, `buketi`, or client names existed in the test fixtures beyond the
  above; final grep over the staged tree confirms zero hits.

### Added files

`README.md`, `LICENSE` (MIT), `.github/workflows/ci.yml` (ubuntu-latest, Node 22,
install/test/typecheck/build), `.gitignore`, `tsconfig.build.json`, this file.

## Judgment calls (the ones worth arguing about)

1. **Compiled bin over tsx-shebang bin.** Costs a build step; buys `npx verify-arch` with zero
   runtime deps. Clearly right for a published CLI.
2. **Rule-id rename is a breaking change vs the workspace package.** Since nothing outside dielime
   ever consumed the old ids, 0.1.0 is the moment to do it.
3. **Namespacing scope broadened** (all of `packages/`, not just a `medusa-plugins/` group). The
   alternative — a config knob for "which dirs are plugins" — is more machinery than the check
   warrants at 0.1.0. If real-world layouts complain, add the knob then.
4. **`route-namespace` uniqueness vs `route-shadow` overlap kept as-is.** The source ran both (path
   collision reported path-level by one, path+method-level by the other). Deduplicating them is a
   behavior change I didn't make in an extraction.
5. **Kept the regex-heuristic approach** rather than upgrading to ts-morph/TS API. It is the
   package's stated design (fast, zero-dep, works on build output), and the README owns the limits.
6. **vitest pinned `^3.2.4`** (resolved 3.2.7, green). The monorepo's own catalog notes vitest 4
   broke unrelated stubbing behavior there; nothing in this package touches that, but 3.x is the
   version the suite was written against.

## Verification (all run in staging)

- `vitest run`: **7 files, 48 tests, all pass** (source suite was 46; +2 new wrapper/`app:root`
  tests, restructured pkgNameForFile cases).
- `tsc --noEmit`: clean. `npm run build`: clean, dist emitted with declarations.
- Compiled CLI smoke-tested against two synthetic fixture repos: a clean single-app layout
  (PASS, exit 0) and a dirty monorepo seeding 6 violation classes — all detected
  (service-name-unique ×2, route-namespace ×2, loader-index, duplicate-query-step ×2,
  route-mutation, route-shadow, subscriber-id; exit 1).
- **Parity check against the origin:** `node dist/cli.js <dielime-root> --workflow-factory
  createScheduledWorkflow --workflow-factory createCartMutatingWorkflow` → PASS, exit 0 — matching
  the in-repo gate's result, and confirming the genericized pkg logic introduces no false positives
  on the codebase the tool was born in.

## How dielime would consume the published package later

1. Delete `packages/verify-arch/` from the monorepo.
2. In the workspace root `package.json`: add `"verify-arch": "^0.1.0"` to devDependencies and
   change the gate script to
   `"verify:arch": "verify-arch . --workflow-factory createScheduledWorkflow --workflow-factory createCartMutatingWorkflow"`.
3. Anything importing `@dielime/verify-arch` programmatically imports `verify-arch` instead —
   same function names; only `Violation['rule']` values changed (R-numbers → slugs), so any code
   matching on rule ids updates per the table above.
4. Turbo: drop the workspace task entries for the old package; the gate becomes a plain script.
5. Optional: keep a repo-local wrapper script if the R-number vocabulary is still wanted in CI
   logs; otherwise the slugs are self-describing.
