import type { ChatMessage } from '../../types'

export type ConsistencyAuditMode = 'fast' | 'deep'
export type ConsistencySeverity = 'hard' | 'risk' | 'unknown'

export const CONSISTENCY_AUDIT_PROMPT_VERSION_V1 = 'consistency-evidence-audit-v2'

export interface ConsistencyFinding {
  category: string
  severity: ConsistencySeverity
  quote: string
  evidence: Array<{
    sourceType: 'canon' | 'observation' | 'chapter' | 'summary'
    sourceId: number
    quote: string
  }>
  reason: string
  suggestion?: string
}

export interface ConsistencyAuditResult {
  mode: ConsistencyAuditMode
  findings: ConsistencyFinding[]
}

export function buildConsistencyAuditPrompt(args: {
  mode: ConsistencyAuditMode
  chapterTitle: string
  chapterContent: string
  evidenceContext: string
  cognitionCatalog?: string
  lifecycleCatalog?: string
}): ChatMessage[] {
  const focus = args.mode === 'fast'
    ? '检查正文内部及其与已确认资料之间的直接矛盾：资源收支、明确时限、实际动作与结算、人物知情来源、证据能否支持结论，以及地点/世界归属、存亡、力量阶段和直接规则冲突。目标是低误报；证据不足就不要报 hard。'
    : '检查因果链、角色动机与长期弧光、伏笔遗漏或错误回收、故事线推进、复杂时间关系、社会规范、世界规则和叙事软风险。'
  return [
    {
      role: 'system',
      content: `你是小说一致性证据审计器。契约：${CONSISTENCY_AUDIT_PROMPT_VERSION_V1}。${focus}

输出严格 JSON：
{"findings":[{"category":"分类","severity":"hard|risk|unknown","quote":"待审正文逐字引文","evidence":[{"sourceType":"chapter|summary|observation|canon","sourceId":0,"quote":"证据上下文逐字引文"}],"reason":"为何冲突或有风险","suggestion":"可选建议"}],"cognitionReferences":[{"characterId":1,"knowledgeKey":"闭集中的key","quote":"该角色运用或陈述该知识的正文逐字引文"}],"lifecycleReferences":[{"characterId":1,"activityType":"normal-activity","quote":"已死亡角色作为活人正常行动的正文逐字引文"}]}

规则：
1. quote 必须逐字来自待审正文；
2. evidence.quote 必须逐字来自证据上下文；正文内部的另一处依据使用 sourceType="chapter"、sourceId=0，quote 逐字来自待审正文。0 仅代表本次待审章，不能用于伪造外部证据；
3. hard 必须有至少一条正确证据，且只能用于直接矛盾；
4. 创作选择、信息不足或可能解释得通的内容只能标 risk/unknown；
5. cognitionReferences 只能从提供的角色认知审计闭集中选择 characterId + knowledgeKey；quote 必须是正文逐字引文；不确定就不输出；
6. lifecycleReferences 只能从角色存亡审计闭集中选择 characterId；仅当该角色在当前场景作为活人正常行动时输出 normal-activity + 正文逐字引文。尸体、遗物、回忆、梦境、幻象、他人转述和明确复活均不得输出；
7. 区分创作计划、角色猜测/证词、记录记载与实际发生。章纲/细纲中的计划不是已发生的事实；偏离计划本身不是硬冲突。已确认的入场条件、规则和明确时限可用于核对；
8. 按叙事顺序核对实际行动、消耗、奖励与余额，不能只看结算句。修改记录不能代替实际核实；人物的确定判断需要相应证据，排除一个可能不自动证明另一个。缺少依据标 risk/unknown，建议保留不确定性或补足必要过程，不能捏造凭证或背景；
9. 普通拿取、翻页等省略和允许多种解释的细节不强判为矛盾。查到相关前后文再判断，不为凑问题要求机械补写；
10. 不输出总分，不自动修改正文；没有发现可定位的问题才返回空 findings，这不认证整章事实无误。`,
    },
    {
      role: 'user',
      content: `【章节】${args.chapterTitle}\n\n【只读资料：规则与已确认条件用于核对，章纲/细纲是计划】\n${args.evidenceContext}\n\n${args.cognitionCatalog || '【角色认知审计闭集】无'}\n\n${args.lifecycleCatalog || '【角色存亡审计闭集】无'}\n\n【待审正文：其中的断言也需要核对，不能自证正确】\n${args.chapterContent}\n\n请输出 JSON：`,
    },
  ]
}

export function parseConsistencyAuditResult(args: {
  raw: string
  mode: ConsistencyAuditMode
  chapterContent: string
  evidenceContext: string
}): ConsistencyAuditResult | null {
  const start = args.raw.indexOf('{')
  const end = args.raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(args.raw.slice(start, end + 1)) as { findings?: unknown }
    if (!Array.isArray(parsed.findings)) return null
    const findings = parsed.findings.map((raw): ConsistencyFinding => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid finding')
      const item = raw as Record<string, unknown>
      const quote = typeof item.quote === 'string' ? item.quote.trim() : ''
      if (!quote || !args.chapterContent.includes(quote)
        || typeof item.category !== 'string' || !item.category.trim()
        || typeof item.reason !== 'string' || !item.reason.trim()
        || !['hard', 'risk', 'unknown'].includes(String(item.severity))
        || !Array.isArray(item.evidence)
        || (item.suggestion !== undefined && typeof item.suggestion !== 'string')) {
        throw new Error('Invalid finding contract or prose anchor')
      }
      const evidence = item.evidence.map((entry): ConsistencyFinding['evidence'][number] => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid evidence')
        const value = entry as Record<string, unknown>
        const evidenceQuote = typeof value.quote === 'string' ? value.quote.trim() : ''
        const currentChapter = value.sourceType === 'chapter' && value.sourceId === 0
        if (!evidenceQuote || !['canon', 'observation', 'chapter', 'summary'].includes(String(value.sourceType))
          || !Number.isInteger(value.sourceId) || (value.sourceId as number) < 0
          || !(currentChapter ? args.chapterContent : args.evidenceContext).includes(evidenceQuote)) {
          throw new Error('Invalid evidence contract or source anchor')
        }
        return {
          sourceType: value.sourceType as ConsistencyFinding['evidence'][number]['sourceType'],
          sourceId: value.sourceId as number,
          quote: evidenceQuote,
        }
      })
      const requested = item.severity as ConsistencySeverity
      const severity: ConsistencySeverity = requested === 'hard' && evidence.length === 0 ? 'unknown' : requested
      return {
        category: item.category.trim(),
        severity,
        quote,
        evidence,
        reason: item.reason.trim(),
        suggestion: (item.suggestion as string | undefined)?.trim() || undefined,
      }
    })
    return { mode: args.mode, findings }
  } catch {
    return null
  }
}
