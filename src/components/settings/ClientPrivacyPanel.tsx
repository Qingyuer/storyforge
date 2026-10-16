import { ClientLegalDocuments } from './ClientAgreement'
import { USAGE_NOTICE } from '../../lib/feedback/client-legal'
import { useEffect, useState } from 'react'
import { clientTelemetryAvailable, deleteClientTelemetry, setTelemetryPreferences, subscribeTelemetryPreferences, telemetryPreferences } from '../../lib/feedback/client-telemetry'

export default function ClientPrivacyPanel() {
  const [preferences, setPreferences] = useState(telemetryPreferences)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribeTelemetryPreferences(() => setPreferences(telemetryPreferences())), [])
  if (!clientTelemetryAvailable()) return <ClientLegalDocuments />
  const choose = (analytics: boolean, errors: boolean) => {
    setMessage(setTelemetryPreferences(analytics, errors) ? '' : '无法保存选择，当前会话已停止自动上传；重启后请检查设置。')
  }
  return <section aria-label="使用统计与错误报告" className="mt-4 rounded-xl border border-border bg-bg-surface p-4">
    <h3 className="text-sm font-semibold">使用统计与故障反馈</h3>
    <p className="my-2 text-xs leading-6 text-text-muted">{USAGE_NOTICE}</p>
    <div className="space-y-3 text-sm">
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={preferences.analytics} onChange={event => choose(event.target.checked, preferences.errors)} />分享日常使用情况</label>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={preferences.errors} onChange={event => choose(preferences.analytics, event.target.checked)} />自动发送故障报告</label>
      <button disabled={busy} className="rounded border border-border px-3 py-2" onClick={() => { setBusy(true); void deleteClientTelemetry().then(() => setMessage('已关闭上传并删除这次安装关联的服务器记录；您主动提交的反馈可凭编号联系支持处理。')).catch(error => setMessage(error instanceof Error ? error.message : '删除未确认，请稍后重试。')).finally(() => setBusy(false)) }}>关闭上报并删除相关记录</button>
      <ClientLegalDocuments />
    </div>
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </section>
}
