import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { CHECK_LABELS, VERDICT_CLASSES, VERDICT_LABELS } from '../features/report/format'
import { RecordedRunFrame } from '../features/recorded/RecordedRunFrame'
import { loadRecordedRun, type RecordedRun } from '../features/recorded/recordedRun'
import { useIntroPlaying } from '../features/intro/introState'
import { Tag } from '../ui/Tag'
import { AVAILABLE_NOW, FUTURE, LIBRARY, SOON, type RoadmapItem } from './content'
import { SiteShell } from './SiteShell'

type Load = { status: 'loading' } | { status: 'ready'; run: RecordedRun } | { status: 'error' }

const FACTS = [
  { term: 'Markets', detail: 'Crypto from public exchange data. Stocks and ETFs through your own CSV and labelled sample sets.' },
  { term: 'Strategies', detail: 'Five library strategies with documented parameters and a stop-loss on each.' },
  { term: 'Checks', detail: 'Six honesty checks on every run, ending in a verdict: credible, fragile or not credible.' },
  { term: 'Access', detail: 'Runs from your browser with no account. Your history stays on your device.' },
]

function useHashScroll() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const target = document.getElementById(hash.slice(1))
    if (!target) return
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
  }, [hash])
}

function BackdropChart({ run }: { run: RecordedRun }) {
  const points = useMemo(() => {
    const close = run.payload.bars.close
    const low = Math.min(...close)
    const high = Math.max(...close)
    const step = Math.max(1, Math.floor(close.length / 300))
    const out: string[] = []
    for (let index = 0; index < close.length; index += step) {
      out.push(`${((index / close.length) * 1000).toFixed(1)},${(300 - (((close[index] ?? low) - low) / (high - low || 1)) * 260).toFixed(1)}`)
    }
    return out.join(' ')
  }, [run])
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 1000 320"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.09] [mask-image:linear-gradient(to_right,transparent,black_60%)]"
    >
      <polyline points={points} fill="none" stroke="var(--price-line)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function FramePlaceholder({ failed }: { failed: boolean }) {
  return (
    <div className="flex aspect-[16/10] items-center justify-center border border-line-strong bg-app px-6 text-center text-[13px] text-ink-3">
      {failed ? 'The recorded run could not be loaded. The app itself is not affected.' : 'Loading the recorded run'}
    </div>
  )
}

function RoadmapColumn({ title, items, soon }: { title: string; items: RoadmapItem[]; soon?: boolean }) {
  return (
    <section aria-labelledby={`roadmap-${title}`} className="flex flex-col gap-3 border-t border-line pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6 md:first:border-l-0 md:first:pl-0">
      <h3 id={`roadmap-${title}`} className="m-0 flex items-center gap-2 text-[17px] font-semibold text-ink">
        {title}
        {soon && <Tag state="SOON" />}
      </h3>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((item) => (
          <li key={item.title} className="text-[14px] leading-relaxed">
            <span className="text-ink">{item.title}.</span> <span className="text-ink-2">{item.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Landing() {
  useHashScroll()
  const [load, setLoad] = useState<Load>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadRecordedRun()
      .then((run) => {
        if (!cancelled) setLoad({ status: 'ready', run })
      })
      .catch(() => {
        if (!cancelled) setLoad({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const introPlaying = useIntroPlaying()
  const loaded = load.status === 'ready' ? load.run : null
  const run = introPlaying ? null : loaded
  const report = loaded?.payload.report

  return (
    <SiteShell>
      <section aria-labelledby="hero-title" className="relative overflow-hidden border-b border-line">
        {loaded && <BackdropChart run={loaded} />}
        <div className="relative mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-20">
          <div className="flex flex-col gap-6">
            <p className="m-0 text-[14px] text-violet-text">Strategy backtesting with an honesty verdict</p>
            <h1 id="hero-title" className="m-0 text-[40px] leading-[1.05] font-semibold tracking-[-0.01em] text-ink sm:text-[58px]">
              Backtesting that tells you the truth.
            </h1>
            <p className="m-0 max-w-[52ch] text-[16px] leading-relaxed text-ink-2">
              Run a trading strategy on past data and see what is left after real costs, without its best trade, on the part of the
              data it was not tuned on, and next to random entries. Crypto comes from public exchange data; for stocks and ETFs, bring
              your own CSV or try the labelled sample sets.
            </p>
            <div className="grid gap-px border border-line bg-line">
              <Link to="/app" className="group flex min-h-11 flex-col gap-1 bg-panel px-4 py-3 hover:bg-hover">
                <span className="font-mono text-[12px] tracking-[0.1em] text-accent-text">RUN IN YOUR BROWSER</span>
                <span className="text-[14px] text-ink">Pick a library strategy and a crypto pair or sample set, then run it. No account.</span>
              </Link>
              <Link to="/app?market=csv" className="group flex min-h-11 flex-col gap-1 bg-panel px-4 py-3 hover:bg-hover">
                <span className="font-mono text-[12px] tracking-[0.1em] text-accent-text">IMPORT YOUR OWN CSV</span>
                <span className="text-[14px] text-ink">Use your own stock, ETF or crypto bars. The file is processed in memory and not kept.</span>
              </Link>
            </div>
          </div>
          <div className="min-w-0">{run ? <RecordedRunFrame run={run} className="aspect-auto h-[460px] lg:h-[520px]" /> : <FramePlaceholder failed={load.status === 'error'} />}</div>
        </div>
      </section>

      <section aria-label="Facts" className="border-b border-line">
        <dl className="mx-auto m-0 grid w-full max-w-[1320px] sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map((fact) => (
            <div key={fact.term} className="flex flex-col gap-1.5 border-b border-line px-4 py-6 sm:px-6 sm:odd:border-r lg:border-r lg:border-b-0 lg:last:border-r-0">
              <dt className="text-[15px] font-semibold text-ink">{fact.term}</dt>
              <dd className="m-0 text-[14px] leading-relaxed text-ink-2">{fact.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="platform" tabIndex={-1} aria-labelledby="platform-title" className="border-b border-line outline-none">
        <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <div className="flex flex-col gap-4">
            <h2 id="platform-title" className="m-0 text-[30px] leading-tight font-semibold text-ink sm:text-[38px]">
              You see the engine work
            </h2>
            <p className="m-0 max-w-[48ch] text-[15px] leading-relaxed text-ink-2">
              The engine reports each stage as it goes: data, signals, the simulation bar by bar, costs, the six checks and the report.
              A crawler on the chart follows those events. It walks where the simulation is, wraps each group of closed trades and taps
              each check as it finishes.
            </p>
            <p className="m-0 max-w-[48ch] text-[15px] leading-relaxed text-ink-2">
              It may lag the engine, never lead it. When the engine finishes in under a second, the screen says so and replays the
              events it received; nothing pretends to still be computing.
            </p>
          </div>
          <div className="min-w-0">{run ? <RecordedRunFrame run={run} showTrades className="h-[460px] lg:h-[560px]" /> : <FramePlaceholder failed={load.status === 'error'} />}</div>
        </div>
      </section>

      <section id="honesty" tabIndex={-1} aria-labelledby="honesty-title" className="border-b border-line outline-none">
        <div className="mx-auto grid w-full max-w-[1320px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-4">
            <h2 id="honesty-title" className="m-0 text-[30px] leading-tight font-semibold text-ink sm:text-[38px]">
              An honesty report on every run
            </h2>
            <p className="m-0 max-w-[50ch] text-[15px] leading-relaxed text-ink-2">
              A backtest can look good for bad reasons: costs left out, one lucky trade, rules tuned on the same data, or a result that
              random entries match. Each run is checked for these six problems, with too few trades reported as insufficient rather
              than as a pass.
            </p>
            <p className="m-0 max-w-[50ch] text-[15px] leading-relaxed text-ink-2">
              The verdict is credible, fragile or not credible, and the report shows the rules that decided it.
            </p>
          </div>
          <figure className="m-0 min-w-0 border border-line-strong bg-panel">
            {report ? (
              <>
                <table className="w-full border-collapse text-[13px]">
                  <caption className="sr-only-text">Honesty checks of the recorded run</caption>
                  <thead>
                    <tr className="bg-panel-head text-left">
                      {['State', 'Check', 'Key figure'].map((header) => (
                        <th key={header} scope="col" className="border-b border-line-strong px-3 py-2 font-mono text-[11px] font-medium tracking-[0.1em] text-ink-3">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.checks.map((check) => (
                      <tr key={check.id} className="border-b border-line align-top">
                        <td className="px-3 py-2">
                          <Tag state={check.status} />
                          {check.insufficient_data && <span className="mt-1 block font-mono text-[10.5px] text-warn-text">insufficient data</span>}
                        </td>
                        <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                          {CHECK_LABELS[check.id]}
                        </th>
                        <td className="px-3 py-2 text-ink-2">{check.headline}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="m-0 flex flex-wrap items-center gap-2 px-3 py-3 text-[13px] text-ink-2">
                  Verdict
                  <span className={`border px-2 py-0.5 font-mono text-[12px] font-semibold tracking-[0.1em] ${VERDICT_CLASSES[report.verdict.id]}`}>
                    {VERDICT_LABELS[report.verdict.id]}
                  </span>
                </p>
              </>
            ) : (
              <p className="m-0 px-3 py-6 text-[13px] text-ink-3">{load.status === 'error' ? 'The recorded report could not be loaded.' : 'Loading the recorded report'}</p>
            )}
            <figcaption className="border-t border-line px-3 py-2 text-[12.5px] text-warn-text">
              Recorded on sample data. Illustrative, not a real market result.
            </figcaption>
          </figure>
        </div>
      </section>

      <section id="strategies" tabIndex={-1} aria-labelledby="strategies-title" className="border-b border-line outline-none">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-6 px-4 py-16 sm:px-6">
          <div className="flex max-w-[62ch] flex-col gap-3">
            <h2 id="strategies-title" className="m-0 text-[30px] leading-tight font-semibold text-ink sm:text-[38px]">
              Strategy library
            </h2>
            <p className="m-0 text-[15px] leading-relaxed text-ink-2">
              Each strategy is a set of declared rules with documented parameters. No performance figures are shown here: run one and
              read its honesty report.
            </p>
          </div>
          <div className="max-w-full overflow-x-auto border border-line">
            <table className="w-full min-w-[640px] border-collapse text-[14px]">
              <caption className="sr-only-text">Strategies</caption>
              <thead>
                <tr className="bg-panel-head text-left">
                  {['Name', 'Idea', 'Type', 'Status'].map((header) => (
                    <th key={header} scope="col" className="border-b border-line-strong px-4 py-2 font-mono text-[11px] font-medium tracking-[0.1em] text-ink-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {LIBRARY.map((row) => (
                  <tr key={row.name} className="border-b border-line align-top last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-left font-medium whitespace-nowrap text-ink">
                      {row.name}
                    </th>
                    <td className="px-4 py-3 text-ink-2">{row.idea}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-2">{row.type}</td>
                    <td className="px-4 py-3">{row.status === 'Soon' ? <Tag state="SOON" /> : <span className="text-[13px] text-profit-text">Available</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="roadmap" tabIndex={-1} aria-labelledby="roadmap-title" className="outline-none">
        <div className="mx-auto flex w-full max-w-[1320px] flex-col gap-8 px-4 py-16 sm:px-6">
          <div className="flex max-w-[62ch] flex-col gap-3">
            <h2 id="roadmap-title" className="m-0 text-[30px] leading-tight font-semibold text-ink sm:text-[38px]">
              Roadmap
            </h2>
            <p className="m-0 text-[15px] leading-relaxed text-ink-2">What works today, what comes next, and what comes later. No dates are promised.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            <RoadmapColumn title="Available now" items={AVAILABLE_NOW} />
            <RoadmapColumn title="Soon" items={SOON} soon />
            <RoadmapColumn title="Future releases" items={FUTURE} />
          </div>
          <Link to="/roadmap" className="self-start text-[14px] text-accent-text underline">
            Read the roadmap page
          </Link>
        </div>
      </section>
    </SiteShell>
  )
}
