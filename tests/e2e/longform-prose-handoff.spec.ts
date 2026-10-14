import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const notes = '安静收店，先问搭档意愿；最后才签收，不增加敌人。'.repeat(220) + '【长备注尾部：签收后停笔】'
const style = '用具体动作与不同声线，少替人物解释情绪。'.repeat(30) + '【文风尾部：保留轻松语气】'
const generated = '两人把余下的材料清点了一遍，约定明天的分工。店主先问了搭档的意愿，最后签收并关灯。'.repeat(8)

async function prepare(page: Page, smallWindow = false) {
  await page.addInitScript(({ smallWindow }) => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama', baseUrl: 'https://prose-handoff.invalid/v1', model: 'handoff-test', maxTokens: smallWindow ? 500 : 3000, contextWindow: smallWindow ? 1500 : 64000, temperature: 0 }))
  }, { smallWindow })
  await createLongform(page, '正文完整资料交接')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByRole('textbox', { name: '章节摘要（可编辑，失焦自动保存）' }).fill('两人收店，先清点、再约定明日分工，最后才签收，签收后停笔。')
  await page.getByTitle('编辑本章细纲', { exact: true }).click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('关火、清点、约定分工；最后签收。')
  await page.getByText('场景任务（可选，可留白）', { exact: true }).click()
  await page.getByLabel('场景1 · 关键选择', { exact: true }).fill('先问搭档意愿')
  await page.getByLabel('场景1 · 退出状态', { exact: true }).fill('未来计划：明日试做点心，尚未发生')
  await page.getByPlaceholder('备注 / AI 建议...', { exact: true }).fill(notes)
  await page.getByRole('button', { name: '写本章正文', exact: true }).click()
  await page.evaluate(async ({ style }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope, stampNewRecord }, { createSystemFictionElementsV1 }, { usePromptStore }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'), importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/prose/system-fiction-contract.ts'), importer('/storyforge/src/stores/prompt.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    await db.works.update(scope.workId, { writingStyleId: 'luxun', description: '【Work 写作意图】只写平静收店，不领取次日奖励。', updatedAt: Date.now() })
    await db.userStyleProfiles.add(stampNewRecord(scope, 'userStyleProfiles', { projectId: project.id, enabled: true, profile: '【作者画像完整尾部】保留两人的口语区别。', sourceChapterIds: '[]', sampleCount: 0, sampleWords: 0, createdAt: Date.now(), updatedAt: Date.now() }, { owner: 'work' }))
    const rules = await db.creativeRules.where('projectId').equals(project.id).first()
    const value = { writingStyle: style, narrativePOV: 'third-limited', atmosphere: '平静、轻松', specialRequirements: '最后才签收', prohibitions: '[]', consistencyRules: '[]', systemFictionElements: { ...createSystemFictionElementsV1(), enabled: true, systemMechanism: '每天第一次签到免费', rewardGrowth: '未来计划：明日试做点心，尚未发生' }, updatedAt: Date.now() }
    if (rules) await db.creativeRules.update(rules.id, value)
    else await db.creativeRules.add(stampNewRecord(scope, 'creativeRules', { ...value, projectId: project.id, createdAt: Date.now() }, { owner: 'work' }))
    await usePromptStore.getState().init()
    const template = usePromptStore.getState().getActive('chapter.content')
    const id = await usePromptStore.getState().saveTemplate({ ...template, id: undefined, scope: 'user', name: '交接验收的自定义模板', isActive: false, systemPrompt: '作者自定义：克制而轻松。', userPromptTemplate: '完成作者当前任务。', continuityMode: 'off', modelOverride: { temperature: 0.2, maxTokens: 1700 } })
    await usePromptStore.getState().setActive(id)
  }, { style })
  await page.getByPlaceholder('自定义指令...', { exact: true }).fill('只写600字，保持平静，签收后停笔。')
}

test('分步骤实际请求完整交付长备注、元素和作者文风；自定义模板保留，候选刷新采纳', async ({ page }) => {
  const requests: Array<{ messages: Array<{ content: string }>; temperature: number; max_tokens: number }> = []
  await page.route('https://prose-handoff.invalid/**', async route => {
    requests.push(route.request().postDataJSON())
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated } }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  expect(requests).toHaveLength(1)
  const wire = requests[0].messages.map(message => message.content).join('\n')
  for (const required of [notes, style, '先问搭档意愿', '未来计划：明日试做点心，尚未发生', '每天第一次签到免费', '作者自定义：克制而轻松。', '【Work 写作意图】', '鲁迅式犀利', '【作者画像完整尾部】']) expect(wire).toContain(required)
  expect(requests[0].temperature).toBe(0.2)
  expect(requests[0].max_tokens).toBe(1700)
  expect(wire).not.toContain('前 40%')
  await page.reload()
  await expect(draft).toHaveValue(generated)
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(draft).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toContainText('约定明天的分工')
  await page.reload()
  await expect(page.locator('.tiptap-editor')).toContainText('最后签收并关灯')
})

test('等待采纳期间改规则拒绝旧候选，保留原稿', async ({ page }) => {
  let calls = 0
  await page.route('https://prose-handoff.invalid/**', async route => {
    calls++
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: generated } }] })}\n\ndata: [DONE]\n\n` })
  })
  await prepare(page)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
  await expect(draft).toHaveValue(generated)
  await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const rules = await db.creativeRules.toCollection().first()
    await db.creativeRules.update(rules.id, { specialRequirements: '改为询问后就停笔，不签收', updatedAt: Date.now() })
  })
  await page.getByRole('button', { name: '采纳', exact: true }).click()
  await expect(page.getByText(/候选生成后项目内容已变化/)).toBeVisible()
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
  expect(calls).toBe(1)
})

test('模型窗口不够时显示错误，不发送被裁短的正式正文请求', async ({ page }) => {
  let calls = 0
  await page.route('https://prose-handoff.invalid/**', route => { calls++; return route.abort() })
  await prepare(page, true)
  await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await expect(page.getByText(/上下文窗口不足/)).toBeVisible()
  expect(calls).toBe(0)
  await expect(page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })).toHaveCount(0)
  await expect(page.locator('.tiptap-editor')).toBeEmpty()
})
