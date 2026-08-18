import { basename } from 'node:path'

import { DEFAULT_WORKFLOW_FACTORIES } from '../types.js'
import type { LoaderFile, Violation } from '../types.js'

/**
 * Rule `loader-index` — no loader-side-effect file named `index.ts`
 * (medusajs/medusa#15442).
 *
 * Medusa's `ResourceLoader.discoverResources` (resource-loader.ts @
 * medusajs/medusa, the base for WorkflowLoader / SubscriberLoader / JobLoader)
 * filters discovered files with `parsedName.name !== "index"` — so ANY file
 * literally named `index.ts` (or `index.js`) inside a `workflows/`,
 * `subscribers/`, or `jobs/` dir is SILENTLY SKIPPED by auto-discovery. The
 * workflow / subscriber / cron it defines is then only registered if some OTHER
 * (loader-discovered) file happens to import it — a fragile, latent #15442 trap.
 *
 * A pure re-export BARREL named `index.ts` is fine (and idiomatic — it is the
 * package's `exports` entry, never meant to be loader-discovered). The rule
 * flags only `index.ts` files that carry a loader-relevant SIDE EFFECT:
 *   - workflows: `createWorkflow` (plus any configured wrapper factories) /
 *     `createStep` / `createHook` / `.hooks.<name>` hook registrations.
 *   - subscribers: a `SubscriberConfig` / `config.event` export.
 *   - jobs: a `config.schedule` export.
 *
 * Detection is a source grep (the gate runs over built and source trees; a
 * heavier AST parse buys nothing here — these tokens are unambiguous markers).
 *
 * Pure: takes the collected `LoaderFile[]`.
 */
function sideEffectMarker(kind: LoaderFile['kind'], factories: string[]): RegExp {
  // `createHook(` and `.hooks.<name>(` both define hook side-effects; wrapper
  // factories wrap createWorkflow. Word-boundary anchored to avoid matching
  // substrings inside identifiers/comments referencing the token by name.
  switch (kind) {
    case 'workflow':
      return new RegExp(
        `\\b(${[...new Set([...factories, 'createStep', 'createHook'])].join('|')})\\s*\\(|\\.hooks\\.[A-Za-z_$]`,
      )
    case 'subscriber':
      return /\bSubscriberConfig\b|\bconfig\b[\s\S]{0,80}\bevent\s*:/
    case 'job':
      return /\bconfig\b[\s\S]{0,80}\bschedule\s*:/
  }
}

export function checkLoaderIndexSideEffects(
  files: LoaderFile[],
  factories: string[] = DEFAULT_WORKFLOW_FACTORIES,
): Violation[] {
  const violations: Violation[] = []
  for (const f of files) {
    const name = basename(f.file)
    if (name !== 'index.ts' && name !== 'index.js') {
      continue
    }
    const marker = sideEffectMarker(f.kind, factories)
    if (!marker.test(f.source)) {
      continue // pure barrel — safe
    }
    violations.push({
      rule: 'loader-index',
      file: f.file,
      message:
        `${f.kind} file named '${name}' carries a loader side-effect but is SKIPPED by ` +
        `Medusa's ResourceLoader auto-discovery (resource-loader.ts: parsedName.name !== "index", ` +
        `medusajs/medusa#15442). Rename it to a descriptive sibling (e.g. ./<name>.ts) and keep a ` +
        `re-export barrel at index.ts.`,
    })
  }
  return violations
}
