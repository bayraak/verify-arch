import { describe, expect, it } from 'vitest'

import { checkLoaderIndexSideEffects } from './loader-index-side-effects.js'

describe('checkLoaderIndexSideEffects (medusajs/medusa#15442)', () => {
  it('flags a workflows/index.ts that calls createWorkflow', () => {
    const out = checkLoaderIndexSideEffects([
      {
        file: '/p/src/workflows/index.ts',
        kind: 'workflow',
        source: `export const wf = createWorkflow('x', () => {})`,
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.rule).toBe('loader-index')
    expect(out[0]?.message).toContain('SKIPPED')
  })

  it('flags a workflows/index.ts that registers a hook', () => {
    const out = checkLoaderIndexSideEffects([
      {
        file: '/p/src/workflows/index.ts',
        kind: 'workflow',
        source: `completeCartWorkflow.hooks.validate(async () => {})`,
      },
    ])
    expect(out).toHaveLength(1)
  })

  it('flags a workflows/index.ts using a configured wrapper factory', () => {
    const out = checkLoaderIndexSideEffects(
      [
        {
          file: '/p/src/workflows/index.ts',
          kind: 'workflow',
          source: `export const wf = createScheduledWorkflow('x', () => {})`,
        },
      ],
      ['createWorkflow', 'createScheduledWorkflow'],
    )
    expect(out).toHaveLength(1)
  })

  it('does NOT flag a pure re-export barrel index.ts', () => {
    const out = checkLoaderIndexSideEffects([
      {
        file: '/p/src/workflows/index.ts',
        kind: 'workflow',
        source: `export * from './production-order'\nexport * from './supplier-cost'`,
      },
    ])
    expect(out).toEqual([])
  })

  it('does NOT flag a non-index workflow file with side-effects', () => {
    const out = checkLoaderIndexSideEffects([
      {
        file: '/p/src/workflows/create-thing.ts',
        kind: 'workflow',
        source: `export const wf = createWorkflow('x', () => {})`,
      },
    ])
    expect(out).toEqual([])
  })

  it('flags a subscribers/index.ts with a SubscriberConfig', () => {
    const out = checkLoaderIndexSideEffects([
      {
        file: '/p/src/subscribers/index.ts',
        kind: 'subscriber',
        source: `export const config: SubscriberConfig = { event: 'order.placed' }`,
      },
    ])
    expect(out).toHaveLength(1)
  })

  it('flags a jobs/index.ts with a config.schedule', () => {
    const out = checkLoaderIndexSideEffects([
      {
        file: '/p/src/jobs/index.ts',
        kind: 'job',
        source: `export const config = { name: 'x', schedule: '0 0 * * *' }`,
      },
    ])
    expect(out).toHaveLength(1)
  })

  it('does NOT flag a jobs/index.ts that is a pure barrel', () => {
    const out = checkLoaderIndexSideEffects([
      { file: '/p/src/jobs/index.ts', kind: 'job', source: `export * from './nightly'` },
    ])
    expect(out).toEqual([])
  })
})
