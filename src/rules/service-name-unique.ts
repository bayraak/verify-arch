import type { ModuleDecl, Violation } from '../types.js'

/**
 * Rule `service-name-unique` — globally-unique module `serviceName`.
 *
 * Every Medusa module's joiner identity is its `serviceName` — the FIRST arg to
 * `Module(serviceName, { service })`. At config merge (`transformModules`,
 * @medusajs/medusa) two modules with the same `serviceName` SILENTLY last-win:
 * the second registration overwrites the first in the module registry, with no
 * thrown error and no warning. In a codebase with many modules a stray
 * duplicate silently drops a whole module's service. A per-file linter cannot
 * see another file's `serviceName`, so this is a whole-graph check.
 *
 * Pure: takes the collected `ModuleDecl[]` and returns one Violation per
 * collision group (every file that shares a colliding name is reported).
 */
export function checkServiceNameUnique(modules: ModuleDecl[]): Violation[] {
  const byName = new Map<string, ModuleDecl[]>()
  for (const m of modules) {
    const group = byName.get(m.serviceName) ?? []
    group.push(m)
    byName.set(m.serviceName, group)
  }

  const violations: Violation[] = []
  for (const [serviceName, group] of byName) {
    if (group.length < 2) {
      continue
    }
    // Report every file in the collision group so the fix is unambiguous.
    for (const m of group) {
      const others = group
        .filter((g) => g.file !== m.file)
        .map((g) => g.file)
        .join(', ')
      violations.push({
        rule: 'service-name-unique',
        file: m.file,
        message:
          `Module serviceName '${serviceName}' is not globally unique — also declared in: ${others}. ` +
          `Colliding serviceNames silently last-win at config merge (transformModules); rename one.`,
      })
    }
  }
  return violations
}
