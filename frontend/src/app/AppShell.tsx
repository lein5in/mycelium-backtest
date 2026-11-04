import { useCallback, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Button } from '../ui/Button'
import { Logo } from '../ui/Logo'
import { ConsentModal } from './ConsentModal'
import { readConsent, writeConsent } from './consent'
import { ConsentContext, EngineContext, type ConsentState, type EngineState } from './context'
import { EngineUnreachable } from './EngineUnreachable'
import { useHealth } from './useHealth'

const NAV = [
  { to: '/app', label: 'New run', end: true },
  { to: '/app/history', label: 'History', end: false },
  { to: '/app/data-sources', label: 'Data sources', end: false },
]

const ENGINE_FREE_PATHS = ['/app/history']

function EngineIndicator({ engine }: { engine: EngineState }) {
  const tone = { up: 'bg-profit', down: 'bg-loss', checking: 'bg-line-strong' }[engine.status]
  const text = {
    up: `Engine online${engine.health ? ` · v${engine.health.version}` : ''}`,
    down: 'Engine unreachable',
    checking: 'Checking engine',
  }[engine.status]
  return (
    <span role="status" aria-live="polite" className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
      <span aria-hidden="true" className={`inline-block h-2 w-2 ${tone}`} />
      {text}
    </span>
  )
}

export function AppShell() {
  const engine = useHealth()
  const { pathname } = useLocation()
  const [accepted, setAccepted] = useState(() => readConsent())
  const [modalOpen, setModalOpen] = useState(() => !readConsent())
  const [storageFailed, setStorageFailed] = useState(false)

  const accept = useCallback(() => {
    setStorageFailed(!writeConsent())
    setAccepted(true)
    setModalOpen(false)
  }, [])

  const consent = useMemo<ConsentState>(
    () => ({
      accepted,
      storageFailed,
      open: () => setModalOpen(true),
      request: () => {
        if (!accepted) setModalOpen(true)
        return accepted
      },
    }),
    [accepted, storageFailed],
  )

  const blocked = engine.status === 'down' && !ENGINE_FREE_PATHS.some((path) => pathname.startsWith(path))

  return (
    <EngineContext.Provider value={engine}>
      <ConsentContext.Provider value={consent}>
        <div className="flex min-h-full flex-col bg-app">
          <a
            href="#main"
            className="sr-only-text focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
          >
            Skip to content
          </a>
          <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-line bg-panel-head px-3 py-1">
            <Link to="/app" aria-label="Mycelium Backtest, new run" className="py-1">
              <Logo />
            </Link>
            <nav aria-label="Main" className="flex flex-wrap items-stretch">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `label-caps inline-flex min-h-[34px] items-center border-b-2 px-3 transition-colors duration-150 ${isActive ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <span className="ml-auto">
              <EngineIndicator engine={engine} />
            </span>
          </header>
          <main id="main" className="flex min-h-0 min-w-0 flex-1 flex-col">
            {blocked ? <EngineUnreachable engine={engine} /> : <Outlet />}
          </main>
          <footer className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel-head px-3 py-1 font-mono text-[11px] text-ink-3">
            <span className="text-ink-2">Research tool · not financial advice</span>
            <span className="ml-auto flex items-center gap-3">
              <Button className="min-h-[26px] px-2 text-[11px]" onClick={() => setModalOpen(true)}>
                Terms of use
              </Button>
            </span>
          </footer>
          {modalOpen && (
            <ConsentModal
              accepted={accepted}
              storageFailed={storageFailed}
              onAccept={accept}
              onClose={() => setModalOpen(false)}
            />
          )}
        </div>
      </ConsentContext.Provider>
    </EngineContext.Provider>
  )
}
