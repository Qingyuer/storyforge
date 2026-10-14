import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const hash = text => createHash('sha256').update(text).digest('hex')
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
const dimensions = [['immersion', '代入与期待'], ['causality', '因果与主动选择'], ['payoff', '情绪与兑现'], ['voice', '人物声音'], ['pace', '节奏与重复'], ['continuity', '前后连贯']]
const reasons = [['immersion', '处境或期待更清楚'], ['causality', '选择与结果更可信'], ['payoff', '回报更有满足感'], ['voice', '人物更有区别'], ['pace', '节奏更顺、重复更少'], ['continuity', '前后信息更一致'], ['prose', '语言更自然'], ['no-difference', '无明显差别'], ['other', '有其它原因，现有选项未覆盖'], ['unknown', '信息不足，无法判断']]

/** 一人一包；同一作品十章的 A/B 身份保持一致，映射只交给组织者。 */
export function makeQuestionnairePackets(input, seed = randomBytes(32).toString('hex')) {
  if (!identifier(input.studyId) || !['preview', 'formal'].includes(input.mode) || !Array.isArray(input.samples) || !input.samples.length || input.samples.length > 100) throw new Error('问卷研究标识、模式或样本无效')
  if (!Array.isArray(input.participants) || !input.participants.length || new Set(input.participants).size !== input.participants.length || input.participants.some(code => !identifier(code))) throw new Error('参与者代号必须独立且有效')
  const ids = new Set()
  for (const row of input.samples) {
    if (!identifier(row.pairId) || ids.has(row.pairId) || !identifier(row.workId) || !Number.isSafeInteger(row.chapter) || row.chapter < 1 || typeof row.genre !== 'string' || row.genre.length > 100) throw new Error('样本身份、章节或题材无效')
    ids.add(row.pairId)
    for (const variant of ['baseline', 'improved']) if (typeof row[variant] !== 'string' || !row[variant].trim() || row[variant].length > 200_000) throw new Error('必须提供两份完整样稿')
  }
  const mapping = []
  const packets = input.participants.map(participantCode => {
    const samples = input.samples.map(row => {
      const first = parseInt(hash(`${seed}:${participantCode}:${row.workId}`).slice(0, 2), 16) % 2 === 0 ? 'baseline' : 'improved'
      const second = first === 'baseline' ? 'improved' : 'baseline'
      mapping.push({ participantCode, pairId: row.pairId, workId: row.workId, a: first, b: second })
      return { pairId: row.pairId, workId: row.workId, chapter: row.chapter, genre: row.genre, a: { text: row[first], hash: hash(row[first]) }, b: { text: row[second], hash: hash(row[second]) } }
    })
    const publicData = { schema: 'storyforge.longform-choice-packet', version: 1, studyId: input.studyId, mode: input.mode, participantCode, dimensions, reasons, samples }
    return { ...publicData, packetId: hash(JSON.stringify(publicData)) }
  })
  return { packets, organizerKey: { studyId: input.studyId, mode: input.mode, inputHash: hash(JSON.stringify(input)), sourceVersions: input.sourceVersions ?? null, mapping } }
}

/** 导入不信任 complete 或身份声明；完整性重算，独立身份须由组织者另核。 */
export function validateChoiceReview(packet, value) {
  const exact = (row, keys) => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).sort().join('|') === [...keys].sort().join('|')
  if (!exact(value, ['schema', 'version', 'studyId', 'packetId', 'participantCode', 'mode', 'role', 'familiarity', 'independence', 'openedAt', 'updatedAt', 'answers'])) throw new Error('结果结构无效')
  if (value.schema !== 'storyforge.longform-choice-review' || value.version !== 1 || value.studyId !== packet.studyId || value.packetId !== packet.packetId || value.participantCode !== packet.participantCode || value.mode !== packet.mode) throw new Error('结果不属于这份问卷，未覆盖当前进度')
  for (const [key, choices] of [['role', ['reader', 'editor', 'author', 'developer']], ['familiarity', ['often', 'sometimes', 'rare']], ['independence', ['yes', 'no', 'unknown']]]) if (value[key] !== null && !choices.includes(value[key])) throw new Error('参与情况选项无效')
  if (![value.openedAt, value.updatedAt].every(time => typeof time === 'string' && Number.isFinite(Date.parse(time))) || !Array.isArray(value.answers) || value.answers.length !== packet.samples.length) throw new Error('结果时间或样本数量无效')
  let completedPairs = 0
  const seen = new Set()
  for (const answer of value.answers) {
    if (!exact(answer, ['pairId', 'hashA', 'hashB', 'a', 'b', 'preference', 'reasons'])) throw new Error('章节答案结构无效')
    const sample = packet.samples.find(row => row.pairId === answer.pairId)
    if (!sample || seen.has(answer.pairId) || answer.hashA !== sample.a.hash || answer.hashB !== sample.b.hash) throw new Error('样稿版本不匹配')
    seen.add(answer.pairId)
    if (answer.preference !== null && !['A', 'B', 'tie', 'unknown'].includes(answer.preference)) throw new Error('偏好选项无效')
    if (!Array.isArray(answer.reasons) || new Set(answer.reasons).size !== answer.reasons.length || answer.reasons.some(reason => !packet.reasons.some(([key]) => key === reason))) throw new Error('原因选项无效')
    if (answer.reasons.length > 1 && answer.reasons.some(reason => ['no-difference', 'unknown'].includes(reason))) throw new Error('无差别或无法判断不能与其它原因同时选择')
    let filled = answer.preference !== null && answer.reasons.length > 0
    for (const side of ['a', 'b']) {
      const row = answer[side]
      const maxParagraph = sample[side].text.split(/\n+/).filter(part => part.trim()).length
      if (!exact(row, ['readTo', 'continuation', 'scores']) || !exact(row.scores, packet.dimensions.map(([key]) => key))) throw new Error('版本答案结构无效')
      if (row.readTo !== null && !['end', 'not-started'].includes(row.readTo) && !(Number.isSafeInteger(row.readTo) && row.readTo >= 1 && row.readTo <= maxParagraph)) throw new Error('段落位置无效')
      if (row.continuation !== null && !['yes', 'maybe', 'no', 'unknown'].includes(row.continuation)) throw new Error('追读选项无效')
      for (const score of Object.values(row.scores)) if (score !== null && score !== 'unknown' && !(Number.isSafeInteger(score) && score >= 1 && score <= 5)) throw new Error('评分无效')
      filled &&= row.readTo !== null && row.continuation !== null && Object.values(row.scores).every(score => score !== null)
    }
    if (filled) completedPairs++
  }
  return { completedPairs, complete: completedPairs === packet.samples.length && ['role', 'familiarity', 'independence'].every(key => value[key] !== null) }
}

function questionnaireClient(packet, validate) {
  const $ = id => document.getElementById(id)
  const key = 'storyforge-choice-review:' + packet.packetId
  const blankSide = () => ({ readTo: null, continuation: null, scores: Object.fromEntries(packet.dimensions.map(([id]) => [id, null])) })
  let review = { schema: 'storyforge.longform-choice-review', version: 1, studyId: packet.studyId, packetId: packet.packetId, participantCode: packet.participantCode, mode: packet.mode, role: null, familiarity: null, independence: null, openedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), answers: packet.samples.map(sample => ({ pairId: sample.pairId, hashA: sample.a.hash, hashB: sample.b.hash, a: blankSide(), b: blankSide(), preference: null, reasons: [] })) }
  let index = 0
  function notice(message) { $('notice').textContent = message }
  function progress() { const result = validate(packet, review); $('progress').textContent = result.completedPairs + ' / ' + packet.samples.length + ' 组已填完' + (result.complete ? ' · 可交回完整结果' : ' · 可随时导出未完成进度') }
  function save() { review.updatedAt = new Date().toISOString(); progress(); try { localStorage.setItem(key, JSON.stringify(review)); notice('已保存到当前浏览器；换设备或交回结果，请导出文件。') } catch { notice('浏览器无法保存。请导出进度文件，下次用“恢复进度”继续。') } }
  function node(tag, text, parent) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (parent) parent.append(element); return element }
  function choices(parent, title, name, options, selected, update, multiple = false) {
    const field = node('fieldset', undefined, parent); node('legend', title, field)
    options.forEach(([id, text]) => { const label = node('label', undefined, field); const input = node('input', undefined, label); input.type = multiple ? 'checkbox' : 'radio'; input.name = name; input.value = String(id); input.checked = multiple ? selected.includes(id) : selected === id; label.append(document.createTextNode(text)); input.addEventListener('change', () => { update(id, input.checked); save(); if (multiple) render() }) })
  }
  function render() {
    const sample = packet.samples[index]; const answer = review.answers.find(row => row.pairId === sample.pairId)
    $('chapter').textContent = sample.genre + ' · 第 ' + sample.chapter + ' 章 · ' + (index + 1) + '/' + packet.samples.length
    $('previous').disabled = index === 0; $('next').disabled = index === packet.samples.length - 1
    $('profile').replaceChildren()
    choices($('profile'), '你的身份', 'role', [['reader', '读者'], ['editor', '编辑'], ['author', '作者'], ['developer', '参与实现者']], review.role, id => { review.role = id })
    choices($('profile'), '平时阅读本次题材的频率', 'familiarity', [['often', '经常'], ['sometimes', '偶尔'], ['rare', '很少']], review.familiarity, id => { review.familiarity = id })
    choices($('profile'), '本次评价是否自己独立完成，未参与开发、未与其他评审讨论？', 'independence', [['yes', '是'], ['no', '否'], ['unknown', '不确定']], review.independence, id => { review.independence = id })
    $('samples').replaceChildren(); $('questions').replaceChildren()
    for (const side of ['a', 'b']) {
      const card = node('section', undefined, $('samples')); node('h2', '版本 ' + side.toUpperCase(), card)
      const text = node('div', undefined, card); text.className = 'prose'
      const paragraphs = sample[side].text.split(/\n+/).filter(part => part.trim())
      paragraphs.forEach((paragraph, number) => { const p = node('p', undefined, text); node('small', String(number + 1), p); p.append(document.createTextNode(paragraph)) })
      const block = node('section', undefined, $('questions')); node('h2', '版本 ' + side.toUpperCase() + ' 的阅读感受', block)
      const label = node('label', '读到哪里 / 从哪里不想继续？', block); const select = node('select', undefined, label); select.setAttribute('aria-label', '版本' + side.toUpperCase() + '阅读位置')
      const positions = [['', '请选择'], ['end', '读完本章'], ['not-started', '还没读这一版'], ...paragraphs.map((_, i) => [String(i + 1), '第 ' + (i + 1) + ' 段后停下'])]
      positions.forEach(([id, label]) => { const option = node('option', label, select); option.value = id })
      select.value = answer[side].readTo === null ? '' : String(answer[side].readTo)
      select.addEventListener('change', () => { answer[side].readTo = /^\d+$/.test(select.value) ? Number(select.value) : select.value || null; save() })
      choices(block, '愿意读这版的下一章吗？', side + '-continuation', [['yes', '愿意'], ['maybe', '可能'], ['no', '不愿意'], ['unknown', '无法判断']], answer[side].continuation, id => { answer[side].continuation = id })
      node('p', '1 明显妨碍阅读 · 3 可读但需要修改 · 5 表现充分。没有足够信息时选“无法判断”。', block)
      for (const [id, label] of packet.dimensions) choices(block, label, side + '-' + id, [[1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], ['unknown', '无法判断']], answer[side].scores[id], value => { answer[side].scores[id] = value })
    }
    choices($('questions'), '综合比较，你更想继续读哪一版？', 'preference', [['A', 'A'], ['B', 'B'], ['tie', '持平'], ['unknown', '无法判断']], answer.preference, id => { answer.preference = id })
    choices($('questions'), '主要原因（可多选）', 'reasons', packet.reasons, answer.reasons, (id, checked) => {
      const neutral = ['no-difference', 'unknown']
      answer.reasons = checked ? neutral.includes(id) ? [id] : [...answer.reasons.filter(old => !neutral.includes(old) && old !== id), id] : answer.reasons.filter(old => old !== id)
    }, true)
    progress()
  }
  try { const stored = localStorage.getItem(key); if (stored) { const parsed = JSON.parse(stored); validate(packet, parsed); review = parsed; notice('已恢复当前浏览器的进度。') } } catch { notice('未读取到有效的本地进度；可从之前导出的文件恢复。') }
  $('previous').addEventListener('click', () => { save(); index--; render(); window.scrollTo(0, 0) })
  $('next').addEventListener('click', () => { save(); index++; render(); window.scrollTo(0, 0) })
  $('save').addEventListener('click', save)
  $('export').addEventListener('click', () => { save(); const url = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2)], { type: 'application/json' })); const link = node('a'); link.href = url; link.download = packet.studyId + '-' + packet.participantCode + '-result.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000) })
  $('restore').addEventListener('click', () => $('file').click())
  $('file').addEventListener('change', async event => { try { const file = event.target.files[0]; if (!file || file.size > 2_000_000) throw new Error('进度文件缺失或过大'); const parsed = JSON.parse(await file.text()); validate(packet, parsed); review = parsed; save(); render(); notice('已恢复所选进度文件。') } catch (error) { notice('恢复失败：' + error.message + '。当前填写保留。') } finally { event.target.value = '' } })
  render()
}

export function renderQuestionnaire(packet) {
  const data = JSON.stringify(packet).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><title>系统文阅读选择问卷</title><style>body{margin:0;background:#f7f5f0;color:#252825;font:16px/1.65 system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1{font-size:25px}h2{font-size:19px}section,details{background:white;border:1px solid #dddcd3;border-radius:12px;padding:18px;margin:16px 0}#samples{display:grid;grid-template-columns:1fr 1fr;gap:18px}#samples section{min-width:0}.prose p{white-space:pre-wrap;overflow-wrap:anywhere}.prose small{color:#647265;padding-right:12px;user-select:none}fieldset{border:0;border-bottom:1px solid #ebe9df;padding:12px 0;margin:0}legend{font-weight:600}label{display:inline-flex;align-items:center;gap:8px;margin:5px 16px 5px 0}input{width:18px;height:18px}select,button{font:inherit;border:1px solid #bfc9bf;border-radius:8px;background:white;padding:10px;cursor:pointer}button:disabled{opacity:.45;cursor:default}input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #31684c;outline-offset:3px}nav{position:sticky;bottom:0;background:#f7f5f0ed;border-top:1px solid #ddd;padding:12px;display:flex;flex-wrap:wrap;gap:10px}.notice{color:#38664a;font-size:14px}#progress{font-weight:600}#file{display:none}.preview{padding:12px;border:1px solid #b68320;border-radius:8px;background:#fff6de}@media(max-width:720px){main{padding:14px}#samples{grid-template-columns:1fr}section{padding:14px}label{margin-right:12px}nav{position:static}}</style></head><body><main><h1>系统文阅读选择问卷</h1>${packet.mode === 'preview' ? '<p class="preview">流程预览：使用原创演示文字。本次填写不进入正式质量结论。</p>' : ''}<p>只需选择，无需打字。可随时停下、保存，下次继续。每份问卷有独立代号，请由同一个人填写；不要讨论答案。无法判断可以直接选择。</p><p id="progress" aria-live="polite"></p><details><summary>参与情况（首次填写即可）</summary><div id="profile"></div></details><h2 id="chapter"></h2><div id="samples"></div><div id="questions"></div><p id="notice" role="status" class="notice"></p><nav><button id="previous">上一组</button><button id="next">下一组</button><button id="save">保存进度</button><button id="export">导出结果 / 进度</button><button id="restore">恢复进度</button><input id="file" type="file" accept="application/json,.json" aria-label="选择进度文件"></nav><p>保存仅在当前浏览器；导出的文件才可交回或换设备恢复。问卷不联网，也不自动上传。填写时间不是修稿耗时。</p></main><script id="packet" type="application/json">${data}</script><script>(${questionnaireClient.toString()})(JSON.parse(document.getElementById('packet').textContent),${validateChoiceReview.toString()});</script></body></html>`
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [inputPath, outputPath] = process.argv.slice(2)
  if (!inputPath || !outputPath) throw new Error('用法：node scripts/quality-evals/longform-choice-questionnaire.mjs INPUT.json OUTPUT_DIR')
  const { packets, organizerKey } = makeQuestionnairePackets(JSON.parse(await readFile(inputPath, 'utf8')))
  const output = resolve(outputPath)
  await mkdir(join(output, 'participants'), { recursive: true })
  for (const packet of packets) await writeFile(join(output, 'participants', packet.participantCode + '.html'), renderQuestionnaire(packet), { flag: 'wx' })
  await writeFile(join(output, 'organizer-key.json'), JSON.stringify(organizerKey, null, 2), { flag: 'wx' })
  process.stdout.write(`已生成 ${packets.length} 份独立问卷。只发 participants 中的 HTML；映射文件留给组织者。\n`)
}
