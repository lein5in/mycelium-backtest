export type TagState = 'PASS' | 'WARN' | 'FAIL' | 'DONE' | 'RUN' | 'WAIT' | 'SOON'

const stateClasses: Record<TagState, string> = {
  PASS: 'border-profit text-profit-text',
  WARN: 'border-warn text-warn-text',
  FAIL: 'border-loss text-loss-text',
  DONE: 'border-line-strong text-ink-2',
  RUN: 'border-accent text-accent-text',
  WAIT: 'border-line-strong text-ink-3',
  SOON: 'border-line-strong text-ink-3',
}

export function Tag({ state, label }: { state: TagState; label?: string }) {
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center border px-1.5 font-mono text-[10.5px] leading-none tracking-[0.08em] whitespace-nowrap uppercase ${stateClasses[state]}`}
    >
      {label ?? state}
    </span>
  )
}

export function ModeBadge({ mode }: { mode: string }) {
  const tone =
    mode === 'SAMPLE DATA' || mode === 'PERSONAL USE ONLY' || mode.startsWith('ESTIMATED')
      ? 'border-warn text-warn-text'
      : 'border-line-strong text-ink-2'
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center border px-1.5 font-mono text-[10.5px] leading-none tracking-[0.08em] whitespace-nowrap uppercase ${tone}`}
    >
      {mode}
    </span>
  )
}
