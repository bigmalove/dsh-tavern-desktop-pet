// 桌宠插件的浏览器侧入口。
//
// 上游（tavern-desktop-pet）是一个酒馆扩展：由酒馆把 index.ts 当脚本加载，自己
// 找 #extensionsMenu 插菜单、挂 <div id="desktop-pet-app">。这里换成 Tavern 的
// 客户端插件：cordis 调 apply(ctx)，我们从 ctx.tavernUi 拿接口，自己建根节点。
//
// 上游的「桌面宠物设置」菜单项在 Tavern 里没有对应物，改成两处入口：
//   - 右侧栏「插件」组里的一页「桌宠」（registerPanel）
//   - 输入框上方的「逗一下」按钮（registerComposerAction）
//
// 生命周期：
//   apply → 装全局垫片、接 Tavern 桥、挂 Vue 应用、注册面板与按钮
//   卸载   → 卸 Vue、断监听、删根节点与样式

import { createPinia } from 'pinia'
import React from 'react'
import { createApp } from 'vue'
import { getVariables, installSillyTavernShims, onVariablesChanged, uninstallSillyTavernShims } from './bridge/shims.js'
import { attachTavern, detachTavern } from './bridge/tavern.js'
import { clearPetActions, openPetSettings, petActions, teasePet } from './bridge/actions.js'
import { createGuidePresenter } from './guide/presenter.js'
import { guide } from './guide/session.js'
import { Live2DManager } from './pet/live2d/manager'
import { DEFAULTS } from './pet/core/constants'
import {
  BUNDLED_MODELS,
  getBundledModelUrl,
  resolveBundledModelUrl,
  setBundledModelUrls,
} from './pet/core/bundled-model'
import { useSettingsStore } from './pet/core/settings'
import GuideDock from './pet/ui/GuideDock.vue'
import PetContainer from './pet/ui/PetContainer.vue'

export const name = 'dsh-tavern-desktop-pet'
// tavernUi 是 Tavern 在浏览器侧 provide 的插件接口服务；sessions 是 DSH 自己的
// 会话服务（Tavern 本体也 inject 了它）。两者都在同一个 cordis 上下文里。
export const inject = ['tavernUi', 'sessions']

const ROOT_ID = 'desktop-pet-root'

const ROOT_STYLE = `
#${ROOT_ID}{position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:1200}
#${ROOT_ID} *{box-sizing:border-box}
/* 设置/模型库是覆盖整个视口的浮层，但根节点自己是一个 stacking context，
   舞台里的桌宠又和它同级；打开浮层时把整个根节点抬到桌宠之上。 */
#${ROOT_ID}:has(.chat-bubble){z-index:1300}
#${ROOT_ID}:has(.menu-overlay){z-index:1400}
#${ROOT_ID}:has(.settings-overlay),#${ROOT_ID}:has(.browser-overlay){z-index:1600}
`

// 侧栏「桌宠」页：只用 DSH 的设计令牌，跟原生设置面板一样随皮肤 / 深浅色切换。
const PANEL_CSS = `
.pet-panel{display:flex;flex-direction:column;gap:10px;padding:2px;font-size:13px;line-height:1.6;
  font-family:var(--dsw-font-family,system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif);
  color:var(--dsw-alias-label-primary,#141413)}
.pet-panel-desc{color:var(--dsw-alias-label-secondary,#6c6a64);font-size:12.5px;line-height:1.6}
.pet-panel-row{display:flex;gap:8px;flex-wrap:wrap}
.pet-panel button{display:inline-flex;align-items:center;justify-content:center;height:32px;padding:0 14px;
  border-radius:var(--dsw-radius-md,12px);cursor:pointer;font:inherit;font-size:12.5px;font-weight:500;
  border:0.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-bg-layer-3,#fff);
  color:var(--dsw-alias-label-primary,#141413);
  transition:background .15s ease,border-color .15s ease,color .15s ease}
.pet-panel button:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  border-color:var(--dsw-alias-border-l2,#e6dfd8)}
.pet-panel button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#cc785c);outline-offset:2px}
.pet-panel-field{display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary,#827d75)}
.pet-panel-field>span{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#141413)}
.pet-panel-field select{width:100%;height:34px;padding:0 10px;border-radius:var(--dsw-radius-md,12px);
  font:inherit;font-size:13px;border:0.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.16));
  background:var(--dsw-specific-input-major,#fff);color:var(--dsw-alias-label-primary,#141413)}
.pet-panel-field select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary,#cc785c);
  box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary,#cc785c) 22%,transparent)}
.pet-panel-hint{margin-top:2px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#827d75)}
.pet-panel-check{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;line-height:1.5;
  color:var(--dsw-alias-label-secondary,#6c6a64);cursor:pointer}
.pet-panel-check input{flex:none;width:16px;height:16px;margin:1px 0 0;accent-color:var(--dsw-alias-brand-primary,#cc785c)}
.pet-guide-dock-host{width:100%;min-width:0}
`

function ensureRootStyle() {
  const id = `${ROOT_ID}-base-style`
  if (document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = ROOT_STYLE + PANEL_CSS
  ;(document.head || document.documentElement).appendChild(style)
}

/** 侧栏「插件」组里的桌宠页：状态 + 打开设置 + 逗一下 + 挑吐槽模型。 */
function PetPanel(ctx) {
  return function PetPanelView() {
    const [status, setStatus] = React.useState(() => petActions.describe())
    const [visible, setVisible] = React.useState(() => petActions.isVisible())
    const [catalog, setCatalog] = React.useState(null)
    const [choice, setChoice] = React.useState(() => petActions.commentModel() || { provider: '', model: '' })
    const [guide, setGuide] = React.useState(() => petActions.guideSettings?.() || { enabled: true, fold: true })
    const [guideState, setGuideState] = React.useState(() => petActions.guideStatus?.() || '')
    const [work, setWork] = React.useState(() => petActions.workStatusLabel?.() || '')

    React.useEffect(() => {
      const timer = setInterval(() => {
        setStatus(petActions.describe())
        setVisible(petActions.isVisible())
        setGuide(petActions.guideSettings?.() || { enabled: true, fold: true })
        setGuideState(petActions.guideStatus?.() || '')
        setWork(petActions.workStatusLabel?.() || '')
      }, 1500)
      return () => clearInterval(timer)
    }, [])

    React.useEffect(() => {
      let alive = true
      ctx.tavernUi
        .callHost('dsh-tavern-desktop-pet/models', {})
        .then((reply) => {
          if (alive) setCatalog(reply?.providers || [])
        })
        .catch((error) => {
          if (alive) setCatalog({ error: String(error?.message || error) })
        })
      return () => {
        alive = false
      }
    }, [])

    const pick = (event) => {
      const [provider, model] = String(event.target.value || '').split('\n')
      const next = { provider, model }
      setChoice(next)
      petActions.setCommentModel(next)
    }

    const options = [{ value: '\n', label: '跟随本局后台模型' }]
    if (Array.isArray(catalog)) {
      for (const entry of catalog) {
        for (const model of entry.models) {
          options.push({ value: `${entry.provider}\n${model}`, label: `${entry.label} · ${model}` })
        }
      }
    }

    return React.createElement(
      'div',
      { className: 'pet-panel' },
      React.createElement('div', { className: 'pet-panel-desc' }, status || '桌宠正在启动…'),
      ctx.tavernUi.apiVersion >= 7
        ? React.createElement('div', { className: 'pet-panel-hint' }, `工作状态：${work || '空闲'}`)
        : null,
      React.createElement(
        'div',
        { className: 'pet-panel-row' },
        React.createElement('button', { type: 'button', onClick: () => openPetSettings() }, '打开设置'),
        React.createElement('button', { type: 'button', onClick: () => teasePet() }, '逗一下'),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => (visible ? petActions.hide?.() : petActions.show?.()),
          },
          visible ? '隐藏桌宠' : '显示桌宠',
        ),
      ),
      React.createElement(
        'label',
        { className: 'pet-panel-field' },
        React.createElement('span', null, '吐槽用的模型'),
        React.createElement(
          'select',
          {
            value: `${choice.provider || ''}\n${choice.model || ''}`,
            onChange: pick,
            disabled: !Array.isArray(catalog),
          },
          options.map((option) =>
            React.createElement('option', { key: option.value, value: option.value }, option.label),
          ),
        ),
      ),
      Array.isArray(catalog) && catalog.length === 0
        ? React.createElement('div', { className: 'pet-panel-hint' }, '这台机器上还没配置模型通道。')
        : null,
      catalog && !Array.isArray(catalog)
        ? React.createElement('div', { className: 'pet-panel-hint' }, `读取模型列表失败：${catalog.error || ''}`)
        : null,
      // 卡片工作台引导：只在 Tavern 第 6 版接口可用时出现。
      ctx.tavernUi.apiVersion >= 6
        ? React.createElement(
            'div',
            { className: 'pet-panel-field' },
            React.createElement('span', null, '卡片工作台引导'),
            React.createElement(
              'label',
              { className: 'pet-panel-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: guide.enabled,
                onChange: (event) => {
                  const next = { ...guide, enabled: event.target.checked }
                  setGuide(next)
                  petActions.setGuideSettings?.(next)
                },
              }),
              '让桌宠念建卡的提问、选项变按钮',
            ),
            React.createElement(
              'label',
              { className: 'pet-panel-check' },
              React.createElement('input', {
                type: 'checkbox',
                checked: guide.fold,
                onChange: (event) => {
                  const next = { ...guide, fold: event.target.checked }
                  setGuide(next)
                  petActions.setGuideSettings?.(next)
                },
              }),
              '提问在主区折叠成一行',
            ),
            React.createElement('div', { className: 'pet-panel-hint' }, guideState || '不在卡片工作台'),
          )
        : React.createElement('div', { className: 'pet-panel-hint' }, 'Tavern 版本较旧，卡片工作台引导不可用。'),
      React.createElement(
        'div',
        { className: 'pet-panel-hint' },
        '长按桌宠可打开功能菜单；双击桌宠立刻吐槽一次。设置面板里可以换模型、调大小和吐槽风格。',
      ),
    )
  }
}

export function apply(ctx) {
  installSillyTavernShims()
  ensureRootStyle()

  // 同一个页面重新加载插件时，先把上一份根节点清掉，避免双份桌宠。
  document.getElementById(ROOT_ID)?.remove()

  const root = document.createElement('div')
  root.id = ROOT_ID
  document.body.appendChild(root)

  const gameId = attachTavern({ tavernUi: ctx.tavernUi, sessions: ctx.sessions })

  const pinia = createPinia()
  // 内置形象：插件自带的大肥鱼 Live2D 三套装扮（女仆 / Claude / 铁盆，assets/live2d/）。
  // 旧版默认是 CDN 上的 shizuku，装过旧版的用户把那个默认值迁过来；玩家选过的内置
  // 装扮则跟着当前运行时地址走（换端口/插件目录后旧地址会失效）。
  try {
    if (typeof ctx.tavernUi.assetUrl === 'function') {
      const bundledModelUrls = {}
      for (const model of BUNDLED_MODELS) {
        const assetPath = ctx.tavernUi.assetUrl(model.asset)
        if (!assetPath) continue
        bundledModelUrls[model.id] = new URL(assetPath, window.location.href).href
      }
      setBundledModelUrls(bundledModelUrls)

      const settingsStore = useSettingsStore(pinia)
      const current = String(settingsStore.settings.modelPath || '')
      const migrated = resolveBundledModelUrl(current)
      const fallback =
        current === '' || current === DEFAULTS.MODEL_PATH ? getBundledModelUrl() : ''
      const next = migrated || fallback
      // 旧默认值、空值，以及换端口/来源前的内置模型地址，都归到当前地址；
      // 自己挑过（非内置）的模型保持不动。
      if (next && next !== current) {
        settingsStore.updateSettings({ modelPath: next })
        console.log('[dsh-tavern-desktop-pet] 内置形象地址已同步', { from: current, to: next })
      }
    }
  } catch (error) {
    console.warn('[dsh-tavern-desktop-pet] 内置模型地址准备失败，继续用原模型', error)
  }
  const app = createApp(PetContainer)
  app.use(pinia)
  app.config.errorHandler = (error, _instance, info) => {
    console.error('[dsh-tavern-desktop-pet] Vue error:', info, error)
  }
  app.mount(root)

  const disposers = []

  // 卡片工作台：桌宠、气泡和选项停靠到输入框上方（Tavern 第 6 版的 composer slot）。
  if (Number(ctx.tavernUi.apiVersion || 0) >= 6 && typeof ctx.tavernUi.registerComposerSlot === 'function') {
    const GuideDockHost = function GuideDockHost(props) {
      const host = React.useRef(null)
      React.useEffect(function () {
        if (!host.current) return undefined
        const dockApp = createApp(GuideDock)
        dockApp.config.errorHandler = function (error, _instance, info) {
          console.error('[dsh-tavern-desktop-pet] 停靠区 error:', info, error)
        }
        dockApp.mount(host.current)
        return function () {
          try {
            dockApp.unmount()
          } catch {
            // ignore
          }
        }
      }, [])
      return React.createElement('div', { ref: host, className: 'pet-guide-dock-host' })
    }
    try {
      disposers.push(
        ctx.tavernUi.registerComposerSlot({
          id: 'guide',
          modes: ['card'],
          render: (props) => React.createElement(GuideDockHost, props),
        }),
      )
    } catch (error) {
      console.warn('[dsh-tavern-desktop-pet] 停靠区注册失败', error)
    }
  }

  if (ctx.tavernUi.apiVersion >= 2) {
    try {
      // render 要返回 React 元素；React 由加载器提供（factory 的 require('react')），
      // 不是 ctx.tavernUi 上的字段。
      const View = PetPanel(ctx)
      disposers.push(
        ctx.tavernUi.registerPanel({
          id: 'pet',
          title: '桌宠',
          render: () => React.createElement(View),
        }),
      )
    } catch (error) {
      console.warn('[dsh-tavern-desktop-pet] 侧栏面板注册失败', error)
    }

    try {
      disposers.push(
        ctx.tavernUi.registerComposerAction({
          id: 'tease',
          label: '逗一下',
          when: ({ busy }) => !busy,
          run: () => {
            if (!teasePet()) openPetSettings()
          },
        }),
      )
    } catch (error) {
      console.warn('[dsh-tavern-desktop-pet] 输入框按钮注册失败', error)
    }
  }

  console.log('[dsh-tavern-desktop-pet] 已挂载', { gameId: gameId || '(未打开任何局)' })
  if (typeof window !== 'undefined') {
    window.__dshTavernPetDebug = {
      version: '0.5.0',
      guide: () => guide.getState(),
      talking: () => Live2DManager.isTalking(),
      mouth: () => Live2DManager._mouthCurrentValue,
      model: () => Boolean(Live2DManager.model),
      param: (id) => {
        try {
          const core = Live2DManager.model?.internalModel?.coreModel
          const index = core?.getParameterIndex?.(id)
          if (!(index >= 0)) return null
          return core.getParameterValueByIndex(index)
        } catch {
          return null
        }
      },
      expressions: () => {
        try {
          const manager = Live2DManager.model?.internalModel?.motionManager?.expressionManager
          return (manager?.definitions || []).map((item) => item.Name || item.name || '').filter(Boolean)
        } catch {
          return []
        }
      },
      motions: () => {
        try {
          return Object.keys(Live2DManager.model?.internalModel?.motionManager?.definitions || {})
        } catch {
          return []
        }
      },
    }
  }

  // 卡片工作台：把「提问轮」在主区折叠成一行。跟着设置与桌宠开关走：
  // 桌宠被关掉、引导关掉、折叠关掉时注销，主区立刻恢复原样。
  const presenter = createGuidePresenter()
  let presenterDispose = null
  const guideSettings = () => {
    const value = getVariables() || {}
    return {
      enabled: value.guideEnabled !== false,
      fold: value.guideFoldQuestions !== false,
      visible: value.petVisible !== false,
    }
  }
  const syncPresenter = () => {
    const wanted = Number(ctx.tavernUi.apiVersion || 0) >= 6 && guideSettings().enabled && guideSettings().fold && guideSettings().visible
    if (wanted && presenterDispose === null) {
      try {
        presenterDispose = ctx.tavernUi.registerReplyPresenter(presenter)
        presenterDispose = typeof presenterDispose === 'function' ? presenterDispose : () => {}
      } catch (error) {
        console.warn('[dsh-tavern-desktop-pet] 折叠呈现器注册失败', error)
        presenterDispose = null
      }
      return
    }
    if (!wanted && presenterDispose !== null) {
      try {
        presenterDispose()
      } catch {
        // ignore
      }
      presenterDispose = null
    }
  }
  if (Number(ctx.tavernUi.apiVersion || 0) >= 6) {
    syncPresenter()
    ctx.effect(() => onVariablesChanged(syncPresenter), 'dsh-tavern-desktop-pet: guide fold follows settings')
    ctx.effect(() => () => {
      if (presenterDispose !== null) {
        try {
          presenterDispose()
        } catch {
          // ignore
        }
        presenterDispose = null
      }
    }, 'dsh-tavern-desktop-pet: guide presenter')
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.reverse()) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch {
        // ignore
      }
    }
    try {
      app.unmount()
    } catch {
      // ignore
    }
    clearPetActions()
    detachTavern()
    root.remove()
    document.getElementById(`${ROOT_ID}-base-style`)?.remove()
    uninstallSillyTavernShims()
    console.log('[dsh-tavern-desktop-pet] 已卸载')
  })
}
