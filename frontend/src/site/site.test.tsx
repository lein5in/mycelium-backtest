import { act, render, screen, waitFor, within } from '@testing-library/react'
import { forwardRef, useEffect, useImperativeHandle } from 'react'
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import recordedFile from '../../public/demo/recorded-run.json'
import limits from '../api/fixtures/limits.json'
import markets from '../api/fixtures/markets.json'
import strategies from '../api/fixtures/strategies.json'
import { PlaybackScheduler } from '../features/crawler/playback'
import { isRecordedRun, RECORDED_LABEL, type RecordedRun } from '../features/recorded/recordedRun'
import { buildRoutes } from '../routes'

const recorded = recordedFile as unknown as RecordedRun

vi.mock('../features/recorded/recordedRun', async (original) => ({
  ...(await original<typeof import('../features/recorded/recordedRun')>()),
  canvasSupported: () => true,
  loadRecordedRun: async () => recorded,
}))

vi.mock('../features/chart/HeatmapChart', () => ({
  HeatmapChart: ({ onReady }: { onReady?: (projection: unknown) => void }) => {
    useEffect(() => {
      const timeScale = { subscribeVisibleLogicalRangeChange: vi.fn(), unsubscribeVisibleLogicalRangeChange: vi.fn(), subscribeSizeChange: vi.fn(), unsubscribeSizeChange: vi.fn() }
      onReady?.({
        barCount: 10,
        barToX: (bar: number) => bar,
        priceToY: (price: number) => price,
        yToPrice: (y: number) => y,
        paneRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        anchors: [],
        container: document.body,
        chart: { timeScale: () => timeScale },
        series: {},
      })
    }, [onReady])
    return <div data-testid="chart" />
  },
}))

const crawlerCalls: string[] = []
vi.mock('../features/crawler/Crawler', () => ({
  Crawler: forwardRef(function Crawler(_props, ref) {
    useImperativeHandle(ref, () => {
      const record = (name: string) => () => void crawlerCalls.push(name)
      return {
        start: record('start'),
        setStage: record('setStage'),
        setBeam: record('setBeam'),
        wrap: record('wrap'),
        pulse: record('pulse'),
        finish: record('finish'),
        fail: record('fail'),
        reset: record('reset'),
        moveSpiderTo: record('moveSpiderTo'),
        setAggression: record('setAggression'),
        setTempo: record('setTempo'),
      }
    })
    return null
  }),
}))

vi.mock('../app/useCatalog', () => ({
  useCatalog: () => ({ status: 'ready', catalog: { limits, markets, strategies } }),
}))

beforeAll(() => {
  globalThis.IntersectionObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return []
    }
  } as unknown as typeof IntersectionObserver
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => vi.restoreAllMocks())

function renderPath(path: string) {
  const router = createMemoryRouter(buildRoutes(false), { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('recorded run file', () => {
  it('is a valid recording of synthetic sample data only', () => {
    expect(isRecordedRun(recorded)).toBe(true)
    expect(recorded.payload.source).toMatchObject({ provider: 'samples', mode: 'SAMPLE DATA', symbol: 'SAMPLE-A' })
    expect(recorded.payload.request.strategy_id).toBe('rsi_mean_reversion')
    expect(JSON.stringify(recordedFile).length).toBeLessThan(1_600_000)
  })
})

describe('landing', () => {
  it('renders every section in order with the recorded frames labelled', { timeout: 15_000 }, async () => {
    renderPath('/')
    await screen.findByRole('heading', { level: 1, name: 'Backtesting that tells you the truth.' }, { timeout: 10_000 })
    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings.slice(0, 6)).toEqual([
      'You see the engine work',
      'An honesty report on every run',
      'Strategy library',
      'Roadmap',
      'Run it locally',
      'Research tool, not financial advice',
    ])
    expect(screen.getByRole('region', { name: 'Facts' })).toBeInTheDocument()
    expect(await screen.findAllByTestId('recorded-label')).toHaveLength(2)
    expect(screen.getAllByTestId('recorded-label')[0]).toHaveTextContent(RECORDED_LABEL)
    expect(screen.getByText('Recorded on sample data. Illustrative, not a real market result.')).toBeInTheDocument()
  })

  it('shows Soon items as labelled text, never as working links', async () => {
    renderPath('/')
    const library = await screen.findByRole('table', { name: 'Strategies' })
    const describeRow = within(library).getByRole('row', { name: /Describe it in words/ })
    expect(within(describeRow).getByText('SOON')).toBeInTheDocument()
    expect(within(describeRow).queryByRole('link')).toBeNull()
    expect(within(library).getByRole('row', { name: /Custom strategy/ })).toHaveTextContent('SOON')
  })

  it('only links to routes that exist', async () => {
    renderPath('/')
    await screen.findByRole('heading', { level: 1 })
    const routes = buildRoutes(false)
    const internal = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href') ?? '')
      .filter((href) => href.startsWith('/'))
    expect(internal.length).toBeGreaterThan(8)
    for (const href of internal) {
      const path = href.split(/[?#]/)[0] ?? '/'
      const matches = matchRoutes(routes, path) ?? []
      expect(matches.at(-1)?.route.path, href).not.toBe('*')
    }
    expect(screen.getAllByRole('link', { name: /IMPORT YOUR OWN CSV/ })[0]).toHaveAttribute('href', '/app?market=csv')
  })

  it('replays the recorded events through the playback scheduler', async () => {
    const push = vi.spyOn(PlaybackScheduler.prototype, 'push')
    renderPath('/')
    await waitFor(() => expect(push).toHaveBeenCalled())
    const pushed = push.mock.calls.map(([event]) => event.seq)
    expect(pushed.slice(0, recorded.events.length)).toEqual(recorded.events.map((event) => event.seq))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(crawlerCalls).toContain('start')
  })
})

describe('public pages and the app', () => {
  it.each([
    ['/privacy', 'Privacy'],
    ['/terms', 'Terms of use'],
    ['/data-sources', 'Data sources'],
    ['/roadmap', 'Roadmap'],
  ])('%s renders its page', async (path, title) => {
    renderPath(path)
    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument()
  })

  it('states the last update of the terms', async () => {
    renderPath('/terms')
    expect(await screen.findByText(/Last updated 4 November 2026/)).toBeInTheDocument()
  })

  it('says sample sets are synthetic and Yahoo is not used in the hosted version', async () => {
    renderPath('/data-sources')
    expect(await screen.findByText(/They are not real prices/)).toBeInTheDocument()
    expect(screen.getByText('Never used in the hosted version.')).toBeInTheDocument()
  })

  it('preselects CSV import on the configuration screen with ?market=csv', async () => {
    renderPath('/app?market=csv')
    const radio = await screen.findByRole('radio', { name: 'CSV import' })
    expect(radio).toHaveAttribute('aria-checked', 'true')
  })
})
