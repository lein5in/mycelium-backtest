import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { CONSENT_KEY, CONSENT_VERSION, readConsent, writeConsent, type ConsentStore } from './consent'
import { useConsent } from './context'

vi.mock('../api/client', async (original) => ({
  ...(await original<typeof import('../api/client')>()),
  getHealth: vi.fn(async () => ({ status: 'ok', version: '0.1.0' })),
}))

function Probe() {
  const consent = useConsent()
  const [launched, setLaunched] = useState<string>('idle')
  return (
    <button type="button" onClick={() => setLaunched(consent.request() ? 'launched' : 'blocked')}>
      Launch {launched}
    </button>
  )
}

function renderShell() {
  const router = createMemoryRouter([{ path: '/app', Component: AppShell, children: [{ index: true, Component: Probe }] }], {
    initialEntries: ['/app'],
  })
  return render(<RouterProvider router={router} />)
}

const memoryStore = (): ConsentStore & { data: Map<string, string> } => {
  const data = new Map<string, string>()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

const brokenStore: ConsentStore = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('consent storage', () => {
  it('reads and writes the versioned flag', () => {
    const store = memoryStore()
    expect(readConsent(store)).toBe(false)
    expect(writeConsent(store)).toBe(true)
    expect(store.data.get(CONSENT_KEY)).toBe(CONSENT_VERSION)
    expect(readConsent(store)).toBe(true)
  })

  it('survives a storage that throws', () => {
    expect(readConsent(brokenStore)).toBe(false)
    expect(writeConsent(brokenStore)).toBe(false)
    expect(readConsent(null)).toBe(false)
  })
})

describe('consent modal in the shell', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('appears on first visit, needs the checkbox, stores acceptance and reopens from the footer', async () => {
    renderShell()
    const dialog = await screen.findByRole('dialog', { name: 'Before you start' })
    expect(dialog).toHaveTextContent('It is not speculative, it is not financial advice')
    const proceed = screen.getByRole('button', { name: 'Continue' })
    expect(proceed).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('I understand'))
    await userEvent.click(proceed)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe(CONSENT_VERSION)
    await userEvent.click(screen.getByRole('button', { name: /Launch/ }))
    expect(screen.getByRole('button', { name: 'Launch launched' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Terms of use' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('blocks a launch until accepted', async () => {
    renderShell()
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByLabelText('I understand'))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    window.localStorage.clear()
    expect(screen.getByRole('button', { name: 'Launch idle' })).toBeInTheDocument()
  })

  it('does not show the modal when already accepted, and asks before a launch otherwise', async () => {
    window.localStorage.setItem(CONSENT_KEY, CONSENT_VERSION)
    renderShell()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Engine online · v0.1.0'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps working when storage is blocked and asks again next time', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderShell()
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /Launch/ }))
    expect(screen.getByRole('button', { name: 'Launch blocked' })).toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('I understand'))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Launch/ }))
    expect(screen.getByRole('button', { name: 'Launch launched' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Terms of use' }))
    expect(screen.getByRole('alert')).toHaveTextContent('blocked local storage')
  })
})
