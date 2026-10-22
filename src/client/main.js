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
`

const PANEL_CSS = `
.pet-panel{display:flex;flex-direction:column;gap:10px;padding:12px;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
  color:var(--color-text-primary,#1c1c1a)}
.pet-panel-desc{color:var(--color-text-secondary,#5f5e5a);font-size:12px}
.pet-panel-row{display:flex;gap:8px;flex-wrap:wrap}
.pet-panel button{padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;
  border:1px solid var(--color-border-secondary,rgba(0,0,0,.18));background:var(--color-background-secondary,#f5f5f3);
  color:var(--color-text-primary,#1c1c1a)}
.pet-panel button:hover{border-color:var(--color-border-primary,rgba(0,0,0,.4))}
.pet-panel-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--color-text-secondary,#5f5e5a)}
.pet-panel-field select{width:100%;padding:5px 8px;border-radius:8px;font-size:12px;
  border:1px solid var(--color-border-secondary,rgba(0,0,0,.18));background:var(--color-background-primary,#fff);
  color:var(--color-text-primary,#1c1c1a)}
.pet-panel-hint{margin-top:4px;font-size:12px;color:var(--color-text-tertiary,#888)}
.pet-panel-check{display:flex;gap:6px;align-items:flex-start;font-size:12px;line-height:1.5;color:var(--color-text-secondary,#5f5e5a);cursor:pointer}
.pet-panel-check input{margin:2px 0 0}
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

    React.useEffect(() => {
      const timer = setInterval(() => {
        setStatus(petActions.describe())
        setVisible(petActions.isVisible())
        setGuide(petActions.guideSettings?.() || { enabled: true, fold: true })
        setGuideState(petActions.guideStatus?.() || '')
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
  // 默认形象：插件自带的大肥鱼 Live2D（assets/live2d/dafeiyu）。旧版默认是 CDN 上的
  // shizuku，装过旧版的用户把那个默认值迁过来；自己挑过模型的保持不动。
  try {
    if (typeof ctx.tavernUi.assetUrl === 'function') {
      const assetPath = ctx.tavernUi.assetUrl('live2d/dafeiyu/dafeiyu.model3.json')
      const bundledModel = new URL(assetPath, window.location.href).href
      const settingsStore = useSettingsStore(pinia)
      const current = String(settingsStore.settings.modelPath || '')
      if (current === '' || current === DEFAULTS.MODEL_PATH) {
        settingsStore.updateSettings({ modelPath: bundledModel })
        console.log('[dsh-tavern-desktop-pet] 默认形象切换为大肥鱼 Live2D', { model: bundledModel })
      }
    }
  } catch (error) {
    console.warn('[dsh-tavern-desktop-pet] 默认模型切换失败，继续用原模型', error)
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
      version: '0.4.0',
      guide: () => guide.getState(),
      talking: () => Live2DManager.isTalking(),
      mouth: () => Live2DManager._mouthCurrentValue,
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
