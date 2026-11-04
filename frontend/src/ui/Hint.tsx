import type { ReactNode } from 'react'

type HintProps = { id?: string; tone?: 'neutral' | 'error' | 'warn'; children: ReactNode }

const tones = { neutral: 'text-ink-3', error: 'text-loss-text', warn: 'text-warn-text' }

export function Hint({ id, tone = 'neutral', children }: HintProps) {
  return (
    <span id={id} role={tone === 'error' ? 'alert' : undefined} className={`block font-mono text-[11px] leading-snug ${tones[tone]}`}>
      {children}
    </span>
  )
}
