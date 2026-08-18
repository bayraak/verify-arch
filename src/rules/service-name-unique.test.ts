import { describe, expect, it } from 'vitest'

import { checkServiceNameUnique } from './service-name-unique.js'

describe('checkServiceNameUnique', () => {
  it('passes when every serviceName is unique', () => {
    const out = checkServiceNameUnique([
      { serviceName: 'company', file: '/a/company/index.ts' },
      { serviceName: 'quote', file: '/a/quote/index.ts' },
      { serviceName: 'approval', file: '/a/approval/index.ts' },
    ])
    expect(out).toEqual([])
  })

  it('flags a collision and reports BOTH colliding files', () => {
    const out = checkServiceNameUnique([
      { serviceName: 'tickets', file: '/support/tickets/index.ts' },
      { serviceName: 'tickets', file: '/other/tickets/index.ts' },
    ])
    expect(out).toHaveLength(2)
    expect(out.every((v) => v.rule === 'service-name-unique')).toBe(true)
    expect(out[0]?.message).toContain("'tickets'")
    expect(out[0]?.message).toContain('/other/tickets/index.ts')
    expect(out[1]?.message).toContain('/support/tickets/index.ts')
  })

  it('handles a three-way collision (each file lists the other two)', () => {
    const out = checkServiceNameUnique([
      { serviceName: 'x', file: '/1' },
      { serviceName: 'x', file: '/2' },
      { serviceName: 'x', file: '/3' },
    ])
    expect(out).toHaveLength(3)
    expect(out[0]?.message).toContain('/2')
    expect(out[0]?.message).toContain('/3')
  })

  it('passes on an empty graph', () => {
    expect(checkServiceNameUnique([])).toEqual([])
  })
})
