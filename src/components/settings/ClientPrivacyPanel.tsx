import { useEffect, useState } from 'react'
import { clientTelemetryAvailable, deleteClientTelemetry, setTelemetryPreferences, subscribeTelemetryPreferences, telemetryPreferences } from '../../lib/feedback/client-telemetry'

export default function ClientPrivacyPanel({ notice = false }: { notice?: boolean }) {
  const [preferences, setPreferences] = useState(telemetryPreferences)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => subscribeTelemetryPreferences(() => setPreferences(telemetryPreferences())), [])
  if (!clientTelemetryAvailable() || (notice && preferences.decided)) return null
  const choose = (analytics: boolean, errors: boolean) => {
    setMessage(setTelemetryPreferences(analytics, errors) ? '' : '无法保存选择，当前会话已停止自动上传；重启后请检查设置。')
  }
  return <section aria-label="使用统计与错误报告" className={notice ? 'fixed bottom-4 left-4 z-40 max-w-sm rounded-xl border border-border bg-bg-surface p-4 shadow-xl' : 'mt-4 rounded-xl border border-border bg-bg-surface p-4'}>
    <h3 className="text-sm font-semibold">帮助改进 StoryForge</h3>
    <p className="my-2 text-xs leading-6 text-text-muted">可自愿分享首次观测启动、每日活跃和留存统计，或发送脱敏错误。只包含随机安装编号、日期、版本、系统类别及错误位置，不包含手稿、提示词、模型回复或 API Key。关闭后仍可正常使用及手动反馈。</p>
    {notice ? <div className="flex flex-wrap gap-2 text-xs">
      <button onClick={() => choose(true, true)} className="rounded bg-accent px-3 py-2 text-white">同意统计与错误上报</button>
      <button onClick={() => choose(false, false)} className="rounded border border-border px-3 py-2">暂不参加</button>
    </div> : <div className="space-y-3 text-sm">
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={preferences.analytics} onChange={event => choose(event.target.checked, preferences.errors)} />分享安装活跃统计</label>
      <label className="flex gap-2"><input type="checkbox" disabled={busy} checked={preferences.errors} onChange={event => choose(preferences.analytics, event.target.checked)} />自动发送脱敏错误报告</label>
      <p className="text-xs leading-6 text-text-muted">活跃明细保存约 38 天，错误明细 30 天，长期保留不含安装标识的汇总；安装去重记录在连续 400 天未活动后清理。本机最多缓存 100 条待发事件，每条最多尝试 5 次。完整内存转储不自动上传。</p>
      <button disabled={busy} className="rounded border border-border px-3 py-2" onClick={() => { setBusy(true); void deleteClientTelemetry().then(() => setMessage('已关闭上传并删除这次安装的服务器明细；匿名汇总和主动提交的反馈不受影响。')).catch(error => setMessage(error instanceof Error ? error.message : '删除未确认，请稍后重试。')).finally(() => setBusy(false)) }}>关闭并删除本安装的统计明细</button>
    </div>}
    {message && <p role="status" className="mt-2 text-xs">{message}</p>}
  </section>
}
