import { describe, expect, it } from 'vitest'
import { makeAuthorRepairPackets, readAuthorRepairHtml, renderAuthorRepair, validateAuthorRepairReturn } from '../../scripts/quality-evals/longform-author-repair.mjs'

const input = { studyId: 'Q10-repair-preview', mode: 'preview', participants: ['W01', 'W02'], samples: [1, 2].map(n => ({ pairId: `pair-${n}`, genre: '系统文', brief: '保持事实与收尾，改善因果和重复。', baseline: `任务${n}原稿甲。`, improved: `任务${n}原稿乙。</script><script>throw 1</script>` })) }
function result(packet: any) {
  return { schema: 'storyforge.author-repair-return', version: 1, studyId: packet.studyId, mode: packet.mode, packetId: packet.packetId, participantCode: packet.participantCode, familiarity: 'often', independence: 'yes', index: 0, updatedAt: '2026-10-15T00:00:03.000Z', tasks: packet.tasks.map((task: any) => ({ taskId: task.taskId, sourceHash: task.sourceHash, text: '作者实际修好的原稿。', status: 'finished', decision: 'ready', sessions: [{ startedAt: '2026-10-15T00:00:00.000Z', endedAt: '2026-10-15T00:00:03.000Z', elapsedMs: 3000 }] })) }
}

describe('LFQ10 · 同文件作者修稿与计时', () => {
  it('每人独立、两稿按同一目标分配，跨任务交替先后且映射不在参与者文件里', () => {
    const made = makeAuthorRepairPackets(input, 'frozen')
    const packet = made.packets[0]
    const rows = made.organizerKey.mapping.filter(row => row.participantCode === packet.participantCode)
    expect(rows[0].variant).not.toBe(rows[2].variant)
    expect(packet.tasks[0].brief).toBe(packet.tasks[1].brief)
    expect(made.packets[0].packetId).not.toBe(made.packets[1].packetId)
    expect(JSON.stringify(packet)).not.toContain('"variant"')
    expect(renderAuthorRepair(packet)).not.toContain('throw 1</script>')
  })
  it('正文与真实计时段一起读取；校验不执行返回 HTML 里的脚本', () => {
    const packet = makeAuthorRepairPackets(input, 'seed').packets[0]
    const value = result(packet)
    const parsed = readAuthorRepairHtml(packet, renderAuthorRepair(packet, value) + '<script>throw 1</script>')
    expect(parsed.validation).toEqual({ finished: 4, totalMs: 12000, complete: true })
    expect(parsed.manuscripts[0].elapsedMs).toBe(3000)
    expect(parsed.manuscripts[0].editedTextHash).not.toBe(packet.tasks[0].sourceHash)
  })
  it('跨人、换原稿、伪造计时、重复任务或错误完成选择均拒绝', () => {
    const made = makeAuthorRepairPackets(input, 'seed'), packet = made.packets[0]
    expect(() => readAuthorRepairHtml(made.packets[1], renderAuthorRepair(packet, result(packet)))).toThrow('人员或原稿')
    const time = result(packet); time.tasks[0].sessions[0].elapsedMs = -1
    expect(() => validateAuthorRepairReturn(packet, time)).toThrow('计时段')
    const duplicate = result(packet); duplicate.tasks[1] = duplicate.tasks[0]
    expect(() => validateAuthorRepairReturn(packet, duplicate)).toThrow('正文、状态或版本')
    const unchanged = result(packet); unchanged.tasks[0].decision = 'unchanged-ready'
    expect(() => validateAuthorRepairReturn(packet, unchanged)).toThrow('完成任务')
    expect(() => readAuthorRepairHtml(packet, renderAuthorRepair(packet))).toThrow('saved-repair')
  })
  it('未完成、缺少独立性或仍需返工不得被当成文学及修稿达标', () => {
    const packet = makeAuthorRepairPackets(input, 'seed').packets[0], value = result(packet)
    value.tasks[0].status = 'paused'; value.independence = null
    expect(validateAuthorRepairReturn(packet, value).complete).toBe(false)
    const retry = result(packet); retry.tasks[0].decision = 'needs-more'
    expect(validateAuthorRepairReturn(packet, retry).complete).toBe(true)
    expect(retry.tasks[0].decision).toBe('needs-more') // Complete collection is distinct from acceptable manuscripts.
  })
})
