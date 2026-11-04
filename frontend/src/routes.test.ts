import { describe, expect, it } from 'vitest'
import { buildRoutes } from './routes'

describe('buildRoutes', () => {
  const paths = (spikes: boolean) => buildRoutes(spikes).map((route) => route.path)

  it('registers spike routes when requested', () => {
    expect(paths(true)).toContain('/app/spike/heatmap')
    expect(paths(true)).toContain('/app/spike/run')
    expect(paths(true)).toContain('/app/spike/crawler')
  })

  it('leaves spike routes out otherwise', () => {
    expect(paths(false)).toEqual(['/', '/privacy', '/terms', '/data-sources', '/roadmap', '/app', '*'])
  })
})
