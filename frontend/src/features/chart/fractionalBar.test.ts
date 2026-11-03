import { describe, expect, it } from 'vitest'
import { fractionalBarToX } from './fractionalBar'

describe('fractionalBarToX', () => {
  const integerOnly = (bar: number) => (Number.isInteger(bar) ? 100 + bar * 4 : 0)

  it('interpolates between neighbouring bars', () => {
    expect(fractionalBarToX(integerOnly, 10.25)).toBe(141)
  })

  it('returns whole bars unchanged', () => {
    expect(fractionalBarToX(integerOnly, 10)).toBe(140)
  })

  it('propagates a missing coordinate', () => {
    expect(fractionalBarToX(() => null, 3.5)).toBeNull()
  })
})
