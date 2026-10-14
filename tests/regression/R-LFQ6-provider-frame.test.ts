import { describe, expect, it } from 'vitest'
import { observeDuplicatedProseFrameV1 } from '../../src/lib/prose/provider-frame-observation'
import { parseProseCandidateDraft } from '../../src/lib/agent/prose-copilot'

const prose = '回廊里的光线深了一层。许照合上笔记，决定先核对断口，不把未验证的推断当成事实。'.repeat(20)
describe('LFQ6 · 回复分隔与原文保护', () => {
  it('识别独立分隔符两侧相同开篇的长正文，记录可核对后段，不自动改字', () => {
    const text = `# 第7章 验证\n${prose}\n</think>\n# 第7章 验证\n${prose}`
    const found = observeDuplicatedProseFrameV1(text)!
    expect(found.kind).toBe('duplicated-answer-frame')
    expect(text.slice(found.afterSeparator)).toBe(`# 第7章 验证\n${prose}`)
    expect(() => parseProseCandidateDraft(text)).toThrow('原响应保留')
  })
  it('保留正文中嵌入的字面标签、技术样例和普通重复，不按关键词删掉原文', () => {
    for (const text of [`正文里写着 </think>，它是字面文本。${prose}`, `${prose}\n</think>\n故事结尾的另一段。`, `<think>\n代码样例\n</think>\n${prose}`, `${prose}\n${prose}`]) expect(observeDuplicatedProseFrameV1(text)).toBeNull()
  })
  it('不同正文不会因为相同分隔标签而被认作重复；少量编辑仍能辨别真实重复响应', () => {
    expect(observeDuplicatedProseFrameV1(`${prose}\n</think>\n${'另一位人物在海港中寻找灯塔。'.repeat(50)}`)).toBeNull()
    expect(observeDuplicatedProseFrameV1(`${prose}\n</think>\n${prose.replace('决定先核对断口', '决定先核对断口') + '他把门关好。'}`)).not.toBeNull()
  })
})
