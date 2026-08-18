import type { RouteFile, Violation, WorkflowSource } from '../types.js'

/**
 * The WRITE BASELINE — three whole-graph rules that keep "everything on
 * workflows, retriable, revertable" true after the sweep that made it true:
 *
 * `route-mutation` — an `api/**\/route.ts` handler must not mutate a module
 * service directly (`svc.createX/updateX/deleteX/upsertX/softDeleteX/restoreX(...)`):
 * mutations exit through a workflow door (`someWorkflow(scope).run(...)`), which is
 * where compensation and retry live. A deliberate exception carries
 * `// arch:inline-mutation-ok(<reason>)` on the call's line or the line above.
 *
 * `step-retry` — a MUTATING workflow step (its invoke body calls a service
 * mutation) must declare a retry class: the object first arg
 * `createStep({ name, ...RETRY_X }|{ name, maxRetries }, …)`. Steps default to
 * maxRetries: 0, so a transient deadlock reverts real state a retry would have
 * absorbed. Read-only/compute steps are exempt.
 *
 * `step-compensation` — see checkMutatingStepsCompensation below.
 *
 * Static heuristics (regex + brace matching, no TS parse) — conservative:
 * only flag what confidently matches the mutation pattern.
 */

const MUTATION_CALL = /\.\s*(create|update|upsert|delete|softDelete|restore)[A-Z][A-Za-z]*\s*\(/g
const INLINE_OK = /arch:inline-mutation-ok\(/
const STEP_FACTORY = /\bcreateStep\s*\(/g

export function checkRouteMutationsViaWorkflows(routes: RouteFile[]): Violation[] {
  const violations: Violation[] = []
  for (const route of routes) {
    if (route.source === undefined) {
      continue
    }
    const lines = route.source.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string
      MUTATION_CALL.lastIndex = 0
      if (!MUTATION_CALL.test(line)) {
        continue
      }
      if (INLINE_OK.test(line) || (i > 0 && INLINE_OK.test(lines[i - 1] as string))) {
        continue
      }
      violations.push({
        rule: 'route-mutation',
        file: route.file,
        message:
          `Route handler mutates a service directly at line ${i + 1} (\`${line.trim().slice(0, 90)}\`) — ` +
          `mutations go through a workflow (compensation + retry live there). Wrap it in a workflow, or ` +
          `annotate \`// arch:inline-mutation-ok(<reason>)\` if the write is deliberately bare.`,
      })
    }
  }
  return violations
}

export function checkMutatingStepsDeclareRetry(sources: WorkflowSource[]): Violation[] {
  const violations: Violation[] = []
  for (const src of sources) {
    STEP_FACTORY.lastIndex = 0
    let match: null | RegExpExecArray
    while ((match = STEP_FACTORY.exec(src.source)) !== null) {
      const openParen = match.index + match[0].length - 1
      const call = balancedCall(src.source, openParen)
      if (call === null) {
        continue
      }
      const firstArg = call.slice(1).trimStart()
      MUTATION_CALL.lastIndex = 0
      if (!MUTATION_CALL.test(call)) {
        continue // read-only/compute step — no retry demanded
      }
      const isObjectForm = firstArg.startsWith('{')
      const declaresRetry = /\.\.\.\s*RETRY_[A-Z_]+|maxRetries\s*:/.test(
        isObjectForm ? firstArg.slice(0, firstArg.indexOf('}') + 1) : '',
      )
      if (!isObjectForm || !declaresRetry) {
        const name = /['"`]([^'"`]+)['"`]/.exec(firstArg)?.[1] ?? '<unnamed>'
        violations.push({
          rule: 'step-retry',
          file: src.file,
          message:
            `Mutating step '${name}' declares no retry class — steps default to maxRetries: 0, so a ` +
            `transient failure reverts real state. Use the object form: createStep({ name: '${name}', ` +
            `maxRetries: <n> }, …) or spread a shared retry preset (...RETRY_DB etc.).`,
        })
      }
    }
  }
  return violations
}

/**
 * `step-compensation` — a MUTATING step must either define a compensation
 * function (3rd createStep arg) or declare `noCompensation: true` in its object
 * config (the framework-blessed flag — Medusa's own core-flows use it, e.g.
 * revoke-api-keys). Honest non-compensation stays honest — but machine-readable.
 */
export function checkMutatingStepsCompensation(sources: WorkflowSource[]): Violation[] {
  const violations: Violation[] = []
  for (const src of sources) {
    STEP_FACTORY.lastIndex = 0
    let match: null | RegExpExecArray
    while ((match = STEP_FACTORY.exec(src.source)) !== null) {
      const openParen = match.index + match[0].length - 1
      const call = balancedCall(src.source, openParen)
      if (call === null) {
        continue
      }
      MUTATION_CALL.lastIndex = 0
      if (!MUTATION_CALL.test(call)) {
        continue // read-only/compute step
      }
      const firstArg = call.slice(1).trimStart()
      const declaresNoCompensation = firstArg.startsWith('{') && /noCompensation\s*:\s*true/.test(firstArg.slice(0, firstArg.indexOf('}') + 1))
      if (declaresNoCompensation) {
        continue
      }
      // a compensation fn = a 2nd top-level comma inside the call followed by async/function/arrow
      const hasCompensation = countTopLevelArgs(call) >= 3
      if (!hasCompensation) {
        const name = /['"`]([^'"`]+)['"`]/.exec(firstArg)?.[1] ?? '<unnamed>'
        violations.push({
          rule: 'step-compensation',
          file: src.file,
          message:
            `Mutating step '${name}' has neither a compensation function nor noCompensation: true — ` +
            `every write is revertable or HONESTLY flagged.`,
        })
      }
    }
  }
  return violations
}

/** The index of the last char of a `//` or `/* *​/` comment starting at `i`, or null when `i` isn't
 *  a comment start. */
function commentEnd(call: string, i: number): null | number {
  if (call[i] !== '/') {
    return null
  }
  if (call[i + 1] === '/') {
    const nl = call.indexOf('\n', i)
    return nl === -1 ? call.length : nl
  }
  if (call[i + 1] === '*') {
    const end = call.indexOf('*/', i + 2)
    return end === -1 ? call.length : end + 1
  }
  return null
}

/** Count top-level (depth-1) arguments of a balanced call string `(...)`.
 * String- AND comment-aware: an apostrophe inside a `//` comment must not flip string state
 * (that swallowed real compensation args on the first run of the compensation rule). */
function countTopLevelArgs(call: string): number {
  let depth = 0
  let args = 1
  let inString: null | string = null
  for (let i = 0; i < call.length; i++) {
    const ch = call[i] as string
    if (inString) {
      if (ch === inString && call[i - 1] !== '\\') {
        inString = null
      }
      continue
    }
    const skipTo = commentEnd(call, i)
    if (skipTo !== null) {
      i = skipTo
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch
    } else if (ch === '(' || ch === '{' || ch === '[') {
      depth++
    } else if (ch === ')' || ch === '}' || ch === ']') {
      depth--
    } else if (ch === ',' && depth === 1) {
      args++
    }
  }
  return args
}

/** The full \`(...)\` argument text of a call whose \`(\` is at \`openParenIndex\` — inclusive. */
function balancedCall(source: string, openParenIndex: number): null | string {
  let depth = 0
  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i]
    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) {
        return source.slice(openParenIndex, i + 1)
      }
    }
  }
  return null
}
