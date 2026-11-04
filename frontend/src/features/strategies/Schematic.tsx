import type { ReactNode } from 'react'

const W = 240
const H = 96

const price = 'var(--price-line)'
const level = 'var(--text-3)'
const entry = 'var(--accent-text)'
const stop = 'var(--loss-text)'
const target = 'var(--profit-text)'

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={title}
      className="block h-auto w-full max-w-[320px] border border-line bg-app"
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{title}</title>
      {children}
    </svg>
  )
}

const stroke = { fill: 'none', strokeWidth: 1.5, strokeLinecap: 'square' as const, strokeLinejoin: 'miter' as const }
const dashed = { ...stroke, strokeWidth: 1, strokeDasharray: '4 3' }

function Marker({ x, y, color }: { x: number; y: number; color: string }) {
  return <rect x={x - 2.5} y={y - 2.5} width="5" height="5" fill={color} />
}

function Label({ x, y, color, children }: { x: number; y: number; color: string; children: string }) {
  return (
    <text x={x} y={y} fill={color} fontFamily="var(--font-mono)" fontSize="8" letterSpacing="0.06em">
      {children}
    </text>
  )
}

const schematics: Record<string, { title: string; body: ReactNode }> = {
  orb: {
    title: 'Opening range breakout: price leaves the first minutes range, stop on the other side',
    body: (
      <>
        <rect x="16" y="38" width="56" height="26" fill="var(--bg-hover)" stroke={level} strokeWidth="1" />
        <polyline {...stroke} stroke={price} points="16,52 26,44 36,58 46,42 56,56 66,46 72,50 92,40 108,30 128,24 150,20 178,14 210,12" />
        <line {...dashed} stroke={level} x1="72" y1="38" x2="230" y2="38" />
        <line {...dashed} stroke={stop} x1="72" y1="64" x2="230" y2="64" />
        <Marker x={92} y={38} color={entry} />
        <Label x={18} y={33} color={level}>RANGE</Label>
        <Label x={196} y={76} color={stop}>STOP</Label>
      </>
    ),
  },
  vwap_mean_reversion: {
    title: 'VWAP mean reversion: price stretches below the VWAP band, then returns to the VWAP',
    body: (
      <>
        <line {...stroke} stroke={level} x1="10" y1="40" x2="230" y2="40" />
        <line {...dashed} stroke={level} x1="10" y1="62" x2="230" y2="62" />
        <polyline {...stroke} stroke={price} points="10,42 34,38 58,46 82,58 100,70 116,66 136,54 160,44 184,40 210,38 230,40" />
        <Marker x={100} y={70} color={entry} />
        <Marker x={184} y={40} color={target} />
        <Label x={12} y={34} color={level}>VWAP</Label>
        <Label x={12} y={74} color={level}>BAND</Label>
      </>
    ),
  },
  gap_fade: {
    title: 'Gap fade: the session opens away from the previous close and is traded back toward it',
    body: (
      <>
        <polyline {...stroke} stroke={price} points="10,30 30,34 50,28 70,32 90,30" />
        <line x1="96" y1="10" x2="96" y2="90" stroke="var(--border-strong)" strokeWidth="1" />
        <line {...dashed} stroke={target} x1="90" y1="30" x2="230" y2="30" />
        <polyline {...stroke} stroke={price} points="104,66 120,70 140,60 160,52 182,42 206,32 230,30" />
        <Marker x={120} y={70} color={entry} />
        <Label x={12} y={22} color={level}>PREV CLOSE</Label>
        <Label x={102} y={86} color={level}>GAP</Label>
      </>
    ),
  },
  donchian_breakout: {
    title: 'Donchian channel breakout: close above the highest high of the previous bars',
    body: (
      <>
        <polyline {...dashed} stroke={level} points="10,30 70,30 70,28 130,28 130,24 230,24" />
        <polyline {...dashed} stroke={level} points="10,72 90,72 90,68 230,68" />
        <polyline {...stroke} stroke={price} points="10,50 30,40 50,58 70,44 90,62 110,46 126,36 140,22 160,16 190,14 230,10" />
        <Marker x={140} y={24} color={entry} />
        <Label x={12} y={22} color={level}>CHANNEL HIGH</Label>
        <Label x={12} y={84} color={level}>CHANNEL LOW</Label>
      </>
    ),
  },
  rsi_mean_reversion: {
    title: 'RSI mean reversion: RSI crosses back above the oversold level, exit when it recovers',
    body: (
      <>
        <polyline {...stroke} stroke={price} points="10,20 40,26 70,38 96,44 116,40 140,32 170,26 200,22 230,20" />
        <line x1="10" y1="56" x2="230" y2="56" stroke="var(--border-strong)" strokeWidth="1" />
        <line {...dashed} stroke={level} x1="10" y1="82" x2="230" y2="82" />
        <line {...dashed} stroke={level} x1="10" y1="68" x2="230" y2="68" />
        <polyline {...stroke} stroke="var(--violet-text)" points="10,62 40,70 70,84 96,88 116,80 140,72 170,66 200,64 230,62" />
        <Marker x={116} y={82} color={entry} />
        <Marker x={170} y={68} color={target} />
        <Label x={196} y={92} color={level}>OVERSOLD</Label>
        <Label x={200} y={78} color={level}>EXIT</Label>
      </>
    ),
  },
  custom: {
    title: 'Custom strategy: your own conditions on prices and indicators',
    body: (
      <>
        <rect x="20" y="24" width="60" height="22" fill="none" stroke={level} strokeWidth="1" />
        <rect x="20" y="54" width="60" height="22" fill="none" stroke={level} strokeWidth="1" />
        <rect x="150" y="38" width="70" height="24" fill="none" stroke={entry} strokeWidth="1" />
        <polyline {...stroke} stroke={level} points="80,35 112,35 112,50 150,50" />
        <polyline {...stroke} stroke={level} points="80,65 112,65 112,50" />
        <Label x={28} y={38} color={level}>RULE</Label>
        <Label x={28} y={68} color={level}>RULE</Label>
        <Label x={160} y={53} color={entry}>ENTRY</Label>
      </>
    ),
  },
}

export function Schematic({ strategyId }: { strategyId: string }) {
  const item = schematics[strategyId]
  if (!item) return null
  return <Frame title={item.title}>{item.body}</Frame>
}
