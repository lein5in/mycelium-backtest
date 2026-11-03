import type { ReactNode } from 'react'

type PanelProps = {
  label: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function Panel({ label, actions, children, className = '' }: PanelProps) {
  return (
    <section className={`flex flex-col border border-line bg-panel ${className}`}>
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-panel-head px-3">
        <h2 className="label-caps m-0 font-medium text-ink-3">{label}</h2>
        {actions}
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}
