import { useRef, useState, type DragEvent } from 'react'
import { Button } from './Button'
import { checkFile, formatBytes } from './format'
import { Hint } from './Hint'

type FileDropZoneProps = {
  id: string
  label: string
  accept: string
  maxBytes: number
  onFile: (file: File) => void
  onReject: (message: string) => void
  disabled?: boolean | undefined
  fileName?: string | null | undefined
}

export function FileDropZone({ id, label, accept, maxBytes, onFile, onReject, disabled, fileName }: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const take = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const problem = checkFile(file, maxBytes)
    if (problem) onReject(problem)
    else onFile(file)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setOver(false)
    if (!disabled) take(event.dataTransfer.files)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid={`${id}-zone`}
      className={`flex flex-col items-start gap-2 border border-dashed px-3 py-3 transition-colors duration-150 ${over ? 'border-accent bg-hover' : 'border-line-strong'}`}
    >
      <span className="text-[13px] text-ink-2">{fileName ? fileName : 'Drop a CSV file here, or'}</span>
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="sr-only-text"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(event) => {
          take(event.target.files)
          event.target.value = ''
        }}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={disabled}>
        {fileName ? 'Choose another file' : label}
      </Button>
      <Hint>Up to {formatBytes(maxBytes)}. Checked here before upload, then validated by the engine.</Hint>
    </div>
  )
}
