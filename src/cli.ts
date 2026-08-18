#!/usr/bin/env node
import { relative, resolve } from 'node:path'
import process from 'node:process'

import { runVerifyArch } from './run.js'

const RULES =
  'service-name-unique, route-namespace, loader-index, duplicate-query-step, ' +
  'route-mutation, step-retry, step-compensation, route-shadow, subscriber-id, named-when'

const USAGE = `verify-arch — whole-graph architecture gate for Medusa 2.x codebases

Usage:
  verify-arch [rootDir] [--workflow-factory <name>]...

  rootDir                     project root to scan (default: cwd). Scans
                              packages/, apps/, and a root-level src/.
  --workflow-factory <name>   an extra workflow-factory function name your
                              project uses to wrap createWorkflow (repeatable).
  -h, --help                  this text.

Checks: ${RULES}
Exits 0 when clean, 1 with a violation list otherwise.
`

interface CliArgs {
  repoRoot: string
  workflowFactories: string[]
}

function parseArgs(argv: string[]): CliArgs {
  const workflowFactories: string[] = []
  let root: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE)
      process.exit(0)
    }
    if (arg === '--workflow-factory') {
      const name = argv[++i]
      if (!name || name.startsWith('-')) {
        process.stderr.write('verify-arch: --workflow-factory needs a function name\n')
        process.exit(2)
      }
      workflowFactories.push(name)
      continue
    }
    if (arg.startsWith('-')) {
      process.stderr.write(`verify-arch: unknown flag '${arg}'\n\n${USAGE}`)
      process.exit(2)
    }
    if (root !== undefined) {
      process.stderr.write('verify-arch: more than one rootDir given\n')
      process.exit(2)
    }
    root = arg
  }
  return { repoRoot: resolve(root ?? process.cwd()), workflowFactories }
}

function main(): void {
  const { repoRoot, workflowFactories } = parseArgs(process.argv.slice(2))
  const violations = runVerifyArch(repoRoot, { workflowFactories })

  if (violations.length === 0) {
    process.stdout.write(`verify-arch — PASS (${RULES})\n`)
    process.exit(0)
  }

  process.stderr.write(`verify-arch — FAIL: ${violations.length} violation(s)\n\n`)
  for (const v of violations) {
    const rel = relative(repoRoot, v.file)
    process.stderr.write(`  [${v.rule}] ${rel}\n    ${v.message}\n\n`)
  }
  process.exit(1)
}

main()
