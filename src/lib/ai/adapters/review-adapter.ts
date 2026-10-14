/**
 * 章节审校适配器 — Phase F1
 *
 * AI 审校五个维度：逻辑一致性、人物行为、世界观、伏笔衔接、情节节奏
 */
import type { ChatMessage } from '../../types'

export interface ReviewIssue {
  dimension: 'logic' | 'character' | 'worldview' | 'foreshadow' | 'pacing'
  severity: 'info' | 'warning' | 'critical'
  description: string
  quote?: string
  suggestion: string
}

export interface ReviewResult {
  overallScore: number
  issues: ReviewIssue[]
  suggestions: string[]
}

const DIMENSION_LABELS: Record<string, string> = {
  logic: '逻辑一致性',
  character: '人物行为',
  worldview: '世界观',
  foreshadow: '伏笔衔接',
  pacing: '情节节奏',
}

export { DIMENSION_LABELS as REVIEW_DIMENSION_LABELS }

/**
 * G8：按审校报告让 AI 修改全文。
 * 把原文 + 报告里的问题/建议喂给模型，产出修订后的【全文】（保持篇幅与情节，只针对问题改）。
 */
export function buildReviewRevisePrompt(
  chapterContent: string,
  report: ReviewResult,
  worldContext?: string,
  characterContext?: string,
): ChatMessage[] {
  const issueLines = report.issues.map((it, i) => {
    const dim = DIMENSION_LABELS[it.dimension] || it.dimension
    const q = it.quote ? `（原文：「${it.quote}」）` : ''
    return `${i + 1}. [${dim}·${it.severity}] ${it.description}${q} → 建议：${it.suggestion}`
  })
  const systemPrompt = `你是一位专业的小说编辑。下面给你一段章节正文，以及一份审校报告。
请你**根据报告逐条修订正文**，输出修改后的【完整正文】。

修订要求：
1. 只针对报告里指出的问题改（逻辑/人物/世界观/伏笔/节奏），没问题的段落保持原样。
2. 篇幅与原文相近（控制在原文 90%~110%）；绝不删情节、不缩写成摘要、不注水扩写。
3. 保持原有的人称、时态、文风；这是"改稿"，不是"重写"。
4. 直接输出修订后的正文全文，不要任何前言、说明、标注或 markdown。`

  const parts: string[] = [
    `【审校报告·待修订的问题】\n${issueLines.length ? issueLines.join('\n') : '（无具体问题项，按总体建议润饰即可）'}`,
  ]
  if (report.suggestions.length) parts.push(`【总体建议】\n${report.suggestions.map(s => '· ' + s).join('\n')}`)
  if (worldContext) parts.push(`【世界观参考】\n${worldContext}`)
  if (characterContext) parts.push(`【角色参考】\n${characterContext}`)
  parts.push(`【原文】\n${chapterContent}`)

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: parts.join('\n\n') + '\n\n请输出修订后的正文全文：' },
  ]
}
