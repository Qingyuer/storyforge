import { expect, test } from '@playwright/test'

test('filings survive disabled JavaScript and an unavailable browser database', async ({ browser, baseURL }) => {
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ javaScriptEnabled })
    if (javaScriptEnabled) await context.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get() { throw new Error('Storage deliberately unavailable in this isolated test') } })
    })
    const page = await context.newPage()
    await page.goto(baseURL!)
    await expect(page.getByRole('link', { name: '京ICP备2026061833号-1', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: '京公网安备11011502040776号', exact: true })).toBeVisible()
    await context.close()
  }
})
