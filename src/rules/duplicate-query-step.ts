import { workflowFactoryRegex } from '../scan.js'
import { DEFAULT_WORKFLOW_FACTORIES } from '../types.js'
import type { Violation, WorkflowSource } from '../types.js'

/**
 * Rule `duplicate-query-step` — duplicate `useQueryGraphStep` must carry a
 * unique `.config({ name })`.
 *
 * Two un-named `useQueryGraphStep` (or `useRemoteQueryStep`) calls in ONE
 * `createWorkflow` body SILENTLY collide: the step-handler Map last-wins
 * (create-step.ts @ medusajs/medusa) and the orchestrator appends a duplicate
 * action with no dedupe (orchestrator-builder.ts) — no thrown error, no
 * message. A unique `.config({ name })` on each is the only safeguard. This is
 * expressible as a per-file lint rule too; the gate carries it so a single
 * command proves the invariant repo-wide, independent of the lint stack.
 *
 * Static heuristic (no full TS parse): for each `createWorkflow` callsite,
 * isolate its callback body by brace-matching, find every
 * `useQueryGraphStep(...)` / `useRemoteQueryStep(...)`, and for each check
 * whether a `.config({ name: "..." })` is chained to THAT call. When a body has
 * >1 such step, each must have a `.config({ name })` and the names must be
 * unique. Conservative: only flags when it can confidently read >1 step.
 *
 * Pure: takes the collected `WorkflowSource[]`.
 */
const STEP_CALL = /\b(useQueryGraphStep|useRemoteQueryStep)\s*\(/g

export function checkDuplicateQueryStep(
  sources: WorkflowSource[],
  factories: string[] = DEFAULT_WORKFLOW_FACTORIES,
): Violation[] {
  const violations: Violation[] = []
  const factoryRe = workflowFactoryRegex(factories)
  for (const src of sources) {
    violations.push(...checkOneFile(src, factoryRe))
  }
  return violations
}

function checkOneFile(src: WorkflowSource, factoryRe: RegExp): Violation[] {
  const violations: Violation[] = []
  const bodies = extractWorkflowBodies(src.source, factoryRe)
  for (const body of bodies) {
    const steps = extractStepConfigs(body)
    if (steps.length < 2) {
      continue
    }
    const seenNames = new Set<string>()
    for (const step of steps) {
      if (step.name === undefined) {
        violations.push({
          rule: 'duplicate-query-step',
          file: src.file,
          message:
            `A workflow body has ${steps.length} ${step.kind} calls but at least one has no ` +
            `.config({ name }) — duplicate steps silently last-win (create-step.ts handler Map). ` +
            `Give every duplicate query step a unique .config({ name }).`,
        })
        continue
      }
      if (seenNames.has(step.name)) {
        violations.push({
          rule: 'duplicate-query-step',
          file: src.file,
          message:
            `Two query steps in one workflow share .config({ name: '${step.name}' }) — ` +
            `names must be unique.`,
        })
      }
      seenNames.add(step.name)
    }
  }
  return violations
}

/** Isolate each workflow-factory callback body via brace matching. */
function extractWorkflowBodies(source: string, factoryRe: RegExp): string[] {
  const bodies: string[] = []
  factoryRe.lastIndex = 0
  let match: null | RegExpExecArray
  while ((match = factoryRe.exec(source)) !== null) {
    // Find the callback `function (...) { ... }` or `(...) => { ... }` after the
    // factory's first arg. We brace-match from the FIRST `{` that follows the
    // factory call's open paren and belongs to a function body. Pragmatic: scan
    // forward from the match to the first `{` that opens a block, then balance.
    const open = source.indexOf('{', match.index)
    if (open === -1) {
      continue
    }
    const body = balanceBraces(source, open)
    if (body !== null) {
      bodies.push(body)
    }
  }
  return bodies
}

/** Return the substring from `openIndex` (a `{`) to its matching `}`, inclusive. */
function balanceBraces(source: string, openIndex: number): null | string {
  let depth = 0
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return source.slice(openIndex, i + 1)
      }
    }
  }
  return null
}

interface StepConfig {
  kind: string
  name: string | undefined
}

/** Find each query-step call in a body and read its chained `.config({ name })`. */
function extractStepConfigs(body: string): StepConfig[] {
  const steps: StepConfig[] = []
  STEP_CALL.lastIndex = 0
  let match: null | RegExpExecArray
  while ((match = STEP_CALL.exec(body)) !== null) {
    const kind = match[1] ?? 'useQueryGraphStep'
    // The step call's arg list, then the trailing chain up to the next `;` or
    // newline-terminated statement. Read a generous window after the call to
    // catch `.config({ name: '...' })`.
    const afterArgs = closeCallParen(body, match.index + match[0].length - 1)
    if (afterArgs === -1) {
      steps.push({ kind, name: undefined })
      continue
    }
    const tail = body.slice(afterArgs, afterArgs + 200)
    const cfg = /^\s*\.config\s*\(\s*\{[^}]*?\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(tail)
    steps.push({ kind, name: cfg ? cfg[1] : undefined })
  }
  return steps
}

/** Given the index of a `(`, return the index just AFTER its matching `)`. */
function closeCallParen(body: string, openParenIndex: number): number {
  let depth = 0
  for (let i = openParenIndex; i < body.length; i++) {
    const ch = body[i]
    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) {
        return i + 1
      }
    }
  }
  return -1
}
