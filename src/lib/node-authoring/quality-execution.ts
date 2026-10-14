import type { Chapter, OutlineNode, WorkspaceScope } from '../types'
import { readOwnedRows, resolveScopeLike } from '../workspace/scope'
import { readLatestWholeChapterQualityReviewV1, runWholeChapterQualityReviewV1 } from '../agent/run/quality-review-durable'
import { createWholeChapterQualityCallV1 } from '../prose/quality-transport'
import { htmlToPlainText } from '../utils/html'
import type { AuthoringInputEnvelope, AuthoringNodeInstance } from './contracts'
import type { DomainExecutionInput, DomainExecutionResult } from './domain-execution'
import { readAuthoringCanonBinding } from './bindings'
import { describeResolvedAIRequestSettingsV1, resolveRequestConfig } from '../ai/client'
import { boundedQualityResolutionV1 } from '../prose/quality-request-budget'
import { hashCanonicalValue } from '../agent/run/hash'

export function qualityAuthoringModeV1(value: unknown): 'quality' | 'style' | 'readability' {
  if (value == null || value === 'quality' || value === '审校') return 'quality'
  if (value === 'style' || value === '表达与重复') return 'style'
  if (value === 'readability' || value === '追读力') return 'readability'
  throw new Error('评审侧重无效。')
}

export async function resolveQualityAuthoringChapterV1(input: { projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; node: AuthoringNodeInstance }) {
  const scope = input.scope ?? await resolveScopeLike(input.projectId)
  const title = typeof input.node.config.chapterTitle === 'string' ? input.node.config.chapterTitle.trim() : ''
  if (!title) throw new Error('请指定全文评审的目标章节。')
  const [chapters, outlines] = await Promise.all([readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }), readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })])
  const allowedOutlines = new Set(outlines.filter(row => (row.worldGroupId ?? null) === input.worldGroupId).map(row => row.id))
  const matches = chapters.filter(row => row.title === title && allowedOutlines.has(row.outlineNodeId))
  if (matches.length !== 1 || matches[0].id == null) throw new Error(`找不到唯一的目标章节《${title}》，未回退到其它章节。`)
  return { scope, chapter: matches[0] }
}

/** A visual adapter only: all model/context/evidence belongs to the shared service. */
export function qualityAuthoringRequestV1(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]) {
  const request = typeof node.config.request === 'string' ? node.config.request : ''
  const prompt = inputs.find(row => row.semantic === 'control.prompt')?.content.trim()
  return prompt ? `${request}\n\n【作者选择的提示词】\n${prompt}` : request
}

export function qualityAuthoringGenerationOverridesV1(node: AuthoringNodeInstance, inputs: AuthoringInputEnvelope[]) {
  const parameter = (semantic: string) => {
    const text = inputs.find(row => row.semantic === semantic)?.content.trim()
    return text == null || text === '' ? undefined : Number(text)
  }
  const values = { temperature: parameter('control.temperature') ?? (typeof node.config.temperature === 'number' ? node.config.temperature : undefined), maxTokens: parameter('control.max-tokens') ?? (typeof node.config.maxTokens === 'number' ? node.config.maxTokens : undefined) }
  if (Object.values(values).some(value => value != null && !Number.isFinite(value))) throw new Error('评审节点模型参数无效。')
  return values
}

export async function executeQualityAuthoringNodeV1(input: DomainExecutionInput): Promise<DomainExecutionResult> {
  const { scope, chapter } = await resolveQualityAuthoringChapterV1(input)
  const mode = qualityAuthoringModeV1(input.node.config.mode)
  const prose = input.inputs.filter(row => row.semantic === 'chapter.prose')
  if (prose.some(row => row.state !== 'canon' || ![htmlToPlainText(chapter.content).trim(), chapter.content.trim()].some(text => text && row.content.includes(text)))) throw new Error('评审只读取当前已保存的本章正文；请先确认上游候选。')
  const cached = input.node.config.newReport === true ? null : await readLatestWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, mode })
  const generationOverrides = qualityAuthoringGenerationOverridesV1(input.node, input.inputs)
  const authorRequest = qualityAuthoringRequestV1(input.node, input.inputs)
  const categories = { quality: 'review.quality', style: 'review.anti-ai', readability: 'review.readability' } as const
  const settings = describeResolvedAIRequestSettingsV1(boundedQualityResolutionV1(resolveRequestConfig(input.aiConfig, { category: categories[mode], projectId: input.projectId, configOverrides: generationOverrides })), false, { responseFormat: 'json_object' })
  const identity = (value: typeof settings) => ({ provider: value.provider, model: value.model, parameters: value.parameters })
  const reusable = cached?.current && !authorRequest.trim() && await hashCanonicalValue(identity(cached.report.reviewer.settings)) === await hashCanonicalValue(identity(settings))
  const result = reusable ? cached : await runWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, outlineNodeId: chapter.outlineNodeId, worldGroupId: input.worldGroupId, mode, configOverride: input.aiConfig, generationOverrides, authorRequest, call: createWholeChapterQualityCallV1(input.projectId, mode, input.signal) })
  const binding = await readAuthoringCanonBinding({ ...input, scope })
  return { output: JSON.stringify(result.report), semantic: 'chapter.quality-review', domain: { kind: 'quality-review', chapterTitle: chapter.title, mode, reportHash: result.report.artifactHash }, sourceKeys: binding.sourceKeys, sourceHash: binding.sourceHash, sourceEvidence: binding }
}

export async function isQualityAuthoringReportCurrentV1(input: { projectId: number; worldGroupId: number | null; node: AuthoringNodeInstance; reportHash: string; mode: 'quality' | 'style' | 'readability' }) {
  const { scope, chapter } = await resolveQualityAuthoringChapterV1(input)
  const result = await readLatestWholeChapterQualityReviewV1({ scope, chapterId: chapter.id!, mode: input.mode })
  return result?.current === true && result.report.artifactHash === input.reportHash
}
