import { useState } from 'react'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Field'
import { Modal } from '../ui/Modal'
import { CONSENT_POINTS } from './consent'

type ConsentModalProps = {
  onAccept: () => void
  onClose?: () => void
  accepted: boolean
  storageFailed: boolean
}

export function ConsentModal({ onAccept, onClose, accepted, storageFailed }: ConsentModalProps) {
  const [understood, setUnderstood] = useState(accepted)
  return (
    <Modal
      title="Before you start"
      onClose={accepted ? onClose : undefined}
      initialFocus="#consent-understood"
      footer={
        <>
          {accepted && onClose && <Button onClick={onClose}>Close</Button>}
          <Button variant="primary" disabled={!understood} onClick={onAccept}>
            Continue
          </Button>
        </>
      }
    >
      <ul className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] leading-relaxed text-ink">
        {CONSENT_POINTS.map((point) => (
          <li key={point} className="border-l border-line-strong pl-3">
            {point}
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-3 text-[13px] text-ink-2">
        No tracking and no analytics. Your answer is stored in this browser only.
      </p>
      {storageFailed && (
        <p role="alert" className="mt-0 mb-3 text-[13px] text-warn-text">
          This browser blocked local storage, so we will ask again next time.
        </p>
      )}
      <Checkbox
        id="consent-understood"
        label="I understand"
        checked={understood}
        onChange={(event) => setUnderstood(event.target.checked)}
      />
    </Modal>
  )
}
