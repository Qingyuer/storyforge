import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { makeAuthorRepairPackets, readAuthorRepairHtml, renderAuthorRepair } from '../../scripts/quality-evals/longform-author-repair.mjs'

const packet = makeAuthorRepairPackets({ studyId: 'Q10-repair-browser', mode: 'preview', participants: ['W01'], samples: [1, 2].map(n => ({ pairId: `pair-${n}`, genre: '都市系统文', brief: '保留行动及关灯收尾，去掉重复解释。', baseline: '陈禾核账，核账之后，她再次核账。关灯。', improved: '陈禾核账，合上账本，关灯。' })) }, 'frozen').packets[0]

test('作者只选择参与信息，实际改稿计时并保存同一 HTML，断网恢复与续计时', async ({ page, browser }, info) => {
  await page.route('**/__author-repair', route => route.fulfill({ contentType: 'text/html', body: renderAuthorRepair(packet) }))
  await page.goto('__author-repair')
  await expect(page.getByRole('textbox', { name: '修稿正文' })).toHaveValue('')
  await page.getByText('参与情况（只需选择）', { exact: true }).click()
  await page.getByRole('radio', { name: '经常', exact: true }).check()
  await page.getByRole('radio', { name: '是', exact: true }).check()
  await page.getByRole('button', { name: '开始 / 继续修稿', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '修稿正文' })).toHaveValue(packet.tasks[0].source)
  await page.getByRole('textbox', { name: '修稿正文' }).fill('陈禾核对余额，记清这笔支出，合上账本，关灯。')
  await page.getByLabel('处理结果').selectOption('ready')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存修稿与计时 HTML', exact: true }).click()
  const download = await pending, file = info.outputPath('paused-repair.html')
  await download.saveAs(file)
  const saved = readAuthorRepairHtml(packet, await readFile(file, 'utf8'))
  expect(saved.result.tasks[0].status).toBe('paused')
  expect(saved.result.tasks[0].sessions[0].elapsedMs).toBeGreaterThan(0)
  expect(saved.result.tasks[0].text).toContain('记清这笔支出')
  const context = await browser.newContext({ offline: true, acceptDownloads: true, viewport: { width: 390, height: 844 } })
  try {
    const local = await context.newPage()
    await local.goto(pathToFileURL(file).href)
    await expect(local.getByRole('textbox', { name: '修稿正文' })).toHaveValue(saved.result.tasks[0].text)
    await expect(local.locator('#notice')).toContainText('计时保持暂停')
    expect(await local.getByRole('textbox', { name: '修稿正文' }).evaluate(element => (element as HTMLTextAreaElement).readOnly)).toBe(true)
    expect(await local.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await local.getByRole('button', { name: '开始 / 继续修稿', exact: true }).click()
    await local.getByRole('textbox', { name: '修稿正文' }).fill('陈禾核对余额，记清支出，合上账本。灯灭了。')
    await local.getByLabel('处理结果').selectOption('ready')
    await local.getByRole('button', { name: '完成本份修稿', exact: true }).click()
    await expect(local.locator('#progress')).toHaveText('1/4 份已完成')
    const resaved = local.waitForEvent('download')
    await local.getByRole('button', { name: '保存修稿与计时 HTML', exact: true }).click()
    const completedFile = info.outputPath('finished-repair.html'); await (await resaved).saveAs(completedFile)
    const completed = readAuthorRepairHtml(packet, await readFile(completedFile, 'utf8'))
    expect(completed.result.tasks[0].sessions).toHaveLength(2)
    expect(completed.result.tasks[0].status).toBe('finished')
    expect(completed.manuscripts[0].editedTextHash).not.toBe(saved.manuscripts[0].editedTextHash)
    expect(completed.validation.complete).toBe(false)
  } finally { await context.close() }
})
