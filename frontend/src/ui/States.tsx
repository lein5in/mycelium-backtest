import type { ReactNode } from 'react'
import type { DescribedError } from '../api/errorMessages'

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-4 py-6">
      <p className="m-0 text-[14px] font-medium text-ink">{title}</p>
      {children && <div className="max-w-prose text-[13px] text-ink-2">{children}</div>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}

export function LoadingLine({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="m-0 flex items-center gap-2 px-3 py-2 font-mono text-data text-ink-3">
      <span aria-hidden="true" className="inline-block h-2 w-2 bg-line-strong" />
      {label}
    </p>
  )
}

export function SkeletonRows({ rows = 4, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex h-8 items-center gap-3 border-b border-line px-3">
          <span className="h-2 w-1/3 bg-hover" />
          <span className="ml-auto h-2 w-16 bg-hover" />
        </div>
      ))}
    </div>
  )
}

type ErrorPanelProps = { error: DescribedError; action?: ReactNode; compact?: boolean }

export function ErrorPanel({ error, action, compact = false }: ErrorPanelProps) {
  return (
    <div role="alert" className={`flex flex-col gap-1.5 border-l-2 border-loss bg-panel ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}>
      <p className="m-0 flex flex-wrap items-center gap-2 text-[14px] font-medium text-loss-text">
        {error.title}
        {error.stage && <span className="font-mono text-[11px] tracking-[0.08em] text-ink-3 uppercase">stage {error.stage}</span>}
      </p>
      {error.message && error.message !== error.title && <p className="m-0 text-[13px] text-ink-2">{error.message}</p>}
      <p className="m-0 text-[13px] text-ink">{error.action}</p>
      <p className="m-0 flex flex-wrap gap-x-3 font-mono text-[11px] text-ink-3">
        <span>code {error.code}</span>
        {error.requestId && <span>request id {error.requestId}</span>}
      </p>
      {action && <div className="pt-1">{action}</div>}
    </div>
  )
}
