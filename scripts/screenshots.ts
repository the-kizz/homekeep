import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:3000'
const OUT = 'docs/screenshots'
const EMAIL = 'demo@homekeep.local'
const PASS = 'demopass12345'

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  })
  const page = await ctx.newPage()

  // Landing (logged out) — keep plain, captures the sign-up path
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT}/01-landing.png`, fullPage: false })

  await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' })
  await page.screenshot({ path: `${OUT}/02-signup.png`, fullPage: false })

  // Log in as the demo user
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASS)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/h(\/|$)/, { timeout: 10_000 })

  // Find the first home and jump into it
  const homeLink = await page.locator('a[href^="/h/"][href*="/"]').first()
  const href = (await homeLink.getAttribute('href')) ?? ''
  const homeUrl = `${BASE}${href.startsWith('/h/') ? href : '/h'}`
  await page.goto(homeUrl, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/03-dashboard-three-band.png`, fullPage: true })

  // By Area
  await page.goto(`${homeUrl}/by-area`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/04-by-area.png`, fullPage: true })

  // Person
  await page.goto(`${homeUrl}/person`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/05-person.png`, fullPage: true })

  // History
  await page.goto(`${homeUrl}/history`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/06-history.png`, fullPage: true })

  // Settings
  await page.goto(`${homeUrl}/settings`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/07-settings.png`, fullPage: true })

  // Mobile band view
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const m = await mobile.newPage()
  await m.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await m.fill('input[name="email"]', EMAIL)
  await m.fill('input[name="password"]', PASS)
  await m.click('button[type="submit"]')
  await m.waitForURL(/\/h(\/|$)/, { timeout: 10_000 })
  const mHomeLink = await m.locator('a[href^="/h/"][href*="/"]').first()
  const mHref = (await mHomeLink.getAttribute('href')) ?? ''
  await m.goto(`${BASE}${mHref}`, { waitUntil: 'networkidle' })
  await m.waitForTimeout(800)
  await m.screenshot({ path: `${OUT}/08-mobile-dashboard.png`, fullPage: false })

  await browser.close()
  console.log('✓ screenshots written to', OUT)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
