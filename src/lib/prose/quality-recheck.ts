import type { ChatMessage } from '../types'
import type { AIRequestSettingsV1 } from '../ai/client'
import { hashCanonicalValue } from '../agent/run/hash'
import { buildWholeChapterQualityReviewRequestV1, parseWholeChapterQualityReviewV1, verifyWholeChapterQualityReviewV1, qualityReviewPromptVersionFromMessagesV1, type QualityReviewArtifactV1 } from './quality-review'
import type { QualityRevisionPlanV1 } from './quality-revision'
import { SCENE_RECHECK_GUIDANCE_V1 } from './scene-craft'

export const QUALITY_RECHECK_PROMPT_VERSION_V1 = 'quality-revision-recheck-v3'
const RECHECK_PROMPT_VERSIONS = ['quality-revision-recheck-v1', 'quality-revision-recheck-v2', QUALITY_RECHECK_PROMPT_VERSION_V1] as const
export interface QualityRecheckArtifactV1 {
  version: 1
  promptVersion: typeof RECHECK_PROMPT_VERSIONS[number]
  planHash: string
  review: QualityReviewArtifactV1
  outcomes: { issueId: string; status: 'improved' | 'unchanged' | 'uncertain'; quote: string; start: number; end: number; reason: string }[]
  artifactHash: string
}

export async function buildQualityRecheckRequestV1(input: {
  plan: QualityRevisionPlanV1
  originalReport: QualityReviewArtifactV1
  chapterTitle: string
  candidateText: string
  registeredContext: string
}): Promise<ChatMessage[]> {
  if (input.originalReport.artifactHash !== input.plan.reportHash) throw new Error('复核的初审报告与冻结计划不一致。')
  const request = await buildWholeChapterQualityReviewRequestV1({ mode: 'quality', chapterTitle: input.chapterTitle, chapterText: input.candidateText, registeredContext: input.registeredContext })
  request.messages[0].content += `\n复核契约：${QUALITY_RECHECK_PROMPT_VERSION_V1}。
本轮只复核一次，不再改写。资料里的已保存正文和初审引文属于旧稿，只用于比较；最后“当前修订候选全文”才是本次唯一审查对象。不能把旧稿误当作当前候选，不能从旧稿复制review.issues.quote或outcomes.quote。逐字核对修订后是否仍有原问题，不能仅复述初审结论。
除检查新问题，还逐项说明作者选中的原问题是improved、unchanged或uncertain。每项outcomes.quote必须是当前修订候选的一个唯一逐字片段；改善是模型建议，不是文学认证。不要替作者选择继续循环。
${SCENE_RECHECK_GUIDANCE_V1}
本轮输出外层JSON契约替代上一段的外层契约：{"review":{"summary":"阅读情况","strengths":[],"issues":[]},"outcomes":[{"issueId":"选中问题id","status":"improved|unchanged|uncertain","quote":"候选中的唯一片段","reason":"改善/未解决/不确定的依据"}]}。review内的issues仍按前述逐字引文契约。`
  request.messages[1].content = `【登记的作品资料与作者意图 · 正文快照属于修订前版本】\n${input.registeredContext || '（暂无）'}
【冻结计划 ${input.plan.planHash} · 初审旧稿问题，仅用于前后比较】\n${JSON.stringify(input.originalReport.issues.filter(issue => input.plan.issueIds.includes(issue.id)))}
【初审保留点 · 只供比较，不是新增事实】\n${JSON.stringify(input.originalReport.strengths)}${input.plan.authorRequest ? `\n【本轮作者要求 · 只适用于冻结范围】\n${input.plan.authorRequest}` : ''}
【受保护文字】\n${JSON.stringify(input.plan.protectedQuotes)}
【章节】${input.chapterTitle}
【当前修订候选全文 · 唯一审查对象 · hash ${request.targetTextHash} · UTF16长度 ${input.candidateText.length}】\n${input.candidateText}
【当前修订候选全文结束】
现在逐字检查上方当前候选。所有定位引文必须来自当前候选，不得引用资料或初审中的旧句。只输出复核JSON。`
  return request.messages
}

export async function parseQualityRecheckV1(input: {
  raw: string
  plan: QualityRevisionPlanV1
  candidateText: string
  messages: ChatMessage[]
  settings: AIRequestSettingsV1
  completion: 'complete' | 'length' | 'unknown'
  createdAt?: number
}): Promise<QualityRecheckArtifactV1> {
  const received = input.raw.trim()
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*)\r?\n```$/.exec(received)
  let root: any
  try { root = JSON.parse(fence ? fence[1] : received) } catch { throw new Error('复核响应格式无效，未自动重发。') }
  if (!root || typeof root !== 'object' || Array.isArray(root) || Object.keys(root).sort().join('|') !== 'outcomes|review'
    || !Array.isArray(root.outcomes) || root.outcomes.length !== input.plan.issueIds.length) throw new Error('复核必须逐项覆盖本轮所选问题。')
  const reviewPromptVersion = qualityReviewPromptVersionFromMessagesV1(input.messages)
  const review = await parseWholeChapterQualityReviewV1({ raw: JSON.stringify(root.review), mode: 'quality', chapterText: input.candidateText, targetTextHash: await hashCanonicalValue(input.candidateText), messages: input.messages, settings: input.settings, responseCompletion: input.completion, createdAt: input.createdAt, promptVersion: reviewPromptVersion })
  const seen = new Set<string>()
  const outcomes = root.outcomes.map((row: any) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).sort().join('|') !== 'issueId|quote|reason|status'
      || !input.plan.issueIds.includes(row.issueId) || seen.has(row.issueId)
      || !['improved', 'unchanged', 'uncertain'].includes(row.status)
      || typeof row.quote !== 'string' || !row.quote.trim() || row.quote.length > 1000
      || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.length > 2000) throw new Error('复核问题身份、引文或判断标识无效。')
    const start = input.candidateText.indexOf(row.quote)
    if (start < 0 || input.candidateText.indexOf(row.quote, start + 1) >= 0) throw new Error('复核引文不存在或不唯一。')
    seen.add(row.issueId)
    return { issueId: row.issueId, status: row.status, quote: row.quote, start, end: start + row.quote.length, reason: row.reason }
  })
  const promptVersion = RECHECK_PROMPT_VERSIONS.find(version => input.messages[0]?.content.includes(`复核契约：${version}。`)) ?? 'quality-revision-recheck-v1'
  const body: Omit<QualityRecheckArtifactV1, 'artifactHash'> = { version: 1, promptVersion, planHash: input.plan.planHash, review, outcomes }
  return { ...body, artifactHash: await hashCanonicalValue(body) }
}

export async function verifyQualityRecheckV1(artifact: QualityRecheckArtifactV1, plan: QualityRevisionPlanV1, candidateText: string, messages: ChatMessage[]): Promise<boolean> {
  try {
    const { artifactHash, ...body } = artifact
    if (artifact.version !== 1 || !RECHECK_PROMPT_VERSIONS.includes(artifact.promptVersion) || artifact.planHash !== plan.planHash
      || artifactHash !== await hashCanonicalValue(body) || !await verifyWholeChapterQualityReviewV1(artifact.review, candidateText, messages)) return false
    const raw = JSON.stringify({ review: { summary: artifact.review.summary, strengths: artifact.review.strengths, issues: artifact.review.issues.map(({ dimension, confidence, quote, start, end, reason, suggestion }) => ({ dimension, confidence, quote, start, end, reason, suggestion })) }, outcomes: artifact.outcomes.map(({ issueId, status, quote, reason }) => ({ issueId, status, quote, reason })) })
    const parsed = await parseQualityRecheckV1({ raw, plan, candidateText, messages, settings: artifact.review.reviewer.settings, completion: 'complete', createdAt: artifact.review.createdAt })
    return parsed.artifactHash === artifact.artifactHash
  } catch { return false }
}
