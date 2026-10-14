/**
 * 质量审校面板 — Phase F
 *
 * 集成三套质量检测：审校(F1)、去AI味(F2)、追读力(F3)
 */
import { useEffect, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import { X, ShieldCheck, Bot, TrendingUp, Loader2, ScanSearch } from 'lucide-react'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { useReviewResultStore, selectChapterReview, type ReviewTab } from '../../stores/review-result'
import type { ReviewResult } from '../../lib/ai/adapters/review-adapter'
import {
  type ConsistencyAuditMode,
  type ConsistencyAuditResult,
} from '../../lib/ai/adapters/consistency-audit-adapter'
import {
  toConsistencyAuditResult,
  type ConsistencyAgentRun,
} from '../../lib/agent/consistency-agent'
import { AgentTeamBudgetTracker } from '../../lib/agent/team-budget'
import { runDurableConsistencyAuditV1 } from '../../lib/agent/run/consistency-audit-durable'
import { resolveScopeLike } from '../../lib/workspace/scope'
import { useAIConfigStore } from '../../stores/ai-config'
import { runWholeChapterQualityReviewV1, readLatestWholeChapterQualityReviewV1, type DurableQualityReviewV1 } from '../../lib/agent/run/quality-review-durable'
import type { QualityReviewModeV1 } from '../../lib/prose/quality-review'
import { captureWorkspaceContentRevisionV1 } from '../../lib/authoring/content-revision'
import { db } from '../../lib/db/schema'

interface Props {
  projectId: number
  /** 当前章节 id — 审校结果按章缓存到 store，收起/切标签不丢（bug G7 / B1） */
  chapterId: number
  /** NS-6：审计证据需用它做世界隔离 + 召回定位（多世界正确性） */
  outlineNodeId?: number | null
  worldGroupId?: number | null
  chapterContent: string
  chapterTitle: string
  worldContext: string
  characterContext: string
  prevChapterSummary: string
  nextChapterSummary: string
  foreshadowContext: string
  stateContext: string
  onClose: () => void
  /** G8：按审校报告让 AI 改全文（交给 ChapterEditor 走标准生成→采纳流程） */
  onReviseByReport?: (report: ReviewResult) => void
  consistencyRun?: ConsistencyAgentRun | null
  consistencyCurrent?: boolean
  onConsistencyRun?: (run: ConsistencyAgentRun) => void
  onBeforeConsistencyRun?: () => Promise<void>
}

type TabType = ReviewTab

const TABS: { key: TabType; label: string; icon: typeof ShieldCheck }[] = [
  { key: 'consistency', label: '一致性', icon: ScanSearch },
  { key: 'review', label: '审校', icon: ShieldCheck },
  { key: 'antiAI', label: '表达与重复', icon: Bot },
  { key: 'readability', label: '追读力', icon: TrendingUp },
]

export default function ReviewPanel(props: Props) {
  const { projectId, chapterId, outlineNodeId, worldGroupId, chapterContent, chapterTitle,
    onClose } = props

  const ai = useAIStream(createAISessionKey(projectId, 'review.run', chapterId))
  const [auditMode, setAuditMode] = useState<ConsistencyAuditMode>('fast')
  const [consistencyRunning, setConsistencyRunning] = useState(false)
  const [consistencyError, setConsistencyError] = useState('')
  const [localConsistencyRun, setLocalConsistencyRun] = useState<ConsistencyAgentRun | null>(
    props.consistencyRun ?? null,
  )

  // 结果与当前标签都存 store（按 chapterId），故收起再展开 / 切一级标签回来都还在
  const cached = useReviewResultStore(selectChapterReview(chapterId))
  const {
    consistency: consistencyResult,
    activeTab,
  } = cached
  const setConsistency = useReviewResultStore(s => s.setConsistency)
  const setActiveTab = (tab: TabType) => useReviewResultStore.getState().setActiveTab(chapterId, tab)

  useEffect(() => {
    setLocalConsistencyRun(props.consistencyRun ?? null)
    if (props.consistencyRun) {
      setConsistency(chapterId, toConsistencyAuditResult(props.consistencyRun.candidate))
    }
  }, [chapterId, props.consistencyRun, setConsistency])

  const [qualityReports, setQualityReports] = useState<Partial<Record<QualityReviewModeV1, DurableQualityReviewV1>>>({})
  const [qualityRunning, setQualityRunning] = useState(false)
  const [qualityError, setQualityError] = useState('')
  const qualityGeneration = useRef(0)
  const qualityTarget = useRef('')
  qualityTarget.current = `${projectId}:${chapterId}`
  const [revisionHash, setRevisionHash] = useState('')
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void (async () => {
      const scope = await resolveScopeLike(projectId)
      if (!active) return
      const subscription = liveQuery(() => Promise.all([
        db.works.get(scope.workId),
        captureWorkspaceContentRevisionV1({ scope, worldGroupId: worldGroupId ?? null }),
      ])).subscribe({
        next: ([work, revision]) => { if (active) setRevisionHash(`${revision.vectorHash}:${JSON.stringify(work)}`) },
        error: error => { if (active) setQualityError(error instanceof Error ? error.message : '作品版本读取失败。') },
      })
      unsubscribe = () => subscription.unsubscribe()
    })().catch(error => { if (active) setQualityError(error instanceof Error ? error.message : '作品版本读取失败。') })
    return () => { active = false; unsubscribe?.() }
  }, [projectId, worldGroupId])
  const mode: QualityReviewModeV1 = activeTab === 'antiAI' ? 'style' : activeTab === 'readability' ? 'readability' : 'quality'
  useEffect(() => {
    if (qualityRunning) return
    let active = true
    const generation = ++qualityGeneration.current
    setQualityReports({})
    void (async () => {
      const scope = await resolveScopeLike(projectId)
      const reports = await Promise.all((['quality', 'style', 'readability'] as const).map(async reviewMode => [reviewMode, await readLatestWholeChapterQualityReviewV1({ scope, chapterId, mode: reviewMode })] as const))
      if (active && generation === qualityGeneration.current) setQualityReports(Object.fromEntries(reports.filter(([, report]) => report)))
    })().catch(error => { if (active) setQualityError(error instanceof Error ? error.message : '报告恢复失败。') })
    return () => { active = false }
  }, [projectId, chapterId, chapterContent, qualityRunning, revisionHash])

  const handleRunQuality = async () => {
    const generation = ++qualityGeneration.current
    const target = qualityTarget.current
    setQualityError(''); setQualityRunning(true)
    try {
      if (outlineNodeId == null) throw new Error('全文评审缺少目标章纲。')
      await props.onBeforeConsistencyRun?.()
      if (qualityTarget.current !== target) return
      const scope = await resolveScopeLike(projectId)
      const result = await runWholeChapterQualityReviewV1({ scope, chapterId, outlineNodeId, worldGroupId: worldGroupId ?? null, mode,
        call: (messages, resolution, streamResult) => mode === 'quality'
          ? ai.start(messages, undefined, { formalEntryId: 'prose.review.quality', category: 'review.quality', projectId, contextOverflowPolicy: 'reject', transportRetryPolicy: 'none' }, resolution, streamResult)
          : mode === 'style'
            ? ai.start(messages, undefined, { formalEntryId: 'prose.review.anti-ai', category: 'review.anti-ai', projectId, contextOverflowPolicy: 'reject', transportRetryPolicy: 'none' }, resolution, streamResult)
            : ai.start(messages, undefined, { formalEntryId: 'prose.review.readability', category: 'review.readability', projectId, contextOverflowPolicy: 'reject', transportRetryPolicy: 'none' }, resolution, streamResult),
      })
      if (generation === qualityGeneration.current && qualityTarget.current === target) setQualityReports(value => ({ ...value, [mode]: result }))
    } catch (error) { if (generation === qualityGeneration.current && qualityTarget.current === target) setQualityError(error instanceof Error ? error.message : '全文评审未完成。') }
    finally { setQualityRunning(false) }
  }

  const handleRunConsistency = async () => {
    setConsistencyError('')
    setConsistencyRunning(true)
    try {
      await props.onBeforeConsistencyRun?.()
      const config = useAIConfigStore.getState().config
      const budget = new AgentTeamBudgetTracker(
        useAIConfigStore.getState().agentTeamBudgetProfile,
      )
      const result = await runDurableConsistencyAuditV1({
        scope: await resolveScopeLike(projectId),
        chapterId,
        outlineNodeId,
        worldGroupId: worldGroupId ?? null,
        chapterTitle,
        chapterContent,
        mode: auditMode,
        provider: config.provider,
        model: config.model,
        budget,
        call: messages => ai.start(messages, undefined, {
          formalEntryId: 'prose.review.consistency',
          category: auditMode === 'fast' ? 'review.consistency.fast' : 'review.consistency.deep',
          projectId,
          configOverrides: { maxTokens: auditMode === 'fast' ? 4_000 : 6_000 },
        }),
      })
      const { run, candidate } = result
      setLocalConsistencyRun(run)
      setConsistency(chapterId, toConsistencyAuditResult(candidate))
      props.onConsistencyRun?.(run)
    } catch (error) {
      setConsistencyError(error instanceof Error ? error.message : '一致性 Agent 运行失败')
    } finally {
      setConsistencyRunning(false)
    }
  }

  const handleRun = () => {
    if (activeTab === 'consistency') void handleRunConsistency()
    else void handleRunQuality()
  }
  const qualityResult = qualityReports[mode]
  const currentResult = activeTab === 'consistency' ? consistencyResult : qualityResult
  const consistencyMeta = localConsistencyRun?.candidate

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated border-b border-border">
        <div className="flex items-center gap-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-muted hover:text-text-primary'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={ai.isStreaming || consistencyRunning || qualityRunning || !chapterContent}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {ai.isStreaming || consistencyRunning || qualityRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {ai.isStreaming || consistencyRunning || qualityRunning ? '检测中...' : '开始检测'}
          </button>
          <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="p-4 max-h-[50vh] overflow-y-auto">
        {activeTab === 'consistency' && (
          <div className="mb-3 flex gap-2">
            {([
              ['fast', 'Fast Guard · 高置信硬冲突'],
              ['deep', 'Deep Audit · 因果/动机/伏笔'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setAuditMode(value)}
                className={`px-2 py-1 text-xs rounded ${auditMode === value ? 'bg-accent/10 text-accent' : 'bg-bg-elevated text-text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {activeTab === 'consistency' && consistencyMeta && (
          <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${
            props.consistencyCurrent === false
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
              : 'border-border bg-bg-base text-text-muted'
          }`}>
            <p>
              {props.consistencyCurrent === false ? '正文已变化，以下报告已过期。' : '当前正文报告'}
              {' · '}{consistencyMeta.mode === 'background' ? '自动 Fast Guard' : consistencyMeta.mode === 'fast' ? 'Fast Guard' : 'Deep Audit'}
              {' · '}{consistencyMeta.budget.calls}/{consistencyMeta.budget.maxCalls} 次模型调用
              {' · '}约 {consistencyMeta.budget.usedTokens.toLocaleString()} / {consistencyMeta.budget.maxTokens.toLocaleString()} tokens
            </p>
            {consistencyMeta.context.included.length > 0 && (
              <p className="mt-1">
                输入证据 {consistencyMeta.context.inputTokens.toLocaleString()} / {consistencyMeta.context.inputBudget.toLocaleString()} tokens
                {' · '}纳入 {consistencyMeta.context.included.length}
                {' · '}省略 {consistencyMeta.context.omitted.length}
                {' · '}裁剪 {consistencyMeta.context.trimmed.length}
              </p>
            )}
          </div>
        )}
        {(ai.error || consistencyError || qualityError) && (
          <div className="text-xs text-error bg-error/10 px-3 py-2 rounded-lg mb-3">
            {qualityError || consistencyError || ai.error}
          </div>
        )}

        {!currentResult && !ai.isStreaming && !consistencyRunning && !qualityRunning && (
          <div className="text-center py-8 text-text-muted text-sm">
            点击「开始检测」运行{activeTab === 'consistency' ? (auditMode === 'fast' ? ' Fast Guard' : ' Deep Audit') : activeTab === 'review' ? '审校' : activeTab === 'antiAI' ? '表达与重复评审' : '追读力评估'}
          </div>
        )}

        {ai.isStreaming && (
          <div className="flex items-center justify-center py-8 gap-2 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            AI 正在分析...
            {ai.output.length > 0 && (
              <span className="text-xs">≈ ~{Math.round(ai.output.length * 1.5).toLocaleString()} tokens</span>
            )}
          </div>
        )}
        {ai.tokenUsage && !ai.isStreaming && (
          <div className="text-[10px] text-text-muted mb-2" title={`输入 ${ai.tokenUsage.inputTokens} + 输出 ${ai.tokenUsage.outputTokens}`}>
            Token: ↑{ai.tokenUsage.inputTokens.toLocaleString()} ↓{ai.tokenUsage.outputTokens.toLocaleString()}
          </div>
        )}

        {activeTab === 'consistency' && consistencyResult && !ai.isStreaming && (
          <ConsistencyResultView result={consistencyResult} />
        )}

        {activeTab !== 'consistency' && qualityResult && !qualityRunning && !ai.isStreaming && <WholeQualityReportView result={qualityResult} />}
      </div>
    </div>
  )
}

function ConsistencyResultView({ result }: { result: ConsistencyAuditResult }) {
  if (!result.findings.length) {
    return <p className="text-sm text-success">未发现有证据支持的一致性问题。</p>
  }
  return (
    <div className="space-y-3">
      {result.findings.map((finding, index) => (
        <div key={index} className="p-3 bg-bg-base rounded-lg border border-border">
          <div className="flex items-center gap-2 text-xs">
            <span className={
              finding.severity === 'hard' ? 'text-error'
                : finding.severity === 'risk' ? 'text-warning' : 'text-text-muted'
            }>
              {finding.severity === 'hard' ? '硬冲突' : finding.severity === 'risk' ? '软风险' : '信息不足'}
            </span>
            <span className="text-text-muted">{finding.category}</span>
          </div>
          <p className="mt-1 text-xs text-text-primary">{finding.reason}</p>
          <p className="mt-1 text-[11px] text-text-muted border-l-2 border-border pl-2">正文：“{finding.quote}”</p>
          {finding.evidence.map((evidence, evidenceIndex) => (
            <p key={evidenceIndex} className="mt-1 text-[11px] text-accent/80">
              证据 {evidence.sourceType}#{evidence.sourceId}：“{evidence.quote}”
            </p>
          ))}
          {finding.suggestion && <p className="mt-1 text-xs text-accent">建议：{finding.suggestion}</p>}
        </div>
      ))}
    </div>
  )
}

// ── 评分徽章 ──

function WholeQualityReportView({ result }: { result: DurableQualityReviewV1 }) {
  const report = result.report
  return <div className="space-y-3" data-testid="whole-chapter-quality-report">
    <p className={result.current ? 'text-xs text-text-muted' : 'text-xs text-warning'}>{result.current ? '当前正文报告' : '正文或作品资料已变化，以下为历史报告。'} · 全文已送审 · 引文已校验</p>
    <p className="text-[11px] text-text-muted">{report.reviewer.provider} / {report.reviewer.model} · {report.coverage.paragraphs} 段 · {report.coverage.utf16Length} 字符 · {report.reviewer.correlatedJudge ? '与生成模型可能相关' : '使用不同的已记录模型'}。模型建议不代表文学达标或平台准入。</p>
    <p className="text-sm text-text-primary">{report.summary}</p>
    {report.strengths.map((item, index) => <p key={index} className="text-xs text-success">保留：{item}</p>)}
    {report.issues.map(issue => <section key={issue.id} className="rounded border border-border bg-bg-base p-3">
      <p className="text-xs text-text-muted">第 {issue.paragraph} 段 · {issue.start}～{issue.end} · {issue.confidence === 'uncertain' ? '待作者判断' : '阅读建议'}</p>
      <blockquote className="my-2 border-l-2 border-accent pl-2 text-xs">{issue.quote}</blockquote>
      <p className="text-xs text-text-primary">{issue.reason}</p><p className="mt-1 text-xs text-text-secondary">{issue.suggestion}</p>
    </section>)}
    {!report.issues.length && <p className="text-xs text-text-muted">本次没有返回可定位的问题；这不等于整章无错。</p>}
  </div>
}
