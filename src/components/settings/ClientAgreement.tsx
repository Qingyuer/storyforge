import { useEffect, useState, type ReactNode } from 'react'
import { CLIENT_AGREEMENT_KEY, CLIENT_LEGAL_VERSION, CLIENT_PRIVACY, CLIENT_TERMS, USAGE_NOTICE, acceptClientAgreement, clientAgreementAccepted, clientAgreementRequired } from '../../lib/feedback/client-legal'
import { setTelemetryPreferences } from '../../lib/feedback/client-telemetry'

export function ClientLegalDocuments() {
  return <div className="space-y-3 text-sm leading-7">
    {[['用户协议', CLIENT_TERMS], ['隐私说明', CLIENT_PRIVACY]] .map(([title, sections]) => <details key={title as string} className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-semibold">{title as string}</summary>
      <p className="mt-2 text-xs text-text-muted">版本：{CLIENT_LEGAL_VERSION} · 本文已随软件保存，可离线阅读。</p>
      {(sections as typeof CLIENT_TERMS).map(section => <section key={section.title} className="mt-4"><h3 className="font-semibold">{section.title}</h3><p className="mt-1 text-text-secondary">{section.text}</p></section>)}
    </details>)}
  </div>
}

/** Do not mount the editor/update checks until the current agreement is accepted. */
export default function ClientAgreement({ children }: { children: ReactNode }) {
  const required = clientAgreementRequired()
  const [accepted, setAccepted] = useState(clientAgreementAccepted)
  const [checked, setChecked] = useState(false)
  const [analytics, setAnalytics] = useState(false)
  const [errors, setErrors] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [issue, setIssue] = useState('')
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === CLIENT_AGREEMENT_KEY || event.key === null) {
        setAccepted(clientAgreementAccepted()); setChecked(false); setAnalytics(false); setErrors(false)
      }
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  if (!required || accepted) return <>{children}</>
  const submit = () => {
    if (!checked) return
    // Remove earlier optional choices/queued events before recording the new receipt.
    if (!setTelemetryPreferences(false, false) || !acceptClientAgreement()) {
      setIssue('无法保存同意记录，请检查本地存储空间或权限后重试。'); return
    }
    setTelemetryPreferences(analytics, errors)
    setAccepted(true)
  }
  return <main className="min-h-screen bg-bg-base px-4 py-8 text-text-primary">
    <div className="mx-auto max-w-3xl space-y-5 rounded-xl border border-border bg-bg-surface p-5 sm:p-8">
      <h1 className="text-xl font-semibold" tabIndex={-1}>欢迎使用 StoryForge 故事熔炉</h1>
      <p className="text-sm leading-7 text-text-secondary">开始使用前，请阅读用户协议与隐私说明。您可以展开下方全文，使用统计与故障上报由您自愿选择。</p>
      <ClientLegalDocuments />
      {declined ? <div className="space-y-4"><p role="status">您尚未接受协议。可以关闭此窗口；本地作品不会被删除。</p><button className="lf-action" onClick={() => setDeclined(false)}>返回阅读</button></div> : <>
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1" type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />我已阅读并同意《用户协议》，并已阅读《隐私说明》</label>
        <fieldset className="space-y-3 rounded-lg border border-border p-4"><legend className="px-2 text-sm">帮助改进软件（可选）</legend>
          <p className="text-xs leading-6 text-text-muted">{USAGE_NOTICE}</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={analytics} onChange={event => setAnalytics(event.target.checked)} />分享日常使用情况</label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={errors} onChange={event => setErrors(event.target.checked)} />自动发送故障报告</label>
          <p className="text-xs text-text-muted">未满十四周岁的用户请保持上述选项关闭，由监护人联系支持。</p>
        </fieldset>
        {issue && <p role="alert" className="text-sm text-error">{issue}</p>}
        <div className="flex flex-wrap gap-3"><button disabled={!checked} className="rounded-lg bg-accent px-5 py-3 text-sm text-white disabled:opacity-40" onClick={submit}>同意协议并继续</button><button className="lf-action" onClick={() => { setTelemetryPreferences(false, false); setDeclined(true) }}>不同意，停止使用</button></div>
      </>}
    </div>
  </main>
}
