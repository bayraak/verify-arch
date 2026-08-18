import { checkDuplicateQueryStep } from './rules/duplicate-query-step.js'
import { checkLoaderIndexSideEffects } from './rules/loader-index-side-effects.js'
import { checkRouteNamespacing } from './rules/route-namespacing.js'
import { checkServiceNameUnique } from './rules/service-name-unique.js'
import {
  checkNamedWhen,
  checkRouteShadowing,
  checkSubscriberIds,
} from './rules/hygiene-baseline.js'
import {
  checkMutatingStepsCompensation,
  checkMutatingStepsDeclareRetry,
  checkRouteMutationsViaWorkflows,
} from './rules/write-baseline.js'
import {
  collectLoaderFiles,
  collectModuleDecls,
  collectRoutes,
  collectWorkflowSources,
} from './scan.js'
import { DEFAULT_WORKFLOW_FACTORIES } from './types.js'
import type { VerifyArchOptions, Violation } from './types.js'

/**
 * Run every whole-graph rule over the repo at `repoRoot` and return the
 * combined violation list (the CLI maps a non-empty list to exit code 1).
 */
export function runVerifyArch(repoRoot: string, options: VerifyArchOptions = {}): Violation[] {
  const factories = [
    ...new Set([...DEFAULT_WORKFLOW_FACTORIES, ...(options.workflowFactories ?? [])]),
  ]

  const modules = collectModuleDecls(repoRoot)
  const routes = collectRoutes(repoRoot)
  const loaderFiles = collectLoaderFiles(repoRoot)
  const workflowSources = collectWorkflowSources(repoRoot, factories)

  return [
    ...checkServiceNameUnique(modules),
    ...checkRouteNamespacing(routes),
    ...checkLoaderIndexSideEffects(loaderFiles, factories),
    ...checkDuplicateQueryStep(workflowSources, factories),
    ...checkRouteMutationsViaWorkflows(routes),
    ...checkMutatingStepsDeclareRetry(workflowSources),
    ...checkMutatingStepsCompensation(workflowSources),
    ...checkRouteShadowing(routes),
    ...checkSubscriberIds(loaderFiles),
    ...checkNamedWhen(workflowSources),
  ]
}
