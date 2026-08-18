import { describe, expect, it } from 'vitest'

import { checkMutatingStepsCompensation, checkMutatingStepsDeclareRetry, checkRouteMutationsViaWorkflows } from './write-baseline.js'

const route = (source: string) => [{ file: '/r/route.ts', pkg: 'p', routePath: '/admin/x', source }]

describe('checkRouteMutationsViaWorkflows (routes mutate through workflow doors)', () => {
  it('flags a bare service mutation in a route handler', () => {
    const out = checkRouteMutationsViaWorkflows(
      route(`
        const service = req.scope.resolve(MODULE)
        const row = await service.createInvoices({ kind })
      `),
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.rule).toBe('route-mutation')
    expect(out[0]?.message).toContain('createInvoices')
  })

  it('passes a workflow-run route and plain reads', () => {
    const out = checkRouteMutationsViaWorkflows(
      route(`
        const { result } = await createInvoiceWorkflow(req.scope).run({ input })
        const { data } = await query.graph({ entity: 'invoice' })
        const rows = await service.listInvoices({}, { take: 5 })
      `),
    )
    expect(out).toEqual([])
  })

  it('honors the arch:inline-mutation-ok escape hatch on the same or preceding line', () => {
    const sameLine = route(`await svc.updateThings({ id }) // arch:inline-mutation-ok(append-only audit)`)
    const lineAbove = route(`
      // arch:inline-mutation-ok(append-only audit)
      await svc.updateThings({ id })
    `)
    expect(checkRouteMutationsViaWorkflows(sameLine)).toEqual([])
    expect(checkRouteMutationsViaWorkflows(lineAbove)).toEqual([])
  })

  it('tolerates routes collected without source (pure-path callers)', () => {
    expect(checkRouteMutationsViaWorkflows([{ file: '/r', pkg: 'p', routePath: '/x' }])).toEqual([])
  })
})

const wf = (source: string) => [{ file: '/w/steps.ts', source }]

describe('checkMutatingStepsDeclareRetry (mutating steps carry a retry class)', () => {
  it('flags a string-named mutating step (default maxRetries: 0)', () => {
    const out = checkMutatingStepsDeclareRetry(
      wf(`
        const s = createStep(
          'flip-status',
          async (input, { container }) => {
            await service.updateOrders({ id: input.id, status: 'draft' })
            return new StepResponse(null)
          },
        )
      `),
    )
    expect(out).toHaveLength(1)
    expect(out[0]?.rule).toBe('step-retry')
    expect(out[0]?.message).toContain("'flip-status'")
  })

  it('passes an object-form step spreading a RETRY_ preset or literal maxRetries', () => {
    const spread = wf(`
      createStep({ name: 'flip', ...RETRY_DB }, async (i, { container }) => {
        await service.updateOrders({ id: i.id })
        return new StepResponse(null)
      })
    `)
    const literal = wf(`
      createStep({ name: 'flip', maxRetries: 3 }, async (i, { container }) => {
        await service.deleteDrafts(i.id)
        return new StepResponse(null)
      })
    `)
    expect(checkMutatingStepsDeclareRetry(spread)).toEqual([])
    expect(checkMutatingStepsDeclareRetry(literal)).toEqual([])
  })

  it('exempts read-only/compute steps entirely', () => {
    const out = checkMutatingStepsDeclareRetry(
      wf(`
        createStep('load-order', async (input, { container }) => {
          const order = await service.retrieveOrder(input.id)
          const rows = await service.listDrafts({ order_id: order.id })
          return new StepResponse({ order, rows })
        })
      `),
    )
    expect(out).toEqual([])
  })

  it('an object form WITHOUT a retry class still flags when the step mutates', () => {
    const out = checkMutatingStepsDeclareRetry(
      wf(`
        createStep({ name: 'flip' }, async (i, { container }) => {
          await service.updateOrders({ id: i.id })
          return new StepResponse(null)
        })
      `),
    )
    expect(out).toHaveLength(1)
  })
})

describe('checkMutatingStepsCompensation (revertable or honestly flagged)', () => {
  it('flags a mutating step with 2 args and no flag; passes with compensation or noCompensation: true', () => {
    const bare = wf(`
      createStep({ name: 'flip', ...RETRY_DB }, async (i, { container }) => {
        await service.updateThings({ id: i.id })
        return new StepResponse(null)
      })
    `)
    expect(checkMutatingStepsCompensation(bare)).toHaveLength(1)
    const compensated = wf(`
      createStep({ name: 'flip', ...RETRY_DB }, async (i, { container }) => {
        // don't lose the operator's snapshot
        await service.updateThings({ id: i.id })
        return new StepResponse(null, i.id)
      }, async (id, { container }) => {
        await service.deleteThings(id)
      })
    `)
    expect(checkMutatingStepsCompensation(compensated)).toEqual([])
    const flagged = wf(`
      createStep({ name: 'flip', ...RETRY_DB, noCompensation: true }, async (i, { container }) => {
        await service.updateThings({ id: i.id })
        return new StepResponse(null)
      })
    `)
    expect(checkMutatingStepsCompensation(flagged)).toEqual([])
  })

  it('apostrophes in comments must not swallow the compensation arg (the first-run bug)', () => {
    const tricky = wf(`
      createStep({ name: 'x', ...RETRY_DB }, async (i, { container }) => {
        // the order's status flips here; don't revert manually
        await service.updateOrders({ id: i.id })
        return new StepResponse(null, i.id)
      }, async (id, { container }) => {
        await service.updateOrders({ id, status: 'proposed' })
      })
    `)
    expect(checkMutatingStepsCompensation(tricky)).toEqual([])
  })
})
