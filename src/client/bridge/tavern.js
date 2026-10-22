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
  stageError: '',
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
    const sessions = state.sessions
    const snapshot = sessions?.list?.getSnapshot?.()
    // DSH 0.1.x: snapshot.current；0.2.x 删掉了顶层 current，「当前会话」是主视图
    // retain 的那一行（dsh-client-ui-workspace 的同一判据）。这里两种都认。
    if (snapshot) {
      for (const row of Object.values(snapshot.byId || {})) {
        if (row && row.retainedBy && (row.retainedBy.mainView ?? 0) > 0) return String(row.id || '')
      }
      if (typeof snapshot.current === 'string' && snapshot.current) return snapshot.current
    }
    if (sessions && typeof sessions.current === 'string' && sessions.current) return String(sessions.current)
    return ''
  } catch {
    return ''
  }
}

function subscribeSessions() {
  const list = state.sessions?.list
  if (!list || state.stopSessions) return
  // 「当前会话」在 0.2.x 由主视图的 retain 推导，列表订阅不一定在切换时触发；
  // 订阅之外再留一个便宜的轮询，只在会话真的换了才广播。
  let unsubscribe = null
  if (typeof list.subscribe === 'function') {
    const stop = list.subscribe(() => publishGame())
    unsubscribe = typeof stop === 'function' ? stop : null
  }
  const timer = window.setInterval(publishGame, 1500)
  state.stopSessions = () => {
    if (unsubscribe) unsubscribe()
    window.clearInterval(timer)
  }
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
    // 写作/剧本这类没有卡的局，舞台接口一定拒绝；记一次就够了，别每轮刷屏。
    if (state.stageError !== String(error?.message || error)) {
      state.stageError = String(error?.message || error)
      log('这一局没有舞台快照，改用按轮读正文：', state.stageError)
    }
    state.stage = null
    state.stageAt = 0
    return null
  }
}

/**
 * 这一局的最近几轮，形状和上游 `_getChatContext` 期望的一致：
 * `[{ role, name, message }]`。玩家输入按 user，正文按 assistant。
 *
 * 有卡的局用舞台快照（带台词标注，还能给配音用）；没有卡的局（写作、剧本）
 * 舞台接口会拒绝，退回宿主侧的按轮读取。
 */
export async function getRecentMessages(limit = 20) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20

  const stage = await getStage(Math.min(10, safeLimit))
  const stageTurns = Array.isArray(stage?.turns) ? stage.turns : []

  if (stageTurns.length) {
    const cardName = String(stage.card?.name || '').trim() || '角色'
    return stageTurns
      .map((turn) => String(turn?.text || '').trim())
      .filter(Boolean)
      .slice(-safeLimit)
      .map((text) => ({ role: 'assistant', name: cardName, message: text }))
  }

  const gameId = state.gameId
  if (!gameId || !state.tavernUi) return []
  try {
    const reply = await callHost('dsh-tavern-desktop-pet/history', { gameId, limit: safeLimit })
    const cardName = String(reply?.card || '').trim() || '角色'
    return (reply?.turns || [])
      .map((entry) => String(entry?.text || '').trim())
      .filter(Boolean)
      .slice(-safeLimit)
      .map((text) => ({ role: 'assistant', name: cardName, message: text }))
  } catch (error) {
    warn('读取最近几轮失败', error)
    return []
  }
}

/** 只管「一轮开始 / 一轮写完」两件事；换局自动重订阅。 */
export function watchTurns({ onStart, onSettled }) {
  state.watchTurn = typeof onStart === 'function' ? onStart : null
  state.watchSettled = typeof onSettled === 'function' ? onSettled : null
  rewatchTurns()
  return stopTurnWatch
}

/**
 * 最新一条回复（含卡片工作台），Tavern 第 6 版插件接口。返回取消函数；
 * 接口不存在时返回空取消函数，引导员据此静默。
 */
export function watchReply(gameId, listener) {
  const id = String(gameId || '')
  if (!id || !state.tavernUi || typeof state.tavernUi.watchReply !== 'function') return () => {}
  try {
    const stop = state.tavernUi.watchReply(id, listener)
    return typeof stop === 'function' ? stop : () => {}
  } catch (error) {
    warn('订阅最新回复失败', error)
    return () => {}
  }
}

export function apiVersion() {
  try {
    return Number(state.tavernUi?.apiVersion) || 0
  } catch {
    return 0
  }
}

/** 工作台里点选项：按玩家输入发送（和手打字母一致）。 */
export function submitChoice(text) {
  const body = String(text || '').trim()
  if (!body) return Promise.resolve(false)
  const gameId = state.gameId
  if (!gameId || !state.tavernUi) return Promise.reject(new Error('这一局没有在当前页面打开'))
  return state.tavernUi.submitInput({ gameId, text: body })
}

/** 「你定」类选项：只把输入框清空并聚焦，让玩家自己写。 */
export function fillInput(text) {
  const gameId = state.gameId
  if (!gameId || !state.tavernUi) throw new Error('这一局没有在当前页面打开')
  state.tavernUi.setInput({ gameId, text: String(text ?? '') })
  focusComposer()
}

/** Tavern 的输入器可能是 textarea，也可能是 contenteditable。 */
export function focusComposer() {
  try {
    const input = document.querySelector("[data-composer-card] :is(textarea, [contenteditable='true'])")
    input?.focus?.()
    if (input && 'select' in input && typeof input.select === 'function') input.select()
  } catch {
    // ignore
  }
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

/** 桌宠的中文情绪标签 → Tavern 用的 ST 28 情绪名。对不上的不传，由渠道自己判断。 */
const EMOTION_TO_STANDARD = {
  默认: 'neutral',
  微笑: 'joy',
  生气: 'anger',
  难过: 'sadness',
  惊讶: 'surprise',
  嘲讽: 'smirk',
  害羞: 'embarrassment',
  思考: 'thinking',
  大笑: 'amusement',
  搞怪: 'playfulness',
}

export function standardEmotion(tag) {
  const key = String(tag || '').trim()
  return EMOTION_TO_STANDARD[key] || undefined
}

export function stopSpeaking() {
  try {
    state.tavernUi?.stopSpeech?.()
  } catch {
    // ignore
  }
}

/** 本插件在 Tavern 里的名字；占用锁的 holder 与它比较。 */
export const PLUGIN_NAME = 'dsh-tavern-desktop-pet'

/**
 * 这一局的工作状态（Tavern 第 7 版）。接口不存在时返回空取消函数，
 * 桌宠照旧按回合吐槽，不报错。
 */
export function watchWorkStatus(gameId, listener) {
  const id = String(gameId || '')
  if (!id || !state.tavernUi || typeof state.tavernUi.watchWorkStatus !== 'function') return () => {}
  try {
    // 自己的回调出错不该冒到 Tavern 的插件接口里：只记一条日志，状态照常收。
    const stop = state.tavernUi.watchWorkStatus(id, (status) => {
      try {
        listener(status)
      } catch (error) {
        warn('工作状态回调失败', error)
      }
    })
    return typeof stop === 'function' ? stop : () => {}
  } catch (error) {
    warn('订阅工作状态失败', error)
    return () => {}
  }
}

/**
 * 拿这一局 voice 的占用锁。拿不到（别的插件占着 / 旧版 Tavern / 没有当前局）
 * 返回 null；调用方照常工作，只是别人不知道声音归它。
 */
export function acquireVoiceLease(ttlMs = 120000) {
  const gameId = state.gameId
  if (!gameId || !state.tavernUi || typeof state.tavernUi.acquireLease !== 'function') return null
  try {
    return state.tavernUi.acquireLease({ sessionId: gameId, scope: 'voice', ttlMs, reason: '卡片工作台引导' })
  } catch (error) {
    warn('占用 voice 失败', error)
    return null
  }
}

/** 续期；锁已经丢了返回 false，调用方据此重拿。 */
export function renewVoiceLease(lease, ttlMs = 120000) {
  try {
    lease?.renew?.(ttlMs)
    return true
  } catch {
    return false
  }
}

export function releaseVoiceLease(lease) {
  try {
    lease?.release?.()
  } catch {
    // ignore
  }
}

/** 别的插件正占着这一局的 voice；返回那把锁的快照，没有（或持有者是自己）返回 null。 */
export function foreignVoiceLease() {
  const gameId = state.gameId
  if (!gameId || !state.tavernUi || typeof state.tavernUi.getLease !== 'function') return null
  try {
    const lease = state.tavernUi.getLease(gameId, 'voice')
    return lease && lease.holder !== PLUGIN_NAME ? lease : null
  } catch {
    return null
  }
}
