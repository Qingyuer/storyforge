/** Observe a duplicated answer around a provider-style separator. This never
 * strips tags or picks a draft; the author must edit the governed candidate. */
export function observeDuplicatedProseFrameV1(text: string): { version: 1; kind: 'duplicated-answer-frame'; separatorStart: number; afterSeparator: number; message: string } | null {
  const body = (value: string) => {
    const lines = value.trim().split(/\r?\n/)
    if (lines[0]?.trim() === '<think>') lines.shift()
    if (/^\s*(?:#{1,6}\s+|第[一二三四五六七八九十百零〇0-9]+章)/.test(lines[0] ?? '')) lines.shift()
    return lines.join('\n').replace(/\s/g, '')
  }
  for (const match of text.matchAll(/^[\t ]*<\/think>[\t ]*(?:\r?\n|$)/gm)) {
    const start = match.index!, end = start + match[0].length
    const before = body(text.slice(0, start)), after = body(text.slice(end))
    if (before.length < 300 || after.length < 300 || Math.min(before.length, after.length) / Math.max(before.length, after.length) < .35) continue
    if (before.slice(0, 48) !== after.slice(0, 48)) continue
    return { version: 1, kind: 'duplicated-answer-frame', separatorStart: start, afterSeparator: end, message: '回复在推理分隔符前后重复了正文，疑似混入草稿。原响应保留；请核对并编辑候选后再采纳，没有自动重发。' }
  }
  return null
}
