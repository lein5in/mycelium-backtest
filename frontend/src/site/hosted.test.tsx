import { render, screen, waitFor, within } from '@testing-library/react'
import { forwardRef } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import recordedFile from '../../public/demo/recorded-run.json'
import type { RecordedRun } from '../features/recorded/recordedRun'

const recorded = recordedFile as unknown as RecordedRun

vi.mock('../features/recorded/recordedRun', async (original) => ({
  ...(await original<typeof import('../features/recorded/recordedRun')>()),
  canvasSupported: () => true,
  loadRecordedRun: async () => recorded,
}))

vi.mock('../features/chart/HeatmapChart', () => ({ HeatmapChart: () => <div data-testid="chart" /> }))

vi.mock('../features/crawler/Crawler', () => ({
  Crawler: forwardRef(function Crawler() {
    return null
  }),
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

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function renderHosted(path: string, repoUrl = 'https://example.invalid/mycelium') {
  vi.stubEnv('VITE_HOSTED', '1')
  vi.stubEnv('VITE_REPO_URL', repoUrl)
  vi.resetModules()
  const { buildRoutes } = await import('../routes')
  const router = createMemoryRouter(buildRoutes(false), { initialEntries: [path] })
  render(<RouterProvider router={router} />)
  return router
}

describe('hosted mode', () => {
  it('redirects every /app route to the run-locally section', async () => {
    for (const path of ['/app', '/app/run/abc', '/app/results/abc', '/app/history', '/app/data-sources']) {
      const router = await renderHosted(path)
      await waitFor(() => expect(router.state.location.pathname).toBe('/'))
      expect(router.state.location.hash).toBe('#run-locally')
      vi.unstubAllEnvs()
    }
  })

  it('replaces the launch calls to action and states that no engine is hosted', async () => {
    await renderHosted('/')
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByText(/The live engine is not hosted on this site\. Watch a recorded run below or run Mycelium on your own machine\./)).toBeInTheDocument()
    expect(screen.queryByText(/Open the app/)).toBeNull()
    expect(screen.queryByText(/RUN IN YOUR BROWSER/)).toBeNull()
    expect(screen.queryByText(/IMPORT YOUR OWN CSV/)).toBeNull()
    expect(screen.getByRole('link', { name: /RUN IT ON YOUR MACHINE/ })).toHaveAttribute('href', '/#run-locally')
    expect(screen.getByRole('link', { name: /VIEW SOURCE ON GITHUB/ })).toHaveAttribute('href', 'https://example.invalid/mycelium')
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'View on GitHub' })).toHaveAttribute('href', 'https://example.invalid/mycelium')
  })

  it('turns the top-bar button into Run it locally when no repository address is set', async () => {
    await renderHosted('/', '')
    await screen.findByRole('heading', { level: 1 })
    const banner = screen.getByRole('banner')
    expect(within(banner).getByRole('link', { name: 'Run it locally' })).toHaveAttribute('href', '/#run-locally')
    expect(screen.queryByRole('link', { name: /VIEW SOURCE ON GITHUB/ })).toBeNull()
    expect(within(banner).queryByRole('link', { name: /GitHub/ })).toBeNull()
  })

  it('has the run-locally section with copyable commands for both shells', async () => {
    await renderHosted('/')
    const section = (await screen.findByRole('heading', { level: 2, name: 'Run it locally' })).closest('section')
    expect(section).toHaveAttribute('id', 'run-locally')
    expect(section).toHaveTextContent('python -m app.dev')
    expect(section).toHaveTextContent('-c constraints.txt')
    expect(section).toHaveTextContent('npm run dev')
    expect(section).toHaveTextContent('http://localhost:5417')
    expect(within(section as HTMLElement).getAllByRole('button', { name: 'COPY' }).length).toBeGreaterThanOrEqual(10)
  })

  it('lists the hosted engine under Soon on the roadmap page', async () => {
    await renderHosted('/roadmap')
    expect(await screen.findByText('Hosted engine')).toBeInTheDocument()
  })

  it('says on the privacy page that the site runs no engine and receives no CSV', async () => {
    await renderHosted('/privacy')
    expect(await screen.findByText(/It receives no CSV file/)).toBeInTheDocument()
    expect(screen.queryByText(/sent to the server, processed in memory/)).toBeNull()
  })

  it('says on the data sources page that the site fetches no data', async () => {
    await renderHosted('/data-sources')
    expect(await screen.findByText(/This site does not fetch any market data/)).toBeInTheDocument()
    expect(screen.queryByText(/Used in the hosted version/)).toBeNull()
  })
})
