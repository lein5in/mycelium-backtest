import type { ReactNode } from 'react'

export function StatusBar({ children, end }: { children?: ReactNode; end?: ReactNode }) {
  return (
    <footer className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel-head px-3 py-1 font-mono text-[11px] text-ink-3">
      {children}
      <span className="ml-auto flex items-center gap-3">{end}</span>
    </footer>
  )
}
