import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'toggle'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  active?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-app border border-accent hover:brightness-110',
  secondary: 'bg-transparent text-ink border border-line-strong hover:bg-hover',
  toggle: 'bg-transparent text-ink-2 border border-line-strong hover:bg-hover',
}

export function Button({
  variant = 'secondary',
  active = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const activeClass = active ? 'border-accent text-accent-text' : ''
  const pressed = variant === 'toggle' ? { 'aria-pressed': active } : {}
  return (
    <button
      type={type}
      {...pressed}
      className={`inline-flex min-h-[34px] items-center justify-center gap-2 rounded-sm px-3 font-mono text-xs font-medium tracking-[0.06em] uppercase transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${variantClasses[variant]} ${activeClass} ${className}`}
      {...rest}
    />
  )
}
