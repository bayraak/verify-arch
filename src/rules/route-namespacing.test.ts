import { describe, expect, it } from 'vitest'

import { checkRouteNamespacing } from './route-namespacing.js'

const r = (routePath: string, pkg = 'packages/b2b', file = routePath) => ({
  routePath,
  pkg,
  file,
})

describe('checkRouteNamespacing', () => {
  it('passes for properly namespaced, unique plugin routes', () => {
    const out = checkRouteNamespacing([
      r('/store/b2b/companies', 'packages/b2b'),
      r('/admin/b2b/quotes/:id', 'packages/b2b'),
      r('/store/search', 'packages/search'),
      r('/admin/procurement/factories', 'packages/procurement'),
    ])
    // /store/search has a namespace segment ('search'), so it passes.
    expect(out).toEqual([])
  })

  it('flags a plugin route with no /store|/admin scope', () => {
    const out = checkRouteNamespacing([r('/widgets/foo', 'packages/b2b')])
    expect(out).toHaveLength(1)
    expect(out[0]?.message).toContain('scoped under /store or /admin')
  })

  it('flags a plugin route with no namespace segment', () => {
    const out = checkRouteNamespacing([r('/store', 'packages/b2b')])
    expect(out).toHaveLength(1)
    expect(out[0]?.message).toContain('no namespace segment')
  })

  it('flags a cross-plugin path collision (last-write-wins) on BOTH files', () => {
    const out = checkRouteNamespacing([
      r('/store/x/thing', 'packages/a', '/a/route'),
      r('/store/x/thing', 'packages/b', '/b/route'),
    ])
    const collisions = out.filter((v) => v.message.includes('collides cross-plugin'))
    expect(collisions).toHaveLength(2)
  })

  it('does NOT namespace-constrain app-root (non-plugin) routes', () => {
    const out = checkRouteNamespacing([r('/custom/thing', 'app:backend')])
    expect(out).toEqual([])
  })

  it('does NOT namespace-constrain a single-app root src route', () => {
    const out = checkRouteNamespacing([r('/custom/thing', 'app:root')])
    expect(out).toEqual([])
  })
})
