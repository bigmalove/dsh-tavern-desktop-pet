// 引导状态机：用假的 watchReply 推送序列验证「生成中不解析 / 结束后只处理一次 /
// 刷新能续上 / 选项发送与关闭开关」。
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createGuideController } from '../src/client/guide/guide-controller.js'
import { createGuidePresenter } from '../src/client/guide/presenter.js'

const QUESTION = [
  '已定：**A 冷静的引航员**。',
  '',
  '**第 3 题：它默认该用什么文风？**',
  '',
  '- **A. 文学细腻流**：重视觉与心理。',
  '- **B. 冷硬克制流**：短句白描。',
  '- **C. 你定。**',
].join('\n')

const SUMMARY = ['信息齐了，先给你一版摘要，确认后我就建卡。', '', '---', '', '**卡名**：星港引航员', '**定位**：引航员，工具型', '**玩家身份**：不设定', '', '---', '', '你说「就这样」，我就建卡。'].join('\n')
const DONE = ['建好了。', '', '**卡片路径**：`cards/星港引航员.json`', '', '| 项目 | 内容 |', '|---|---|', '| 定位 | 引航员 |'].join('\n')

function harness(options = {}) {
  const pushes = []
  const calls = { speak: [], submit: [], fill: 0 }
  let sessionId = options.sessionId === undefined ? 's1' : options.sessionId
  let sessionListener = null
  const controller = createGuideController({
    currentSessionId: () => sessionId,
    onSessionChange: (listener) => { sessionListener = listener; return () => { sessionListener = null } },
    watchReply: (id, listener) => {
      const entry = { id, listener }
      pushes.push(entry)
      if (options.initial) listener(options.initial)
      return () => { const at = pushes.indexOf(entry); if (at >= 0) pushes.splice(at, 1) }
    },
    speak: (text, mood) => calls.speak.push([text, mood]),
    submitChoice: (text) => calls.submit.push(text),
    fillInput: () => { calls.fill += 1 },
  })
  const states = []
  controller.subscribe((state) => states.push(state))
  controller.start()
  const latest = () => pushes[pushes.length - 1]
  return { controller, pushes, calls, states, latest, changeSession: (id) => { sessionId = id; sessionListener?.(id) }, setSession: (id) => { sessionId = id } }
}

test('进入工作台：生成中只显示不解析，结束后解析一次，选项与表情就位', () => {
  const run = harness()
  assert.equal(run.pushes.length, 1)
  assert.equal(run.pushes[0].id, 's1')
  const state = run.controller.getState()
  assert.equal(state.active, true)
  assert.equal(state.phase, 'idle')

  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 3, text: '已定：**A 冷静的引航员**。\n\n**第 3', streaming: true, busy: true, tool: 'tavern_update_card' })
  let now = run.controller.getState()
  assert.equal(now.phase, 'streaming')
  assert.equal(now.options.length, 0)
  assert.match(now.bubble.lead, /已定/)
  assert.equal(run.calls.speak.length, 0, '生成中不朗读')

  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 3, text: QUESTION, streaming: false, busy: false, tool: null })
  now = run.controller.getState()
  assert.equal(now.phase, 'presenting')
  assert.equal(now.kind, 'question')
  assert.equal(now.turn, 3)
  assert.equal(now.bubble.ack, '已定：A 冷静的引航员。')
  assert.equal(now.bubble.question, '它默认该用什么文风？')
  assert.deepEqual(now.options.map((option) => option.key), ['A', 'B', 'C'])
  assert.equal(now.options[2].freeform, true)
  assert.equal(now.mood, '思考')
  assert.deepEqual(run.calls.speak, [['已定：A 冷静的引航员。它默认该用什么文风？', '思考']])

  // 同一轮同一个结果再次到达：不重复解析、不重复朗读。
  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 3, text: QUESTION, streaming: false, busy: false, tool: null })
  assert.equal(run.calls.speak.length, 1)

  // 下一轮又是同一条：允许再说一次。
  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 4, text: QUESTION, streaming: false, busy: false, tool: null })
  assert.equal(run.calls.speak.length, 2)
})

test('刷新续接：订阅时已经有提问，直接进入 presenting', () => {
  const run = harness({ initial: { sessionId: 's1', mode: 'card', turn: 5, text: QUESTION, streaming: false, busy: false, tool: null } })
  const state = run.controller.getState()
  assert.equal(state.phase, 'presenting')
  assert.equal(state.turn, 5)
  assert.equal(state.options.length, 3)
})

test('摘要轮与建好轮：各自的台词与按钮', () => {
  const run = harness()
  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 9, text: SUMMARY, streaming: false, busy: false })
  let state = run.controller.getState()
  assert.equal(state.kind, 'summary')
  assert.match(state.bubble.lead, /信息齐了/)
  assert.deepEqual(state.options.map((option) => option.label), ['就这样', '我要改…'])

  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 10, text: DONE, streaming: false, busy: false, cardSaved: 'cards/星港引航员.json' })
  state = run.controller.getState()
  assert.equal(state.kind, 'done')
  assert.match(state.bubble.lead, /建好啦/)
  assert.match(state.bubble.detail, /已保存到 cards\/星港引航员\.json/)
  assert.deepEqual(state.options.map((option) => option.label), ['再改改'])
  assert.equal(state.mood, '大笑')
})

test('回复没有宿主信号（刷新后）时，「建好了」不会退化成摘要', () => {
  const run = harness()
  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 10, text: DONE, streaming: false, busy: false })
  assert.equal(run.controller.getState().kind, 'done')
})

test('点选项即发送；「你定」只填输入框；发送后按钮清空并禁用', () => {
  const run = harness()
  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 3, text: QUESTION, streaming: false, busy: false })
  run.controller.choose(run.controller.getState().options[2])
  assert.equal(run.calls.fill, 1)
  assert.equal(run.controller.getState().options.length, 3, '填输入框不动选项')

  run.controller.choose(run.controller.getState().options[1])
  assert.deepEqual(run.calls.submit, ['B'])
  const state = run.controller.getState()
  assert.equal(state.options.length, 0)
  assert.equal(state.choiceDisabled, true)
  assert.equal(state.phase, 'waiting')
  run.controller.choose({ key: 'A' })
  assert.deepEqual(run.calls.submit, ['B'], '发送后的重复点击被忽略')
})

test('离开工作台、关闭开关、隐藏桌宠都不吞主区的内容，只是回到 idle', () => {
  const run = harness()
  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 3, text: QUESTION, streaming: false, busy: false })
  assert.equal(run.controller.getState().active, true)

  run.latest().listener({ sessionId: 's1', mode: 'story', turn: 3, text: '正文', streaming: false, busy: false })
  assert.equal(run.controller.getState().active, false)
  assert.equal(run.controller.getState().phase, 'idle')

  run.latest().listener({ sessionId: 's1', mode: 'card', turn: 4, text: QUESTION, streaming: false, busy: false })
  run.controller.setEnabled(false)
  assert.equal(run.controller.getState().active, false)
  assert.equal(run.pushes.length, 0, '关闭开关后取消订阅')
  assert.equal(run.controller.describe(), '引导已关闭')

  run.controller.setEnabled(true)
  assert.equal(run.pushes.length, 1)
  run.controller.setVisible(false)
  assert.equal(run.pushes.length, 0)
  assert.equal(run.controller.describe(), '桌宠已隐藏')
})

test('换局自动重订阅；不知道当前局时不订阅', () => {
  const run = harness()
  run.changeSession('s2')
  assert.deepEqual(run.pushes.map((entry) => entry.id), ['s2'])

  const empty = harness({ sessionId: '' })
  assert.equal(empty.pushes.length, 0)
  empty.setSession('s3')
  empty.controller.setSession('s3')
  assert.deepEqual(empty.pushes.map((entry) => entry.id), ['s3'])
})

test('呈现器只在提问时折叠，摘要最多 40 字，生成中不折叠', () => {
  const presenter = createGuidePresenter()
  assert.equal(presenter.id, 'workbench-question')
  assert.deepEqual(presenter.modes, ['card'])
  assert.equal(presenter.present({ text: QUESTION, streaming: true }), null)
  assert.deepEqual(presenter.present({ text: QUESTION, streaming: false }), { fold: { summary: '第 3 题：它默认该用什么文风？' } })
  assert.equal(presenter.present({ text: SUMMARY, streaming: false }), null)
  assert.equal(presenter.present({ text: DONE, streaming: false }), null)
  const long = QUESTION.replace('它默认该用什么文风？', '问'.repeat(60) + '？')
  assert.equal(presenter.present({ text: long, streaming: false }).fold.summary.length, '第 3 题：'.length + 40)
})
