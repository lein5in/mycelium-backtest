import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:5417'
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, '../docs/screenshots')
let counter = Number(process.env.SCREENSHOT_FIRST ?? 49)
const results = []
const consoleErrors = []
const failures = []
const origin = new URL(BASE).origin
const APP_MODULES = ['AppShell', 'ConfigPage', 'RunPage', 'ResultsPage', 'HistoryPage']

mkdirSync(OUT, { recursive: true })

async function shot(target, label, options = {}) {
  const file = `${String(counter++).padStart(2, '0')}-${label}.png`
  await target.screenshot({ path: resolve(OUT, file), ...(options.fullPage ? { fullPage: true } : {}) })
  results.push({ screenshot: file })
}

async function newPage(browser, options = {}) {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  })
  if (options.seen !== false) await context.addInitScript(() => window.sessionStorage.setItem('mycelium.intro', '1'))
  const page = await context.newPage()
  const requests = []
  const badResponses = []
  page.on('request', (request) => requests.push(request.url()))
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`${page.url()} ${message.text()}`)
  })
  page.on('pageerror', (error) => consoleErrors.push(`${page.url()} ${String(error)}`))
  return { page, requests, badResponses }
}

const crossOrigin = (requests) => requests.filter((url) => !url.startsWith('data:') && !url.startsWith('blob:') && new URL(url).origin !== origin)
const appModules = (requests) => requests.filter((url) => APP_MODULES.some((name) => url.includes(name)))
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

const browser = await chromium.launch()
try {
  const wide = await newPage(browser)
  await wide.page.goto(`${BASE}/?intro=0`)
  await wide.page.getByTestId('recorded-label').first().waitFor({ timeout: 30_000 })
  await wide.page.waitForTimeout(6_500)
  const body = await wide.page.locator('body').innerText()
  const claims = {
    engineLine: body.includes('The live engine is not hosted on this site. Watch a recorded run below or run Mycelium on your own machine.'),
    openTheApp: /Open the app|RUN IN YOUR BROWSER|IMPORT YOUR OWN CSV/.test(body),
    recordedLabel: body.includes('RECORDED RUN · SAMPLE DATA'),
    runLocallyHeading: await wide.page.getByRole('heading', { level: 2, name: 'Run it locally' }).count(),
    topBar: await wide.page.getByRole('banner').getByRole('link').allInnerTexts(),
    launchBlocks: await wide.page.locator('a:has-text("RUN IT ON YOUR MACHINE"), a:has-text("VIEW SOURCE ON GITHUB")').allInnerTexts(),
  }
  results.push({ landing1440: { ...claims, crossOrigin: crossOrigin(wide.requests), appModules: appModules(wide.requests), bad: wide.badResponses, overflow: await overflow(wide.page) } })
  if (!claims.engineLine || claims.openTheApp || !claims.recordedLabel || claims.runLocallyHeading !== 1) failures.push('landing text in hosted mode')
  if (crossOrigin(wide.requests).length) failures.push(`cross-origin: ${crossOrigin(wide.requests).join(', ')}`)
  if (appModules(wide.requests).length) failures.push(`app modules loaded: ${appModules(wide.requests).join(', ')}`)
  if (wide.badResponses.length) failures.push(`bad responses: ${wide.badResponses.join(', ')}`)
  await shot(wide.page, 'hosted-landing-hero')
  await wide.page.evaluate(() => window.scrollTo(0, 0))
  await shot(wide.page, 'hosted-landing-full', { fullPage: true })
  await wide.page.locator('#run-locally').scrollIntoViewIfNeeded()
  await shot(wide.page.locator('#run-locally'), 'hosted-run-locally')

  const narrow = await newPage(browser, { viewport: { width: 390, height: 844 } })
  await narrow.page.goto(`${BASE}/?intro=0`)
  await narrow.page.getByTestId('recorded-label').first().waitFor({ timeout: 30_000 })
  await narrow.page.waitForTimeout(3_000)
  const overflow390 = await overflow(narrow.page)
  await shot(narrow.page, 'hosted-landing-narrow-390', { fullPage: true })
  await narrow.page.setViewportSize({ width: 360, height: 800 })
  await narrow.page.waitForTimeout(500)
  const overflow360 = await overflow(narrow.page)
  const codeOverflow = await narrow.page.evaluate(() => [...document.querySelectorAll('#run-locally pre')].filter((pre) => pre.getBoundingClientRect().right > window.innerWidth).length)
  results.push({ narrow: { overflow390, overflow360, codeBlocksBeyondViewport: codeOverflow, crossOrigin: crossOrigin(narrow.requests) } })
  if (overflow390 > 0 || overflow360 > 0 || codeOverflow > 0) failures.push(`horizontal overflow ${overflow390} / ${overflow360} / code ${codeOverflow}`)

  for (const path of ['/app', '/app/run/abc', '/app/results/abc', '/app/history', '/app/data-sources', '/app/spike/ui']) {
    const redirected = await newPage(browser)
    await redirected.page.goto(`${BASE}${path}`)
    await redirected.page.locator('#run-locally').waitFor({ timeout: 15_000 })
    const url = new URL(redirected.page.url())
    const visible = await redirected.page.locator('#run-locally').isVisible()
    const inView = await redirected.page.evaluate(() => {
      const rect = document.getElementById('run-locally')?.getBoundingClientRect()
      return Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0)
    })
    results.push({ redirect: { path, to: `${url.pathname}${url.hash}`, visible, inView, appModules: appModules(redirected.requests) } })
    if (url.pathname !== '/' || url.hash !== '#run-locally' || !visible || !inView) failures.push(`redirect ${path} -> ${url.pathname}${url.hash}`)
    if (appModules(redirected.requests).length) failures.push(`app modules after redirect ${path}`)
    if (path === '/app') await shot(redirected.page, 'hosted-app-redirect')
    await redirected.page.context().close()
  }

  const pages = [
    ['/privacy', 'Privacy', 'hosted-privacy'],
    ['/terms', 'Terms of use', 'hosted-terms'],
    ['/data-sources', 'Data sources', 'hosted-data-sources'],
    ['/roadmap', 'Roadmap', 'hosted-roadmap'],
  ]
  for (const [path, title, label] of pages) {
    const entry = await newPage(browser)
    await entry.page.goto(`${BASE}${path}`)
    await entry.page.getByRole('heading', { level: 1, name: title }).waitFor({ timeout: 15_000 })
    const text = await entry.page.locator('main').innerText()
    const cross = crossOrigin(entry.requests)
    results.push({ publicPage: { path, status: 'loaded', crossOrigin: cross, bad: entry.badResponses, hostedEngineListed: text.includes('Hosted engine'), overflow: await overflow(entry.page) } })
    if (cross.length || entry.badResponses.length) failures.push(`public page ${path}: ${cross.join(', ')} ${entry.badResponses.join(', ')}`)
    if (path === '/roadmap' && !text.includes('Hosted engine')) failures.push('roadmap lacks Hosted engine')
    await shot(entry.page, label, { fullPage: true })
    await entry.page.context().close()
  }

  const fresh = await newPage(browser, { seen: false })
  await fresh.page.goto(`${BASE}/?intro=1&seed=1`)
  const shownFirstVisit = await fresh.page.getByTestId('intro').waitFor({ timeout: 10_000 }).then(() => true, () => false)
  await fresh.page.waitForTimeout(1_200)
  await shot(fresh.page, 'hosted-intro')
  await fresh.page.keyboard.press('Escape')
  const skipped = await fresh.page.getByTestId('intro').waitFor({ state: 'detached', timeout: 2_000 }).then(() => true, () => false)
  await fresh.page.getByTestId('recorded-label').first().waitFor({ timeout: 30_000 })
  results.push({ intro: { shownFirstVisit, skipped, crossOrigin: crossOrigin(fresh.requests), appModules: appModules(fresh.requests) } })
  if (!shownFirstVisit || !skipped) failures.push('intro behaviour in hosted mode')

  const bad = consoleErrors.filter((line) => !line.includes('favicon'))
  results.push({ consoleErrors: bad })
  if (bad.length) failures.push(`console errors: ${bad.length}`)
} finally {
  await browser.close()
}

console.log(JSON.stringify(results, null, 2))
if (failures.length) {
  console.error(`FAILURES:\n${failures.join('\n')}`)
  process.exit(1)
}
console.log('hosted flow: all checks passed')
