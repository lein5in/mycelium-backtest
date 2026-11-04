import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5417'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots')
const LIVE = process.env.SCREENSHOT_LIVE !== '0'
let counter = Number(process.env.SCREENSHOT_FIRST ?? 24)
const results = []
const consoleErrors = []

mkdirSync(OUT, { recursive: true })

async function shot(page, label, options = {}) {
  const file = `${String(counter++).padStart(2, '0')}-${label}.png`
  if (options.locator) await options.locator.screenshot({ path: resolve(OUT, file) })
  else await page.screenshot({ path: resolve(OUT, file), fullPage: Boolean(options.fullPage) })
  results.push({ screenshot: file })
}

async function newPage(browser, options = {}) {
  const context = options.context ?? (await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  }))
  await context.addInitScript(() => {
    window.localStorage.setItem('mycelium.consent', '1')
    window.sessionStorage.setItem('mycelium.intro', '1')
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${page.url()} ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()} ${String(error)}`))
  return page
}

function stats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b)
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return {
    frames: sorted.length,
    p50: Number(pick(0.5)?.toFixed(1)),
    p95: Number(pick(0.95)?.toFixed(1)),
    max: Number(sorted.at(-1)?.toFixed(1)),
    over33: sorted.filter((value) => value > 33.4).length,
  }
}

async function startFrames(page) {
  await page.evaluate(() => {
    window.__frames = []
    let last = performance.now()
    const tick = (now) => {
      window.__frames.push(now - last)
      last = now
      if (window.__framesOn) requestAnimationFrame(tick)
    }
    window.__framesOn = true
    requestAnimationFrame(tick)
  })
}

async function stopFrames(page) {
  return page.evaluate(() => {
    window.__framesOn = false
    return window.__frames.slice(1)
  })
}

async function waitForConfig(page) {
  await page.getByRole('button', { name: 'Run backtest' }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Opening Range Breakout' }).waitFor()
}

async function launch(page) {
  const clicked = Date.now()
  await page.getByRole('button', { name: 'Run backtest' }).click()
  await page.waitForURL(/\/app\/run\//, { timeout: 60_000 })
  await page.locator('ol[aria-label="Engine events shown"] li').first().waitFor({ timeout: 120_000 })
  return { clicked, firstShown: Date.now() }
}

async function waitDone(page, timeout = 120_000) {
  return Promise.race([
    page.getByTestId('verdict').waitFor({ timeout }).then(() => 'verdict'),
    page.locator('[data-testid="run-state"]', { hasText: /FAILED|CANCELLED/ }).waitFor({ timeout }).then(() => 'failed'),
  ]).catch(() => 'timeout')
}

const browser = await chromium.launch()
try {
  const page = await newPage(browser)
  await page.goto(`${BASE}/app`)
  await waitForConfig(page)
  await page.getByRole('button', { name: 'RSI Mean Reversion' }).click()
  const run = await launch(page)
  const runUrl = page.url()
  const runId = runUrl.split('/').at(-1)
  const firstArrival = await page.evaluate(() => performance.now())
  await page.waitForFunction(() => (window.__runPlayback?.steps ?? []).some((step) => step.kind === 'trade_cluster' || step.kind === 'clusters'), null, { timeout: 60_000 })
  await page.waitForTimeout(1300)
  await shot(page, 'run-midway')
  const midNote = await page.getByTestId('engine-note').textContent()
  const outcome = await waitDone(page)
  await page.waitForTimeout(600)
  await shot(page, 'run-done')
  const playback = await page.evaluate(() => window.__runPlayback?.steps ?? [])
  const lassos = await page.evaluate(() => window.__runCrawler?.model.lasso?.label ?? null)
  const first = playback[0]?.shownAt ?? 0
  const kinds = playback.reduce((map, step) => ({ ...map, [step.kind]: (map[step.kind] ?? 0) + 1 }), {})
  results.push({
    sampleRun: {
      outcome,
      clickToFirstEventShownSeconds: (run.firstShown - run.clicked) / 1000,
      engineNoteMidway: midNote,
      engineNoteDone: await page.getByTestId('engine-note').textContent(),
      displaySteps: playback.length,
      displaySeconds: Number(((playback.at(-1)?.shownAt - first) / 1000).toFixed(2)),
      clusterSteps: (kinds.trade_cluster ?? 0) + (kinds.clusters ?? 0),
      mergedClusterSteps: kinds.clusters ?? 0,
      lastLassoLabel: lassos,
      counters: await page.getByTestId('live-counters').first().innerText(),
      firstArrivalMs: firstArrival,
    },
  })

  await page.getByRole('link', { name: 'Open results' }).click()
  await page.waitForURL(/\/app\/results\//)
  await page.getByRole('heading', { name: 'Honesty report' }).waitFor({ timeout: 30_000 })
  await page.waitForTimeout(800)
  await shot(page, 'results-report')

  const chart = page.locator('#results-chart')
  await page.getByRole('tab', { name: 'Chart' }).click()
  const box = await chart.locator('canvas').first().boundingBox()
  await startFrames(page)
  if (box) {
    const x = box.x + box.width * 0.55
    const y = box.y + box.height * 0.3
    await page.mouse.move(x, y)
    for (let index = 0; index < 30; index += 1) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(16)
    }
    await page.mouse.down()
    for (let index = 0; index < 60; index += 1) {
      await page.mouse.move(x - index * 6, y, { steps: 1 })
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
  }
  results.push({ chartPanZoomFrames: stats(await stopFrames(page)), bars: await page.locator('[data-testid="kpi-Trades"]').textContent() })
  await page.waitForTimeout(400)
  await shot(page, 'results-chart-heatmap-zoomed', { locator: chart })

  const tradesSection = page.locator('#results-trades')
  await page.getByRole('tab', { name: 'Trades' }).click()
  await page.waitForTimeout(300)
  await shot(page, 'results-trades', { locator: tradesSection })

  const calendarSection = page.locator('#results-calendar')
  await page.getByRole('tab', { name: 'Calendar' }).click()
  const dayButton = calendarSection.locator('table button[aria-pressed]').first()
  const dayLabel = await dayButton.getAttribute('aria-label')
  await dayButton.click()
  await page.waitForTimeout(300)
  const filteredRange = await page.getByTestId('trades-range').textContent()
  results.push({ calendarFilter: { day: dayLabel, url: page.url().split('?')[1], tradesRange: filteredRange } })
  await calendarSection.scrollIntoViewIfNeeded()
  await shot(page, 'results-calendar-day-filter', { locator: calendarSection })
  await dayButton.click()

  await page.getByRole('tab', { name: 'Sweep' }).click()
  await page.waitForTimeout(300)
  await shot(page, 'results-sweep', { locator: page.locator('#results-sweep') })

  const firstTradeRow = tradesSection.locator('tbody tr').first()
  await firstTradeRow.click()
  await page.waitForTimeout(500)
  results.push({ tradeSelection: page.url().split('?')[1] })

  await page.getByRole('button', { name: "Start a replay of the finished run's chart" }).click()
  const slider = page.getByRole('slider', { name: 'Replay position' })
  const max = Number(await slider.getAttribute('max'))
  await slider.fill(String(Math.round(max / 2)))
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: 'Pause', exact: true }).click()
  await page.waitForTimeout(300)
  results.push({ replay: await page.getByTestId('replay-position').textContent() })
  await shot(page, 'results-replay-midway', { locator: chart })
  await page.getByRole('button', { name: 'Exit replay' }).click()

  await page.reload()
  await page.getByRole('heading', { name: 'Honesty report' }).waitFor({ timeout: 30_000 })
  await page.goto(`${BASE}/app/history`)
  await page.getByTestId('history-table').waitFor({ timeout: 15_000 })
  const historyRows = await page.getByTestId('history-table').locator('tbody tr').count()
  await shot(page, 'history-entries')
  await page.getByTestId('history-table').locator('tbody tr').first().getByRole('link', { name: 'Open' }).click()
  await page.getByRole('heading', { name: 'Honesty report' }).waitFor({ timeout: 30_000 })
  results.push({ history: { rows: historyRows, reopenedAfterReload: page.url().includes(runId) } })

  const narrow = await newPage(browser, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  await narrow.goto(`${BASE}/app/results/${runId}`)
  await narrow.getByRole('heading', { name: 'Honesty report' }).waitFor({ timeout: 30_000 })
  await narrow.waitForTimeout(500)
  results.push({ narrowOverflow390: await narrow.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) })
  await shot(narrow, 'results-narrow-390')
  await narrow.setViewportSize({ width: 360, height: 800 })
  await narrow.goto(`${BASE}${new URL(runUrl).pathname}`)
  await narrow.waitForTimeout(1500)
  results.push({ narrowRunOverflow360: await narrow.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) })

  const fresh = await newPage(browser)
  await fresh.goto(`${BASE}/app/history`)
  await fresh.getByText('No runs saved in this browser yet').waitFor()
  await shot(fresh, 'history-empty')
  await fresh.goto(`${BASE}/app/results/0000000000000000000000000000dead`)
  await fresh.getByRole('heading', { name: 'This result has expired' }).waitFor({ timeout: 30_000 })
  await shot(fresh, 'results-expired')

  const cancel = await newPage(browser)
  await cancel.goto(`${BASE}/app`)
  await waitForConfig(cancel)
  await cancel.locator('#data-timeframe').selectOption('1m')
  await cancel.locator('#data-range-start').fill('2024-01-02')
  await cancel.locator('#data-range-end').fill('2024-03-29')
  await cancel.locator('#honesty-draws').fill('5000')
  await cancel.getByRole('button', { name: 'Run backtest' }).click()
  await cancel.waitForURL(/\/app\/run\//, { timeout: 60_000 })
  await cancel.getByRole('button', { name: 'Stop the run on the engine' }).click({ timeout: 30_000 })
  const cancelOutcome = await waitDone(cancel, 60_000)
  await cancel.getByRole('tab', { name: /Errors/ }).click()
  await cancel.waitForTimeout(500)
  results.push({ failureCase: { outcome: cancelOutcome, state: await cancel.getByTestId('run-state').textContent() } })
  await shot(cancel, 'run-cancelled')

  if (LIVE) {
    const live = await newPage(browser)
    await live.goto(`${BASE}/app`)
    await waitForConfig(live)
    await live.getByRole('radio', { name: 'Crypto' }).click()
    await live.getByRole('button', { name: 'Donchian Channel Breakout' }).click()
    const liveRun = await launch(live)
    const liveOutcome = await waitDone(live, 180_000)
    await live.waitForTimeout(1000)
    results.push({
      liveCoinbase: {
        outcome: liveOutcome,
        clickToFirstEventShownSeconds: (liveRun.firstShown - liveRun.clicked) / 1000,
        engineNote: await live.getByTestId('engine-note').textContent(),
        verdict: liveOutcome === 'verdict' ? await live.getByTestId('verdict').textContent() : null,
      },
    })
    await shot(live, 'run-live-coinbase-done')
  }
} finally {
  await browser.close()
  console.log(JSON.stringify({ results, consoleErrors }, null, 2))
}
