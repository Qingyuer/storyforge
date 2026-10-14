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
import { executeRegisteredAIEntryV1 } from '../../lib/agent/formal-ai-entry'
import type { ChatResult } from '../../lib/ai/client'
import { htmlToPlainText } from '../../lib/utils/html'
import { runQualityRevisionV1, readLatestQualityRevisionV1, adoptQualityRevisionV1, rejectQualityRevisionV1, abandonQualityRevisionV1, type QualityRevisionViewV1 } from '../../lib/agent/run/quality-revision-durable'

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
  consistencyRun?: ConsistencyAgentRun | null
  consistencyCurrent?: boolean
  onConsistencyRun?: (run: ConsistencyAgentRun) => void
  onBeforeConsistencyRun?: () => Promise<void>
  onQualityRevisionAdopted?: () => Promise<void>
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
  const qualityAbort = useRef<AbortController | null>(null)
  useEffect(() => () => qualityAbort.current?.abort(), [projectId, chapterId])
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
  const [selectedIssues, setSelectedIssues] = useState<string[]>([])
  const [extraParagraphs, setExtraParagraphs] = useState<number[]>([])
  const [protectedText, setProtectedText] = useState('')
  const [revisionView, setRevisionView] = useState<QualityRevisionViewV1 | null>(null)
  const [revisionBusy, setRevisionBusy] = useState(false)
  const [revisionError, setRevisionError] = useState('')
  const selectedReportHash = qualityReports[mode]?.report.artifactHash
  useEffect(() => { setSelectedIssues([]); setExtraParagraphs([]); setProtectedText('') }, [chapterId, selectedReportHash])
  useEffect(() => {
    if (revisionBusy) return
    let active = true
    void resolveScopeLike(projectId).then(scope => readLatestQualityRevisionV1({ scope, chapterId }))
      .then(view => { if (active) setRevisionView(view) })
      .catch(error => { if (active) setRevisionError(error instanceof Error ? error.message : '修订记录恢复失败。') })
    return () => { active = false }
  }, [projectId, chapterId, chapterContent, revisionHash, revisionBusy])
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
    if (qualityAbort.current) return
    const controller = new AbortController()
    qualityAbort.current = controller
    const generation = ++qualityGeneration.current
    const target = qualityTarget.current
    setQualityError(''); setQualityRunning(true)
    try {
      if (outlineNodeId == null) throw new Error('全文评审缺少目标章纲。')
      await props.onBeforeConsistencyRun?.()
      if (qualityTarget.current !== target || controller.signal.aborted) return
      const scope = await resolveScopeLike(projectId)
      const result = await runWholeChapterQualityReviewV1({ scope, chapterId, outlineNodeId, worldGroupId: worldGroupId ?? null, mode,
        call: async (messages, resolution, streamResult) => {
          const result: ChatResult = {}
          const options = { responseFormat: 'json_object' as const }
          const raw = mode === 'quality'
            ? await executeRegisteredAIEntryV1('prose.review.quality', messages, resolution.config, { category: 'review.quality', projectId, contextOverflowPolicy: 'reject' }, controller.signal, result, options, resolution)
            : mode === 'style'
              ? await executeRegisteredAIEntryV1('prose.review.anti-ai', messages, resolution.config, { category: 'review.anti-ai', projectId, contextOverflowPolicy: 'reject' }, controller.signal, result, options, resolution)
              : await executeRegisteredAIEntryV1('prose.review.readability', messages, resolution.config, { category: 'review.readability', projectId, contextOverflowPolicy: 'reject' }, controller.signal, result, options, resolution)
          streamResult.usage = result.usage
          streamResult.finishReason = result.finishReason
          streamResult.completion = result.finishReason === 'stop' ? 'complete' : 'unknown'
          return raw
        },
      })
      if (generation === qualityGeneration.current && qualityTarget.current === target) setQualityReports(value => ({ ...value, [mode]: result }))
    } catch (error) { if (generation === qualityGeneration.current && qualityTarget.current === target) setQualityError(controller.signal.aborted ? '评审已停止，未自动重发。' : error instanceof Error ? error.message : '全文评审未完成。') }
    finally { if (qualityAbort.current === controller) qualityAbort.current = null; setQualityRunning(false) }
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

  const handleRevision = async () => {
    if (qualityAbort.current || !qualityResult?.current || outlineNodeId == null) return
    const controller = new AbortController(); qualityAbort.current = controller
    const target = qualityTarget.current
    setRevisionBusy(true); setRevisionError('')
    try {
      await props.onBeforeConsistencyRun?.()
      if (qualityTarget.current !== target || controller.signal.aborted) return
      const scope = await resolveScopeLike(projectId)
      const view = await runQualityRevisionV1({ scope, chapterId, outlineNodeId, worldGroupId: worldGroupId ?? null, mode, reportRunId: qualityResult.runId, reportHash: qualityResult.report.artifactHash, selectedIssueIds: selectedIssues, additionalParagraphs: extraParagraphs, protectedQuotes: protectedText.split('\n').filter(line => line.trim()), signal: controller.signal,
        revise: async (messages, resolution, response) => {
          const result: ChatResult = {}
          const raw = await executeRegisteredAIEntryV1('prose.chapter.quality-revise', messages, resolution.config, { category: 'review.revise', projectId, contextOverflowPolicy: 'reject' }, controller.signal, result, { responseFormat: 'json_object' }, resolution)
          response.finishReason = result.finishReason; response.usage = result.usage; response.completion = result.finishReason === 'stop' ? 'complete' : 'unknown'; return raw
        },
        recheck: async (messages, resolution, response) => {
          const result: ChatResult = {}
          const raw = await executeRegisteredAIEntryV1('prose.review.recheck', messages, resolution.config, { category: 'review.quality', projectId, contextOverflowPolicy: 'reject' }, controller.signal, result, { responseFormat: 'json_object' }, resolution)
          response.finishReason = result.finishReason; response.usage = result.usage; response.completion = result.finishReason === 'stop' ? 'complete' : 'unknown'; return raw
        },
      })
      if (qualityTarget.current === target) setRevisionView(view)
    } catch (error) { if (qualityTarget.current === target) setRevisionError(error instanceof Error ? error.message : '范围修订未完成。') }
    finally { if (qualityAbort.current === controller) qualityAbort.current = null; setRevisionBusy(false) }
  }

  const decideRevision = async (adopt: boolean) => {
    const candidate = revisionView?.candidate
    if (!candidate || revisionBusy) return
    setRevisionBusy(true); setRevisionError('')
    try {
      await props.onBeforeConsistencyRun?.()
      const scope = await resolveScopeLike(projectId)
      if (adopt) { await adoptQualityRevisionV1({ scope, candidate }); await props.onQualityRevisionAdopted?.() }
      else await rejectQualityRevisionV1({ scope, candidate })
      setRevisionView(await readLatestQualityRevisionV1({ scope, chapterId }))
    } catch (error) { setRevisionError(error instanceof Error ? error.message : '作者决定未保存。') }
    finally { setRevisionBusy(false) }
  }

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
            disabled={ai.isStreaming || consistencyRunning || qualityRunning || revisionBusy || !chapterContent}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-accent text-white rounded-md hover:bg-accent-hover disabled:opacity-50 transition-colors"
          >
            {ai.isStreaming || consistencyRunning || qualityRunning ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            {ai.isStreaming || consistencyRunning || qualityRunning ? '检测中...' : '开始检测'}
          </button>
          <button aria-label="关闭质量审校" onClick={() => { qualityAbort.current?.abort(); onClose() }} className="p-1 text-text-muted hover:text-text-primary rounded">
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
        {((activeTab === 'consistency' && ai.error) || consistencyError || qualityError) && (
          <div className="text-xs text-error bg-error/10 px-3 py-2 rounded-lg mb-3">
            {qualityError || consistencyError || ai.error}
          </div>
        )}

        {!currentResult && !ai.isStreaming && !consistencyRunning && !qualityRunning && (
          <div className="text-center py-8 text-text-muted text-sm">
            点击「开始检测」运行{activeTab === 'consistency' ? (auditMode === 'fast' ? ' Fast Guard' : ' Deep Audit') : activeTab === 'review' ? '审校' : activeTab === 'antiAI' ? '表达与重复评审' : '追读力评估'}
          </div>
        )}

        {(ai.isStreaming || qualityRunning) && (
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

        {activeTab !== 'consistency' && qualityResult && !qualityRunning && !ai.isStreaming && <>
          <WholeQualityReportView result={qualityResult} selected={selectedIssues} disabled={revisionBusy || !qualityResult.current} toggle={id => setSelectedIssues(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id])} />
          {qualityResult.current && qualityResult.report.issues.length > 0 && <div className="mt-4 space-y-3 rounded border border-border p-3">
            <p className="text-sm font-medium">按选中问题修稿</p>
            <p className="text-xs text-text-muted">默认只允许修改问题所在段落。你可以增加相关段落，并保护要保留的原句；本轮再调用最多两次模型，先看修订与复核结果，再确认写回。</p>
            <details><summary className="cursor-pointer text-xs">选择其它可改段落</summary><div className="mt-2 max-h-40 space-y-1 overflow-y-auto">{chapterContent.split('\n').filter(line => line.trim()).map((line, index) => <label key={index} className="flex gap-2 text-xs"><input type="checkbox" disabled={revisionBusy} checked={extraParagraphs.includes(index + 1)} onChange={() => setExtraParagraphs(value => value.includes(index + 1) ? value.filter(item => item !== index + 1) : [...value, index + 1])} />第 {index + 1} 段：{line}</label>)}</div></details>
            <label className="block text-xs">保护原句（可选，每行一句，须与正文完全相同）<textarea aria-label="保护原句" className="mt-1 w-full rounded border border-border bg-bg-base p-2" value={protectedText} disabled={revisionBusy} onChange={event => setProtectedText(event.target.value)} /></label>
            <button className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-50" disabled={revisionBusy || qualityRunning || !selectedIssues.length} onClick={() => void handleRevision()}>{revisionBusy ? '修订与复核中…' : '生成修订并复核'}</button>
          </div>}
        </>}
        {revisionError && <p className="mt-3 rounded bg-error/10 p-3 text-xs text-error">{revisionError}</p>}
        {revisionView && <div data-testid="quality-revision-preview" className="mt-4 space-y-3 rounded border border-border p-3">
          <p className="text-sm font-medium">修订前后对照</p>
          <p className="text-xs text-text-muted">{revisionView.state === 'completed' ? '已采纳，记录只读。' : revisionView.state === 'cancelled' ? '已放弃，原稿保留。' : !revisionView.current ? '原稿、资料或证据已变化，修订不能采纳。' : !revisionView.candidate || revisionView.state !== 'awaiting_confirmation' ? '复核未完成，预演结果只供查看；刷新不会重发。' : '复核已返回，最终是否采用由你判断。'}</p>
          <div className="grid gap-3 md:grid-cols-2"><div><p className="text-xs text-text-muted">原稿</p><p className="whitespace-pre-wrap text-sm">{htmlToPlainText(revisionView.draft.sourceHtml)}</p></div><div><p className="text-xs text-text-muted">修订稿</p><p className="whitespace-pre-wrap text-sm">{revisionView.draft.outputText}</p></div></div>
          {revisionView.candidate?.qualityRevision?.recheck.outcomes.map(item => <p key={item.issueId} className="text-xs">{item.status === 'improved' ? '模型认为已有改善' : item.status === 'unchanged' ? '模型认为仍未解决' : '模型无法确定'}：{item.reason}<br />依据：“{item.quote}”</p>)}
          {revisionView.candidate?.qualityRevision?.recheck.review.issues.map(item => <p key={item.id} className="text-xs text-warning">复核建议：{item.reason} · “{item.quote}”</p>)}
          {revisionView.current && revisionView.candidate && revisionView.state === 'awaiting_confirmation' && <div className="flex gap-2"><button disabled={revisionBusy} className="rounded bg-accent px-3 py-2 text-xs text-white disabled:opacity-50" onClick={() => void decideRevision(true)}>确认采纳修订</button><button disabled={revisionBusy} className="rounded border border-border px-3 py-2 text-xs disabled:opacity-50" onClick={() => void decideRevision(false)}>放弃修订</button></div>}
          {['running', 'paused', 'recovery_required'].includes(revisionView.state) && !revisionBusy && <button className="rounded border border-border px-3 py-2 text-xs" onClick={() => {
            setRevisionBusy(true); setRevisionError('')
            void resolveScopeLike(projectId).then(async scope => { await abandonQualityRevisionV1({ scope, chapterId, runId: revisionView.runId }); setRevisionView(await readLatestQualityRevisionV1({ scope, chapterId })) })
              .catch(error => setRevisionError(error instanceof Error ? error.message : '运行未能结束。')).finally(() => setRevisionBusy(false))
          }}>结束未完成运行</button>}
        </div>}
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

function WholeQualityReportView({ result, selected, toggle, disabled }: { result: DurableQualityReviewV1; selected: string[]; toggle: (id: string) => void; disabled: boolean }) {
  const report = result.report
  return <div className="space-y-3" data-testid="whole-chapter-quality-report">
    <p className={result.current ? 'text-xs text-text-muted' : 'text-xs text-warning'}>{result.current ? '当前正文报告' : '正文或作品资料已变化，以下为历史报告。'} · 全文已送审 · 引文已校验</p>
    <p className="text-[11px] text-text-muted">{report.reviewer.provider} / {report.reviewer.model} · {report.coverage.paragraphs} 段 · {report.coverage.utf16Length} 字符 · {report.reviewer.correlatedJudge ? '与生成模型可能相关' : '使用不同的已记录模型'}。模型建议不代表文学达标或平台准入。</p>
    <p className="text-sm text-text-primary">{report.summary}</p>
    {report.strengths.map((item, index) => <p key={index} className="text-xs text-success">保留：{item}</p>)}
    {report.issues.map(issue => <section key={issue.id} className="rounded border border-border bg-bg-base p-3">
      <label className="mb-2 flex items-center gap-2 text-xs"><input type="checkbox" aria-label={`处理第${issue.paragraph}段问题`} checked={selected.includes(issue.id)} disabled={disabled} onChange={() => toggle(issue.id)} />本轮处理这个问题</label>
      <p className="text-xs text-text-muted">第 {issue.paragraph} 段 · {issue.start}～{issue.end} · {issue.confidence === 'uncertain' ? '待作者判断' : '阅读建议'}</p>
      <blockquote className="my-2 border-l-2 border-accent pl-2 text-xs">{issue.quote}</blockquote>
      <p className="text-xs text-text-primary">{issue.reason}</p><p className="mt-1 text-xs text-text-secondary">{issue.suggestion}</p>
    </section>)}
    {!report.issues.length && <p className="text-xs text-text-muted">本次没有返回可定位的问题；这不等于整章无错。</p>}
  </div>
}
