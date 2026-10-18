// Tavern 桥：桌宠用到的每一件外部事实都从这里拿。
//
// 上游把这些分散在酒馆事件、全局上下文、页面 DOM 里；这里统一换成
// Tavern 的插件接口（ctx.tavernUi）和 DSH 自己的会话服务（ctx.sessions）。
// 桌宠其余代码只依赖本文件，不直接碰 Tavern。

import { setStageSnapshot } from './shims.js'

const state = {
  tavernUi: null,
  sessions: null,
  gameId: '',
  stage: null,
  stageAt: 0,
  gameListeners: new Set(),
  stopSessions: null,
  stopWatch: null,
  watchTurn: null,
  watchSettled: null,
  watchedGameId: '',
}

const log = (...args) => console.log('[dsh-tavern-desktop-pet]', ...args)
const warn = (...args) => console.warn('[dsh-tavern-desktop-pet]', ...args)

/** 由 main.js 在 apply 时调用一次。 */
export function attachTavern({ tavernUi, sessions }) {
  state.tavernUi = tavernUi || null
  state.sessions = sessions || null
  state.gameId = readGameId()
  subscribeSessions()
  log('已接入 Tavern', { gameId: state.gameId || '(未打开)', sessions: Boolean(sessions) })
  return state.gameId
}

export function detachTavern() {
  try {
    state.stopSessions?.()
  } catch {
    // ignore
  }
  state.stopSessions = null
  stopTurnWatch()
  state.tavernUi = null
  state.sessions = null
  state.gameListeners.clear()
}

export function tavernUi() {
  return state.tavernUi
}

function readGameId() {
  try {
    const snapshot = state.sessions?.list?.getSnapshot?.()
    return String(snapshot?.current || '')
  } catch {
    return ''
  }
}

function subscribeSessions() {
  const list = state.sessions?.list
  if (!list || state.stopSessions) return
  if (typeof list.subscribe === 'function') {
    const unsubscribe = list.subscribe(() => publishGame())
    state.stopSessions = typeof unsubscribe === 'function' ? unsubscribe : () => {}
    return
  }
  // 没有订阅能力时退化轮询：只在会话真的换了才广播。
  const timer = window.setInterval(publishGame, 1500)
  state.stopSessions = () => window.clearInterval(timer)
}

function publishGame() {
  const next = readGameId()
  if (next === state.gameId) return
  const previous = state.gameId
  state.gameId = next
  state.stage = null
  state.stageAt = 0
  // 换局就重挂回合监听，避免把上一局的 busy 变化算进来。
  if (state.watchedGameId) rewatchTurns()
  log('当前局变化', { from: previous, to: next })
  for (const listener of state.gameListeners) {
    try {
      listener(next, previous)
    } catch (error) {
      warn('局变化回调失败', error)
    }
  }
}

export function currentGameId() {
  return state.gameId
}

export function onGameChange(listener) {
  state.gameListeners.add(listener)
  return () => state.gameListeners.delete(listener)
}

/** 这一局的舞台快照：玩家名、卡名、人物素材、最近几轮正文。取不到时给空壳。 */
export async function getStage(count = 5) {
  const gameId = state.gameId
  if (!gameId || !state.tavernUi) return null
  const fresh = state.stage && Date.now() - state.stageAt < 4000
  if (fresh && state.stage?.gameId === gameId) return state.stage
  try {
    const stage = await state.tavernUi.getStage(gameId, { count })
    if (!stage) return null
    state.stage = { ...stage, gameId }
    state.stageAt = Date.now()
    setStageSnapshot(stage)
    return state.stage
  } catch (error) {
    warn('读取舞台数据失败', error)
    return null
  }
}

/**
 * 这一局的最近几轮，形状和上游 `_getChatContext` 期望的一致：
 * `[{ role, name, message }]`。玩家输入按 user，正文按 assistant。
 */
export async function getRecentMessages(limit = 20) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20
  const stage = await getStage(Math.min(10, safeLimit))
  if (!stage) return []
  const cardName = String(stage.card?.name || '').trim() || '角色'
  const turns = Array.isArray(stage.turns) ? stage.turns : []
  const list = []
  for (const turn of turns) {
    const text = String(turn?.text || '').trim()
    if (!text) continue
    list.push({ role: 'assistant', name: cardName, message: text })
  }
  return list.slice(-safeLimit)
}

/** 只管「一轮开始 / 一轮写完」两件事；换局自动重订阅。 */
export function watchTurns({ onStart, onSettled }) {
  state.watchTurn = typeof onStart === 'function' ? onStart : null
  state.watchSettled = typeof onSettled === 'function' ? onSettled : null
  rewatchTurns()
  return stopTurnWatch
}

function stopTurnWatch() {
  try {
    state.stopWatch?.()
  } catch {
    // ignore
  }
  state.stopWatch = null
  state.watchedGameId = ''
  state.watchTurn = null
  state.watchSettled = null
}

function rewatchTurns() {
  try {
    state.stopWatch?.()
  } catch {
    // ignore
  }
  state.stopWatch = null

  const gameId = state.gameId
  if (!gameId || !state.tavernUi) {
    state.watchedGameId = ''
    return
  }

  let lastBusy = null
  let lastTurn = null
  let lastSettledKey = ''

  const listener = (snapshot) => {
    if (!snapshot) return
    const busy = snapshot.busy === true || snapshot.generating === true || snapshot.settling === true
    const turn = Number(snapshot.turn || 0)

    if (lastBusy === null) {
      lastBusy = busy
      lastTurn = turn
      return
    }

    if (busy && !lastBusy) {
      // 从空闲变忙 = 玩家提交了一轮
      try {
        state.watchTurn?.(turn)
      } catch (error) {
        warn('回合开始回调失败', error)
      }
    }

    if (!busy && lastBusy) {
      // 从忙变闲且这一轮结算完 = 正文写完
      const settledKey = `${turn}:${snapshot.textVersion || ''}`
      if (snapshot.settled !== false && settledKey !== lastSettledKey) {
        lastSettledKey = settledKey
        try {
          state.watchSettled?.(turn, snapshot)
        } catch (error) {
          warn('回合结束回调失败', error)
        }
      }
    }

    lastBusy = busy
    lastTurn = turn
  }

  try {
    const stop = state.tavernUi.watchTurnState(gameId, listener)
    state.stopWatch = typeof stop === 'function' ? stop : () => {}
    state.watchedGameId = gameId
    log('已监听回合状态', { gameId })
  } catch (error) {
    warn('监听回合状态失败', error)
  }
}

/** 调宿主侧注册的处理函数。 */
export async function callHost(name, args) {
  if (!state.tavernUi) throw new Error('桌宠插件还没接入 Tavern')
  return state.tavernUi.callHost(name, args)
}

/** 念一句。Tavern 负责选渠道、声音和缓存。 */
export async function speak({ text, speaker, emotion, narration }) {
  const gameId = state.gameId
  const body = String(text || '').trim()
  if (!gameId || !body || !state.tavernUi) return false
  try {
    return await state.tavernUi.speak({
      gameId,
      speaker: String(speaker || '').trim() || undefined,
      text: body,
      emotion: emotion || undefined,
      narration: narration === true,
    })
  } catch (error) {
    warn('朗读失败', error)
    return false
  }
}

export function stopSpeaking() {
  try {
    state.tavernUi?.stopSpeech?.()
  } catch {
    // ignore
  }
}
