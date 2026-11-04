import { useId, type ReactNode } from 'react'

type PanelProps = {
  label: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function Panel({ label, actions, children, className = '', bodyClassName = '' }: PanelProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={`flex min-w-0 flex-col border border-line bg-panel ${className}`}>
      <header className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-line bg-panel-head px-3">
        <h2 id={headingId} className="label-caps m-0 font-medium text-ink-3">
          {label}
        </h2>
        {actions}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  )
}
