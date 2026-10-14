import { expect, test } from '@playwright/test'
import { makeQuestionnairePackets, renderQuestionnaire } from '../../scripts/quality-evals/longform-choice-questionnaire.mjs'

const { packets } = makeQuestionnairePackets({ studyId: 'Q10-ui-preview', mode: 'preview', participants: ['R01', 'R02'], samples: [1, 2].map(chapter => ({ pairId: `demo-${chapter}`, workId: 'demo', chapter, genre: '都市系统文', baseline: '第一段原稿。\n第二段原稿。', improved: '第一段另一稿。\n第二段另一稿。' })) }, 'ui-frozen-seed')

test('选择问卷无需打字，独立保存/刷新/导出/恢复；损坏进度不能覆盖已填答案', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__choice-preview', route => route.fulfill({ contentType: 'text/html', body: renderQuestionnaire(packets[0]) }))
  await page.goto('__choice-preview')
  await expect(page.getByText('流程预览：', { exact: false })).toBeVisible()
  await expect(page.locator('textarea, input[type="text"], input[type="email"], input[type="number"]')).toHaveCount(0)
  await page.getByText('参与情况（首次填写即可）', { exact: true }).click()
  await page.getByRole('radio', { name: '读者', exact: true }).check()
  await page.getByRole('radio', { name: '经常', exact: true }).check()
  await page.getByRole('radio', { name: '是', exact: true }).check()
  for (const side of ['A', 'B']) {
    await page.getByLabel(`版本${side}阅读位置`).selectOption('end')
    await page.getByRole('group', { name: '愿意读这版的下一章吗？' }).nth(side === 'A' ? 0 : 1).getByRole('radio', { name: '可能', exact: true }).check()
  }
  for (const label of ['代入与期待', '因果与主动选择', '情绪与兑现', '人物声音', '节奏与重复', '前后连贯']) {
    const groups = page.getByRole('group', { name: label, exact: true })
    for (const index of [0, 1]) await groups.nth(index).getByRole('radio', { name: '3', exact: true }).check()
  }
  await page.getByRole('group', { name: '综合比较，你更想继续读哪一版？' }).getByRole('radio', { name: '持平', exact: true }).check()
  await page.getByRole('checkbox', { name: '无明显差别', exact: true }).check()
  await expect(page.locator('#progress')).toContainText('1 / 2 组已填完')
  await page.reload()
  await expect(page.getByRole('radio', { name: '持平', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '下一组', exact: true }).click()
  await expect(page.locator('#chapter')).toContainText('第 2 章')
  await page.getByRole('button', { name: '上一组', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出结果 / 进度', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Q10-ui-preview-R01-result.json')
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.answers[0].preference).toBe('tie')
  expect(exported.mode).toBe('preview')
  const before = await page.evaluate(() => Object.values(localStorage)[0])
  await page.locator('#file').setInputFiles({ name: 'wrong-person.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...exported, participantCode: 'R02' })) })
  await expect(page.locator('#notice')).toContainText('恢复失败')
  expect(await page.evaluate(() => Object.values(localStorage)[0])).toBe(before)
  await page.getByRole('group', { name: '综合比较，你更想继续读哪一版？' }).getByRole('radio', { name: 'A', exact: true }).check()
  await page.locator('#file').setInputFiles({ name: 'valid-progress.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) })
  await expect(page.getByRole('radio', { name: '持平', exact: true })).toBeChecked()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})
