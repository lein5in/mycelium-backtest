import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'

type ModalProps = {
  title: string
  children: ReactNode
  footer?: ReactNode | undefined
  onClose?: (() => void) | undefined
  initialFocus?: string | undefined
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, children, footer, onClose, initialFocus }: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const first = initialFocus ? dialog?.querySelector<HTMLElement>(initialFocus) : null
    ;(first ?? dialog?.querySelector<HTMLElement>(FOCUSABLE) ?? dialog)?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus()
    }
  }, [initialFocus])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && onClose) {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) {
      event.preventDefault()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-app/80 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="flex max-h-full w-full max-w-[560px] flex-col overflow-hidden border border-line-strong bg-panel shadow-[0_24px_64px_rgba(0,0,0,0.6)] outline-none"
      >
        <header className="flex min-h-9 shrink-0 items-center border-b border-line bg-panel-head px-4">
          <h2 id={titleId} className="label-caps m-0 font-medium text-ink-2">
            {title}
          </h2>
        </header>
        <div className="min-h-0 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  )
}
