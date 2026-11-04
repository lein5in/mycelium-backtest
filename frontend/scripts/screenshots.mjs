import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5417'
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/screenshots')
const FIRST = Number(process.env.SCREENSHOT_FIRST ?? 10)
const LIVE = process.env.SCREENSHOT_LIVE !== '0'
const CONSENT = ['mycelium.consent', '1']

mkdirSync(OUT, { recursive: true })
let counter = FIRST
const results = []
const consoleErrors = []

const name = (label) => `${String(counter++).padStart(2, '0')}-${label}.png`

async function shot(page, label, fullPage = false) {
  const file = name(label)
  await page.screenshot({ path: resolve(OUT, file), fullPage })
  results.push({ screenshot: file })
}

function problemCsv() {
  const lines = ['timestamp,open,high,low,close,volume']
  const start = Date.UTC(2024, 0, 2, 14, 30)
  let price = 50
  for (let i = 0; i < 160; i += 1) {
    const time = new Date(start + i * 5 * 60_000).toISOString().replace('.000Z', 'Z')
    const open = price
    const close = price + Math.sin(i / 7) * 0.2
    const high = Math.max(open, close) + 0.1
    const low = Math.min(open, close) - 0.1
    price = close
    const cells = [time, open.toFixed(2), high.toFixed(2), low.toFixed(2), close.toFixed(2), String(1000 + i)]
    if (i === 10) cells[1] = 'n/a'
    if (i === 20) cells[4] = '-3'
    if (i === 30) cells[5] = ''
    lines.push(cells.join(','))
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf-8')
}

async function newPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  if (options.consent !== false) {
    await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), CONSENT)
  }
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${page.url()} ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()} ${String(error)}`))
  return page
}

async function waitForConfig(page) {
  await page.getByRole('button', { name: 'Run backtest' }).waitFor()
  await page.getByRole('button', { name: 'Opening Range Breakout' }).waitFor()
}

async function launchAndWait(page, label) {
  const started = Date.now()
  await page.getByRole('button', { name: 'Run backtest' }).click()
  await page.waitForURL(/\/app\/run\//, { timeout: 60_000 })
  const outcome = await Promise.race([
    page.getByTestId('verdict').waitFor({ timeout: 150_000 }).then(() => 'verdict'),
    page.getByRole('alert').first().waitFor({ timeout: 150_000 }).then(() => 'error'),
  ]).catch(() => 'timeout')
  const verdict = outcome === 'verdict' ? await page.getByTestId('verdict').textContent() : null
  const alert = outcome === 'error' ? await page.getByRole('alert').first().textContent() : null
  const events = await page.locator('ol[aria-label="Engine events"] li').count()
  results.push({ run: label, outcome, verdict, alert, events, seconds: Math.round((Date.now() - started) / 100) / 10 })
  return outcome
}

async function horizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
}

const browser = await chromium.launch()
try {
  const gallery = await newPage(browser)
  await gallery.goto(`${BASE}/app/spike/ui`)
  await gallery.getByRole('heading', { name: /UI primitives/ }).waitFor()
  await shot(gallery, 'ui-gallery', true)

  const fresh = await newPage(browser, { consent: false })
  await fresh.goto(`${BASE}/app`)
  await fresh.getByRole('dialog', { name: 'Before you start' }).waitFor()
  await shot(fresh, 'consent-modal')
  const continueDisabled = await fresh.getByRole('button', { name: 'Continue' }).isDisabled()
  await fresh.getByLabel('I understand').check()
  await fresh.getByRole('button', { name: 'Continue' }).click()
  results.push({ consent: { continueDisabledBeforeTick: continueDisabled, stored: await fresh.evaluate(() => window.localStorage.getItem('mycelium.consent')) } })

  const page = await newPage(browser)
  await page.goto(`${BASE}/app`)
  await waitForConfig(page)
  await shot(page, 'config-default')

  await page.getByRole('button', { name: 'RSI Mean Reversion' }).click()
  await page.getByRole('heading', { name: 'RSI Mean Reversion' }).waitFor()
  await shot(page, 'config-strategy-selected', true)

  await page.getByRole('button', { name: 'Gap Fade' }).click()
  await page.getByRole('radio', { name: 'Crypto' }).click()
  await page.getByText(/Gap Fade supports Stocks & ETFs only/).first().waitFor()
  results.push({ incompatible: { gapFadeDisabled: await page.getByRole('button', { name: 'Gap Fade' }).isDisabled() } })
  await shot(page, 'config-incompatible-market')

  await page.getByRole('radio', { name: 'CSV import' }).click()
  await page.locator('#csv-market').selectOption('us_equity')
  await page.locator('#csv-file').setInputFiles({ name: 'bars-with-problems.csv', mimeType: 'text/csv', buffer: problemCsv() })
  await page.getByText('BLOCKED').waitFor({ timeout: 30_000 })
  const problemRows = await page.getByRole('table', { name: 'Problems found in the file' }).locator('tbody tr').count()
  results.push({ csv: { blocked: true, problemRows } })
  await shot(page, 'csv-import-problems', true)

  const sample = await newPage(browser)
  await sample.goto(`${BASE}/app`)
  await waitForConfig(sample)
  await launchAndWait(sample, 'SAMPLE-A 5m ORB defaults')
  await shot(sample, 'run-temporary-done', true)

  if (LIVE) {
    const live = await newPage(browser)
    await live.goto(`${BASE}/app`)
    await waitForConfig(live)
    await live.getByRole('radio', { name: 'Crypto' }).click()
    await live.getByRole('button', { name: 'Donchian Channel Breakout' }).click()
    await launchAndWait(live, 'Coinbase BTC-USD 1h 60 days Donchian (live network)')
    await shot(live, 'run-temporary-live-coinbase', true)
  }

  const down = await newPage(browser)
  await down.route('**/api/health', (route) => route.abort())
  await down.goto(`${BASE}/app`)
  await down.getByRole('heading', { name: 'The engine is unreachable' }).waitFor({ timeout: 20_000 })
  await shot(down, 'error-engine-unreachable')

  const limited = await newPage(browser)
  await limited.route('**/api/runs', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '1260', 'X-Request-ID': '5f0c2a7e91d3b648' },
          body: JSON.stringify({
            code: 'rate_limited',
            status: 429,
            message: 'The limit is 12 runs per hour; try again later.',
            stage: null,
            details: null,
            request_id: '5f0c2a7e91d3b648',
          }),
        })
      : route.continue(),
  )
  await limited.goto(`${BASE}/app`)
  await waitForConfig(limited)
  await limited.getByRole('button', { name: 'Run backtest' }).click()
  await limited.getByText('Too many requests').waitFor()
  await shot(limited, 'error-rate-limited')

  const history = await newPage(browser)
  await history.goto(`${BASE}/app/history`)
  await history.getByText('No runs saved in this browser yet').waitFor()
  await shot(history, 'history-empty')

  const missing = await newPage(browser)
  await missing.goto(`${BASE}/app/no-such-page`)
  await missing.getByText('This page does not exist').waitFor()
  await shot(missing, 'not-found')

  const sources = await newPage(browser)
  await sources.goto(`${BASE}/app/data-sources`)
  await sources.getByRole('table', { name: 'Data sources' }).waitFor()
  await shot(sources, 'data-sources', true)

  const overflow = {}
  for (const width of [390, 360]) {
    const narrow = await newPage(browser, { viewport: { width, height: 844 } })
    await narrow.goto(`${BASE}/app`)
    await waitForConfig(narrow)
    overflow[width] = await horizontalOverflow(narrow)
    if (width === 390) await shot(narrow, 'config-narrow-390', true)
  }
  results.push({ horizontalOverflowPx: overflow })
} finally {
  await browser.close()
}

console.log(JSON.stringify({ results, consoleErrors }, null, 1))
