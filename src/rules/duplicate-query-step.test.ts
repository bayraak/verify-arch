import { describe, expect, it } from 'vitest'

import { checkDuplicateQueryStep } from './duplicate-query-step.js'

describe('checkDuplicateQueryStep', () => {
  it('passes when both duplicate steps have unique .config({ name })', () => {
    const source = `
      createWorkflow('w', function () {
        const a = useQueryGraphStep({ entity: 'customer' }).config({ name: 'get-customer' })
        const b = useQueryGraphStep({ entity: 'order' }).config({ name: 'get-orders' })
        return new WorkflowResponse(a)
      })
    `
    expect(checkDuplicateQueryStep([{ file: '/w', source }])).toEqual([])
  })

  it('flags a second un-named useQueryGraphStep', () => {
    const source = `
      createWorkflow('w', function () {
        const a = useQueryGraphStep({ entity: 'customer' }).config({ name: 'get-customer' })
        const b = useQueryGraphStep({ entity: 'order' })
      })
    `
    const out = checkDuplicateQueryStep([{ file: '/w', source }])
    expect(out.length).toBeGreaterThanOrEqual(1)
    expect(out[0]?.rule).toBe('duplicate-query-step')
  })

  it('flags two steps that share the same .config name', () => {
    const source = `
      createWorkflow('w', function () {
        const a = useQueryGraphStep({ entity: 'customer' }).config({ name: 'dup' })
        const b = useQueryGraphStep({ entity: 'order' }).config({ name: 'dup' })
      })
    `
    const out = checkDuplicateQueryStep([{ file: '/w', source }])
    expect(out.some((v) => v.message.includes("'dup'"))).toBe(true)
  })

  it('does NOT flag a single useQueryGraphStep without a name', () => {
    const source = `
      createWorkflow('w', function () {
        const a = useQueryGraphStep({ entity: 'customer' })
        return new WorkflowResponse(a)
      })
    `
    expect(checkDuplicateQueryStep([{ file: '/w', source }])).toEqual([])
  })

  it('isolates per-workflow: two single-step workflows in one file are fine', () => {
    const source = `
      createWorkflow('w1', function () {
        const a = useQueryGraphStep({ entity: 'customer' })
        return new WorkflowResponse(a)
      })
      createWorkflow('w2', function () {
        const b = useRemoteQueryStep({ entity: 'order' })
        return new WorkflowResponse(b)
      })
    `
    expect(checkDuplicateQueryStep([{ file: '/w', source }])).toEqual([])
  })

  it('handles useRemoteQueryStep too', () => {
    const source = `
      createWorkflow('w', function () {
        const a = useRemoteQueryStep({ entity: 'customer' })
        const b = useRemoteQueryStep({ entity: 'order' })
      })
    `
    const out = checkDuplicateQueryStep([{ file: '/w', source }])
    expect(out.length).toBeGreaterThanOrEqual(1)
  })

  it('honors a configured wrapper factory name', () => {
    const source = `
      createScheduledWorkflow('w', function () {
        const a = useQueryGraphStep({ entity: 'customer' })
        const b = useQueryGraphStep({ entity: 'order' })
      })
    `
    const out = checkDuplicateQueryStep(
      [{ file: '/w', source }],
      ['createWorkflow', 'createScheduledWorkflow'],
    )
    expect(out.length).toBeGreaterThanOrEqual(1)
  })
})
