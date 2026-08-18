import type { LoaderFile, RouteFile, Violation, WorkflowSource } from '../types.js'

/**
 * HYGIENE rules — three source-study truths about Medusa's loaders and
 * composer, turned into gates:
 *
 * `route-shadow` — ROUTE SHADOWING IS SILENT upstream (routes-loader: same
 * derived path + method, core → plugins → app-as-last-plugin, LAST WINS with no
 * warning). Two packages registering the same (path, method) means one of them
 * silently vanishes. Deliberate overrides carry
 * `// arch:route-override-ok(<reason>)` in the overriding file.
 *
 * `subscriber-id` — SUBSCRIBER IDS ARE INFERRED from function/file names when
 * `config.context.subscriberId` is missing (subscriber-loader) — a collision
 * across a plugin fleet dedupes handlers silently. Every subscriber declares
 * one explicitly.
 *
 * `named-when` — UNNAMED `when()` derives a nondeterministic `when-then-{ulid}`
 * step name (composer/when) — checkpoint identity can drift across
 * processes/releases. Every `when()` uses the named overload:
 * `when('name', values, cond)`.
 */

const ROUTE_OVERRIDE_OK = /arch:route-override-ok\(/

export function checkRouteShadowing(routes: RouteFile[]): Violation[] {
  const violations: Violation[] = []
  const byPath = new Map<string, RouteFile[]>()
  for (const route of routes) {
    const group = byPath.get(route.routePath) ?? []
    group.push(route)
    byPath.set(route.routePath, group)
  }
  const METHOD_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b|export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=/g
  for (const [path, group] of byPath) {
    if (group.length < 2) {
      continue
    }
    // same derived path from >1 package — flag per shared METHOD
    const methodsByFile = group.map((route) => {
      const methods = new Set<string>()
      METHOD_RE.lastIndex = 0
      let match: null | RegExpExecArray
      while ((match = METHOD_RE.exec(route.source ?? '')) !== null) {
        methods.add((match[1] ?? match[2]) as string)
      }
      return { methods, route }
    })
    for (let i = 0; i < methodsByFile.length; i++) {
      for (let j = i + 1; j < methodsByFile.length; j++) {
        const a = methodsByFile[i] as (typeof methodsByFile)[number]
        const b = methodsByFile[j] as (typeof methodsByFile)[number]
        if (a.route.pkg === b.route.pkg) {
          continue // same package duplicating a path is the loader's own collision problem
        }
        const shared = [...a.methods].filter((m) => b.methods.has(m))
        if (shared.length === 0) {
          continue
        }
        const overrideOk = ROUTE_OVERRIDE_OK.test(a.route.source ?? '') || ROUTE_OVERRIDE_OK.test(b.route.source ?? '')
        if (overrideOk) {
          continue
        }
        violations.push({
          rule: 'route-shadow',
          file: b.route.file,
          message:
            `Route ${shared.join('/')} ${path} is defined by BOTH ${a.route.pkg} and ${b.route.pkg} — ` +
            `Medusa's loader silently last-wins (core → plugins → app). Rename one, or annotate the ` +
            `deliberate override with // arch:route-override-ok(<reason>).`,
        })
      }
    }
  }
  return violations
}

export function checkSubscriberIds(loaderFiles: LoaderFile[]): Violation[] {
  const violations: Violation[] = []
  for (const file of loaderFiles) {
    if (file.kind !== 'subscriber') {
      continue
    }
    if (!/export\s+const\s+config\s*[:=]/.test(file.source)) {
      continue // not a subscriber definition file (helper/barrel)
    }
    if (!/subscriberId\s*:/.test(file.source)) {
      violations.push({
        rule: 'subscriber-id',
        file: file.file,
        message:
          `Subscriber has no explicit config.context.subscriberId — Medusa infers ids from ` +
          `function/file names, which collide silently across a plugin fleet.`,
      })
    }
  }
  return violations
}

const WHEN_CALL = /\bwhen\s*\(\s*([^)]?)/g

export function checkNamedWhen(sources: WorkflowSource[]): Violation[] {
  const violations: Violation[] = []
  for (const src of sources) {
    // scan CODE only — `when()` inside comments/docs must not trip the rule
    const code = src.source.replaceAll(/\/\/[^\n]*/g, '').replaceAll(/\/\*[\s\S]*?\*\//g, '')
    WHEN_CALL.lastIndex = 0
    let match: null | RegExpExecArray
    while ((match = WHEN_CALL.exec(code)) !== null) {
      const firstChar = match[1]
      if (firstChar === "'" || firstChar === '"' || firstChar === '`') {
        continue // named overload
      }
      violations.push({
        rule: 'named-when',
        file: src.file,
        message:
          `when() without a name derives a nondeterministic when-then-{ulid} step name — ` +
          `checkpoint identity can drift across processes/releases. Use ` +
          `when('stable-name', values, condition).`,
      })
    }
  }
  return violations
}
