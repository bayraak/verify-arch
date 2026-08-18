import { describe, expect, it } from 'vitest'

import { checkNamedWhen, checkRouteShadowing, checkSubscriberIds } from './hygiene-baseline.js'

const route = (pkg: string, routePath: string, source: string) => ({ file: `/${pkg}/route.ts`, pkg, routePath, source })
const sub = (source: string) => [{ file: '/s.ts', kind: 'subscriber' as const, source }]
const wf = (source: string) => [{ file: '/w.ts', source }]

describe('checkRouteShadowing (silent last-wins across packages)', () => {
  it('flags the same path+method from two packages', () => {
    const out = checkRouteShadowing([
      route('packages/a', '/admin/x', 'export async function GET(req, res) {}'),
      route('packages/b', '/admin/x', 'export async function GET(req, res) {}'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.rule).toBe('route-shadow')
    expect(out[0]?.message).toContain('packages/a')
  })

  it('same path but disjoint methods, same package, or an override annotation pass', () => {
    expect(
      checkRouteShadowing([
        route('packages/a', '/admin/x', 'export async function GET(req, res) {}'),
        route('packages/b', '/admin/x', 'export async function POST(req, res) {}'),
      ]),
    ).toEqual([])
    expect(
      checkRouteShadowing([
        route('packages/a', '/admin/x', 'export async function GET() {}'),
        route('packages/a', '/admin/x', 'export async function GET() {}'),
      ]),
    ).toEqual([])
    expect(
      checkRouteShadowing([
        route('packages/a', '/admin/x', 'export async function GET() {}'),
        route('app:backend', '/admin/x', '// arch:route-override-ok(app overrides plugin listing)\nexport async function GET() {}'),
      ]),
    ).toEqual([])
  })
})

describe('checkSubscriberIds (inferred ids collide silently)', () => {
  it('flags a subscriber config without subscriberId; passes with one; ignores non-config files', () => {
    expect(checkSubscriberIds(sub("export const config = { event: 'order.placed' }"))).toHaveLength(1)
    expect(
      checkSubscriberIds(sub("export const config = { event: 'order.placed', context: { subscriberId: 'x' } }")),
    ).toEqual([])
    expect(checkSubscriberIds(sub('export const helper = 1'))).toEqual([])
    expect(checkSubscriberIds([{ file: '/w.ts', kind: 'workflow', source: 'export const config = {}' }])).toEqual([])
  })
})

describe('checkNamedWhen (nondeterministic step names)', () => {
  it('flags unnamed when(); passes the named overload', () => {
    expect(checkNamedWhen(wf('when({ a }, ({ a }) => a > 1).then(() => step())'))).toHaveLength(1)
    expect(checkNamedWhen(wf("when('gate', { a }, ({ a }) => a > 1).then(() => step())"))).toEqual([])
  })
})
