import { test, expect } from '@playwright/test'

test('real product navigation, built-in examples, isolated editing and closed model configuration', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    window.localStorage.setItem('storyforge-ai-config', JSON.stringify({ apiKey: 'private-sentinel', baseUrl: 'http://127.0.0.1:9/v1' }))
    window.localStorage.setItem('original-manuscript-sentinel', 'preserve')
  })
  await page.goto('./')
  await expect(page.getByTestId('home-page')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '产品导航' })).toBeVisible()
  const paths = await page.getByRole('navigation', { name: '产品导航' }).getByRole('link').evaluateAll(links => links.map(a => a.getAttribute('href')!))
  expect(paths.length).toBeGreaterThanOrEqual(10)
  for (const path of paths) {
    await page.goto(path)
    await expect(page.getByRole('navigation', { name: '产品导航', exact: true }), path).toBeVisible()
    await expect(page.locator('.showcase-app')).not.toContainText('StoryForge 无法启动')
    await expect(page.getByRole('link', { name: '京ICP备2026061833号-1', exact: true })).toBeVisible()
  }
  await page.goto('./home/examples?type=long')
  await page.getByRole('button', { name: '创建体验副本', exact: true }).first().click()
  await expect(page).toHaveURL(/workspace\/[0-9]+/)
  await expect(page.locator('.showcase-app')).toContainText('体验副本')
  await page.reload()
  await expect(page.locator('.showcase-app')).toContainText('体验副本')
  await page.goto('./home/settings')
  await expect(page.getByRole('heading', { name: '在这里了解完整项目，在本机开始 AI 创作' })).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '测试连接', exact: true })).toHaveCount(0)
  const isolation = await page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map(db => db.name),
    oldConfig: localStorage.getItem('storyforge-ai-config'),
    oldManuscript: localStorage.getItem('original-manuscript-sentinel'),
    worker: navigator.serviceWorker.controller !== null,
  }))
  expect(isolation.databases).toContain('storyforge-website-experience-v1')
  expect(isolation.databases).not.toContain('storyforge-core')
  expect(isolation.databases).not.toContain('storyforge-fsa')
  expect(isolation.oldConfig).toBeNull()
  expect(isolation.oldManuscript).toBeNull()
  expect(isolation.worker).toBe(false)
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/showcase-settings.png', fullPage: true })
})

test('all network exits reject AI, local bridges and writes while packaged assets work', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByTestId('home-page')).toBeVisible()
  const result = await page.evaluate(async () => {
    const rejected: boolean[] = []
    for (const [url, method] of [
      ['https://api.openai.com/v1/chat/completions', 'POST'],
      ['http://localhost:11434/v1/chat/completions', 'POST'],
      ['/storyforge/local-codex/v1/status', 'GET'],
      ['/v1/plugins', 'POST'],
      ['/storyforge/games/catalog.json', 'POST'],
    ]) {
      try { await fetch(url, { method }); rejected.push(false) } catch { rejected.push(true) }
    }
    for (const action of [
      () => new WebSocket('ws://localhost:11434'),
      () => new EventSource('/v1/events'),
      () => new XMLHttpRequest().open('POST', '/v1/upload'),
    ]) { try { action(); rejected.push(false) } catch { rejected.push(true) } }
    return { rejected, assets: (await fetch('/storyforge/games/catalog.json')).ok, beacon: navigator.sendBeacon('/v1/upload', 'no') }
  })
  expect(result.rejected.every(Boolean)).toBe(true)
  expect(result.assets).toBe(true)
  expect(result.beacon).toBe(false)
})

test('examples and project interface remain usable at mobile widths', async ({ page }) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('./home/examples')
    await expect(page.getByRole('region', { name: '内置示例作品', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '京公网安备11011502040776号' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    await page.screenshot({ path: `test-results/showcase-examples-${width}.png`, fullPage: true })
  }
})

test('actual novel, screenplay and comic readers and packaged town remain available without AI', async ({ page }) => {
  // The real town includes original multi-megabyte artwork; measure completion on the public link.
  if (process.env.SHOWCASE_BASE_URL) test.setTimeout(600_000)
  await page.goto('./home/examples?type=short')
  await page.getByRole('button', { name: '阅读完整样例《盐从记忆里长出来》' }).click()
  await expect(page.getByRole('dialog')).toContainText('盐从记忆里长出来')
  await page.keyboard.press('Escape')
  await page.goto('./home/examples?type=script')
  await page.getByRole('button', { name: '查看专业剧本《婚礼第零桌》' }).click()
  await expect(page.getByRole('dialog')).toContainText('Title: 婚礼第零桌')
  await page.goto('./home/examples?type=comic')
  await page.getByRole('button', { name: '查看完整漫画《雨停之前》' }).click()
  await expect(page.locator('.comic-showcase-reader figure')).toHaveCount(6)
  await expect.poll(() => page.locator('.comic-showcase-reader figure img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(500)
  await page.goto('./home/examples?type=town')
  await page.getByRole('button', { name: '导入原型并准备游玩' }).click()
  await expect(page).toHaveURL(/town\/play\?project=\d+&work=\d+/, { timeout: process.env.SHOWCASE_BASE_URL ? 480_000 : 60_000 })
  await page.reload()
  await expect(page.locator('.showcase-app')).toContainText('回潮镇')
})
