import type { RouteObject } from 'react-router'
import { AppPlaceholder } from './pages/AppPlaceholder'
import { LandingPlaceholder } from './pages/LandingPlaceholder'
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
    ]
  : []

export function buildRoutes(includeSpikes: boolean): RouteObject[] {
  return [
    { path: '/', Component: LandingPlaceholder },
    { path: '/app', Component: AppPlaceholder },
    ...(includeSpikes ? spikeRoutes : []),
    { path: '*', Component: NotFound },
  ]
}
