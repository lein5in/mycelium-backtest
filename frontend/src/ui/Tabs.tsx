import { useRef, type KeyboardEvent } from 'react'
import { panelId, tabId } from './format'
import { Tag } from './Tag'

export type TabItem = { id: string; label: string; soon?: boolean; disabled?: boolean }

type TabsProps = {
  label: string
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  idPrefix: string
}

export function Tabs({ label, items, value, onChange, idPrefix }: TabsProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const enabled = items.flatMap((item, index) => (item.disabled || item.soon ? [] : [index]))

  const move = (event: KeyboardEvent<HTMLButtonElement>, current: number) => {
    const position = enabled.indexOf(current)
    const count = enabled.length
    const targets: Record<string, number | undefined> = {
      ArrowRight: enabled[(position + 1) % count],
      ArrowLeft: enabled[(position - 1 + count) % count],
      Home: enabled[0],
      End: enabled[count - 1],
    }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    const item = items[target]
    if (!item) return
    onChange(item.id)
    refs.current[target]?.focus()
  }

  return (
    <div role="tablist" aria-label={label} className="flex min-h-[34px] flex-wrap items-stretch border-b border-line bg-panel-head">
      {items.map((item, index) => {
        const selected = item.id === value
        const unavailable = Boolean(item.disabled || item.soon)
        return (
          <button
            key={item.id}
            ref={(element) => {
              refs.current[index] = element
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={unavailable ? undefined : panelId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            disabled={unavailable}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => move(event, index)}
            className={`label-caps -mb-px inline-flex min-h-[34px] items-center gap-2 border-b-2 px-3 transition-colors duration-150 disabled:cursor-not-allowed ${selected ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink-2'}`}
          >
            {item.label}
            {item.soon && <Tag state="SOON" />}
          </button>
        )
      })}
    </div>
  )
}
