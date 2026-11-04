import { useState } from 'react'
import { REPO_URL } from './hosted'

type Step = { title: string; detail: string; windows: string; unix: string }

const CLONE_URL = REPO_URL ?? '<repository-url>'

const STEPS: Step[] = [
  {
    title: 'Clone the repository',
    detail: 'The repository address is the one this site links to.',
    windows: `git clone ${CLONE_URL} mycelium-backtest\ncd mycelium-backtest`,
    unix: `git clone ${CLONE_URL} mycelium-backtest\ncd mycelium-backtest`,
  },
  {
    title: 'Create the backend environment and install the pinned packages',
    detail: 'The constraints file fixes every package, including the indirect ones, to the versions the project was tested with.',
    windows:
      'cd backend\npy -3.12 -m venv .venv\n.\\.venv\\Scripts\\python -m pip install -r requirements.txt -c constraints.txt',
    unix: 'cd backend\npython3.12 -m venv .venv\n./.venv/bin/python -m pip install -r requirements.txt -c constraints.txt',
  },
  {
    title: 'Start the backend',
    detail: 'Leave this terminal open. The engine listens on port 8417 on your machine only.',
    windows: '.\\.venv\\Scripts\\python -m app.dev',
    unix: './.venv/bin/python -m app.dev',
  },
  {
    title: 'Start the frontend in a second terminal',
    detail: 'From the repository folder. The first install downloads the packages and can take a few minutes.',
    windows: 'cd frontend\nnpm install\nnpm run dev',
    unix: 'cd frontend\nnpm install\nnpm run dev',
  },
  {
    title: 'Open it in your browser',
    detail: 'Accept the terms once, then pick a strategy and a data source.',
    windows: 'start http://localhost:5417',
    unix: 'open http://localhost:5417   # on Linux: xdg-open http://localhost:5417',
  },
]

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }
  return (
    <div className="min-w-0 border border-line-strong bg-app">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-panel-head px-3">
        <span className="font-mono text-[11px] tracking-[0.1em] text-ink-3">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-11 items-center px-2 font-mono text-[11px] tracking-[0.1em] text-accent-text hover:text-ink"
        >
          {copied === 'done' ? 'COPIED' : copied === 'failed' ? 'COPY FAILED' : 'COPY'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto px-3 py-3 font-mono text-[12.5px] leading-relaxed text-ink" tabIndex={0} aria-label={`${label} commands`}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function RunLocally() {
  return (
    <section id="run-locally" tabIndex={-1} aria-labelledby="run-locally-title" className="border-t border-line outline-none">
      <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 py-16 sm:px-6">
        <div className="flex max-w-[68ch] flex-col gap-3">
          <h2 id="run-locally-title" className="m-0 text-[30px] leading-tight font-semibold text-ink sm:text-[38px]">
            Run it locally
          </h2>
          <p className="m-0 text-[15px] leading-relaxed text-ink-2">
            The engine is not hosted on this site. Mycelium Backtest runs on your own machine: a Python backend on port 8417 and a web
            interface on port 5417. Crypto data needs an internet connection; the sample sets and CSV import work offline. Nothing
            leaves your machine except the public data requests you ask for.
          </p>
        </div>
        <div className="max-w-[68ch]">
          <h3 className="m-0 text-[17px] font-semibold text-ink">You need</h3>
          <ul className="mt-2 mb-0 flex list-disc flex-col gap-1 pl-5 text-[14.5px] leading-relaxed text-ink-2">
            <li>Python 3.12</li>
            <li>Node.js 26.13 or a later 26.x release, with npm</li>
            <li>git</li>
          </ul>
        </div>
        <ol className="m-0 flex list-none flex-col gap-8 p-0">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3">
              <div className="flex max-w-[68ch] flex-col gap-1">
                <h3 className="m-0 flex items-baseline gap-3 text-[17px] font-semibold text-ink">
                  <span className="font-mono text-[13px] text-accent-text">{String(index + 1).padStart(2, '0')}</span>
                  {step.title}
                </h3>
                <p className="m-0 text-[14.5px] leading-relaxed text-ink-2">{step.detail}</p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <CodeBlock label="WINDOWS POWERSHELL" code={step.windows} />
                <CodeBlock label="MACOS / LINUX" code={step.unix} />
              </div>
            </li>
          ))}
        </ol>
        <p className="m-0 max-w-[68ch] text-[14px] leading-relaxed text-ink-3">
          Stop either server with Ctrl+C. Research tool, not financial advice.
        </p>
      </div>
    </section>
  )
}
