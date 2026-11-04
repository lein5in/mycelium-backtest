import type { RouteObject } from 'react-router'
import { NotFound } from './pages/NotFound'
import { RouteLoading } from './pages/RouteLoading'

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
  { index: true, lazy: async () => ({ Component: (await import('./pages/ConfigPage')).ConfigPage }) },
  { path: 'run/:id', lazy: async () => ({ Component: (await import('./pages/RunPage')).RunPage }) },
  { path: 'results/:id', lazy: async () => ({ Component: (await import('./pages/ResultsPage')).ResultsPage }) },
  { path: 'history', lazy: async () => ({ Component: (await import('./pages/HistoryPage')).HistoryPage }) },
  { path: 'data-sources', lazy: async () => ({ Component: (await import('./pages/DataSourcesPage')).DataSourcesPage }) },
  { path: '*', Component: NotFound },
]

export const publicRoutes: RouteObject[] = [
  { path: '/', HydrateFallback: RouteLoading, lazy: async () => ({ Component: (await import('./site/Landing')).Landing }) },
  { path: '/privacy', HydrateFallback: RouteLoading, lazy: async () => ({ Component: (await import('./site/PublicPages')).PrivacyPage }) },
  { path: '/terms', HydrateFallback: RouteLoading, lazy: async () => ({ Component: (await import('./site/PublicPages')).TermsPage }) },
  {
    path: '/data-sources',
    HydrateFallback: RouteLoading,
    lazy: async () => ({ Component: (await import('./site/PublicPages')).PublicDataSourcesPage }),
  },
  { path: '/roadmap', HydrateFallback: RouteLoading, lazy: async () => ({ Component: (await import('./site/PublicPages')).RoadmapPage }) },
]

export function buildRoutes(includeSpikes: boolean): RouteObject[] {
  return [
    ...publicRoutes,
    ...(includeSpikes ? spikeRoutes : []),
    {
      path: '/app',
      HydrateFallback: RouteLoading,
      lazy: async () => ({ Component: (await import('./app/AppShell')).AppShell }),
      children: appChildren,
    },
    { path: '*', Component: NotFound },
  ]
}
