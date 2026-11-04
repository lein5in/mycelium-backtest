import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { Intro } from './features/intro/Intro'
import { buildRoutes } from './routes'
import './styles/index.css'

const router = createBrowserRouter(buildRoutes(import.meta.env.DEV))

const container = document.getElementById('root')
if (!container) throw new Error('Root element missing')

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Intro />
  </StrictMode>,
)
