import type { RouteFile, Violation } from '../types.js'

/**
 * Rule `route-namespace` — plugin API route namespacing + cross-plugin path
 * uniqueness.
 *
 * Medusa's routes-loader keys routes in a `#routes[matcher][method]` map and
 * does a plain last-write-wins assignment (routes-loader.ts @ medusajs/medusa)
 * — a cross-plugin route-path collision is UNDETECTED: the second plugin's
 * handler silently clobbers the first. Two invariants close this:
 *
 *  1. NAMESPACING: every plugin route lives under `/store/<ns>/*` or
 *     `/admin/<ns>/*` where `<ns>` is the plugin's namespace. A bare
 *     `/store/<leaf>` (no namespace segment) is a collision magnet.
 *  2. UNIQUENESS: no two route files across ALL packages derive the same route
 *     path (the loader would last-win one away).
 *
 * The app's own `src/api` (pkg `app:*`) is allowed any path (it is the project
 * root, not a plugin); only package routes are namespace-checked. Uniqueness
 * is checked across everything.
 *
 * Pure: takes the collected `RouteFile[]`.
 */
const isPluginPkg = (pkg: string): boolean => !pkg.startsWith('app:')

export function checkRouteNamespacing(routes: RouteFile[]): Violation[] {
  const violations: Violation[] = []

  // 1. Namespacing — plugin routes must be /store/<ns>/* or /admin/<ns>/*.
  for (const r of routes) {
    if (!isPluginPkg(r.pkg)) {
      continue // app-root routes are unconstrained
    }
    const segments = r.routePath.split('/').filter(Boolean)
    // segments[0] = store | admin ; segments[1] = the namespace ; segments[2+] = leaf
    const scope = segments[0]
    if (scope !== 'store' && scope !== 'admin') {
      violations.push({
        rule: 'route-namespace',
        file: r.file,
        message: `Plugin route '${r.routePath}' must be scoped under /store or /admin.`,
      })
      continue
    }
    if (segments.length < 2) {
      violations.push({
        rule: 'route-namespace',
        file: r.file,
        message:
          `Plugin route '${r.routePath}' has no namespace segment — it must be ` +
          `/${scope}/<plugin-namespace>/* ; a bare /${scope}/<leaf> collides cross-plugin.`,
      })
    }
  }

  // 2. Uniqueness — no two route files derive the same path.
  const byPath = new Map<string, RouteFile[]>()
  for (const r of routes) {
    const group = byPath.get(r.routePath) ?? []
    group.push(r)
    byPath.set(r.routePath, group)
  }
  for (const [routePath, group] of byPath) {
    if (group.length < 2) {
      continue
    }
    for (const r of group) {
      const others = group
        .filter((g) => g.file !== r.file)
        .map((g) => `${g.pkg} (${g.file})`)
        .join(', ')
      violations.push({
        rule: 'route-namespace',
        file: r.file,
        message:
          `Route path '${routePath}' collides cross-plugin — also defined by: ${others}. ` +
          `The routes-loader map is last-write-wins; one handler silently clobbers the other.`,
      })
    }
  }

  return violations
}
