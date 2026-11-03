export const tokenNames = [
  'bg-app',
  'bg-panel',
  'bg-panel-head',
  'border',
  'border-strong',
  'grid',
  'text',
  'text-2',
  'text-3',
  'accent',
  'violet',
  'violet-text',
  'cyan',
  'magenta',
  'profit',
  'profit-text',
  'loss',
  'loss-text',
  'warn',
  'warn-text',
  'node-core',
  'price-line',
  'heat-0',
  'heat-1',
  'heat-2',
  'heat-3',
  'heat-4',
  'heat-5',
  'heat-6',
] as const

export type TokenName = (typeof tokenNames)[number]
export type Theme = Record<TokenName, string>

export function readTheme(root: Element = document.documentElement): Theme {
  const style = getComputedStyle(root)
  const entries = tokenNames.map((name) => [name, style.getPropertyValue(`--${name}`).trim()])
  return Object.fromEntries(entries) as Theme
}

export function heatRamp(theme: Theme): string[] {
  return [
    theme['heat-0'],
    theme['heat-1'],
    theme['heat-2'],
    theme['heat-3'],
    theme['heat-4'],
    theme['heat-5'],
    theme['heat-6'],
  ]
}

export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? [...value].map((c) => c + c).join('') : value
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const a = Math.min(1, Math.max(0, alpha))
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`
}
