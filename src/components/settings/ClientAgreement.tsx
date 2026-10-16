import { useEffect, useState, type ReactNode } from 'react'
import { CLIENT_AGREEMENT_KEY, CLIENT_LEGAL_VERSION, CLIENT_TERMS, acceptClientAgreement, clientAgreementAccepted, clientAgreementRequired } from '../../lib/feedback/client-legal'
import { setTelemetryPreferences } from '../../lib/feedback/client-telemetry'

export function ClientLegalDocuments() {
  return <div className="space-y-3 text-sm leading-7">
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer font-semibold">用户协议</summary>
      <p className="mt-2 text-xs text-text-muted">版本：{CLIENT_LEGAL_VERSION} · 本文已随软件保存，可离线阅读。</p>
      {CLIENT_TERMS.map(section => <section key={section.title} className="mt-4"><h3 className="font-semibold">{section.title}</h3><p className="mt-1 text-text-secondary">{section.text}</p></section>)}
    </details>
  </div>
}

/** Do not mount the editor/update checks until the current agreement is accepted. */
export default function ClientAgreement({ children }: { children: ReactNode }) {
  const required = clientAgreementRequired()
  const [accepted, setAccepted] = useState(clientAgreementAccepted)
  const [checked, setChecked] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [issue, setIssue] = useState('')
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === CLIENT_AGREEMENT_KEY || event.key === null) {
        setAccepted(clientAgreementAccepted()); setChecked(false)
      }
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [])
  if (!required || accepted) return <>{children}</>
  const submit = () => {
    if (!checked) return
    // Clear earlier records before the user accepts the current unified agreement.
    if (!setTelemetryPreferences(false, false) || !acceptClientAgreement()) {
      setIssue('无法保存同意记录，请检查本地存储空间或权限后重试。'); return
    }
    setTelemetryPreferences(true, true)
    setAccepted(true)
  }
  return <main className="min-h-screen bg-bg-base px-4 py-8 text-text-primary">
    <div className="mx-auto max-w-3xl space-y-5 rounded-xl border border-border bg-bg-surface p-5 sm:p-8">
      <h1 className="text-xl font-semibold" tabIndex={-1}>欢迎使用 StoryForge 故事熔炉</h1>
      <p className="text-sm leading-7 text-text-secondary">开始使用前，请阅读并同意《用户协议》。您可以展开下方查看全文。</p>
      <ClientLegalDocuments />
      {declined ? <div className="space-y-4"><p role="status">您尚未接受协议。可以关闭此窗口；本地作品不会被删除。</p><button className="lf-action" onClick={() => setDeclined(false)}>返回阅读</button></div> : <>
        <label className="flex items-start gap-3 text-sm leading-6"><input className="mt-1" type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />我已阅读并同意《用户协议》</label>
        {issue && <p role="alert" className="text-sm text-error">{issue}</p>}
        <div className="flex flex-wrap gap-3"><button disabled={!checked} className="rounded-lg bg-accent px-5 py-3 text-sm text-white disabled:opacity-40" onClick={submit}>同意协议并继续</button><button className="lf-action" onClick={() => { setTelemetryPreferences(false, false); setDeclined(true) }}>不同意，停止使用</button></div>
      </>}
    </div>
  </main>
}
