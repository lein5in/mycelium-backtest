import { Link } from 'react-router'
import { Logo } from '../ui/Logo'

export function LandingPlaceholder() {
  return (
    <main className="flex min-h-full flex-col items-start justify-center gap-6 bg-landing px-10">
      <Logo />
      <p className="max-w-xl text-ink-2">
        Placeholder. The promo site is built in a later lot. Research tool · not financial advice.
      </p>
      <Link className="text-accent-text underline" to="/app">
        Open the app
      </Link>
    </main>
  )
}
