import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5417'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '../docs/screenshots')
let counter = Number(process.env.SCREENSHOT_FIRST ?? 38)
const results = []
const consoleErrors = []
const failures = []
const origin = new URL(BASE).origin
const APP_MODULES = ['/src/app/AppShell', '/src/pages/ConfigPage', '/src/pages/RunPage', '/src/pages/ResultsPage', '/src/pages/HistoryPage']
const SITE_MODULES = ['/src/site/Landing', '/src/site/PublicPages', '/src/site/SiteShell', '/demo/recorded-run.json']

mkdirSync(OUT, { recursive: true })

async function shot(page, label, options = {}) {
  const file = `${String(counter++).padStart(2, '0')}-${label}.png`
  await page.screenshot({ path: resolve(OUT, file), fullPage: Boolean(options.fullPage) })
  results.push({ screenshot: file })
}

async function newPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: options.scale ?? 2,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  })
  if (options.seen !== false) await context.addInitScript(() => window.sessionStorage.setItem('mycelium.intro', '1'))
  const page = await context.newPage()
  const requests = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${page.url()} ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()} ${String(error)}`))
  return { page, requests }
}

const crossOrigin = (requests) => requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin)
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

function stats(deltas) {
  const sorted = [...deltas].sort((a, b) => a - b)
  const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { frames: sorted.length, p50: Number(pick(0.5)?.toFixed(1)), p95: Number(pick(0.95)?.toFixed(1)), max: Number(sorted.at(-1)?.toFixed(1)), over33: sorted.filter((value) => value > 33.4).length }
}

const browser = await chromium.launch()
try {
  const { page, requests } = await newPage(browser)
  await page.goto(`${BASE}/?intro=0`)
  await page.getByTestId('recorded-label').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(6_500)
  await shot(page, 'landing-hero')
  await page.mouse.wheel(0, 20_000)
  await page.waitForTimeout(800)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await shot(page, 'landing-full', { fullPage: true })
  const landingCross = crossOrigin(requests)
  const landingAppModules = requests.filter((url) => APP_MODULES.some((name) => url.includes(name)))
  results.push({ landing: { requests: requests.length, crossOrigin: landingCross, appModulesLoaded: landingAppModules, overflow1440: await overflow(page) } })
  if (landingCross.length) failures.push(`cross-origin requests on the landing: ${landingCross.join(', ')}`)
  if (landingAppModules.length) failures.push(`landing loaded app modules: ${landingAppModules.join(', ')}`)

  const narrow = await newPage(browser, { viewport: { width: 390, height: 844 } })
  await narrow.page.goto(`${BASE}/?intro=0`)
  await narrow.page.getByTestId('recorded-label').first().waitFor({ timeout: 30_000 })
  await narrow.page.waitForTimeout(3_000)
  const overflow390 = await overflow(narrow.page)
  await shot(narrow.page, 'landing-narrow-390', { fullPage: true })
  await narrow.page.setViewportSize({ width: 360, height: 800 })
  await narrow.page.waitForTimeout(500)
  const overflow360 = await overflow(narrow.page)
  results.push({ narrow: { overflow390, overflow360 } })
  if (overflow390 > 0 || overflow360 > 0) failures.push(`horizontal overflow ${overflow390} / ${overflow360}`)

  for (const time of [0.3, 1.2, 2.4, 3.2]) {
    const frame = await newPage(browser, { seen: false })
    await frame.page.goto(`${BASE}/?intro=1&seed=1&introTime=${time}`)
    await frame.page.getByTestId('intro').waitFor()
    await frame.page.waitForTimeout(300)
    await shot(frame.page, `intro-${String(time).replace('.', '_')}s`)
    await frame.page.context().close()
  }

  const live = await newPage(browser, { seen: false })
  await live.page.goto(`${BASE}/?intro=1&seed=1`)
  await live.page.getByTestId('intro').waitFor()
  await live.page.waitForTimeout(600)
  const contentDuringIntro = { heading: await live.page.getByRole('heading', { level: 1 }).count(), overlayStillShown: await live.page.getByTestId('intro').count() }
  await live.page.waitForTimeout(3_600)
  const introFrames = await live.page.evaluate(() => window.__introFrames ?? [])
  const goneAfterPlay = (await live.page.getByTestId('intro').count()) === 0
  results.push({ intro: { frameTimes: stats(introFrames.slice(1)), headingInDocumentDuringIntro: contentDuringIntro, goneAfterPlay } })

  const fresh = await newPage(browser, { seen: false })
  await fresh.page.goto(`${BASE}/`)
  const shownFirstVisit = await fresh.page.getByTestId('intro').isVisible().catch(() => false)
  await fresh.page.waitForTimeout(400)
  const pressedAt = Date.now()
  await fresh.page.keyboard.press('Escape')
  const skippedByKey = await fresh.page.getByTestId('intro').waitFor({ state: 'detached', timeout: 2_000 }).then(() => true, () => false)
  const skipMs = Date.now() - pressedAt
  const focusInOverlay = await fresh.page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="intro"]')))
  await fresh.page.keyboard.press('Tab')
  const focusAfterTab = await fresh.page.evaluate(() => document.activeElement?.textContent?.trim() ?? null)
  await fresh.page.goto(`${BASE}/app`)
  await fresh.page.waitForTimeout(800)
  const shownAgainInSession = (await fresh.page.getByTestId('intro').count()) > 0
  results.push({ introSession: { shownFirstVisit, skippedByKey, skipMs, focusInOverlay, focusAfterTab, shownAgainInSession } })
  if (!shownFirstVisit || !skippedByKey || shownAgainInSession || focusInOverlay) failures.push('intro session behaviour')

  const reduced = await newPage(browser, { seen: false, reducedMotion: 'reduce' })
  await reduced.page.goto(`${BASE}/?intro=1`)
  const reducedShown = (await reduced.page.getByTestId('intro').count()) > 0
  await reduced.page.waitForTimeout(700)
  results.push({ introReducedMotion: { shown: reducedShown, goneAfter700ms: (await reduced.page.getByTestId('intro').count()) === 0 } })

  for (const [path, label] of [
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
    ['/data-sources', 'data-sources'],
    ['/roadmap', 'roadmap'],
  ]) {
    const pub = await newPage(browser)
    await pub.page.goto(`${BASE}${path}`)
    await pub.page.getByRole('heading', { level: 1 }).waitFor()
    await pub.page.waitForTimeout(300)
    await shot(pub.page, label, { fullPage: true })
    const cross = crossOrigin(pub.requests)
    if (cross.length) failures.push(`cross-origin on ${path}: ${cross.join(', ')}`)
    await pub.page.context().close()
  }

  const app = await newPage(browser)
  await app.page.goto(`${BASE}/app?intro=0`)
  await app.page.getByRole('button', { name: 'Run backtest' }).waitFor({ timeout: 30_000 })
  const appSite = app.requests.filter((url) => SITE_MODULES.some((name) => url.includes(name)))
  results.push({ app: { siteModulesLoaded: appSite, crossOrigin: crossOrigin(app.requests) } })
  if (appSite.length) failures.push(`app loaded landing modules: ${appSite.join(', ')}`)

  const og = await newPage(browser, { viewport: { width: 1200, height: 630 }, scale: 1 })
  await og.page.goto(`${BASE}/?intro=0`)
  await og.page.getByTestId('recorded-frame').first().waitFor({ timeout: 30_000 })
  await og.page.evaluate(() => {
    const frame = document.querySelector('[data-testid="recorded-frame"]')
    if (frame instanceof HTMLElement) frame.setAttribute('style', 'position:fixed;inset:0;z-index:50;height:630px;width:1200px')
  })
  await og.page.waitForTimeout(7_000)
  await og.page.screenshot({ path: resolve(ROOT, 'public/og-image.png') })
  results.push({ ogImage: 'public/og-image.png 1200x630' })
} finally {
  await browser.close()
  console.log(JSON.stringify({ results, failures, consoleErrors }, null, 2))
}
