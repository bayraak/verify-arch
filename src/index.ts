// verify-arch — whole-graph architecture gate for Medusa 2.x codebases.
// Barrel: the pure rules, the scanner, and the runner that ties them together.

export * from './types.js'
export { checkServiceNameUnique } from './rules/service-name-unique.js'
export { checkRouteNamespacing } from './rules/route-namespacing.js'
export { checkLoaderIndexSideEffects } from './rules/loader-index-side-effects.js'
export { checkDuplicateQueryStep } from './rules/duplicate-query-step.js'
export {
  checkNamedWhen,
  checkRouteShadowing,
  checkSubscriberIds,
} from './rules/hygiene-baseline.js'
export {
  checkMutatingStepsCompensation,
  checkMutatingStepsDeclareRetry,
  checkRouteMutationsViaWorkflows,
} from './rules/write-baseline.js'
export {
  collectLoaderFiles,
  collectModuleDecls,
  collectRoutes,
  collectWorkflowSources,
  deriveRoutePath,
  pkgNameForFile,
  scanRoots,
  walk,
  workflowFactoryRegex,
} from './scan.js'
export { runVerifyArch } from './run.js'
