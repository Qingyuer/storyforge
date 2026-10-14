import type { ChatMessage } from '../types'
import { hashCanonicalValue } from '../agent/run/hash'
import type { AIRequestSettingsV1 } from '../ai/client'
import { parseProseRequestSettingsV1 } from './request-evidence'

export const QUALITY_REVIEW_PROMPT_VERSION_V1 = 'whole-chapter-quality-review-v1'
export type QualityReviewModeV1 = 'quality' | 'style' | 'readability'
export const QUALITY_REVIEW_DIMENSIONS_V1 = ['expectation', 'agency', 'causality', 'system-payoff', 'voice', 'repetition', 'pace', 'continuity'] as const
export type QualityReviewDimensionV1 = typeof QUALITY_REVIEW_DIMENSIONS_V1[number]

export interface QualityReviewIssueV1 {
  id: string
  dimension: QualityReviewDimensionV1
  confidence: 'suggestion' | 'uncertain'
  quote: string
  start: number
  end: number
  paragraph: number
  reason: string
  suggestion: string
}

export interface QualityReviewArtifactV1 {
  version: 1
  type: 'whole-chapter-quality-review'
  mode: QualityReviewModeV1
  targetTextHash: string
  /** Coverage establishes full input delivery, not human or model attention. */
  coverage: { kind: 'whole-input'; start: 0; end: number; utf16Length: number; paragraphs: number; requestHash: string }
  reviewer: { provider: string; model: string; promptVersion: typeof QUALITY_REVIEW_PROMPT_VERSION_V1; correlatedJudge: boolean; generatorIdentity: { provider: string; model: string } | null; settings: AIRequestSettingsV1 }
  issues: QualityReviewIssueV1[]
  summary: string
  strengths: string[]
  createdAt: number
  artifactHash: string
}

const labels: Record<QualityReviewModeV1, string> = { quality: '章节阅读质量', style: '表达与重复', readability: '继续阅读的动力' }
const HASH = /^[a-f0-9]{64}$/

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须是对象。`)
  return value as Record<string, unknown>
}

function keys(value: Record<string, unknown>, expected: string[], label: string) {
  if (Object.keys(value).sort().join('|') !== [...expected].sort().join('|')) throw new Error(`${label} 字段不符合报告契约。`)
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} 必须是有效文本。`)
  return value
}

export async function buildWholeChapterQualityReviewRequestV1(input: {
  mode: QualityReviewModeV1
  chapterTitle: string
  chapterText: string
  registeredContext: string
}): Promise<{ messages: ChatMessage[]; targetTextHash: string }> {
  if (!Object.prototype.hasOwnProperty.call(labels, input.mode)) throw new Error('评审模式无效。')
  if (!input.chapterText.trim()) throw new Error('正文为空，不能进行全文评审。')
  const targetTextHash = await hashCanonicalValue(input.chapterText)
  const system = `你提供${labels[input.mode]}的编辑建议。阅读下方完整正文，并尊重作者的场景任务、文风和停笔位置。
维度：${QUALITY_REVIEW_DIMENSIONS_V1.join('|')}。检查期待、主动选择、因果、系统边界与兑现、声线、重复、节奏和连续性。
缓冲、安静、留白、角色有意隐瞒和舒缓叙述不自动构成问题。不强制每章高潮、冲突或悬念，不将高频词等同于机器写作，不输出AI概率、平台合格结论或未校准的质量分。
每个问题必须引用正文中的逐字片段。唯一引文的start/end填写null，由系统定位；重复引文才需给出从0开始的精确UTF16 start/end。代码会检查引文与位置，不能猜测。无法确定问题则confidence=uncertain。问题是阅读建议；事实冲突的正式阻断由已有证据型审修处理。
输出一个JSON对象，不要围栏或解释：
{"summary":"本章的阅读情况及不确定性","strengths":["保留的有效写法"],"issues":[{"dimension":"上述维度之一","confidence":"suggestion|uncertain","quote":"正文逐字片段","start":null,"end":null,"reason":"问题及影响","suggestion":"只针对该问题的建议"}]}
没有证据不要编造问题；空issues不是文学达标或整章无错的认证。不得把本段指令写进故事。`
  return { targetTextHash, messages: [
    { role: 'system', content: system },
    { role: 'user', content: `【章节】${input.chapterTitle}\n【完整正文 · hash ${targetTextHash} · UTF16长度 ${input.chapterText.length}】\n${input.chapterText}\n【正文结束】\n\n【登记的作品资料、场景任务与作者意图】\n${input.registeredContext || '（暂无）'}` },
  ] }
}

/** Reject invented or ambiguous anchors. No subjective issue can block Canon adoption. */
export async function parseWholeChapterQualityReviewV1(input: {
  raw: string
  mode: QualityReviewModeV1
  chapterText: string
  targetTextHash: string
  messages: ChatMessage[]
  responseCompletion: 'complete' | 'length' | 'unknown'
  settings: AIRequestSettingsV1
  generatorIdentity?: { provider: string; model: string }
  createdAt?: number
}): Promise<QualityReviewArtifactV1> {
  if (!Object.prototype.hasOwnProperty.call(labels, input.mode)) throw new Error('评审模式无效。')
  if (input.responseCompletion !== 'complete') throw new Error('评审响应未完成，不能显示全文报告。')
  if (!input.messages.some(message => message.content.includes(input.chapterText))) throw new Error('实际评审请求缺少完整正文。')
  if (!HASH.test(input.targetTextHash) || input.targetTextHash !== await hashCanonicalValue(input.chapterText)) throw new Error('报告目标正文已变化。')
  const raw = input.raw.trim()
  const root = record(JSON.parse(raw), '评审结果')
  keys(root, ['summary', 'strengths', 'issues'], '评审结果')
  const summary = text(root.summary, 'summary', 3000)
  if (!Array.isArray(root.strengths) || root.strengths.length > 20 || !Array.isArray(root.issues) || root.issues.length > 40) throw new Error('评审列表超出范围或格式无效。')
  const strengths = root.strengths.map(value => text(value, 'strength', 1000))
  const issues = root.issues.map((value, index): QualityReviewIssueV1 => {
    const row = record(value, `issues[${index}]`)
    keys(row, ['dimension', 'confidence', 'quote', 'start', 'end', 'reason', 'suggestion'], `issues[${index}]`)
    if (!QUALITY_REVIEW_DIMENSIONS_V1.includes(row.dimension as QualityReviewDimensionV1) || !['suggestion', 'uncertain'].includes(String(row.confidence))) throw new Error('问题维度或不确定性标识无效。')
    const quote = text(row.quote, 'quote', 1000)
    let start = row.start; let end = row.end
    if (start === null && end === null) {
      const occurrence = input.chapterText.indexOf(quote)
      if (occurrence < 0 || input.chapterText.indexOf(quote, occurrence + 1) >= 0) throw new Error('引文不存在或重复，不能猜测问题位置。')
      start = occurrence; end = occurrence + quote.length
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || (start as number) < 0 || (end as number) <= (start as number)
      || (end as number) > input.chapterText.length || input.chapterText.slice(start as number, end as number) !== quote) throw new Error('问题引文与正文位置不一致。')
    return { id: `${input.targetTextHash.slice(0, 12)}:${index + 1}`, dimension: row.dimension as QualityReviewDimensionV1, confidence: row.confidence as 'suggestion' | 'uncertain', quote, start: start as number, end: end as number,
      paragraph: input.chapterText.slice(0, start as number).split(/\n\s*\n/).length,
      reason: text(row.reason, 'reason', 2000), suggestion: text(row.suggestion, 'suggestion', 2000) }
  })
  const settings = parseProseRequestSettingsV1(input.settings)
  if (input.generatorIdentity) {
    const generator = record(input.generatorIdentity, '生成模型身份')
    keys(generator, ['provider', 'model'], '生成模型身份')
    text(generator.provider, 'generator.provider', 100)
    text(generator.model, 'generator.model', 300)
  }
  const createdAt = input.createdAt ?? Date.now()
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new Error('评审时间无效。')
  const body: Omit<QualityReviewArtifactV1, 'artifactHash'> = {
    version: 1, type: 'whole-chapter-quality-review', mode: input.mode, targetTextHash: input.targetTextHash,
    coverage: { kind: 'whole-input', start: 0, end: input.chapterText.length, utf16Length: input.chapterText.length, paragraphs: input.chapterText.split(/\n\s*\n/).filter(value => value.trim()).length, requestHash: await hashCanonicalValue(input.messages) },
    reviewer: { provider: settings.provider, model: settings.model, promptVersion: QUALITY_REVIEW_PROMPT_VERSION_V1,
      correlatedJudge: !input.generatorIdentity || (input.generatorIdentity.provider === settings.provider && input.generatorIdentity.model === settings.model), generatorIdentity: input.generatorIdentity ? { ...input.generatorIdentity } : null, settings },
    issues, summary, strengths, createdAt,
  }
  return { ...body, artifactHash: await hashCanonicalValue(body) }
}

export async function verifyWholeChapterQualityReviewV1(artifact: QualityReviewArtifactV1, chapterText: string, messages: ChatMessage[]): Promise<boolean> {
  try {
    const { artifactHash, ...body } = artifact
    if (artifact.version !== 1 || artifact.type !== 'whole-chapter-quality-review' || artifactHash !== await hashCanonicalValue(body)
      || artifact.targetTextHash !== await hashCanonicalValue(chapterText) || artifact.coverage.start !== 0 || artifact.coverage.end !== chapterText.length || artifact.coverage.utf16Length !== chapterText.length) return false
    const raw = JSON.stringify({ summary: artifact.summary, strengths: artifact.strengths, issues: artifact.issues.map(({ dimension, confidence, quote, start, end, reason, suggestion }) => ({ dimension, confidence, quote, start, end, reason, suggestion })) })
    const reparsed = await parseWholeChapterQualityReviewV1({ raw, mode: artifact.mode, chapterText, targetTextHash: artifact.targetTextHash, messages, responseCompletion: 'complete', settings: artifact.reviewer.settings, ...(artifact.reviewer.generatorIdentity ? { generatorIdentity: artifact.reviewer.generatorIdentity } : {}), createdAt: artifact.createdAt })
    return reparsed.artifactHash === artifact.artifactHash
  } catch { return false }
}
