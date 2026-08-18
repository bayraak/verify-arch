import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { DEFAULT_WORKFLOW_FACTORIES } from './types.js'
import type { LoaderFile, ModuleDecl, RouteFile, WorkflowSource } from './types.js'

/**
 * The filesystem layer of the gate: walk the project and produce the pure
 * inputs the rules consume. Scans SOURCE trees; the .medusa/server build
 * output, node_modules, dist, and __tests__ are excluded so the gate reads
 * exactly one canonical copy of each artefact.
 *
 * Layouts supported:
 *  - monorepo: `packages/**` and `apps/**`
 *  - single Medusa app: a root-level `src/`
 */

const IGNORE_DIRS = new Set([
  'node_modules',
  '.medusa',
  'dist',
  '.next',
  '.turbo',
  'out',
  '__tests__',
  '.git',
])

/** The roots the gate scans, in a fixed order. Non-existent roots are skipped by walk(). */
export function scanRoots(repoRoot: string): string[] {
  return [join(repoRoot, 'packages'), join(repoRoot, 'apps'), join(repoRoot, 'src')]
}

/** Recursively list every file under `root`, skipping IGNORE_DIRS. */
export function walk(root: string): string[] {
  const out: string[] = []
  if (!existsSync(root)) {
    return out
  }
  const stack = [root]
  while (stack.length > 0) {
    const dir = stack.pop() as string
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) {
        continue
      }
      const full = join(dir, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
      } else {
        out.push(full)
      }
    }
  }
  return out
}

const isTestFile = (f: string): boolean =>
  f.endsWith('.test.ts') || f.endsWith('.spec.ts') || f.endsWith('.test.js')

/**
 * The package id owning a file path. Positional (pure — no package.json read):
 *  - `apps/<name>/...`      -> `app:<name>`
 *  - `src/...` (root app)   -> `app:root`
 *  - `packages/.../src/...` -> the dir path up to `src` (e.g. `packages/b2b`)
 *  - anything else          -> the containing dir path (fallback)
 * `app:*` packages are the project root; everything else is treated as a plugin
 * by the route-namespace rule.
 */
export function pkgNameForFile(repoRoot: string, file: string): string {
  const rel = relative(repoRoot, file)
  const parts = rel.split(sep)
  if (parts[0] === 'apps' && parts[1]) {
    return `app:${parts[1]}`
  }
  if (parts[0] === 'src') {
    return 'app:root'
  }
  const srcIdx = parts.indexOf('src')
  if (srcIdx > 0) {
    return parts.slice(0, srcIdx).join('/')
  }
  const dir = parts.slice(0, -1).join('/')
  return dir || rel
}

/** Collect every `Module(NAME, ...)` declaration's serviceName (service-name-unique). */
export function collectModuleDecls(repoRoot: string): ModuleDecl[] {
  const out: ModuleDecl[] = []
  for (const root of scanRoots(repoRoot)) {
    const files = walk(root).filter(
      (f) =>
        (f.endsWith(`${sep}index.ts`) || f.endsWith(`${sep}index.js`)) &&
        f.includes(`${sep}modules${sep}`) &&
        !f.includes(`${sep}models${sep}`) &&
        !isTestFile(f),
    )
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      // export default Module(SERVICE_NAME, { ... })  — read the first arg ident,
      // then resolve its string-literal `export const SERVICE_NAME = '...'`.
      const call = /\bModule\s*\(\s*([A-Za-z_$][\w$]*)\s*,/.exec(src)
      if (!call) {
        continue
      }
      const ident = call[1] as string
      const constRe = new RegExp(`\\b${ident}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`)
      const literal = constRe.exec(src)
      if (!literal) {
        continue
      }
      out.push({ serviceName: literal[1] as string, file })
    }
  }
  return out
}

/** Derive a Medusa route path from an `api/.../route.ts` file path (route-namespace). */
export function deriveRoutePath(apiRelative: string): string {
  // apiRelative is the path under `src/api/`, e.g. `admin/b2b/quotes/[id]/route.ts`.
  const segments = apiRelative
    .replace(/route\.(ts|js)$/, '')
    .split(sep)
    .filter(Boolean)
    .map((s) => (s.startsWith('[') ? `:${s.slice(1, -1)}` : s))
  return `/${segments.join('/')}`
}

/** Collect every `route.ts` and its derived path (route-namespace, route-shadow, route-mutation). */
export function collectRoutes(repoRoot: string): RouteFile[] {
  const out: RouteFile[] = []
  for (const root of scanRoots(repoRoot)) {
    const files = walk(root).filter(
      (f) =>
        (f.endsWith(`${sep}route.ts`) || f.endsWith(`${sep}route.js`)) &&
        f.includes(`${sep}api${sep}`) &&
        !isTestFile(f),
    )
    for (const file of files) {
      const apiIdx = file.lastIndexOf(`${sep}api${sep}`)
      const apiRelative = file.slice(apiIdx + `${sep}api${sep}`.length)
      out.push({
        file,
        routePath: deriveRoutePath(apiRelative),
        pkg: pkgNameForFile(repoRoot, file),
        source: readFileSync(file, 'utf8'),
      })
    }
  }
  return out
}

const LOADER_KIND: Record<string, LoaderFile['kind']> = {
  workflows: 'workflow',
  subscribers: 'subscriber',
  jobs: 'job',
}

/** Collect every file under a `workflows|subscribers|jobs` dir (loader-index, subscriber-id). */
export function collectLoaderFiles(repoRoot: string): LoaderFile[] {
  const out: LoaderFile[] = []
  for (const root of scanRoots(repoRoot)) {
    const files = walk(root).filter(
      (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !isTestFile(f) && !f.endsWith('.d.ts'),
    )
    for (const file of files) {
      const parts = file.split(sep)
      // The nearest loader-dir ancestor decides the kind.
      let kind: LoaderFile['kind'] | undefined
      for (let i = parts.length - 2; i >= 0; i--) {
        const k = LOADER_KIND[parts[i] as string]
        if (k) {
          kind = k
          break
        }
      }
      if (!kind) {
        continue
      }
      out.push({ file, kind, source: readFileSync(file, 'utf8') })
    }
  }
  return out
}

/** Build the "this call defines a workflow" regex from the factory-name list. */
export function workflowFactoryRegex(factories: string[]): RegExp {
  return new RegExp(`\\b(${factories.join('|')})\\s*\\(`, 'g')
}

/** Collect every source file that defines at least one workflow (duplicate-query-step, step-retry, step-compensation, named-when). */
export function collectWorkflowSources(
  repoRoot: string,
  factories: string[] = DEFAULT_WORKFLOW_FACTORIES,
): WorkflowSource[] {
  const out: WorkflowSource[] = []
  const factoryRe = workflowFactoryRegex(factories)
  for (const root of scanRoots(repoRoot)) {
    const files = walk(root).filter(
      (f) =>
        (f.endsWith('.ts') || f.endsWith('.js')) &&
        !isTestFile(f) &&
        f.includes(`${sep}workflows${sep}`),
    )
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      factoryRe.lastIndex = 0
      if (factoryRe.test(source)) {
        out.push({ file, source })
      }
    }
  }
  return out
}
