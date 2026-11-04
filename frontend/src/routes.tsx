import type { RouteObject } from 'react-router'
import { AppShell } from './app/AppShell'
import { ConfigPage } from './pages/ConfigPage'
import { DataSourcesPage } from './pages/DataSourcesPage'
import { HistoryPage } from './pages/HistoryPage'
import { LandingPlaceholder } from './pages/LandingPlaceholder'
import { NotFound } from './pages/NotFound'
import { RouteLoading } from './pages/RouteLoading'
import { RunPage } from './pages/RunPage'

const spikeRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/app/spike/heatmap',
        HydrateFallback: RouteLoading,
        lazy: async () => ({ Component: (await import('./spikes/HeatmapSpike')).HeatmapSpike }),
      },
      {
        path: '/app/spike/run',
        HydrateFallback: RouteLoading,
        lazy: async () => ({ Component: (await import('./spikes/RunSpike')).RunSpike }),
      },
      {
        path: '/app/spike/crawler',
        HydrateFallback: RouteLoading,
        lazy: async () => ({ Component: (await import('./spikes/CrawlerLab')).CrawlerLab }),
      },
      {
        path: '/app/spike/ui',
        HydrateFallback: RouteLoading,
        lazy: async () => ({ Component: (await import('./spikes/UiGallery')).UiGallery }),
      },
    ]
  : []

export const appChildren: RouteObject[] = [
  { index: true, Component: ConfigPage },
  { path: 'run/:id', Component: RunPage },
  { path: 'history', Component: HistoryPage },
  { path: 'data-sources', Component: DataSourcesPage },
  { path: '*', Component: NotFound },
]

export function buildRoutes(includeSpikes: boolean): RouteObject[] {
  return [
    { path: '/', Component: LandingPlaceholder },
    ...(includeSpikes ? spikeRoutes : []),
    { path: '/app', Component: AppShell, children: appChildren },
    { path: '*', Component: NotFound },
  ]
}
