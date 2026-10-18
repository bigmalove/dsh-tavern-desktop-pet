// 桌宠插件的宿主侧（Node）。
//
// 只做一件浏览器做不了的事：调模型。桌宠的吐槽、手动聊天都从这里走。
//
// 两条路，先走后一条：
//   1. `tavern.runTask`：用这局的后台模型，带人物卡/世界书/最近两轮，
//      请求会进这局的请求记录。缺点是要这局在 DSH 里有活跃的前台 Agent——
//      刚打开还没发过言、或玩家只开了页面没动过时，DSH 会报「前台会话不可用」。
//   2. 直连：`tavern.backgroundModel` 取这局的后台模型，用 DSH 的 `llm` 服务
//      发一次普通请求。不带游戏背景，但任何时候都能用。
//
// 桌宠是随嘴吐槽，丢了就算了，所以第 2 条失败也不重试，把错误交给浏览器侧显示。

export const name = 'dsh-tavern-desktop-pet'
export const inject = ['tavern']

const HANDLER_COMMENT = 'dsh-tavern-desktop-pet/comment'
const MAX_PROMPT = 20000
const MAX_REPLY = 2000

function normalize(text) {
  return String(text || '').trim().slice(0, MAX_REPLY)
}

/** 把 DSH 的流式分块拼成纯文本。 */
async function collect(stream, signal) {
  let text = ''
  let failure = null
  for await (const chunk of stream) {
    signal?.throwIfAborted()
    if (chunk.type === 'text-delta') text += chunk.text
    else if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind !== 'stop') failure = chunk.reason
  }
  if (failure && failure.kind === 'error') {
    throw new Error('模型调用失败：' + String(failure.failure?.message || failure.failure?.code || '未知原因'))
  }
  return text
}

export function apply(ctx) {
  /** 直连模型：不依赖前台会话，任何一局都能用。 */
  async function completeDirectly({ gameId, system, user, signal }) {
    const llm = ctx.get('llm')
    if (!llm) throw new Error('这台 DSH 没有可用的模型服务')

    const selection = await ctx.tavern.backgroundModel({ gameId })
    if (!selection || !selection.provider || !selection.model) {
      throw new Error('这一局还没有选后台模型，请在「本局设置」里选一个')
    }

    const config = { provider: selection.provider, model: selection.model }
    if (selection.reasoningEffort) config.reasoningEffort = selection.reasoningEffort

    const prepared = await llm.prepareCall(config, signal)
    const messages = [
      {
        id: `desktop-pet-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text: user }],
        source: { kind: 'plugin', plugin: name },
      },
    ]
    const stream = prepared.stream(
      Object.assign(
        {},
        prepared.config,
        { messages, system },
        // 官方 DeepSeek 适配器要用 sessionId 收集插件包清单（请求扩展）；
        // 不传会让 prepareExtensions 抛错，报成「request extension preparation failed」。
        // signal 同理：扩展准备里直接调 request.signal.throwIfAborted()，缺了就炸。
        { sessionId: gameId, signal: signal || new AbortController().signal },
      ),
    )
    try {
      return normalize(await collect(stream, signal))
    } catch (error) {
      const chain = []
      let cursor = error
      for (let depth = 0; cursor && depth < 5; depth += 1) {
        chain.push(String(cursor.message || cursor))
        cursor = cursor.cause
      }
      console.warn('[dsh-tavern-desktop-pet] 直连模型失败', { provider: selection.provider, model: selection.model, chain })
      throw new Error(chain.join(' ← '))
    }
  }

  ctx.tavern.handle(HANDLER_COMMENT, async ({ gameId, system, user }) => {
    const id = String(gameId || '').trim()
    if (!id) throw new Error('桌宠：缺少 gameId')

    const head = String(system || '').trim()
    const body = String(user || '').trim()
    if (!head && !body) throw new Error('桌宠：提示词为空')

    const prompt = (head && body ? `${head}\n\n${body}` : head || body).slice(0, MAX_PROMPT)

    try {
      const { text } = await ctx.tavern.runTask({ gameId: id, prompt })
      const value = normalize(text)
      if (value) return { text: value, via: 'task' }
    } catch (error) {
      // 前台会话不在时 runTask 一定失败，这不是错误，直接走直连。
      ctx.logger?.info?.('[dsh-tavern-desktop-pet] runTask 不可用，改直连模型：' + String(error?.message || error))
    }

    const text = await completeDirectly({ gameId: id, system: head, user: body, signal: undefined }).catch(
      (error) => {
        const cause = error?.cause
        throw new Error(
          String(error?.message || error) +
            (cause ? `（${String(cause?.message || cause)}）` : '') +
            ` [provider=${error?.provider || '?'}]`,
        )
      },
    )
    if (!text) throw new Error('模型没有返回内容')
    return { text, via: 'direct' }
  })

  ctx.effect(() => () => {
    console.log('[dsh-tavern-desktop-pet] 宿主侧已卸载')
  })

  // 排查用：列一下这台机器上有哪些模型通道。玩家不需要它，只在日志里留一行。
  try {
    const llm = ctx.get('llm')
    const providers = llm?.listProviders?.() || []
    console.log(
      '[dsh-tavern-desktop-pet] 模型通道',
      providers.map((provider) => provider.id).join(', ') || '(无)',
    )
  } catch (error) {
    console.warn('[dsh-tavern-desktop-pet] 读取模型通道失败', String(error?.message || error))
  }
}
