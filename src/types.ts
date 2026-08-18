/**
 * Shared types for the whole-graph architecture gate.
 *
 * The rules are PURE functions over already-collected inputs (file path +
 * source text). The fs walk lives in `scan.ts`; keeping the rules pure makes
 * each one unit-testable with hand-built inputs and no disk I/O.
 */

/** Stable machine-readable rule ids (one per check). */
export type RuleId =
  | 'duplicate-query-step'
  | 'loader-index'
  | 'named-when'
  | 'route-mutation'
  | 'route-namespace'
  | 'route-shadow'
  | 'service-name-unique'
  | 'step-compensation'
  | 'step-retry'
  | 'subscriber-id'

/**
 * Workflow factory names the scanner and rules treat as "this call defines a
 * workflow". `createWorkflow` is Medusa's own; projects that wrap it (e.g. a
 * `createScheduledWorkflow` helper) can add their wrapper names via
 * `--workflow-factory` / `VerifyArchOptions.workflowFactories`.
 */
export const DEFAULT_WORKFLOW_FACTORIES = ['createWorkflow']

/** Options accepted by `runVerifyArch` and the CLI. */
export interface VerifyArchOptions {
  /** Extra workflow factory names IN ADDITION to `createWorkflow`. */
  workflowFactories?: string[]
}

/** One module's joiner identity, as collected from a `Module(NAME, ...)` index.ts. */
export interface ModuleDecl {
  /** Absolute path of the module's `index.ts` (for the error message). */
  file: string
  /** The serviceName string literal passed as the first arg to `Module(...)`. */
  serviceName: string
}

/** One API route file, as collected from an `api/**\/route.ts`. */
export interface RouteFile {
  /** Absolute path of the `route.ts`. */
  file: string
  /**
   * The owning package id. Positional: `app:<name>` for files under `apps/<name>`,
   * `app:root` for a root-level `src/`, else the package dir path up to `src`
   * (e.g. `packages/b2b`). Routes whose pkg starts with `app:` are the project
   * root's own routes and are exempt from the namespacing check.
   */
  pkg: string
  /**
   * The route path the Medusa routes-loader derives: the file path relative to
   * the package's `src/api/`, minus the trailing `route.ts`, with
   * `[param]` -> `:param` (routes-loader.ts @ medusajs/medusa). E.g.
   * `admin/b2b/quotes/[id]` -> `/admin/b2b/quotes/:id`.
   */
  routePath: string
  /** Raw source text (the route-mutation rule greps it; optional for pure-path callers). */
  source?: string
}

/** One file under a loader-scanned dir (workflows/subscribers/jobs). */
export interface LoaderFile {
  /** Absolute path. */
  file: string
  /** The loader resource kind, from the nearest `workflows|subscribers|jobs` ancestor dir. */
  kind: 'job' | 'subscriber' | 'workflow'
  /** Raw source text (the rule greps it for side-effects). */
  source: string
}

/** A single workflow body, for the duplicate-step rule. */
export interface WorkflowSource {
  /** Absolute path. */
  file: string
  /** Raw source text of the file containing one-or-more `createWorkflow` bodies. */
  source: string
}

/** A rule finding. `rule` is the stable id; `message` is human-facing. */
export interface Violation {
  file: string
  message: string
  rule: RuleId
}
