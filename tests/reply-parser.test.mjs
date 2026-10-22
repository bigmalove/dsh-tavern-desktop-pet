// 解析器规则：用一份结构与真实建卡对话相同的合成样本，外加降级边界。
// 真实样本来自本机的一次建卡对话，这里换成虚构的卡片，避免把用户的创作内容
// 带进公开仓库。
//
// 重点两类：
//   1. 样本里出现过的主路径（第 1～8 题、摘要、建好）；
//   2. 刷新后没有宿主信号时不能把「建好了」误判成摘要。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { foldSummary, parseReply, speechText } from '../src/client/guide/reply-parser.js'

const Q1 = [
  '好，我们一步步来定这张卡。你可以直接选编号、自由组合，或者随时说「你来定」。',
  '',
  '**第 1 题：这张卡想做什么题材与基调？**',
  '',
  '- **A. 星港日常 / 慢节奏**：贴近生活的港口与航线，重细节与人情。',
  '- **B. 深空冒险 / 史诗**：远航、未知信号与失败代价。',
  '- **C. 悬疑 / 怪谈**：失踪的货船、无人应答的频道。',
  '- **D. 其他想法**：直接告诉我你想玩的题材。',
].join('\n')

const Q2 = [
  '已记录：题材是**星港日常**。',
  '',
  '**第 2 题：这张卡的核心定位是什么？**',
  '',
  '- **A. 引航员 / 工具型**：只做事，不闲聊。',
  '- **B. 港口搭档 / 对话型**：有性格、会吐槽。',
].join('\n')

const Q3 = [
  '已定：**A 冷静的引航员**，不扮演虚构人物。',
  '',
  '**第 3 题：它默认该用什么语气与节奏？（影响开场与对白）**',
  '',
  '- **A. 克制、短句**：像值班记录。',
  '- **B. 温和、有耐心**：像带新人。',
  '- **C. 你定**：按你的习惯来。',
].join('\n')

const Q7 = [
  '已定：**不带世界书**。整张卡只有提示词本身。',
  '',
  '**第 7 题：要不要加 MVU 变量？**（有一项功能需要你决定）',
  '',
  'MVU 是后台每轮自动结算一组状态，比如当前泊位、累计航次、船况，右侧面板会稳定显示。好处是跨多轮时不会前后变化；代价是**每轮多一次后台调用**（更慢、更费额度）。',
  '',
  '- **A. 不加**：纯靠上下文记。',
  '- **B. 加一套精简进度条**：只记泊位、航次。',
  '- **C. 加一套完整档案**：还记船况与船员。',
  '- **D. 你定。**',
].join('\n')

const Q8 = [
  '已定：**不加 MVU**。不做后台结算。',
  '',
  '**第 8 题（最后一题）：要不要做前端美化？**',
  '',
  '- **A. 不要美化**：纯文本开场。',
  '- **B. 只美化开场**：做一张静态的港口版面。',
  '- **C. 美化开场 + 正文排版约定**：统一分段与对白符号。',
  '- **D. 你定。**',
].join('\n')

const SUMMARY = [
  '信息齐了，先给你一版摘要，确认后我就建卡。',
  '',
  '---',
  '',
  '**卡名（待定）**：`星港引航员`',
  '**定位**：冷静的引航员，工具型。',
  '**玩家身份**：不设定。',
  '',
  '---',
  '',
  '你说「就这样」，我就以这些默认值直接建卡。',
].join('\n')

const DONE = [
  '建好了。',
  '',
  '**卡片路径**：`cards/星港引航员.json`',
  '',
  '| 项目 | 内容 |',
  '|---|---|',
  '| 定位 | 引航员 |',
  '| 开场 | 1 个 |',
  '',
  '在游玩模式选中它即可开局。',
].join('\n')

const QUESTIONS = [Q1, Q2, Q3, Q7, Q8]

test('样本里的提问都认成 question，题号、问题、选项齐全', () => {
  const expected = [1, 2, 3, 7, 8]
  for (const [index, text] of QUESTIONS.entries()) {
    const parsed = parseReply(text)
    assert.equal(parsed.kind, 'question', '第 ' + expected[index] + ' 题')
    assert.equal(parsed.index, expected[index])
    assert.ok(parsed.question.length > 0)
    assert.ok(parsed.options.length >= 2)
    assert.deepEqual(parsed.options.map((option) => option.key), parsed.options.map((_, at) => String.fromCharCode(65 + at)))
    assert.ok(parsed.options.every((option) => option.label !== ''))
  }
})

test('第 8 题的括注在冒号前：题号仍要认出来，问题里不能带「第 8 题」前缀，hint 是括注', () => {
  const parsed = parseReply(Q8)
  assert.equal(parsed.kind, 'question')
  assert.equal(parsed.index, 8)
  assert.equal(parsed.question, '要不要做前端美化？')
  assert.equal(parsed.hint, '最后一题')
})

test('确认句只在第一段以「已定 / 已记录 / 好」开头时进入 ack', () => {
  const intro = parseReply(Q1)
  assert.match(intro.ack, /^好，我们一步步来/)
  assert.equal(intro.ack.includes('第 1 题'), false, '问题行本身不进 ack')
  const third = parseReply(Q3)
  assert.match(third.ack, /^已定：/)
  assert.equal(third.ack.includes('第 3 题'), false)
  const withoutAck = parseReply('**第 1 题：想做什么题材？**\n\n- **A. 星港**：港口日常。\n- **B. 深空**：远航。')
  assert.equal(withoutAck.ack, '')
})

test('问题与选项之间的利弊说明进入 note，且截到 200 字以内', () => {
  const parsed = parseReply(Q7)
  assert.equal(parsed.kind, 'question')
  assert.match(parsed.note, /MVU 是后台每轮自动结算/)
  assert.ok(parsed.note.length <= 200)
})

test('摘要轮不折叠：分隔线 + 键值列表', () => {
  const parsed = parseReply(SUMMARY)
  assert.equal(parsed.kind, 'summary')
  assert.equal(foldSummary(parsed), null)
  assert.equal(parsed.lead, '信息齐了，先给你一版摘要，确认后我就建卡。')
})

test('建好轮：有宿主信号时直接 done；刷新后没有信号也靠首行认出来，不再掉进摘要', () => {
  const withSignal = parseReply(DONE, { cardSaved: 'cards/星港引航员.json' })
  assert.equal(withSignal.kind, 'done')
  assert.equal(withSignal.created, true)
  assert.equal(withSignal.cardPath, 'cards/星港引航员.json')

  const afterRefresh = parseReply(DONE)
  assert.equal(afterRefresh.kind, 'done', '没有 cardSaved / changed 时也必须识别')
  assert.equal(afterRefresh.created, true)
  assert.equal(afterRefresh.cardPath, 'cards/星港引航员.json')

  const edited = parseReply('改好了。\n\n**卡片路径**：`cards/星港引航员.json`', { changed: true })
  assert.equal(edited.kind, 'done')
  assert.equal(edited.created, false)
})

test('只有一行选项时不折叠；选项后还有长文时降级为 unknown', () => {
  const one = parseReply('**第 2 题：核心定位是什么？**\n\n- **A. 引航员**：只做事。')
  assert.equal(one.kind, 'unknown')

  const longAfter = parseReply('**第 2 题：核心定位是什么？**\n\n- **A. 引航员**：只做事。\n- **B. 搭档**：会闲聊。\n\n' + '补充说明。'.repeat(30))
  assert.equal(longAfter.kind, 'unknown')
})

test('不加粗的选项也能认；纯文字提问（没有选项）走 unknown，气泡只说第一句', () => {
  const plain = parseReply('已记录。\n\n**第 2 题：核心定位是什么？**\n\n- A. 引航员：只做事\n- B. 搭档：会闲聊')
  assert.equal(plain.kind, 'question')
  assert.equal(plain.index, 2)
  assert.deepEqual(plain.options.map((option) => option.label), ['引航员', '搭档'])

  const noOptions = parseReply('角色叫什么名字？想好了告诉我，我再接着问下一个问题。')
  assert.equal(noOptions.kind, 'unknown')
  assert.equal(noOptions.lead, '角色叫什么名字？')
})

test('折叠摘要：带题号前缀，最多 40 字；朗读只读确认句和问题', () => {
  const parsed = parseReply(Q2)
  assert.equal(foldSummary(parsed), '第 2 题：这张卡的核心定位是什么？')
  const long = { kind: 'question', index: 5, question: '问'.repeat(60), ack: '', hint: '', note: '', options: [] }
  assert.equal(foldSummary(long).length, '第 5 题：'.length + 40)
  assert.equal(speechText({ kind: 'question', ack: '已定：A', question: '下一步做什么？' }), '已定：A。下一步做什么？')
  assert.equal(speechText({ kind: 'done', lead: '建好了。' }), '建好了。')
})

test('选项末尾的句号不会带进按钮', () => {
  const parsed = parseReply('**第 4 题：你在什么身份用它？**\n\n- **A. 匿名领航员**：不带设定。\n- **B. 其他，或你来定。**')
  assert.deepEqual(parsed.options.map((option) => option.label), ['匿名领航员', '其他，或你来定'])
  assert.equal(parsed.options[1].freeform, true)
})

test('真实回复的另一种写法：中文题号、问号在句中、选项没有列表符号', () => {
  const text = [
    '你的“初步想法”后面是空的，那我就从零开始问，一题一题来，别急。',
    '',
    '第一题，也是定方向的一题：你想开的是什么样的一局？也就是题材、基调和尺度，这三件常常绑在一起。',
    '',
    'A. 现代都市、暧昧慢热：日常场景，感情靠拉扯推进。',
    'B. 奇幻异世界、权力与征服：有规则、有势力。',
    'C. 阴暗畸形、心理依赖：囚禁、操控。',
    'D. 其他想法 / 你定：直接说你想的。',
    '',
    '选一个字母就行。',
  ].join('\n')
  const parsed = parseReply(text)
  assert.equal(parsed.kind, 'question')
  assert.equal(parsed.index, 1)
  assert.equal(parsed.question, '你想开的是什么样的一局？')
  assert.deepEqual(parsed.options.map((option) => option.key), ['A', 'B', 'C', 'D'])
  assert.equal(parsed.options[3].freeform, true)
  assert.equal(foldSummary(parsed), '第 1 题：你想开的是什么样的一局？')
})
