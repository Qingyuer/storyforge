import { describe, expect, it } from 'vitest'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1, verifyWholeChapterQualityReviewV1 } from '../../src/lib/prose/quality-review'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'

const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig({ ...useAIConfigStore.getState().config, provider: 'ollama', model: 'review-contract-test', temperature: 0, maxTokens: 4000 }), false)
const issue = (quote: string, start: number | null, end: number | null) => ({ dimension: 'causality', confidence: 'uncertain', quote, start, end, reason: '付款过程没有写出，却直接记为已收款。', suggestion: '核对付款过程，保持金额和签字人。' })

describe('LFQ7 · 全章输入、真实引文与阅读建议合同', () => {
  it('末尾4500字之后的问题、长章和登记资料尾部完整进入三个评审请求', async () => {
    const text = '前段叙述。'.repeat(1000) + '\n\n未付款却记为已收款。'
    for (const mode of ['quality', 'style', 'readability'] as const) {
      const request = await buildWholeChapterQualityReviewRequestV1({ mode, chapterTitle: '交付', chapterText: text, registeredContext: '登记资料'.repeat(1000) + '【资料尾部】' })
      expect(request.messages[1].content).toContain(text)
      expect(request.messages[1].content).toContain('【资料尾部】')
      expect(request.messages[0].content).toContain('缓冲、安静、留白、角色有意隐瞒')
      expect(request.messages[0].content).toContain('不输出AI概率')
      const quote = '未付款却记为已收款。'; const start = text.indexOf(quote)
      const report = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '需核对交付过程', strengths: ['保留自然停笔'], issues: [issue(quote, start, start + quote.length)] }), mode, chapterText: text, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
      expect(report.issues[0].start).toBeGreaterThan(4000)
      expect(report.issues[0].paragraph).toBe(2)
      expect(report.coverage.end).toBe(text.length)
      expect(report.reviewer.correlatedJudge).toBe(true)
      expect(await verifyWholeChapterQualityReviewV1(report, text, request.messages)).toBe(true)
      expect(await verifyWholeChapterQualityReviewV1(report, text + '作者新改一段', request.messages)).toBe(false)
    }
  })

  it('伪造引文、重复引文猜位置和虚构满分字段均被拒绝，UTF16位置保留', async () => {
    const text = '😀收条已签。\n\n收条已签。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '收条', chapterText: text, registeredContext: '' })
    const parse = (row: unknown) => parseWholeChapterQualityReviewV1({ raw: JSON.stringify(row), mode: 'quality', chapterText: text, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
    const root = { summary: '仅为建议', strengths: [], issues: [issue('并不存在的付款', 0, 7)] }
    await expect(parse(root)).rejects.toThrow('不一致')
    await expect(parse({ ...root, issues: [issue('收条已签。', null, null)] })).rejects.toThrow('重复')
    await expect(parse({ ...root, issues: [], overallScore: 100 })).rejects.toThrow('契约')
    const good = await parse({ ...root, issues: [issue('收条已签。', 2, 7)] })
    expect(good.issues[0].start).toBe(2)
    expect(await verifyWholeChapterQualityReviewV1({ ...good, issues: [{ ...good.issues[0], start: 0 }] }, text, request.messages)).toBe(false)
  })

  it('只送前段、响应截断或完成未知都不能声称全文已评；独立模型身份与报告损坏可回查', async () => {
    const text = '安静清点工具。\n\n关灯后停笔。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'style', chapterTitle: '关灯', chapterText: text, registeredContext: '' })
    const base = { raw: JSON.stringify({ summary: '缓冲章可保留', strengths: ['具体行动有效'], issues: [] }), mode: 'style' as const, chapterText: text, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    await expect(parseWholeChapterQualityReviewV1({ ...base, messages: [{ role: 'user', content: '安静清点工具。' }] })).rejects.toThrow('完整正文')
    await expect(parseWholeChapterQualityReviewV1({ ...base, responseCompletion: 'length' })).rejects.toThrow('未完成')
    await expect(parseWholeChapterQualityReviewV1({ ...base, responseCompletion: 'unknown' })).rejects.toThrow('未完成')
    const report = await parseWholeChapterQualityReviewV1({ ...base, generatorIdentity: { provider: 'agnes', model: 'another-generator' } })
    expect(report.reviewer.correlatedJudge).toBe(false)
    expect(await verifyWholeChapterQualityReviewV1(report, text, request.messages)).toBe(true)
    expect(await verifyWholeChapterQualityReviewV1(report, text, [{ role: 'user', content: text }])).toBe(false)
    expect(await verifyWholeChapterQualityReviewV1({ ...report, coverage: { ...report.coverage, end: 8 } }, text, request.messages)).toBe(false)
  })

  it('只归一化完整JSON围栏，缺引文或夹带解释仍拒绝；历史v1报告继续验签', async () => {
    const chapterText = '陈禾接过一百二十元，数好后把收条交还。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '交清', chapterText, registeredContext: '' })
    const raw = JSON.stringify({ summary: '已描写实际收款过程', strengths: ['行动具体'], issues: [] })
    const base = { raw, mode: 'quality' as const, chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    const fenced = await parseWholeChapterQualityReviewV1({ ...base, raw: '```json\n' + raw + '\n```' })
    expect(await verifyWholeChapterQualityReviewV1(fenced, chapterText, request.messages)).toBe(true)
    await expect(parseWholeChapterQualityReviewV1({ ...base, raw: '说明\n```json\n' + raw + '\n```' })).rejects.toThrow()
    await expect(parseWholeChapterQualityReviewV1({ ...base, raw: JSON.stringify({ summary: '猜测', strengths: [], issues: [{ ...issue('', null, null), quote: null }] }) })).rejects.toThrow('quote')
    const historical = await parseWholeChapterQualityReviewV1({ ...base, promptVersion: 'whole-chapter-quality-review-v1' })
    expect(await verifyWholeChapterQualityReviewV1(historical, chapterText, request.messages)).toBe(true)
    expect(request.messages[0].content).toContain('只有start/end允许同时为null')
    expect(request.messages[0].content).toContain('章纲、细纲与作者要求是计划')
  })

  it('富文本存稿的单换行按非空文本段定位，旧v2的段落规则仍可验签', async () => {
    const chapterText = '准备验收。\n\n检查封盖。\n拿出收条。\n实际收款缺失。'
    const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '验收', chapterText, registeredContext: '' })
    const raw = JSON.stringify({ summary: '核对动作和结果', strengths: [], issues: [issue('实际收款缺失。', null, null)] })
    const base = { raw, mode: 'quality' as const, chapterText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete' as const, settings }
    const current = await parseWholeChapterQualityReviewV1(base)
    expect(current.coverage.paragraphs).toBe(4)
    expect(current.issues[0].paragraph).toBe(4)
    expect(await verifyWholeChapterQualityReviewV1(current, chapterText, request.messages)).toBe(true)
    const old = await parseWholeChapterQualityReviewV1({ ...base, promptVersion: 'whole-chapter-quality-review-v2' })
    expect(old.coverage.paragraphs).toBe(2)
    expect(old.issues[0].paragraph).toBe(2)
    expect(await verifyWholeChapterQualityReviewV1(old, chapterText, request.messages)).toBe(true)
  })
})
