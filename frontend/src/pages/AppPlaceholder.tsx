import { Link } from 'react-router'
import { Logo } from '../ui/Logo'

export function AppPlaceholder() {
  return (
    <main className="flex min-h-full flex-col gap-6 bg-app px-10 py-10">
      <Logo />
      <p className="max-w-xl text-ink-2">
        Placeholder. The configuration screen is built in a later lot.
      </p>
      {import.meta.env.DEV && (
        <nav aria-label="Development spikes" className="flex flex-col gap-2 font-mono text-data">
          <Link className="text-accent-text underline" to="/app/spike/heatmap">
            /app/spike/heatmap
          </Link>
          <Link className="text-accent-text underline" to="/app/spike/run">
            /app/spike/run
          </Link>
          <Link className="text-accent-text underline" to="/app/spike/crawler">
            /app/spike/crawler
          </Link>
        </nav>
      )}
    </main>
  )
}
