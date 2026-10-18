// SillyTavern 环境垫片（临时桥）。
//
// 上游 tavern-desktop-pet 是一个酒馆（SillyTavern）扩展：它依赖一批由酒馆/酒馆助手
// 注入到页面上的全局函数和对象（`toastr`、`SillyTavern`、`getChatMessages`、
// `getVariables`、`eventOn` …）。这份垫片把那些全局补上最小可用的实现，
// 让上游的界面、Live2D、配音、设置代码原样跑起来。
//
// 分工：
//   - 真正参与玩法逻辑的（聊天监听、模型调用）**不走垫片**，由 ./tavern.js 接
//     Tavern 的插件接口重写（见 pet/chat/monitor.ts、pet/chat/commentator.ts）。
//   - 只影响显示与持久化的（提示气泡、设置读写）走垫片，行为等价即可。
//
// 之所以集中在一个文件，是为了以后要找「还有哪些酒馆依赖」时只看这一处。

const SCRIPT_ID = 'dsh-tavern-desktop-pet'
const STORAGE_PREFIX = `${SCRIPT_ID}:`

function storageGet(key, fallback) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value))
  } catch {
    // 存储满了或被禁用：设置退回默认值，不影响桌宠本体
  }
}

// ── 提示气泡 ────────────────────────────────────────────────────────────────
// 上游 70 处 toastr.xxx。这里自绘一个小气泡，样式跟着 DSH 的颜色变量走。
const TOAST_STYLE_ID = `${SCRIPT_ID}-toast-style`
const TOAST_HOST_ID = `${SCRIPT_ID}-toast-host`

function ensureToastHost() {
  let host = document.getElementById(TOAST_HOST_ID)
  if (host) return host

  if (!document.getElementById(TOAST_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = TOAST_STYLE_ID
    style.textContent = `
#${TOAST_HOST_ID}{position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:2400;
  display:flex;flex-direction:column;gap:6px;align-items:center;pointer-events:none}
#${TOAST_HOST_ID} .pet-toast{max-width:min(560px,86vw);padding:7px 12px;border-radius:10px;
  font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--color-text-primary,#1c1c1a);
  background:var(--color-background-primary,#fff);border:1px solid var(--color-border-secondary,rgba(0,0,0,.18));
  box-shadow:0 2px 10px rgba(0,0,0,.10);opacity:0;transform:translateY(-4px);transition:opacity .16s,transform .16s}
#${TOAST_HOST_ID} .pet-toast[data-in]{opacity:1;transform:none}
#${TOAST_HOST_ID} .pet-toast[data-level="error"]{border-color:var(--color-border-danger,rgba(190,40,40,.5))}
#${TOAST_HOST_ID} .pet-toast[data-level="warning"]{border-color:var(--color-border-warning,rgba(170,120,20,.5))}
`
    ;(document.head || document.documentElement).appendChild(style)
  }

  host = document.createElement('div')
  host.id = TOAST_HOST_ID
  document.body.appendChild(host)
  return host
}

function pushToast(level, message, timeout) {
  const text = String(message ?? '').trim()
  if (!text) return
  const host = ensureToastHost()
  const node = document.createElement('div')
  node.className = 'pet-toast'
  node.dataset.level = level
  node.textContent = text
  host.appendChild(node)
  requestAnimationFrame(() => node.setAttribute('data-in', ''))
  window.setTimeout(() => {
    node.removeAttribute('data-in')
    window.setTimeout(() => node.remove(), 200)
  }, Number.isFinite(timeout) ? timeout : 3200)
}

const toastr = {
  success: (message) => pushToast('success', message),
  info: (message) => pushToast('info', message),
  warning: (message) => pushToast('warning', message),
  error: (message) => pushToast('error', message),
  clear: () => document.getElementById(TOAST_HOST_ID)?.replaceChildren(),
  remove: () => document.getElementById(TOAST_HOST_ID)?.remove(),
}

// ── 酒馆上下文 ──────────────────────────────────────────────────────────────
// 只读用途：角色名（配音的说话人标识）、玩家名。真实数据由 ./tavern.js 的
// stage 快照填进来，取不到时用占位。
const stageSnapshot = { card: '', player: '', characters: [] }

export function setStageSnapshot(next) {
  stageSnapshot.card = String(next?.card?.name || next?.card || '').trim()
  stageSnapshot.player = String(next?.player || '').trim()
  stageSnapshot.characters = Array.isArray(next?.characters) ? next.characters : []
}

const SillyTavern = {
  getContext: () => ({
    characterId: stageSnapshot.card || 'default',
    name1: stageSnapshot.player || '玩家',
    name2: stageSnapshot.card || '角色',
    characters: stageSnapshot.characters,
    chat: [],
    chatId: '',
    extensionSettings: {},
    eventSource: { on() {}, off() {}, emit() {} },
  }),
  getRequestHeaders: () => ({}),
  getCurrentChatId: () => '',
  eventTypes: {},
  eventSource: { on() {}, off() {}, emit() {} },
  libs: {},
}

// ── 事件系统 ────────────────────────────────────────────────────────────────
// 上游把「又发生了一轮」挂在酒馆事件上；这部分已经改由 Tavern 的
// watchTurnState 驱动（见 pet/chat/monitor.ts）。这里留空实现，只为让残留的
// eventOn(...) 调用点不报错。
const noopStop = { stop() {} }

function eventOn() {
  return noopStop
}

function eventOnce() {
  return noopStop
}

function eventEmit() {}

function makeKeyProxy(name) {
  return new Proxy(
    {},
    {
      get: (_target, key) => (typeof key === 'string' ? `${name}:${key}` : undefined),
      has: () => true,
    },
  )
}

// ── 脚本变量（设置持久化）────────────────────────────────────────────────────
// 上游用酒馆助手的 getVariables/replaceVariables 存设置。换成 localStorage，
// 同一浏览器同一 origin 内持久。
const variableBag = { value: storageGet('variables', {}) }

function getVariables() {
  return JSON.parse(JSON.stringify(variableBag.value))
}

function replaceVariables(value) {
  variableBag.value = JSON.parse(JSON.stringify(value ?? {}))
  storageSet('variables', variableBag.value)
  return variableBag.value
}

function insertOrAssignVariables(partial) {
  return replaceVariables({ ...variableBag.value, ...(partial || {}) })
}

function getScriptId() {
  return SCRIPT_ID
}

// ── jQuery 的极小替身 ────────────────────────────────────────────────────────
// 上游只剩实时拖拽还写着 jQueryUI：`$(container).draggable({...})`，拿不到
// draggable 时会自己走 `_enablePointerDrag`（原生 pointer events）。这里给一个
// 没有 draggable 的壳，正好让它落到原生实现上，不必把 jQuery + jQueryUI 塞进来。
function jqueryLite(target) {
  const element = typeof target === 'string' ? document.querySelector(target) : target
  const api = {
    0: element,
    length: element ? 1 : 0,
    addClass(name) {
      try {
        element?.classList?.add(String(name))
      } catch {
        // ignore
      }
      return api
    },
    removeClass(name) {
      try {
        element?.classList?.remove(String(name))
      } catch {
        // ignore
      }
      return api
    },
    hasClass(name) {
      try {
        return Boolean(element?.classList?.contains(String(name)))
      } catch {
        return false
      }
    },
    attr(name, value) {
      try {
        if (value === undefined) return element?.getAttribute?.(String(name)) ?? undefined
        element?.setAttribute?.(String(name), String(value))
      } catch {
        // ignore
      }
      return api
    },
    remove() {
      try {
        element?.remove?.()
      } catch {
        // ignore
      }
      return api
    },
    on() {
      return api
    },
    off() {
      return api
    },
  }
  return api
}

// ── 其它 ────────────────────────────────────────────────────────────────────
function getChatMessages() {
  // 上游只用它读「第三方手机扩展」的聊天记录；那些扩展在 Tavern 里不存在，
  // 返回空数组即等于整条分支自动失效，不会抛错。
  return []
}

function getLastMessageId() {
  return 0
}

function generateRaw() {
  throw new Error('桌宠插件：正文生成请走 Tavern 的插件接口（tavern.runTask）')
}

const registry = {
  $: jqueryLite,
  jQuery: jqueryLite,
  toastr,
  SillyTavern,
  eventOn,
  eventOnce,
  eventEmit,
  tavern_events: makeKeyProxy('tavern_events'),
  iframe_events: makeKeyProxy('iframe_events'),
  getVariables,
  replaceVariables,
  insertOrAssignVariables,
  getScriptId,
  getChatMessages,
  getLastMessageId,
  generateRaw,
  name1: '玩家',
}

export function installSillyTavernShims(target = window) {
  for (const [key, value] of Object.entries(registry)) {
    if (target[key] === undefined) target[key] = value
  }
  return registry
}

export function uninstallSillyTavernShims(target = window) {
  for (const key of Object.keys(registry)) {
    if (target[key] === registry[key]) delete target[key]
  }
  document.getElementById(TOAST_HOST_ID)?.remove()
  document.getElementById(TOAST_STYLE_ID)?.remove()
}
