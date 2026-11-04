import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { rangeHint } from './format'
import { Hint } from './Hint'

const controlBase =
  'min-h-[30px] min-w-0 rounded-sm border bg-app px-2 font-mono text-data text-ink outline-none transition-colors duration-150 focus-visible:border-accent disabled:cursor-not-allowed disabled:text-ink-3'

const border = (error?: string | null) => (error ? 'border-loss' : 'border-line-strong hover:border-ink-3')

const describedBy = (...ids: unknown[]) =>
  ids.filter((id): id is string => typeof id === 'string' && id.length > 0).join(' ') || undefined

type Common = { id: string; error?: string | null | undefined; hint?: ReactNode | undefined }

export function FieldMessages({ id, error, hint }: Common) {
  return (
    <>
      {hint && <Hint id={`${id}-hint`}>{hint}</Hint>}
      {error && (
        <Hint id={`${id}-error`} tone="error">
          {error}
        </Hint>
      )}
    </>
  )
}

export type SelectOption = { value: string; label: string; disabled?: boolean }

type SelectProps = Common & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & { options: SelectOption[] }

export function Select({ id, error, hint, options, className = '', ...rest }: SelectProps) {
  return (
    <span className="flex w-full min-w-0 flex-col items-end gap-1">
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        className={`${controlBase} ${border(error)} w-full max-w-[220px] ${className}`}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <FieldMessages id={id} error={error} hint={hint} />
    </span>
  )
}

type TextInputProps = Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>

export function TextInput({ id, error, hint, className = '', type = 'text', ...rest }: TextInputProps) {
  return (
    <span className="flex w-full min-w-0 flex-col items-end gap-1">
      <input
        id={id}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
        className={`${controlBase} ${border(error)} w-full max-w-[220px] ${className}`}
        {...rest}
      />
      <FieldMessages id={id} error={error} hint={hint} />
    </span>
  )
}

type NumberInputProps = Common &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'> & {
    value: string
    onValueChange: (value: string) => void
    unit?: string | null | undefined
    min?: number | null | undefined
    max?: number | null | undefined
    step?: number | null | undefined
  }

export function NumberInput({ id, error, hint, value, onValueChange, unit, min, max, step, ...rest }: NumberInputProps) {
  const range = hint ?? rangeHint(min, max, step)
  return (
    <span className="flex w-full min-w-0 flex-col items-end gap-1">
      <span className="flex w-full max-w-[220px] items-stretch justify-end">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={min ?? undefined}
          max={max ?? undefined}
          step={step ?? 'any'}
          onChange={(event) => onValueChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(range && `${id}-hint`, error && `${id}-error`, unit && `${id}-unit`)}
          className={`${controlBase} ${border(error)} w-full text-right tabular-nums ${unit ? 'rounded-r-none' : ''}`}
          {...rest}
        />
        {unit && (
          <span
            id={`${id}-unit`}
            className="inline-flex shrink-0 items-center rounded-r-sm border border-l-0 border-line-strong bg-panel-head px-2 font-mono text-[11px] text-ink-3"
          >
            {unit}
          </span>
        )}
      </span>
      <FieldMessages id={id} error={error} hint={range} />
    </span>
  )
}

type DateRangeProps = {
  id: string
  start: string
  end: string
  onChange: (range: { start: string; end: string }) => void
  min?: string | undefined
  max?: string | undefined
  error?: string | null | undefined
  hint?: ReactNode | undefined
  disabled?: boolean | undefined
}

export function DateRangeInput({ id, start, end, onChange, min, max, error, hint, disabled }: DateRangeProps) {
  const described = describedBy(hint && `${id}-hint`, error && `${id}-error`)
  const dateClass = `${controlBase} ${border(error)} w-[128px] [color-scheme:dark]`
  return (
    <span className="flex w-full min-w-0 flex-col items-end gap-1">
      <span className="flex w-full flex-wrap items-center justify-end gap-1">
        <input
          id={`${id}-start`}
          type="date"
          aria-label="Start date"
          value={start}
          min={min}
          max={end || max}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(event) => onChange({ start: event.target.value, end })}
          className={dateClass}
        />
        <span aria-hidden="true" className="text-ink-3">
          to
        </span>
        <input
          id={`${id}-end`}
          type="date"
          aria-label="End date"
          value={end}
          min={start || min}
          max={max}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(event) => onChange({ start, end: event.target.value })}
          className={dateClass}
        />
      </span>
      <FieldMessages id={id} error={error} hint={hint} />
    </span>
  )
}

type CheckboxProps = Common & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'type'> & { label: ReactNode }

export function Checkbox({ id, label, error, hint, ...rest }: CheckboxProps) {
  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex min-h-[30px] items-center gap-2">
        <input
          id={id}
          type="checkbox"
          aria-describedby={describedBy(hint && `${id}-hint`, error && `${id}-error`)}
          className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
          {...rest}
        />
        <label htmlFor={id} className="cursor-pointer text-[13px] text-ink">
          {label}
        </label>
      </span>
      <FieldMessages id={id} error={error} hint={hint} />
    </span>
  )
}
