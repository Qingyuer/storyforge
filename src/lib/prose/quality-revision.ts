import type { ChatMessage, WorkspaceScope } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'
import { verifyWholeChapterQualityReviewV1, type QualityReviewArtifactV1 } from './quality-review'

export interface QualityRevisionSpanV1 {
  id: string
  start: number
  end: number
  text: string
}

/** Ephemeral author plan. The durable service must resolve ownership/freshness
 * again and use the existing chapter candidate/adoption path before any write. */
export interface QualityRevisionPlanV1 {
  version: 1
  type: 'quality-revision-plan'
  portable: false
  scope: Pick<WorkspaceScope, 'projectId' | 'worldId' | 'workId'>
  chapterId: number
  reportRunId: number
  reportHash: string
  targetTextHash: string
  issueIds: string[]
  allowedSpans: QualityRevisionSpanV1[]
  protectedQuotes: string[]
  authorRequest?: string
  budget: { previousCalls: number; maxTotalCalls: 4; maxRevisionCalls: 1; maxRecheckCalls: 1 }
  maxReplacementChars: number
  planHash: string
}

function paragraphs(text: string): QualityRevisionSpanV1[] {
  let start = 0
  const spans: QualityRevisionSpanV1[] = []
  for (const line of text.split('\n')) {
    if (line.trim()) spans.push({ id: `p${spans.length + 1}`, start, end: start + line.length, text: line })
    start += line.length + 1
  }
  return spans
}

export async function freezeQualityRevisionPlanV1(input: {
  scope: WorkspaceScope
  chapterId: number
  reportRunId: number
  report: QualityReviewArtifactV1
  reviewMessages: ChatMessage[]
  reviewCurrent: boolean
  originalText: string
  selectedIssueIds: string[]
  additionalParagraphs?: number[]
  protectedQuotes?: string[]
  authorRequest?: string
  previousCalls: number
}): Promise<QualityRevisionPlanV1> {
  if (!input.reviewCurrent || !await verifyWholeChapterQualityReviewV1(input.report, input.originalText, input.reviewMessages)) throw new Error('评审或原稿已变化，不能使用旧问题修订。')
  if (input.authorRequest != null && (typeof input.authorRequest !== 'string' || input.authorRequest.length > 16000)) throw new Error('本次修订要求无效或过长。')
  for (const id of [input.scope.projectId, input.scope.worldId, input.scope.workId, input.chapterId, input.reportRunId]) {
    if (!Number.isSafeInteger(id) || id! < 1) throw new Error('修订计划缺少明确作品和章节身份。')
  }
  if (!Number.isSafeInteger(input.previousCalls) || input.previousCalls < 0 || input.previousCalls > 2) throw new Error('本轮没有初稿、初审之后的修订与复核预算。')
  if (!input.selectedIssueIds.length || new Set(input.selectedIssueIds).size !== input.selectedIssueIds.length) throw new Error('请明确选择本轮要处理的问题。')
  const selected = input.selectedIssueIds.map(id => input.report.issues.find(issue => issue.id === id))
  if (selected.some(issue => !issue)) throw new Error('所选问题不属于当前报告。')
  const sourceSpans = paragraphs(input.originalText)
  const additional = input.additionalParagraphs ?? []
  if (additional.some(value => !Number.isSafeInteger(value) || value < 1 || value > sourceSpans.length)) throw new Error('可改段落不属于当前原稿。')
  const requested = sourceSpans.filter((span, index) => additional.includes(index + 1)
    || selected.some(issue => issue!.start < span.end && issue!.end > span.start))
  const protectedQuotes = [...new Set(input.protectedQuotes ?? [])]
  const protectedRanges = protectedQuotes.map(quote => {
    const start = input.originalText.indexOf(quote)
    if (!quote.trim() || start < 0 || input.originalText.indexOf(quote, start + 1) >= 0) throw new Error('保护文字必须是原稿中的唯一引文。')
    return { start, end: start + quote.length }
  }).sort((a, b) => a.start - b.start)
  if (protectedRanges.some((range, index) => index > 0 && range.start < protectedRanges[index - 1].end)) throw new Error('保护文字范围不能重叠。')
  const allowedSpans: QualityRevisionSpanV1[] = []
  for (const span of requested) {
    let start = span.start
    let part = 0
    const push = (end: number) => {
      if (end > start) allowedSpans.push({ id: `${span.id}.${++part}`, start, end, text: input.originalText.slice(start, end) })
    }
    for (const protectedRange of protectedRanges.filter(range => range.start < span.end && range.end > span.start)) {
      push(Math.max(start, protectedRange.start))
      start = Math.min(span.end, protectedRange.end)
    }
    push(span.end)
  }
  if (!allowedSpans.length) throw new Error('所选段落已全部保护，没有授权的可改文字。')
  const body: Omit<QualityRevisionPlanV1, 'planHash'> = {
    version: 1, type: 'quality-revision-plan', portable: false,
    scope: { projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId },
    chapterId: input.chapterId, reportRunId: input.reportRunId, reportHash: input.report.artifactHash,
    targetTextHash: input.report.targetTextHash, issueIds: [...input.selectedIssueIds], allowedSpans, protectedQuotes,
    budget: { previousCalls: input.previousCalls, maxTotalCalls: 4, maxRevisionCalls: 1, maxRecheckCalls: 1 },
    maxReplacementChars: Math.max(800, Math.ceil(input.originalText.length * 1.25)),
    ...(input.authorRequest?.trim() ? { authorRequest: input.authorRequest.trim() } : {}),
  }
  return { ...body, planHash: await hashCanonicalValue(body) }
}

/** Deterministic reconstruction preserves every unselected/protected code unit.
 * This is text-scope validation, not a semantic fact or literature certificate. */
export async function applyQualityRevisionPatchesV1(input: {
  plan: QualityRevisionPlanV1
  originalText: string
  raw: string
}): Promise<{ outputText: string; changedSpanIds: string[] }> {
  const { planHash, ...body } = input.plan
  if (planHash !== await hashCanonicalValue(body) || input.plan.targetTextHash !== await hashCanonicalValue(input.originalText)) throw new Error('修订计划或原稿版本已变化。')
  const received = input.raw.trim()
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*)\r?\n```$/.exec(received)
  const parsed = JSON.parse(fence ? fence[1].trim() : received)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).join('|') !== 'edits'
    || !Array.isArray(parsed.edits) || !parsed.edits.length) throw new Error('修订只能返回明确范围的 edits。')
  const seen = new Set<string>()
  let replacementChars = 0
  const edits = parsed.edits.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('修订项格式无效。')
    const row = value as Record<string, unknown>
    if (Object.keys(row).sort().join('|') !== 'replacement|spanId' || typeof row.spanId !== 'string' || typeof row.replacement !== 'string') throw new Error('修订项只允许 spanId 与 replacement。')
    const span = input.plan.allowedSpans.find(span => span.id === row.spanId)
    if (!span || seen.has(span.id) || input.originalText.slice(span.start, span.end) !== span.text) throw new Error('修订试图越过授权范围或重复修改。')
    seen.add(span.id)
    replacementChars += row.replacement.length
    return { ...span, replacement: row.replacement }
  })
  if (replacementChars > input.plan.maxReplacementChars) throw new Error('本轮修订超出冻结篇幅预算。')
  let outputText = input.originalText
  for (const edit of edits.sort((a: QualityRevisionSpanV1, b: QualityRevisionSpanV1) => b.start - a.start)) {
    outputText = outputText.slice(0, edit.start) + edit.replacement + outputText.slice(edit.end)
  }
  return { outputText, changedSpanIds: [...seen] }
}
