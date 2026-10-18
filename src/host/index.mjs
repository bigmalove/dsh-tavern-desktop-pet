// 桌宠插件的宿主侧（Node）。
//
// 只做浏览器做不了的两件事：调模型、列可选模型。
//
// 吐槽优先走 `tavern.runTask`：用这局的后台模型，带人物卡/世界书/最近两轮，
// 请求会进这局的请求记录。它要求这一局在 DSH 里有活跃的前台 Agent；刚打开还没
// 发过言的局会报「前台会话不可用」，这时改走直连。
//
// 直连用 `llm` 服务自己发一次请求。模型来源有两处：
//   - 玩家在桌宠设置里指定了通道/模型（settings.commentModel）→ 用它；
//   - 没指定 → 跟随这局的后台模型（tavern.backgroundModel）。
// 后者在部分通道上会返回空内容（例如 deepseek-flash 直连），所以设置里留了
// 「挑一个模型」的入口。

export const name = 'dsh-tavern-desktop-pet'
export const inject = ['tavern']

const HANDLER_COMMENT = 'dsh-tavern-desktop-pet/comment'
const HANDLER_MODELS = 'dsh-tavern-desktop-pet/models'
const HANDLER_HISTORY = 'dsh-tavern-desktop-pet/history'
const MAX_PROMPT = 20000
const MAX_REPLY = 2000
const MAX_MODELS = 60

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
  function llmService() {
    const llm = ctx.get('llm')
    if (!llm) throw new Error('这台 DSH 没有可用的模型服务')
    return llm
  }

  /** 直连模型：不依赖前台会话，任何一局都能用。 */
  async function completeDirectly({ gameId, system, user, selection }) {
    const llm = llmService()

    let chosen = selection && selection.provider && selection.model ? selection : null
    if (!chosen) {
      const background = await ctx.tavern.backgroundModel({ gameId })
      if (background?.provider && background?.model) chosen = background
    }
    if (!chosen) throw new Error('这一局还没有选后台模型，请在「本局设置」里选一个')

    const config = { provider: chosen.provider, model: chosen.model }
    if (chosen.reasoningEffort) config.reasoningEffort = chosen.reasoningEffort

    const prepared = await llm.prepareCall(config)
    const messages = [
      {
        id: `desktop-pet-${Date.now()}`,
        role: 'user',
        content: [{ type: 'text', text: user }],
        source: { kind: 'plugin', plugin: name },
      },
    ]
    const stream = prepared.stream(
      Object.assign({}, prepared.config, {
        messages,
        system,
        // 官方 DeepSeek 适配器用 sessionId 收集插件包清单（请求扩展），
        // signal 则被扩展准备直接调用；两者缺一都会被报成
        // 「request extension preparation failed」，看不出真实原因。
        sessionId: gameId,
        signal: new AbortController().signal,
      }),
    )
    try {
      return normalize(await collect(stream))
    } catch (error) {
      const chain = []
      let cursor = error
      for (let depth = 0; cursor && depth < 5; depth += 1) {
        chain.push(String(cursor.message || cursor))
        cursor = cursor.cause
      }
      console.warn('[dsh-tavern-desktop-pet] 直连模型失败', {
        provider: chosen.provider,
        model: chosen.model,
        chain,
      })
      throw new Error(chain.join(' ← '))
    }
  }

  ctx.tavern.handle(HANDLER_COMMENT, async ({ gameId, system, user, selection }) => {
    const id = String(gameId || '').trim()
    if (!id) throw new Error('桌宠：缺少 gameId')

    const head = String(system || '').trim()
    const body = String(user || '').trim()
    if (!head && !body) throw new Error('桌宠：提示词为空')

    const prompt = (head && body ? `${head}\n\n${body}` : head || body).slice(0, MAX_PROMPT)
    const override = selection && selection.provider && selection.model ? selection : null

    // 玩家指定了模型就不要再走 runTask —— 那条路用的是后台模型，指定了也没用。
    if (!override) {
      try {
        const { text } = await ctx.tavern.runTask({ gameId: id, prompt })
        const value = normalize(text)
        if (value) return { text: value, via: 'task' }
      } catch (error) {
        // 前台会话不在时 runTask 一定失败，这不是错误，直接走直连。
        console.log('[dsh-tavern-desktop-pet] runTask 不可用，改直连模型：' + String(error?.message || error))
      }
    }

    const text = await completeDirectly({ gameId: id, system: head, user: body, selection: override })
    if (!text) throw new Error('模型没有返回内容')
    return { text, via: 'direct' }
  })

  // 设置面板里挑模型用：把这台机器上可用的通道与模型列出来。
  ctx.tavern.handle(HANDLER_MODELS, async () => {
    const llm = llmService()
    const providers = []
    for (const provider of llm.listProviders()) {
      let models = []
      try {
        models = (await llm.listModels(provider.id)).map((entry) => String(entry.id || '')).filter(Boolean)
      } catch (error) {
        console.warn('[dsh-tavern-desktop-pet] 列模型失败', provider.id, String(error?.message || error))
      }
      if (!models.length) continue
      providers.push({
        provider: provider.id,
        label: String(provider.displayName || provider.id),
        models: models.slice(0, MAX_MODELS),
      })
    }
    return { providers }
  })

  // 写作/剧本这类没有人物卡的局拿不到舞台快照（那要卡），退到按轮读正文。
  ctx.tavern.handle(HANDLER_HISTORY, async ({ gameId, limit }) => {
    const id = String(gameId || '').trim()
    if (!id) throw new Error('桌宠：缺少 gameId')
    const state = await ctx.tavern.getTurnState({ gameId: id }).catch((error) => {
      console.log('[dsh-tavern-desktop-pet] getTurnState 失败：' + String(error?.message || error))
      return null
    })
    const latest = Number(state?.turn || 0)
    const count = Math.max(1, Math.min(10, Number(limit) || 5))
    if (!latest) {
      console.log('[dsh-tavern-desktop-pet] 这一局还没有可读的轮次', { latest })
      return { turns: [] }
    }
    const from = Math.max(1, latest - count + 1)
    const turns = await ctx.tavern.getHistory({ gameId: id, from, to: latest }).catch((error) => {
      console.log('[dsh-tavern-desktop-pet] getHistory 失败：' + String(error?.message || error))
      return []
    })
    return {
      card: String(state?.card?.name || ''),
      turns: (turns || [])
        .map((entry) => ({ turn: Number(entry?.turn || 0), text: String(entry?.text || '').trim() }))
        .filter((entry) => entry.turn > 0 && entry.text),
    }
  })

  ctx.effect(() => () => {
    console.log('[dsh-tavern-desktop-pet] 宿主侧已卸载')
  })
}
