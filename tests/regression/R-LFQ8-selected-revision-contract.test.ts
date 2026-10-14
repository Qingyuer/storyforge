import { describe, expect, it } from 'vitest'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1 } from '../../src/lib/prose/quality-review'
import { freezeQualityRevisionPlanV1, applyQualityRevisionPatchesV1 } from '../../src/lib/prose/quality-revision'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../../src/lib/ai/client'
import { useAIConfigStore } from '../../src/stores/ai-config'

async function seed() {
  const originalText = '已确认事实：余额3点。\n陈禾写下已收款，但未交代付款过程。\n两人关灯，停笔。'
  const quote = '陈禾写下已收款，但未交代付款过程。'
  const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: '交付', chapterText: originalText, registeredContext: '本章交清十份餐并收款，保留三点余额。' })
  const settings = describeResolvedAIRequestSettingsV1(resolveRequestConfig({ ...useAIConfigStore.getState().config, provider: 'ollama', model: 'scope-test' }), true)
  const report = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify({ summary: '核对收款过程', strengths: ['自然停笔'], issues: [{ dimension: 'causality', confidence: 'uncertain', quote, start: null, end: null, reason: '关键动作未写出', suggestion: '补足实际收款过程，保留金额和余额' }] }), mode: 'quality', chapterText: originalText, targetTextHash: request.targetTextHash, messages: request.messages, responseCompletion: 'complete', settings })
  return { scope: { projectId: 1, worldId: 2, workId: 3 }, chapterId: 4, reportRunId: 5, report, reviewMessages: request.messages, reviewCurrent: true, originalText, selectedIssueIds: [report.issues[0].id], previousCalls: 2 }
}

describe('LFQ8 · 作者选题与限定文字范围', () => {
  it('只修所选问题的段落，未选事实和停笔逐字保留；本轮冻结四次总预算', async () => {
    const f = await seed()
    const plan = await freezeQualityRevisionPlanV1(f)
    expect(plan.allowedSpans.map(span => span.id)).toEqual(['p2.1'])
    const result = await applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ spanId: 'p2.1', replacement: '赵经理递来一百二十元；陈禾点清后开了收条。' }] }) })
    expect(result.outputText).toBe('已确认事实：余额3点。\n赵经理递来一百二十元；陈禾点清后开了收条。\n两人关灯，停笔。')
    expect(plan.budget).toEqual({ previousCalls: 2, maxTotalCalls: 4, maxRevisionCalls: 1, maxRecheckCalls: 1 })
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ spanId: 'p1.1', replacement: '余额变成30点。' }] }) })).rejects.toThrow('授权')
  })

  it('保护文字从允许范围中扣除，修订不能替换受保护的原句', async () => {
    const f = await seed()
    const plan = await freezeQualityRevisionPlanV1({ ...f, additionalParagraphs: [1], protectedQuotes: ['已确认事实：余额3点。', '已收款'] })
    expect(plan.allowedSpans.map(span => span.text)).toEqual(['陈禾写下', '，但未交代付款过程。'])
    const result = await applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ spanId: 'p2.2', replacement: '；收款动作已补足。' }] }) })
    expect(result.outputText).toContain('已确认事实：余额3点。')
    expect(result.outputText).toContain('已收款')
    expect(result.outputText).toContain('两人关灯，停笔。')
  })

  it('旧报告、未选问题、伪造引文和越界段落在发模型前拒绝', async () => {
    const f = await seed()
    await expect(freezeQualityRevisionPlanV1({ ...f, reviewCurrent: false })).rejects.toThrow('已变化')
    await expect(freezeQualityRevisionPlanV1({ ...f, originalText: f.originalText + '作者改稿。' })).rejects.toThrow('已变化')
    await expect(freezeQualityRevisionPlanV1({ ...f, selectedIssueIds: [] })).rejects.toThrow('明确选择')
    await expect(freezeQualityRevisionPlanV1({ ...f, selectedIssueIds: ['其它报告的问题'] })).rejects.toThrow('当前报告')
    await expect(freezeQualityRevisionPlanV1({ ...f, additionalParagraphs: [99] })).rejects.toThrow('段落')
    await expect(freezeQualityRevisionPlanV1({ ...f, protectedQuotes: ['不存在的已确认事实'] })).rejects.toThrow('唯一引文')
  })

  it('预算耗尽、重复补丁、夹带全文、过量输出或计划篡改均拒绝', async () => {
    const f = await seed()
    await expect(freezeQualityRevisionPlanV1({ ...f, previousCalls: 3 })).rejects.toThrow('预算')
    const plan = await freezeQualityRevisionPlanV1(f)
    const edit = { spanId: 'p2.1', replacement: '补足收款过程。' }
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [edit, edit] }) })).rejects.toThrow('重复')
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [edit], fullText: '偷偷重写全章' }) })).rejects.toThrow('edits')
    await expect(applyQualityRevisionPatchesV1({ plan, originalText: f.originalText, raw: JSON.stringify({ edits: [{ ...edit, replacement: '字'.repeat(801) }] }) })).rejects.toThrow('篇幅预算')
    await expect(applyQualityRevisionPatchesV1({ plan: { ...plan, chapterId: 999 }, originalText: f.originalText, raw: JSON.stringify({ edits: [edit] }) })).rejects.toThrow('已变化')
  })
})
