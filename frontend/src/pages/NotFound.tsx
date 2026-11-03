import { Link } from 'react-router'

export function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-start justify-center gap-4 px-10">
      <p className="label-caps text-ink-3">404</p>
      <p className="text-ink-2">This page does not exist.</p>
      <Link className="text-accent-text underline" to="/">
        Back to the start
      </Link>
    </main>
  )
}
