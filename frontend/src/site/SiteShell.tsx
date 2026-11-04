import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { CONSENT_POINTS } from '../app/consent'
import { Logo } from '../ui/Logo'

const SITE_NAV = [
  { label: 'Platform', to: '/#platform' },
  { label: 'Honesty report', to: '/#honesty' },
  { label: 'Strategies', to: '/#strategies' },
  { label: 'Roadmap', to: '/roadmap' },
  { label: 'Privacy', to: '/privacy' },
]

const FOOTER_LINKS = [
  { label: 'Privacy', to: '/privacy' },
  { label: 'Terms', to: '/terms' },
  { label: 'Data sources', to: '/data-sources' },
  { label: 'Roadmap', to: '/roadmap' },
]

const repoUrl = import.meta.env.VITE_REPO_URL?.trim() || null

export const primaryLink =
  'inline-flex min-h-11 items-center justify-center border border-accent bg-accent px-4 text-[14px] font-semibold text-app hover:brightness-110'
export const outlineLink =
  'inline-flex min-h-11 items-center justify-center border border-line-strong px-4 text-[14px] text-ink hover:bg-hover'

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-landing text-ink">
      <a
        href="#content"
        className="sr-only-text focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center gap-x-8 gap-y-1 px-4 py-2 sm:px-6">
          <Link to="/" aria-label="Mycelium Backtest, home" className="inline-flex min-h-11 items-center">
            <Logo />
          </Link>
          <nav aria-label="Site" className="order-3 -mx-2 flex w-full flex-wrap lg:order-none lg:w-auto">
            {SITE_NAV.map((item) => (
              <Link key={item.to} to={item.to} className="inline-flex min-h-11 items-center px-2 text-[14px] text-ink-2 hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
          <span className="ml-auto flex items-center gap-2">
            {repoUrl && (
              <a href={repoUrl} className={outlineLink} rel="noreferrer">
                GitHub
              </a>
            )}
            <Link to="/app" className={primaryLink}>
              Open the app
            </Link>
          </span>
        </div>
      </header>
      <main id="content" tabIndex={-1} className="flex flex-1 flex-col outline-none">
        {children}
      </main>
      <section aria-labelledby="legal-strip" className="border-t border-line bg-app">
        <div className="mx-auto grid w-full max-w-[1320px] gap-4 px-4 py-6 sm:px-6 md:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="legal-strip" className="m-0 text-[15px] font-semibold text-ink">
              Research tool, not financial advice
            </h2>
            <p className="mt-2 mb-0 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">
              Mycelium Backtest describes how a set of rules behaved on past data. It is not speculative, it is not financial
              advice, and it can make mistakes. Past results do not predict future ones.
            </p>
          </div>
          <div>
            <h2 className="m-0 text-[15px] font-semibold text-ink">Privacy in one line</h2>
            <p className="mt-2 mb-0 max-w-[62ch] text-[13.5px] leading-relaxed text-ink-2">
              No account, no tracking, no analytics; your history stays in your browser and imported files are not kept.
            </p>
          </div>
        </div>
      </section>
      <footer className="border-t border-line bg-app">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-4 px-4 py-6 sm:px-6">
          <nav aria-label="Footer" className="-mx-2 flex flex-wrap">
            {FOOTER_LINKS.map((item) => (
              <Link key={item.to} to={item.to} className="inline-flex min-h-11 items-center px-2 text-[14px] text-ink-2 hover:text-ink">
                {item.label}
              </Link>
            ))}
          </nav>
          <div>
            <p className="m-0 text-[13px] font-medium text-ink-2">What you accept before your first run</p>
            <ul className="mt-2 mb-0 flex max-w-[80ch] list-none flex-col gap-1 p-0 text-[13px] leading-relaxed text-ink-3">
              {CONSENT_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
        </div>
      </footer>
    </div>
  )
}
