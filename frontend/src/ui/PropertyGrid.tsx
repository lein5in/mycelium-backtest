import type { ReactNode } from 'react'

export function PropertyGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl aria-label={label} className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      {children}
    </dl>
  )
}

type PropertyRowProps = {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
}

export function PropertyRow({ label, htmlFor, hint, children }: PropertyRowProps) {
  return (
    <div className="col-span-2 grid grid-cols-subgrid border-b border-line last:border-b-0">
      <dt className="flex min-w-0 flex-col justify-center gap-0.5 px-3 py-1.5 text-[13px] text-ink-2">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="cursor-pointer">
            {label}
          </label>
        ) : (
          <span>{label}</span>
        )}
        {hint}
      </dt>
      <dd className="m-0 flex min-w-0 items-center justify-end px-3 py-1.5 text-right font-mono text-data text-ink">
        {children}
      </dd>
    </div>
  )
}
