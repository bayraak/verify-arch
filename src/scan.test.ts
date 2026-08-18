import { join, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { deriveRoutePath, pkgNameForFile } from './scan.js'

/*
 * deriveRoutePath turns an `api/<…>/route.ts` file path into the Medusa route path the
 * route-namespace cross-plugin collision rule compares. The load-bearing bit: a `[param]` path
 * segment must become a `:param` dynamic segment — if that normalization drifts, two plugins
 * owning the same dynamic route (e.g. /admin/x/[id] vs a hand-written /admin/x/:id) would slip
 * past the collision gate. The rule tests feed already-derived routePaths, so this normalizer
 * itself would otherwise be unexercised. Pure — build inputs with the OS `sep` to mirror how
 * scan.ts slices a real file path.
 */
const apiPath = (...segments: string[]): string => segments.join(sep)

describe('deriveRoutePath', () => {
  it('derives a static route, stripping the route.ts filename', () => {
    expect(deriveRoutePath(apiPath('store', 'products', 'route.ts'))).toBe('/store/products')
  })

  it('converts a [param] segment to a :param dynamic segment', () => {
    expect(deriveRoutePath(apiPath('admin', 'b2b', 'quotes', '[id]', 'route.ts'))).toBe(
      '/admin/b2b/quotes/:id',
    )
  })

  it('converts every dynamic segment in a deeply nested route', () => {
    expect(
      deriveRoutePath(apiPath('store', 'orders', '[id]', 'items', '[itemId]', 'route.ts')),
    ).toBe('/store/orders/:id/items/:itemId')
  })

  it('handles a route.js build-output filename the same way', () => {
    expect(deriveRoutePath(apiPath('hooks', 'shipping', 'route.js'))).toBe('/hooks/shipping')
  })
})

/*
 * pkgNameForFile attributes a file to its owning package — the route-namespace rule uses this to
 * tell "same path, two DIFFERENT plugins" (a collision) from "same path, same plugin" (fine), so
 * a wrong owner here = a missed or false collision, not just a mislabelled report. It is
 * positional: apps/<name> -> app:<name>, root src/ -> app:root, else the dir path up to `src`.
 */
const REPO = join(sep, 'repo')

describe('pkgNameForFile', () => {
  it('attributes a packages/<plugin> file to its package dir path', () => {
    const file = join(REPO, 'packages', 'b2b', 'src', 'api', 'route.ts')
    expect(pkgNameForFile(REPO, file)).toBe('packages/b2b')
  })

  it('attributes a nested package group (packages/plugins/<name>) to the full package dir', () => {
    const file = join(REPO, 'packages', 'plugins', 'b2b', 'src', 'api', 'route.ts')
    expect(pkgNameForFile(REPO, file)).toBe('packages/plugins/b2b')
  })

  it('attributes an apps file to app:<name>', () => {
    expect(pkgNameForFile(REPO, join(REPO, 'apps', 'backend', 'src', 'x.ts'))).toBe('app:backend')
  })

  it('attributes a root-level src file to app:root (single-app layout)', () => {
    expect(pkgNameForFile(REPO, join(REPO, 'src', 'api', 'custom', 'route.ts'))).toBe('app:root')
  })

  it('falls back to the containing dir path for a file with no src segment', () => {
    const file = join(REPO, 'packages', 'tools', 'script.ts')
    expect(pkgNameForFile(REPO, file)).toBe('packages/tools')
  })
})
