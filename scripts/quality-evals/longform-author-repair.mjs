import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const hash = value => createHash('sha256').update(value).digest('hex')
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
const jsonForScript = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

/** Two versions per task; alternate first version across pairs to limit order effects. */
export function makeAuthorRepairPackets(input, seed = randomBytes(32).toString('hex')) {
  if (!id(input.studyId) || !['preview', 'formal'].includes(input.mode) || !Array.isArray(input.participants) || !input.participants.length || input.participants.some(code => !id(code)) || new Set(input.participants).size !== input.participants.length) throw new Error('修稿研究或参与者无效')
  if (!Array.isArray(input.samples) || input.samples.length < 2 || input.samples.length > 12 || new Set(input.samples.map(row => row.pairId)).size !== input.samples.length) throw new Error('至少提供两组独立修稿任务')
  for (const sample of input.samples) {
    if (!id(sample.pairId) || typeof sample.brief !== 'string' || !sample.brief.trim() || sample.brief.length > 16000 || typeof sample.genre !== 'string' || sample.genre.length > 100) throw new Error('修稿资料无效')
    for (const side of ['baseline', 'improved']) if (typeof sample[side] !== 'string' || !sample[side].trim() || sample[side].length > 200000) throw new Error('必须提供两份完整原稿')
  }
  const mapping = []
  const packets = input.participants.map(participantCode => {
    const firstBit = parseInt(hash(seed + ':' + participantCode).slice(0, 2), 16) % 2
    const tasks = input.samples.flatMap((sample, index) => {
      const order = (firstBit + index) % 2 ? ['improved', 'baseline'] : ['baseline', 'improved']
      return order.map((variant, side) => {
        const taskId = `${sample.pairId}-${side + 1}`
        mapping.push({ participantCode, taskId, pairId: sample.pairId, variant })
        return { taskId, pairId: sample.pairId, label: `任务 ${index + 1} · ${side === 0 ? '第一份' : '第二份'}`, genre: sample.genre, brief: sample.brief, source: sample[variant], sourceHash: hash(sample[variant]) }
      })
    })
    const publicData = { schema: 'storyforge.author-repair-packet', version: 1, studyId: input.studyId, mode: input.mode, participantCode, tasks }
    return { ...publicData, packetId: hash(JSON.stringify(publicData)) }
  })
  return { packets, organizerKey: { studyId: input.studyId, inputHash: hash(JSON.stringify(input)), sourceVersions: input.sourceVersions ?? null, mapping, orderLimit: 'Alternating order reduces carryover, but a small author sample cannot establish a general causal effect.' } }
}

export function validateAuthorRepairReturn(packet, value) {
  const exact = (row, keys) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).sort().join('|') === [...keys].sort().join('|')
  if (!exact(value, ['schema', 'version', 'studyId', 'mode', 'packetId', 'participantCode', 'familiarity', 'independence', 'index', 'updatedAt', 'tasks']) || value.schema !== 'storyforge.author-repair-return' || value.version !== 1 || value.studyId !== packet.studyId || value.mode !== packet.mode || value.packetId !== packet.packetId || value.participantCode !== packet.participantCode) throw new Error('修稿结果不属于这份任务')
  if (![null, 'often', 'sometimes', 'rare'].includes(value.familiarity) || ![null, 'yes', 'no', 'unknown'].includes(value.independence) || !Number.isSafeInteger(value.index) || value.index < 0 || value.index >= packet.tasks.length || !Number.isFinite(Date.parse(value.updatedAt)) || !Array.isArray(value.tasks) || value.tasks.length !== packet.tasks.length) throw new Error('修稿参与情况或位置无效')
  let finished = 0
  let totalMs = 0
  const seen = new Set()
  for (const task of value.tasks) {
    const source = packet.tasks.find(row => row.taskId === task.taskId)
    if (!exact(task, ['taskId', 'sourceHash', 'text', 'status', 'decision', 'sessions']) || !source || seen.has(task.taskId) || task.sourceHash !== source.sourceHash || typeof task.text !== 'string' || task.text.length > 400000 || !['pending', 'paused', 'finished'].includes(task.status) || ![null, 'ready', 'unchanged-ready', 'needs-more'].includes(task.decision) || !Array.isArray(task.sessions) || task.sessions.length > 1000) throw new Error('修稿正文、状态或版本无效')
    seen.add(task.taskId)
    for (const session of task.sessions) {
      if (!exact(session, ['startedAt', 'endedAt', 'elapsedMs']) || !Number.isFinite(Date.parse(session.startedAt)) || !Number.isFinite(Date.parse(session.endedAt)) || !Number.isSafeInteger(session.elapsedMs) || session.elapsedMs < 0 || session.elapsedMs > 86400000) throw new Error('计时段无效')
      totalMs += session.elapsedMs
    }
    if (task.status === 'finished') {
      if (!task.text.trim() || !task.decision || !task.sessions.length || (task.decision === 'unchanged-ready' && task.text !== source.source)) throw new Error('完成任务缺少正文、计时或处理选择')
      finished++
    }
  }
  return { finished, totalMs, complete: finished === packet.tasks.length && value.familiarity !== null && value.independence !== null }
}

export function readAuthorRepairHtml(packet, html) {
  if (typeof html !== 'string' || html.length > JSON.stringify(packet).length * 3 + 12000000) throw new Error('修稿文件缺失或过大')
  const read = name => { const parts = [...html.matchAll(new RegExp('<script id="' + name + '" type="application/json">([\\s\\S]*?)</script>', 'g'))]; if (parts.length !== 1) throw new Error('缺少唯一的 ' + name); return JSON.parse(parts[0][1]) }
  if (JSON.stringify(read('repair-packet')) !== JSON.stringify(packet)) throw new Error('任务人员或原稿已变化')
  const result = read('saved-repair')
  return { result, validation: validateAuthorRepairReturn(packet, result), manuscripts: result.tasks.map(task => ({ taskId: task.taskId, sourceHash: task.sourceHash, editedTextHash: hash(task.text), elapsedMs: task.sessions.reduce((sum, row) => sum + row.elapsedMs, 0) })) }
}

function repairClient(packet, validate, encode) {
  const $ = id => document.getElementById(id)
  let result = { schema: 'storyforge.author-repair-return', version: 1, studyId: packet.studyId, mode: packet.mode, packetId: packet.packetId, participantCode: packet.participantCode, familiarity: null, independence: null, index: 0, updatedAt: new Date().toISOString(), tasks: packet.tasks.map(row => ({ taskId: row.taskId, sourceHash: row.sourceHash, text: row.source, status: 'pending', decision: null, sessions: [] })) }
  let active = null
  let dirty = false
  try { if ($('saved-repair')) { const saved = JSON.parse($('saved-repair').textContent); validate(packet, saved); result = saved; $('notice').textContent = '已恢复正文与计时。计时保持暂停，请自行继续。' } } catch { $('notice').textContent = '保存数据无效，请保留文件交给组织者核查。' }
  const current = () => result.tasks[result.index]
  const elapsed = () => current().sessions.reduce((sum, row) => sum + row.elapsedMs, 0) + (active ? performance.now() - active.clock : 0)
  function pause() { if (active) { current().sessions.push({ startedAt: active.startedAt, endedAt: new Date().toISOString(), elapsedMs: Math.max(0, Math.round(performance.now() - active.clock)) }); active = null; current().status = 'paused'; dirty = true } }
  function render() {
    const source = packet.tasks[result.index], task = current()
    $('identity').textContent = '任务代号：' + packet.participantCode
    $('task-title').textContent = source.genre + ' · ' + source.label + ' · ' + (result.index + 1) + '/' + packet.tasks.length
    $('brief').textContent = task.status === 'pending' ? '点击开始后显示资料与原稿；计时包含阅读。' : source.brief
    $('editor').value = task.status === 'pending' ? '' : task.text; $('editor').readOnly = !active
    $('decision').value = task.decision ?? ''
    $('start').disabled = Boolean(active)
    $('pause').disabled = !active
    $('finish').disabled = !active && task.status !== 'paused'
    $('previous').disabled = result.index === 0
    $('next').disabled = result.index === packet.tasks.length - 1 || task.status !== 'finished'
    $('progress').textContent = validate(packet, result).finished + '/' + packet.tasks.length + ' 份已完成'
    for (const name of ['familiarity', 'independence']) for (const input of document.querySelectorAll('input[name="' + name + '"]')) input.checked = input.value === result[name]
  }
  $('editor').addEventListener('input', () => { current().text = $('editor').value; dirty = true })
  $('decision').addEventListener('change', () => { current().decision = $('decision').value || null; dirty = true })
  for (const name of ['familiarity', 'independence']) for (const input of document.querySelectorAll('input[name="' + name + '"]')) input.addEventListener('change', () => { result[name] = input.value; dirty = true })
  $('start').addEventListener('click', () => { if (active) return; current().status = 'paused'; current().decision = null; dirty = true; active = { startedAt: new Date().toISOString(), clock: performance.now() }; render() })
  $('pause').addEventListener('click', () => { pause(); render() })
  $('finish').addEventListener('click', () => { pause(); if (!current().text.trim() || !current().decision) { $('notice').textContent = '请保留修稿正文，并选择处理结果。'; render(); return } current().status = 'finished'; try { validate(packet, result) } catch (error) { current().status = 'paused'; $('notice').textContent = error.message } render() })
  $('previous').addEventListener('click', () => { pause(); result.index--; render() })
  $('next').addEventListener('click', () => { pause(); result.index++; render() })
  $('save-html').addEventListener('click', () => {
    pause(); result.updatedAt = new Date().toISOString(); validate(packet, result); render()
    const copy = document.documentElement.cloneNode(true)
    for (const name of ['identity', 'task-title', 'brief', 'editor', 'progress', 'timer', 'notice']) copy.querySelector('#' + name).replaceChildren()
    for (const block of copy.querySelectorAll('#saved-repair')) block.remove()
    const saved = document.createElement('script'); saved.id = 'saved-repair'; saved.type = 'application/json'; saved.textContent = encode(result); copy.querySelector('#repair-packet').after(saved)
    const url = URL.createObjectURL(new Blob(['<!doctype html>\n' + copy.outerHTML], { type: 'text/html;charset=utf-8' })), link = document.createElement('a'); link.href = url; link.download = packet.studyId + '-' + packet.participantCode + '-repair-result.html'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000)
    dirty = false
    $('notice').textContent = '已发起含正文与计时的 HTML 保存，请在下载列表确认。把这份 HTML 交回即可。'
  })
  setInterval(() => { $('timer').textContent = '本份累计：' + Math.floor(elapsed() / 60000) + ' 分 ' + Math.floor(elapsed() / 1000) % 60 + ' 秒' + (active ? ' · 正在计时' : ' · 暂停') }, 250)
  window.addEventListener('beforeunload', event => { if (active || dirty) { event.preventDefault(); event.returnValue = '' } })
  render()
}

export function renderAuthorRepair(packet, saved = null) {
  if (saved) validateAuthorRepairReturn(packet, saved)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; object-src 'none'; base-uri 'none'"><title>系统文修稿计时任务</title><style>*{box-sizing:border-box}body{margin:0;background:#f7f5f0;color:#252825;font:16px/1.75 system-ui,sans-serif}main{max-width:960px;margin:auto;padding:20px}section,details{padding:16px;background:#fff;border:1px solid #ddd;border-radius:10px;margin:16px 0}textarea{width:100%;height:55vh;min-height:300px;font:17px/1.8 system-ui,sans-serif;padding:14px;border:1px solid #bbc5bb;border-radius:8px}pre{white-space:pre-wrap;font:inherit}button,select{font:inherit;min-height:44px;padding:8px 12px;border:1px solid #bbc5bb;border-radius:8px;background:white}button:disabled{opacity:.45}label{display:inline-flex;gap:6px;margin:8px 12px 8px 0}nav{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;padding:12px 0;background:#f7f5f0}#notice{color:#38664a}.preview{background:#fff6de;padding:12px}@media(max-width:600px){main{padding:12px}}</style></head><body><main><h1>系统文修稿计时任务</h1>${packet.mode === 'preview' ? '<p class="preview">流程预览，不计入正式文学或修稿结论。</p>' : ''}<p>这是作者实际修稿任务。问卷信息只需选择；修稿正文需要你亲自修改。请不要用 AI 代改。每组两份原稿使用相同目标。</p><p>先点击“开始 / 继续修稿”，再阅读资料与修改正文；离开时点击暂停。计时包含阅读与修稿。每次保存会暂停，并把正文与计时放进同一份 HTML；下次打开自动恢复，计时不会自动开始。</p><p id="identity"></p><details><summary>参与情况（只需选择）</summary><p>平时写作或修订本次题材的频率</p><label><input type="radio" name="familiarity" value="often">经常</label><label><input type="radio" name="familiarity" value="sometimes">偶尔</label><label><input type="radio" name="familiarity" value="rare">很少</label><p>是否本人独立完成，未参与开发、未请 AI 代改、未讨论版本？</p><label><input type="radio" name="independence" value="yes">是</label><label><input type="radio" name="independence" value="no">否</label><label><input type="radio" name="independence" value="unknown">不确定</label></details><h2 id="task-title"></h2><section><h3>两份原稿共同的修稿目标与资料</h3><pre id="brief"></pre></section><p id="progress"></p><p id="timer" role="status"></p><button id="start">开始 / 继续修稿</button> <button id="pause">暂停计时</button><p>正文在开始计时后可以修改。暂停时只供阅读。</p><textarea id="editor" aria-label="修稿正文"></textarea><label>处理结果<select id="decision" aria-label="处理结果"><option value="">请选择</option><option value="ready">已修订到共同目标</option><option value="unchanged-ready">原稿已符合目标，无需改动</option><option value="needs-more">仍需返工，尚未达到目标</option></select></label><button id="finish">完成本份修稿</button><p id="notice" role="status"></p><nav><button id="previous">上一份</button><button id="next">下一份</button><button id="save-html">保存修稿与计时 HTML</button></nav><p>计时依赖你如实开始、暂停和完成。文件记录不能替代组织者核实身份或检查最终稿；预览数据不进入正式结论。</p></main><script id="repair-packet" type="application/json">${jsonForScript(packet)}</script>${saved ? '<script id="saved-repair" type="application/json">' + jsonForScript(saved) + '</script>' : ''}<script>(${repairClient.toString()})(JSON.parse(document.getElementById('repair-packet').textContent),${validateAuthorRepairReturn.toString()},${jsonForScript.toString()})</script></body></html>`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) throw new Error('用法：node scripts/quality-evals/longform-author-repair.mjs INPUT.json OUTPUT_DIR')
  const { packets, organizerKey } = makeAuthorRepairPackets(JSON.parse(await readFile(inputPath, 'utf8')))
  const output = resolve(outputPath); await mkdir(join(output, 'participants'), { recursive: true })
  for (const packet of packets) await writeFile(join(output, 'participants', packet.participantCode + '.html'), renderAuthorRepair(packet), { flag: 'wx' })
  await writeFile(join(output, 'organizer-key.json'), JSON.stringify(organizerKey, null, 2), { flag: 'wx' })
}
