import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalFrame, INTRO_MS, introFrame, introLayout, PHASES, SPOKE_NODES, SPOKES, WORDMARK } from '../crawler/intro'
import { MAX_LINKS, MAX_NODES } from '../crawler/params'
import { Intro, REDUCED_MOTION_MS } from './Intro'
import { decideIntro, INTRO_KEY, resetIntroGate } from './introGate'

function memoryStore() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values }
}

const failing = () => {
  throw new DOMException('blocked', 'SecurityError')
}

beforeEach(() => resetIntroGate())
afterEach(() => vi.useRealTimers())

describe('intro scene', () => {
  const layout = introLayout(1, 1200, 800)

  it('stays inside the crawler node and link caps', () => {
    expect(layout.scattered.length).toBe(1 + SPOKES * SPOKE_NODES)
    expect(layout.scattered.length).toBeLessThanOrEqual(MAX_NODES)
    for (const t of [0, 500, 1000, 1600, 2500, INTRO_MS]) expect(introFrame(layout, t).links.length).toBeLessThanOrEqual(MAX_LINKS)
  })

  it('contracts the scattered web into the six-spoke mark and types the wordmark', () => {
    const start = introFrame(layout, 0)
    expect(start.nodes.every((node) => node.alpha === 0)).toBe(true)
    const contracted = introFrame(layout, PHASES.contract[1])
    contracted.nodes.forEach((node, index) => {
      expect(node.x).toBeCloseTo(layout.targets[index]?.x ?? 0)
      expect(node.y).toBeCloseTo(layout.targets[index]?.y ?? 0)
    })
    expect(introFrame(layout, PHASES.wordmark[0]).letters).toBe(0)
    expect(introFrame(layout, PHASES.wordmark[1]).letters).toBe(WORDMARK.length)
    expect(introFrame(layout, PHASES.subtitle[1]).subtitle).toBe(1)
    expect(introFrame(layout, INTRO_MS).overlay).toBe(0)
    expect(finalFrame(layout)).toMatchObject({ letters: WORDMARK.length, overlay: 1 })
  })

  it('is reproducible for a seed', () => {
    expect(introLayout(7, 800, 600)).toEqual(introLayout(7, 800, 600))
    expect(introLayout(7, 800, 600)).not.toEqual(introLayout(8, 800, 600))
  })
})

describe('intro gate', () => {
  it('shows once per browser session', () => {
    const store = memoryStore()
    expect(decideIntro('', () => store).show).toBe(true)
    expect(store.values.get(INTRO_KEY)).toBe('1')
    resetIntroGate()
    expect(decideIntro('', () => store).show).toBe(false)
  })

  it('shows once per page load when storage fails', () => {
    expect(decideIntro('', failing).show).toBe(true)
    expect(decideIntro('?x=1', failing).show).toBe(false)
  })

  it('reads the test parameters', () => {
    const store = memoryStore()
    store.setItem(INTRO_KEY, '1')
    expect(decideIntro('?intro=1&seed=4&introTime=1.2', () => store)).toEqual({ show: true, forced: true, seed: 4, frozenAt: 1200 })
    resetIntroGate()
    expect(decideIntro('?intro=0', () => memoryStore()).show).toBe(false)
  })
})

describe('intro overlay', () => {
  it('skips on click', () => {
    render(<Intro search="?intro=1&introTime=1" storage={() => memoryStore()} reducedMotion={false} />)
    fireEvent.pointerDown(screen.getByTestId('intro'))
    expect(screen.getByTestId('intro').className).toContain('pointer-events-none')
  })

  it('skips on any key and leaves the focus on the page', () => {
    vi.useFakeTimers()
    render(
      <>
        <button type="button">Open the app</button>
        <Intro search="?intro=1&introTime=1" storage={() => memoryStore()} reducedMotion={false} />
      </>,
    )
    const button = screen.getByRole('button', { name: 'Open the app' })
    button.focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => vi.advanceTimersByTime(250))
    expect(screen.queryByTestId('intro')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('shows only the final frame for 300 ms under reduced motion', () => {
    vi.useFakeTimers()
    render(<Intro search="?intro=1" storage={() => memoryStore()} reducedMotion />)
    expect(screen.getByTestId('intro')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(REDUCED_MOTION_MS + 10))
    expect(screen.queryByTestId('intro')).toBeNull()
  })

  it('renders nothing when disabled or already seen', () => {
    const store = memoryStore()
    store.setItem(INTRO_KEY, '1')
    const { container } = render(<Intro search="" storage={() => store} reducedMotion={false} />)
    expect(container).toBeEmptyDOMElement()
    resetIntroGate()
    const disabled = render(<Intro search="?intro=0" storage={() => memoryStore()} reducedMotion={false} />)
    expect(disabled.container).toBeEmptyDOMElement()
  })

  it('never hides the page content: the overlay is aria-hidden and the content stays in the document', () => {
    render(
      <>
        <main>Page content</main>
        <Intro search="?intro=1&introTime=1" storage={() => memoryStore()} reducedMotion={false} />
      </>,
    )
    expect(screen.getByText('Page content')).toBeInTheDocument()
    expect(screen.getByTestId('intro')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('intro web', () => {
  it('is made of short threads only, never long lines across the screen', async () => {
    const { LINK_SHARE } = await import('../crawler/intro')
    const layout = introLayout(1, 1440, 900)
    const limit = Math.min(1440, 900) * LINK_SHARE
    for (const [a, b] of layout.scatterLinks) {
      const p = layout.scattered[a]
      const q = layout.scattered[b]
      expect(Math.hypot((p?.x ?? 0) - (q?.x ?? 0), (p?.y ?? 0) - (q?.y ?? 0))).toBeLessThanOrEqual(limit)
    }
  })
})
