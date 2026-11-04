import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { entryFromRequest, HistoryStore, memoryBackend, type Codec } from '../features/history/historyStore'
import { tabFromSearch } from '../features/report/resultTabs'
import { makeResult } from '../test/resultFixture'
import { HistoryPage } from './HistoryPage'
import { ResultsPage } from './ResultsPage'

vi.mock('../features/chart/HeatmapChart', () => ({
  HeatmapChart: (props: { cursor: number | null; selectedTrade: number | null }) => (
    <div data-testid="chart" data-cursor={String(props.cursor)} data-selected={String(props.selectedTrade)} />
  ),
}))

const getRunResult = vi.fn()
vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  getRunResult: (...args: unknown[]) => getRunResult(...args),
}))

function Where() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

function renderAt(path: string, element: React.ReactNode) {
  const router = createMemoryRouter(
    [
      { path: '/app/results/:id', element: <>{element}<Where /></> },
      { path: '/app/history', element: <>{element}<Where /></> },
      { path: '/app', element: <Where /> },
    ],
    { initialEntries: [path] },
  )
  return { router, ...render(<RouterProvider router={router} />) }
}

describe('results tabs in the URL', () => {
  it('reads the tab from the URL and falls back to the report', () => {
    expect(tabFromSearch('calendar')).toBe('calendar')
    expect(tabFromSearch('nonsense')).toBe('report')
    expect(tabFromSearch(null)).toBe('report')
  })

  it('selects the tab from the URL, writes the new tab back, and keeps the selected trade', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    getRunResult.mockResolvedValueOnce(makeResult())
    const user = userEvent.setup()
    renderAt('/app/results/run-1?tab=calendar&trade=2', <ResultsPage />)
    const tabs = await screen.findByRole('tablist', { name: 'Results sections' })
    expect(within(tabs).getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('chart')).toHaveAttribute('data-selected', '2')
    await user.click(within(tabs).getByRole('tab', { name: 'Trades' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/app/results/run-1?tab=trades&trade=2')
    expect(within(tabs).getByRole('tab', { name: 'Trades' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: 'Share, available soon' })).toBeDisabled()
  })

  it('shows the expired state with Run again when the server purged the run and nothing is stored', async () => {
    const { ApiError } = await import('../api/client')
    getRunResult.mockRejectedValueOnce(new ApiError({ code: 'run_not_found', status: 404, message: 'gone' }))
    renderAt('/app/results/purged', <ResultsPage />)
    expect(await screen.findByRole('heading', { name: 'This result has expired' })).toBeInTheDocument()
  })
})

const plain: Codec = {
  encode: async (text) => new TextEncoder().encode(text),
  decode: async (data) => new TextDecoder().decode(data),
}

describe('history page', () => {
  it('states that history stays in this browser and shows the empty state', async () => {
    renderAt('/app/history', <HistoryPage store={new HistoryStore(memoryBackend, plain)} />)
    expect(await screen.findByText('No runs saved in this browser yet')).toBeInTheDocument()
    expect(screen.getByTestId('history-privacy')).toHaveTextContent('History lives only in this browser. It is never sent anywhere')
  })

  it('lists saved runs, deletes one, runs one again and clears all', async () => {
    const user = userEvent.setup()
    const store = new HistoryStore(memoryBackend, plain)
    const payload = makeResult()
    const entry = entryFromRequest('run-1', payload.request, { strategyName: 'Opening Range Breakout', market: 'us_equity', sourceMode: 'SAMPLE DATA' })
    await store.saveResult(entry, payload)
    await store.put({ ...entry, id: 'run-2', strategyName: 'Donchian', savedAt: '2026-11-05T00:00:00Z' })
    renderAt('/app/history', <HistoryPage store={store} />)
    const table = await screen.findByTestId('history-table')
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    expect(within(table).getByText('NOT CREDIBLE')).toBeInTheDocument()
    expect(within(table).getByText('+125.00')).toBeInTheDocument()
    expect(within(table).getAllByText('SAMPLE DATA')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Delete Donchian SAMPLE-A from history' }))
    await waitFor(() => expect(within(screen.getByTestId('history-table')).getAllByRole('row')).toHaveLength(2))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(await screen.findByText('No runs saved in this browser yet')).toBeInTheDocument()
  })

  it('prefills the configuration when running a saved run again', async () => {
    const user = userEvent.setup()
    const store = new HistoryStore(memoryBackend, plain)
    const payload = makeResult()
    await store.put(entryFromRequest('run-1', payload.request, { strategyName: 'ORB', market: 'us_equity', sourceMode: null }))
    const { router } = renderAt('/app/history', <HistoryPage store={store} />)
    await user.click(await screen.findByRole('button', { name: 'Run again' }))
    expect(router.state.location.pathname).toBe('/app')
    expect(router.state.location.state).toEqual({ request: payload.request })
  })

  it('does not crash when storage is unavailable', async () => {
    renderAt('/app/history', <HistoryPage store={new HistoryStore(() => null, plain)} />)
    expect(await screen.findByText('History is not available')).toBeInTheDocument()
    expect(screen.getByText(/storage is blocked or disabled/)).toBeInTheDocument()
  })
})
