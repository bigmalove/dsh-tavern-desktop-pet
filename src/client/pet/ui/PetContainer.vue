<template>
  <div>
    <ChatBubble
      :text="bubbleText"
      :is-done="bubbleDone"
      :auto-close-delay-seconds="settings.bubbleDuration"
      :guide="guideBubble"
      :options="guideOptions"
      :choice-disabled="guideChoiceDisabled"
      @hidden="onBubbleHidden"
      @choose="onGuideChoose"
    />
    <ChatBubble
      :text="statusBubbleText"
      :is-done="true"
      :auto-close-delay-seconds="-1"
      :status="true"
    />
    <SettingsPanel
      :visible="showSettings"
      @close="uiStore.closeSettings()"
      @model-change="onModelChange"
    />

    <FunctionMenu
      :visible="showMenu"
      :x="menuAnchor.x"
      :y="menuAnchor.y"
      :placement="menuPlacement"
      :motion-loop-enabled="settings.autoMotionLoop"
      :comment-style="settings.commentStyle"
      @close="showMenu = false"
      @send-chat="onManualChat"
      @toggle-motion-loop="toggleMotionLoop"
      @switch-model="openModelBrowser"
      @switch-persona="cyclePersona"
      @open-settings="onMenuOpenSettings"
      @close-model="closePet"
    />

    <div v-if="showModelBrowser" class="browser-overlay" @click.self="showModelBrowser = false">
      <div class="browser-dialog">
        <div class="browser-dialog-header">
          <h3>在线模型库</h3>
          <button class="close-btn" @click="showModelBrowser = false">×</button>
        </div>
        <div class="browser-dialog-body">
          <ModelBrowser
            :use-cdn="settings.useCdn"
            @cancel="showModelBrowser = false"
            @load-model="onModelBrowserLoad"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { clearPetActions, providePetActions } from '../../bridge/actions';
import {
  currentGameId,
  fillInput as fillTavernInput,
  foreignVoiceLease,
  onGameChange,
  speak as speakViaTavern,
  standardEmotion,
  stopSpeaking as stopTavernSpeech,
  watchWorkStatus,
} from '../../bridge/tavern';
import { guideDockActive } from '../../guide/dock-state';
import { guide, stopGuideTalking, stopGuideVoiceLease } from '../../guide/session';
import { splitZhJaForDisplayAndTts } from '../chat/bilingual-text';
import { Commentator } from '../chat/commentator';
import { parseEmotionCotText } from '../chat/emotion-cot';
import { ChatMonitor } from '../chat/monitor';
import { DEFAULTS, LOCAL_LIVE2D_MODEL_PATH_PREFIX, type EmotionTag } from '../core/constants';
import { useSettingsStore } from '../core/settings';
import { bubbleForWorkStatus, faceForWorkStatus, labelForWorkStatus, shouldApplyWorkStatusFace } from '../core/work-status';
import { useUiStore } from '../core/ui';
import { hasLive2DModel } from '../db/live2d-models';
import { Live2DManager, type ModelLoadProgress } from '../live2d/manager';
import { applyEmotionToLive2D as applyEmotionWithConfigs } from '../live2d/emotion-apply';
import { Live2DStage } from '../live2d/stage';
import type { GestureEvent } from '../utils/gesture-recognizer';
import { error as logError, log } from '../utils/dom';
import ChatBubble from './ChatBubble.vue';
import FunctionMenu from './FunctionMenu.vue';
import ModelBrowser from './ModelBrowser.vue';
import SettingsPanel from './SettingsPanel.vue';

const store = useSettingsStore();
const { settings } = storeToRefs(store);
const uiStore = useUiStore();
const { showSettings } = storeToRefs(uiStore);

const bubbleText = ref('');
const bubbleDone = ref(true);
const BASE_STAGE_WIDTH = 280;
const BASE_STAGE_HEIGHT = 360;
const OPEN_SETTINGS_FN_KEY = '__desktopPetOpenSettings_v2';
let globalOpenSettingsFn: (() => void) | null = null;

// 卡片工作台的引导：控制器是单例（停靠区也用同一份），这里只把它桥成响应式。
const guideState = ref<any>(null);
let stopGuideSubscribe: (() => void) | null = null;
const guideActive = computed(() => Boolean(guideState.value && guideState.value.active));

// 这一局的工作状态（Tavern 第 7 版）：思考/干活/等你回答/刚忙完/出错时换个表情。
// 只在没有引导、没有气泡时动，免得抢引导员和吐槽的镜头。
let stopWorkStatus: (() => void) | null = null;
let stopWorkGame: (() => void) | null = null;
const workStatus = ref<{ state?: string; tool?: string; role?: string } | null>(null);
let lastWorkFace = '';
let lastWorkState = '';
let workStatusSerial = 0;
// 停靠区接管时，固定气泡让位，避免同一句话显示两遍。
const guideBubble = computed(() => {
  const state = guideState.value;
  if (!state || !state.active || guideDockActive.value) return null;
  const bubble = state.bubble || {};
  if (state.phase === 'idle' && !bubble.lead) return null;
  return {
    ack: bubble.ack || '',
    question: bubble.question || '',
    hint: bubble.hint || '',
    note: bubble.note || '',
    lead: bubble.lead || '',
    detail: bubble.detail || '',
    index: Number(bubble.index) || 0,
    streaming: state.streaming === true,
    kind: state.kind || '',
  };
});
const guideOptions = computed(() => (guideBubble.value ? (guideState.value?.options || []) : []));
const guideChoiceDisabled = computed(() => Boolean(guideState.value?.choiceDisabled));

// 工作状态气泡：生成中 / 干活中 / 等你回答 / 写完了 / 出错了。
// 引导员和吐槽气泡优先；它们在时这条让位，免得两个气泡叠在一起。
const statusBubbleText = computed(() => {
  if (guideActive.value || guideBubble.value || String(bubbleText.value || '').trim()) return '';
  return bubbleForWorkStatus(workStatus.value);
});

function onGuideChoose(option: { key?: string; label: string; freeform?: boolean }) {
  guide.choose(option);
}

let modelLoadTaskId = 0;
let initTaskId = 0;
let modelLoadingHideTimer: number | null = null;
let statusCheckTimer: number | null = null;
let viewportResizeSyncTimer: number | null = null;
let boundWindowResizeHandler: (() => void) | null = null;
let boundVisualViewportResizeHandler: (() => void) | null = null;
let gazeFollowBound = false;
let gazePointerMoveHandler: ((event: PointerEvent) => void) | null = null;
let gazePointerDownHandler: ((event: PointerEvent) => void) | null = null;
let gazeFollowRafId: number | null = null;
let gazePendingPoint: { x: number; y: number } | null = null;
let petClosed = false;

const showMenu = ref(false);
const menuAnchor = ref({ x: 0, y: 0 });
const menuPlacement = ref<'left' | 'right'>('left');
const showModelBrowser = ref(false);

function getTopWindow(): Window {
  try {
    return window.parent ?? window;
  } catch {
    return window;
  }
}

function applyEmotionToLive2D(tag: EmotionTag): boolean {
  return applyEmotionWithConfigs(tag, settings.value.emotionConfigs);
}

function applyWorkStatusFace(face: string): void {
  const serial = ++workStatusSerial;
  const attempt = (left: number) => {
    if (serial !== workStatusSerial || petClosed) return;
    if (!Live2DManager.model) {
      // 模型还在加载（或刚切模型）：等一会儿再试，别把这次状态丢掉。
      if (left > 0) window.setTimeout(() => attempt(left - 1), 1200);
      return;
    }
    if (!applyEmotionToLive2D(face as EmotionTag)) {
      // 模型没有这组表情/动作：至少动一下，别让桌宠在生成时像块石头。
      Live2DManager.playRandomAnimation();
    }
  };
  attempt(8);
}

function applyWorkStatus(next: any): void {
  const status = next && typeof next === 'object' ? next : null;
  workStatus.value = status;
  if (!status) return;
  const state = String(status.state || '');
  if (state !== lastWorkState) {
    lastWorkState = state;
    log('工作状态 →', state, status.tool || '');
  }
  const bubbleVisible = Boolean(String(bubbleText.value || '').trim());
  if (state === 'idle') {
    lastWorkFace = '';
    // 忙完了回到默认表情；引导/气泡在时不动，它们自己会收尾。
    if (!guideActive.value && !bubbleVisible) {
      workStatusSerial++;
      applyEmotionToLive2D('默认');
    }
    return;
  }
  if (
    !shouldApplyWorkStatusFace({
      status: status,
      guideActive: guideActive.value,
      bubbleVisible: bubbleVisible,
    })
  ) {
    lastWorkFace = '';
    return;
  }
  const face = faceForWorkStatus(state);
  if (!face || face === lastWorkFace) return;
  lastWorkFace = face;
  applyWorkStatusFace(face);
}

function bindWorkStatus(): void {
  stopWorkStatus?.();
  stopWorkStatus = null;
  if (petClosed) return;
  const gameId = currentGameId();
  if (!gameId) return;
  stopWorkStatus = watchWorkStatus(gameId, applyWorkStatus);
  log('已订阅工作状态', gameId);
}

function stopWorkStatusWatch(): void {
  stopWorkStatus?.();
  stopWorkStatus = null;
  workStatusSerial++;
  workStatus.value = null;
  lastWorkFace = '';
  lastWorkState = '';
}

watch(showSettings, (visible) => {
  log(visible ? '设置面板已显示' : '设置面板已关闭');
  if (!visible || !petClosed) return;
  // 用户主动 CLOSE 的不能在这里复活，否则「关闭」就形同虚设；
  // 只有意外销毁（比如舞台被外力清掉，但开关还是打开状态）才补回来。
  if (settings.value.petVisible === false) return;
  log('设置面板打开时检测到宠物已关闭，开始重新加载模型');
  syncGazeFollowBinding();
  void initPet();
});

// 设置页的「显示桌宠」复选框与长按菜单的 CLOSE 共用这一个开关。
watch(
  () => settings.value.petVisible,
  (visible) => {
    if (visible === false) {
      if (!petClosed) closePet(false);
      return;
    }
    if (petClosed) {
      log('检测到「显示桌宠」已打开，重新初始化');
      syncGazeFollowBinding();
      void initPet();
    }
  },
);

function registerGlobalOpenSettings(): void {
  try {
    const top = window.parent ?? window;
    const fn = () => {
      uiStore.openSettings();
      log('通过全局函数打开设置面板');
    };
    (top as any)[OPEN_SETTINGS_FN_KEY] = fn;
    globalOpenSettingsFn = fn;
  } catch (e) {
    notifyInitError('注册全局设置打开函数失败', e);
  }
}

function unregisterGlobalOpenSettings(): void {
  try {
    const top = window.parent ?? window;
    if (globalOpenSettingsFn && (top as any)[OPEN_SETTINGS_FN_KEY] === globalOpenSettingsFn) {
      delete (top as any)[OPEN_SETTINGS_FN_KEY];
    }
  } catch {
    // ignore
  } finally {
    globalOpenSettingsFn = null;
  }
}

registerGlobalOpenSettings();

function openFunctionMenu(e: GestureEvent): void {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  } catch {
    // ignore
  }

  const top = getTopWindow();
  let placement: 'left' | 'right' = 'right';
  let x = e.clientX;
  let y = e.clientY;

  try {
    const stageEl = top.document.getElementById('desktop-pet-stage') as HTMLElement | null;
    const rect = stageEl?.getBoundingClientRect?.();
    const vw = top.innerWidth || top.document.documentElement.clientWidth || 0;

    if (rect && vw > 0) {
      placement = rect.left > vw / 2 ? 'left' : 'right';
      x = placement === 'left' ? rect.left - 10 : rect.right + 10;
      y = rect.top + rect.height * 0.5;
    } else if (vw > 0) {
      placement = e.clientX > vw / 2 ? 'left' : 'right';
    }
  } catch {
    // ignore
  }

  menuPlacement.value = placement;
  menuAnchor.value = { x, y };
  showMenu.value = true;
}

function toggleMotionLoop(): void {
  const next = !settings.value.autoMotionLoop;
  settings.value.autoMotionLoop = next;
  Live2DManager.setAutoMotionLoopEnabled(next);
}

function cyclePersona(): void {
  const personas = ['毒舌吐槽', '可爱卖萌', '冷静分析', '傲娇'] as const;
  const current = settings.value.commentStyle;
  const idx = personas.indexOf(current as any);
  const next = personas[(idx >= 0 ? idx + 1 : 0) % personas.length];
  settings.value.commentStyle = next;

  try {
    toastr.info(`已切换人设：${next}`);
  } catch {
    // ignore
  }
}

function openModelBrowser(): void {
  showMenu.value = false;
  showModelBrowser.value = true;
}

/** 长按菜单里的「设置」：先收起菜单，再开设置面板（两层遮罩不能同时挂）。 */
function onMenuOpenSettings(): void {
  showMenu.value = false;
  uiStore.openSettings();
}

function onModelBrowserLoad(url: string): void {
  settings.value.modelPath = url;
  showModelBrowser.value = false;
  void onModelChange(url);
}

let tauntTalkTimer: number | null = null;

/** 吐槽气泡的说话口型：流式时保持，两秒没有新字或说完后停下。 */
function driveTauntMouth(text: string, done: boolean): void {
  const body = String(text || '').trim();
  if (!body) return;
  if (!Live2DManager.isTalking()) Live2DManager.startTalking();
  if (tauntTalkTimer !== null) {
    window.clearTimeout(tauntTalkTimer);
    tauntTalkTimer = null;
  }
  tauntTalkTimer = window.setTimeout(() => {
    tauntTalkTimer = null;
    Live2DManager.stopTalking();
  }, done ? Math.min(9000, Math.max(1200, body.length * 140)) : 2400);
}

function stopAllTalking(): void {
  if (tauntTalkTimer !== null) {
    window.clearTimeout(tauntTalkTimer);
    tauntTalkTimer = null;
  }
  Live2DManager.stopTalking();
  stopGuideTalking();
}

function onManualChat(message: string): void {
  // 工作台里 CHAT 变成「聚焦输入框」：引导员的工作是让玩家回答主对话，
  // 不是另开一段与桌宠的闲聊（那条会走宿主吐槽模型）。
  if (guideActive.value) {
    fillTavernInput('');
    return;
  }
  void Commentator.chat(message);
}

function closePet(closeSettingsPanel = true): void {
  if (petClosed) return;
  petClosed = true;
  // 关掉这件事要记住：只销毁实例的话，刷新后 onMounted 又会把桌宠挂回来。
  settings.value.petVisible = false;
  initTaskId++;
  modelLoadTaskId++;
  clearModelLoadingHideTimer();
  clearStatusCheckTimer();
  clearViewportResizeSyncTimer();
  stopAllTalking();
  stopWorkStatusWatch();
  stopGuideVoiceLease();
  guide.setVisible(false);

  showMenu.value = false;
  showModelBrowser.value = false;
  // 在设置面板里取消勾选「显示桌宠」时不要把面板一起收掉，否则改到一半就没了。
  if (closeSettingsPanel) uiStore.closeSettings();
  onBubbleHidden();
  unbindGlobalGazeFollow(true);

  ChatMonitor.destroy();
  Commentator.destroy();
  Live2DStage.hideLoadingProgress();
  Live2DManager.destroyModel();
  Live2DStage.destroy();

  try {
    toastr.info('桌面宠物已关闭');
  } catch {
    // ignore
  }
}

/** 关掉之后重新挂出来：先翻状态，避免 petVisible 的 watch 回调再初始化一遍。 */
function showPet(): void {
  if (!petClosed) return;
  petClosed = false;
  settings.value.petVisible = true;
  guide.setVisible(true);
  log('重新打开桌宠');
  syncGazeFollowBinding();
  void initPet();
}

function getStageSize(scale: number): { width: number; height: number } {
  const safeScale = normalizePetScale(scale);
  return {
    width: Math.max(1, Math.round(BASE_STAGE_WIDTH * safeScale)),
    height: Math.max(1, Math.round(BASE_STAGE_HEIGHT * safeScale)),
  };
}

function normalizePetScale(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULTS.PET_SCALE;
  return Math.max(0.1, Math.min(3, parsed));
}

function clearModelLoadingHideTimer(): void {
  if (modelLoadingHideTimer === null) return;
  window.clearTimeout(modelLoadingHideTimer);
  modelLoadingHideTimer = null;
}

function clearStatusCheckTimer(): void {
  if (statusCheckTimer === null) return;
  window.clearTimeout(statusCheckTimer);
  statusCheckTimer = null;
}

function clearViewportResizeSyncTimer(): void {
  if (viewportResizeSyncTimer === null) return;
  window.clearTimeout(viewportResizeSyncTimer);
  viewportResizeSyncTimer = null;
}

function clearGazeFollowRaf(): void {
  if (gazeFollowRafId === null) return;
  const top = getTopWindow();
  try {
    top.cancelAnimationFrame(gazeFollowRafId);
  } catch {
    // ignore
  }
  gazeFollowRafId = null;
}

function isGazePointerTypeSupported(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
}

function scheduleGazeFollow(clientX: number, clientY: number): void {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;

  gazePendingPoint = { x: clientX, y: clientY };
  if (gazeFollowRafId !== null) return;

  const top = getTopWindow();
  gazeFollowRafId = top.requestAnimationFrame(() => {
    gazeFollowRafId = null;

    const point = gazePendingPoint;
    gazePendingPoint = null;
    if (!point) return;
    if (settings.value.gazeFollowMouseEnabled === false) return;
    if (Live2DStage.isPreviewMounted()) return;

    Live2DManager.focusByClientPoint(point.x, point.y, false);
  });
}

function bindGlobalGazeFollow(): void {
  if (gazeFollowBound) return;

  const top = getTopWindow();
  const topDoc = top.document ?? document;
  const handlePointerEvent = (event: PointerEvent) => {
    if (!isGazePointerTypeSupported(event.pointerType)) return;
    scheduleGazeFollow(event.clientX, event.clientY);
  };

  gazePointerMoveHandler = handlePointerEvent;
  gazePointerDownHandler = handlePointerEvent;

  topDoc.addEventListener('pointermove', gazePointerMoveHandler, { passive: true });
  topDoc.addEventListener('pointerdown', gazePointerDownHandler, { passive: true });
  gazeFollowBound = true;
}

function unbindGlobalGazeFollow(resetFocus = true): void {
  clearGazeFollowRaf();
  gazePendingPoint = null;

  const top = getTopWindow();
  const topDoc = top.document ?? document;

  if (gazePointerMoveHandler) {
    topDoc.removeEventListener('pointermove', gazePointerMoveHandler);
  }
  if (gazePointerDownHandler) {
    topDoc.removeEventListener('pointerdown', gazePointerDownHandler);
  }

  gazePointerMoveHandler = null;
  gazePointerDownHandler = null;
  gazeFollowBound = false;

  if (resetFocus) {
    Live2DManager.focusCenter(true);
  }
}

function syncGazeFollowBinding(): void {
  if (settings.value.gazeFollowMouseEnabled === false) {
    unbindGlobalGazeFollow(true);
    return;
  }
  bindGlobalGazeFollow();
}

function syncStageAfterViewportResize(reason: string): void {
  if (petClosed) return;
  if (Live2DStage.isPreviewMounted()) return;

  const stageSize = getStageSize(settings.value.petScale);
  const recoverOnce = (label: string) => {
    Live2DStage.resizeFloating(stageSize.width, stageSize.height);
    const top = getTopWindow();
    const stageEl = top.document.getElementById('desktop-pet-stage') as HTMLElement | null;
    if (stageEl) {
      stageEl.style.display = 'block';
      stageEl.style.visibility = 'visible';
      stageEl.style.opacity = '1';
      stageEl.style.zIndex = '1200';
    }

    const stage = Live2DStage.getStage();
    const hasModelOnStage = !!stage && stage.children.length > 0;
    if (hasModelOnStage) {
      Live2DManager.updateScale(stageSize.width, stageSize.height, 1);
      log(`Viewport resize recovery synced model (${label})`);
      return;
    }

    Live2DManager.mountToStage(stageSize.width, stageSize.height, 1);
    log(`Viewport resize recovery remounted model (${label})`);
  };

  recoverOnce(`${reason}-pass1`);
  window.setTimeout(() => {
    if (Live2DStage.isPreviewMounted()) return;
    recoverOnce(`${reason}-pass2`);
  }, 220);

  scheduleStatusCheck(`${reason}-recover`);
}

function scheduleViewportResizeSync(reason: string): void {
  clearViewportResizeSyncTimer();
  viewportResizeSyncTimer = window.setTimeout(() => {
    viewportResizeSyncTimer = null;
    syncStageAfterViewportResize(reason);
  }, 160);
}

function bindViewportResizeRecovery(): void {
  const top = getTopWindow();

  boundWindowResizeHandler = () => {
    scheduleViewportResizeSync('window-resize');
  };

  try {
    top.addEventListener('resize', boundWindowResizeHandler, { passive: true });
  } catch (e) {
    logError('Failed to bind window.resize listener', e);
    boundWindowResizeHandler = null;
  }

  const viewport = top.visualViewport;
  if (!viewport) return;

  boundVisualViewportResizeHandler = () => {
    scheduleViewportResizeSync('visual-viewport-resize');
  };

  try {
    viewport.addEventListener('resize', boundVisualViewportResizeHandler, { passive: true });
  } catch (e) {
    logError('Failed to bind visualViewport.resize listener', e);
    boundVisualViewportResizeHandler = null;
  }
}

function unbindViewportResizeRecovery(): void {
  const top = getTopWindow();
  if (boundWindowResizeHandler) {
    try {
      top.removeEventListener('resize', boundWindowResizeHandler);
    } catch {
      // ignore
    }
    boundWindowResizeHandler = null;
  }

  const viewport = top.visualViewport;
  if (viewport && boundVisualViewportResizeHandler) {
    try {
      viewport.removeEventListener('resize', boundVisualViewportResizeHandler);
    } catch {
      // ignore
    }
    boundVisualViewportResizeHandler = null;
  }
}

function renderModelLoadProgress(progress: ModelLoadProgress): void {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  Live2DStage.showLoadingProgress(percent, progress.message);
}

function notifyInitError(message: string, err?: unknown): void {
  logError(message, err);
  try {
    toastr.error(message);
  } catch {
    // ignore
  }
}

async function loadModelWithProgress(path: string): Promise<boolean> {
  const taskId = ++modelLoadTaskId;
  clearModelLoadingHideTimer();
  renderModelLoadProgress({ percent: 0, message: '准备加载模型' });

  const loaded = await Live2DManager.loadModel(path, (progress) => {
    if (taskId !== modelLoadTaskId) return;
    renderModelLoadProgress(progress);
  });

  if (taskId !== modelLoadTaskId) {
    return loaded;
  }

  renderModelLoadProgress({
    percent: 100,
    message: loaded ? '模型加载完成' : '模型加载失败',
  });
  modelLoadingHideTimer = window.setTimeout(() => {
    if (taskId !== modelLoadTaskId) return;
    Live2DStage.hideLoadingProgress();
    modelLoadingHideTimer = null;
  }, loaded ? 400 : 15000);
  return loaded;
}

function scheduleStatusCheck(reason: string): void {
  clearStatusCheckTimer();
  if (petClosed) return;
  statusCheckTimer = window.setTimeout(() => {
    try {
      if (petClosed) return;
      const top = window.parent ?? window;
      const stageEl = top.document.getElementById('desktop-pet-stage') as HTMLElement | null;
      const rect = stageEl?.getBoundingClientRect?.();
      const rectSummary = rect
        ? `${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`
        : 'none';

      const pixiVersion = String((top as any).PIXI?.VERSION || '').trim() || 'none';
      const hasLive2d = !!(top as any).PIXI?.live2d?.Live2DModel;
      const hasModel = !!Live2DManager.model;
      const stageChildren = (Live2DStage.getStage()?.children?.length ?? 0) as number;

      const stageVisible =
        !!rect &&
        rect.width > 10 &&
        rect.height > 10 &&
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < (top.innerHeight || 0) &&
        rect.left < (top.innerWidth || 0);

      if (stageVisible && hasLive2d && hasModel && stageChildren > 0) {
        statusCheckTimer = null;
        return;
      }

      if (stageEl) {
        const prevOutline = stageEl.style.outline;
        const prevBackground = stageEl.style.background;
        const prevZIndex = stageEl.style.zIndex;

        stageEl.style.outline = '2px dashed rgba(245, 158, 11, 0.95)';
        stageEl.style.background = 'rgba(245, 158, 11, 0.08)';
        stageEl.style.zIndex = '2147483647';

        window.setTimeout(() => {
          if (!stageEl?.ownerDocument?.documentElement?.contains(stageEl)) return;
          stageEl.style.outline = prevOutline;
          stageEl.style.background = prevBackground;
          stageEl.style.zIndex = prevZIndex;
        }, 10000);
      }

      const message =
        `桌面宠物未显示(${reason}) ` +
        `stage=${!!stageEl} rect=${rectSummary} visible=${stageVisible} ` +
        `pixi=${pixiVersion} live2d=${hasLive2d} model=${hasModel} children=${stageChildren}`;

      try {
        toastr.warning(message);
      } catch {
        // ignore
      }
    } catch (e) {
      notifyInitError('桌面宠物状态检查失败', e);
    } finally {
      statusCheckTimer = null;
    }
  }, 2500);
}

async function initPet() {
  const taskId = ++initTaskId;
  petClosed = false;
  try {
    log('桌面宠物初始化开始');
    if (taskId !== initTaskId || petClosed) return;
    const s = settings.value;


    Commentator.setCallback((text: string, isDone: boolean) => {
      const parsed = parseEmotionCotText(text, {
        enabled: !!settings.value.emotionCotEnabled,
        stripFromText: settings.value.emotionCotStripFromText !== false,
        configs: settings.value.emotionConfigs,
      });
      const splitResult = splitZhJaForDisplayAndTts(parsed.cleanText, !!settings.value.ttsBilingualZhJaEnabled);

      bubbleText.value = splitResult.displayText;
      bubbleDone.value = isDone;
      driveTauntMouth(splitResult.displayText, isDone);

      if (!isDone) return;
      const finalText = String(splitResult.displayText || '').trim();
      if (!finalText) return;
      const ttsText = String(splitResult.ttsText || '').trim();
      if (!ttsText) return;

      if (parsed.normalizedTag) {
        const applied = applyEmotionToLive2D(parsed.normalizedTag);
        if (!applied) {
          Live2DManager.playRandomAnimation();
        }
      } else {
        Live2DManager.playRandomAnimation();
      }

      // 配音走 Tavern 自己的渠道（浏览器朗读 / OpenAI 兼容 / GPT-SoVITS / MiniMax），
      // 上游那套 littlewhitebox / 自建 SoVITS 渠道不再需要，所以不再看它的 provider 开关。
      const autoPlay = !!settings.value.ttsAutoPlay;
      const tagLabel = parsed.normalizedTag || '(none)';
      log(
        `生成完成，自动朗读: autoPlay=${autoPlay}, tag=${tagLabel}, textLen=${finalText.length}, ttsLen=${ttsText.length}`,
      );
      if (!autoPlay) return;

      void speakViaTavern({
        text: ttsText,
        emotion: standardEmotion(parsed.normalizedTag),
        // 不指定 speaker：这是桌宠自己的语气，不是卡里某个角色的台词；
        // 说话人（以及它的声音）由 Tavern 的角色素材决定。
      });
    });

    const ready = await Live2DManager.init();
    if (!ready) {
      notifyInitError('Live2D SDK 初始化失败（可能是网络 CDN 不可用）');
      return;
    }
    log('Live2D SDK 初始化完成');

    Live2DManager.setAutoMotionLoopEnabled(s.autoMotionLoop);

    const initialScale = normalizePetScale(s.petScale);
    if (initialScale !== s.petScale) {
      settings.value.petScale = initialScale;
    }
    const stageSize = getStageSize(initialScale);

    const created = Live2DStage.create({
      width: stageSize.width,
      height: stageSize.height,
      position: { x: s.petPosition.x, y: s.petPosition.y },
      scale: initialScale,
      onPositionChange: (x: number, y: number) => {
        settings.value.petPosition = { x, y };
      },
      onScaleChange: (scale: number) => {
        const safeScale = normalizePetScale(scale);
        if (safeScale !== settings.value.petScale) {
          settings.value.petScale = safeScale;
        }
      },
      onTap: (_e: GestureEvent) => {
        log('单击宠物 -> 播放动作（不触发 LLM）');
        Live2DManager.playRandomAnimation();
      },
      onDoubleTap: (_e: GestureEvent) => {
        const motionEnabled = settings.value.doubleTapRandomMotionEnabled !== false;
        // 工作台里没有可吐槽的正文，宿主侧吐槽必然失败：只做个动作。
        if (guideActive.value) {
          Live2DManager.playRandomAnimation();
          return;
        }
        log(motionEnabled ? '双击宠物 -> 触发吐槽 + 随机动作' : '双击宠物 -> 触发吐槽');
        ChatMonitor.manualTrigger();
        if (motionEnabled) {
          Live2DManager.playRandomAnimation();
        }
      },
      onLongPress: (_e: GestureEvent) => {
        log('长按宠物 -> 打开功能菜单');
        openFunctionMenu(_e);
      },
    });

    if (!created) {
      notifyInitError('Live2D 舞台创建失败（可能是 WebGL 不可用）');
      return;
    }
    log('Live2D 舞台创建完成');

    const loaded = await loadModelWithProgress(s.modelPath);
    if (taskId !== initTaskId || petClosed) return;
    if (loaded) {
      Live2DManager.mountToStage(stageSize.width, stageSize.height, 1);
      log('Live2D 模型挂载完成');
    } else {
      notifyInitError('Live2D 模型加载失败（可在设置里更换模型或关闭 CDN）');
    }

    ChatMonitor.init(
      {
        autoTrigger: s.autoTrigger,
        triggerInterval: s.triggerInterval,
        triggerProbability: s.triggerProbability,
        commentTriggerMode: s.commentTriggerMode,
      },
      () => {
        // 别的插件正占着这一局的「声音」：让路，别在它演出中间插嘴。
        const holder = foreignVoiceLease();
        if (holder) {
          log(`声音被插件 ${holder.holder} 占用，跳过自动吐槽`);
          return;
        }
        void Commentator.generate();
      },
    );

    bindWorkStatus();
    log('桌面宠物初始化完成');
    if (taskId !== initTaskId || petClosed) return;
    scheduleStatusCheck('init');
  } catch (e) {
    if (taskId !== initTaskId || petClosed) return;
    notifyInitError('桌面宠物初始化异常，请打开控制台查看错误', e);
  }
}

async function onModelChange(path: string) {
  if (petClosed) return;
  const nextPath = String(path || '').trim();
  const isLocalModel =
    nextPath.length > 0 &&
    nextPath.toLowerCase().startsWith(LOCAL_LIVE2D_MODEL_PATH_PREFIX.toLowerCase());

  if (isLocalModel) {
    try {
      const exists = await hasLive2DModel();
      if (!exists) {
        const message = '未找到已上传本地模型，请先在设置中上传 ZIP 模型。';
        log(`模型切换中止: local model missing, path=${nextPath}`);
        toastr.error(message);
        scheduleStatusCheck('model-change-local-missing');
        return;
      }
    } catch (e) {
      const message = `检查本地模型失败: ${e instanceof Error ? e.message : String(e)}`;
      log(`模型切换检查异常: path=${nextPath}`, e);
      toastr.error(message);
      scheduleStatusCheck('model-change-local-check-error');
      return;
    }
  }

  const loaded = await loadModelWithProgress(path);
  if (petClosed) return;
  if (loaded) {
    const stageSize = getStageSize(settings.value.petScale);
    Live2DManager.mountToStage(stageSize.width, stageSize.height, 1);
  } else if (isLocalModel) {
    const message = '本地模型加载失败，请尝试重新上传 ZIP 或切换远程模型。';
    log(`本地模型加载失败: path=${nextPath}`);
    toastr.error(message);
  }
  scheduleStatusCheck(isLocalModel ? 'model-change-local' : 'model-change');
}

function onBubbleHidden() {
  bubbleText.value = '';
  bubbleDone.value = true;
}

watch(
  () => ({
    autoTrigger: settings.value.autoTrigger,
    triggerInterval: settings.value.triggerInterval,
    triggerProbability: settings.value.triggerProbability,
    commentTriggerMode: settings.value.commentTriggerMode,
  }),
  (config) => {
    ChatMonitor.updateConfig(config);
  },
);

watch(
  () => settings.value.autoMotionLoop,
  (enabled) => {
    Live2DManager.setAutoMotionLoopEnabled(enabled);
  },
);

watch(
  () => settings.value.guideEnabled,
  (enabled) => {
    guide.setEnabled(enabled !== false);
    if (enabled === false) stopAllTalking();
  },
);

watch(
  () => settings.value.gazeFollowMouseEnabled,
  () => {
    syncGazeFollowBinding();
  },
);

watch(
  () => settings.value.petScale,
  (scale) => {
    const safeScale = normalizePetScale(scale);
    if (safeScale !== scale) {
      settings.value.petScale = safeScale;
      return;
    }
    const stageSize = getStageSize(safeScale);
    Live2DStage.resizeFloating(stageSize.width, stageSize.height);
    if (!Live2DStage.isPreviewMounted()) {
      Live2DManager.updateScale(stageSize.width, stageSize.height, 1);
    }
  },
);

onMounted(() => {
  bindViewportResizeRecovery();
  // 侧栏面板和输入框按钮通过这组函数指针操作桌宠（React 侧碰不到 Vue 实例）。
  providePetActions({
    openSettings: () => uiStore.openSettings(),
    closeSettings: () => uiStore.closeSettings(),
    show: () => showPet(),
    hide: () => closePet(),
    isVisible: () => !petClosed,
    tease: () => {
      if (petClosed) {
        // 关掉之后点「逗一下」：先把它叫回来。这一下没有模型可逗，所以不计为失败。
        showPet();
        try {
          toastr.info('桌宠已重新打开');
        } catch {
          // ignore
        }
        return true;
      }
      if (guideActive.value) {
        // 工作台里没有可吐槽的正文：只做个动作，不去调宿主模型。
        Live2DManager.playRandomAnimation();
        return true;
      }
      ChatMonitor.manualTrigger();
      Live2DManager.playRandomAnimation();
      return true;
    },
    reloadModel: () => {
      if (petClosed) return false;
      void onModelChange(settings.value.modelPath);
      return true;
    },
    isReady: () => !petClosed && Boolean(Live2DManager.model),
    describe: () => {
      if (petClosed) return '桌宠已关闭（在设置 → Live2D 里勾「显示桌宠」可恢复）';
      const pieces = [];
      pieces.push(settings.value.modelPath ? `模型：${settings.value.modelPath}` : '尚未选择模型');
      pieces.push(`大小：${Math.round(normalizePetScale(settings.value.petScale) * 100)}%`);
      pieces.push(settings.value.autoTrigger ? `每 ${settings.value.triggerInterval} 轮吐槽一次` : '手动吐槽');
      const model = String(settings.value.commentModelModel || '').trim();
      if (model) pieces.push(`吐槽模型：${model}`);
      return pieces.join(' · ');
    },
    commentModel: () => ({
      provider: String(settings.value.commentModelProvider || ''),
      model: String(settings.value.commentModelModel || ''),
    }),
    setCommentModel: (next: { provider: string; model: string }) => {
      settings.value.commentModelProvider = String(next?.provider || '');
      settings.value.commentModelModel = String(next?.model || '');
    },
    guideSettings: () => ({
      enabled: settings.value.guideEnabled !== false,
      fold: settings.value.guideFoldQuestions !== false,
    }),
    setGuideSettings: (next: { enabled?: boolean; fold?: boolean }) => {
      if (next && typeof next.enabled === 'boolean') settings.value.guideEnabled = next.enabled;
      if (next && typeof next.fold === 'boolean') settings.value.guideFoldQuestions = next.fold;
    },
    guideStatus: () => guide.describe(),
    workStatus: () => workStatus.value,
    workStatusLabel: () => labelForWorkStatus(workStatus.value),
  });

  // 引导状态桥成 Vue 响应式；桌宠被关掉时不订阅。
  stopGuideSubscribe = guide.subscribe((next: unknown) => {
    guideState.value = next;
  });
  // 换局后工作状态跟着换：退回旧局的 idle，再订阅新局。
  stopWorkGame = onGameChange(() => {
    if (petClosed) return;
    bindWorkStatus();
  });
  if (settings.value.petVisible === false) {
    guide.setVisible(false);
  } else {
    guide.setEnabled(settings.value.guideEnabled !== false);
    guide.start();
  }

  // 上次是用户主动 CLOSE 的：这次只在页面里留个空挂载点，不再加载模型。
  if (settings.value.petVisible === false) {
    petClosed = true;
    log('桌宠上次被关闭，本次不自动启动');
    return;
  }

  petClosed = false;
  syncGazeFollowBinding();
  initPet();
});

onUnmounted(() => {
  petClosed = true;
  initTaskId++;
  guide.stop();
  stopAllTalking();
  stopWorkStatusWatch();
  stopWorkGame?.();
  stopWorkGame = null;
  stopGuideVoiceLease();
  stopGuideSubscribe?.();
  stopGuideSubscribe = null;
  clearPetActions();
  unbindViewportResizeRecovery();
  unbindGlobalGazeFollow(true);
  unregisterGlobalOpenSettings();
  modelLoadTaskId++;
  clearModelLoadingHideTimer();
  clearStatusCheckTimer();
  clearViewportResizeSyncTimer();
  Live2DStage.hideLoadingProgress();
  ChatMonitor.destroy();
  Commentator.destroy();
  Live2DManager.destroyModel();
  Live2DStage.destroy();
});
</script>
<style lang="scss" scoped>
@use './styles/theme-arknights.scss' as theme;

.browser-overlay {
  @include theme.overlay-backdrop(1520, 0.8);
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
}

.browser-dialog {
  width: min(980px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: theme.$ark-text-main;
  background: theme.$ark-base;
  font-family: theme.$font-cn;
  @include theme.tech-panel(theme.$ark-accent-yellow);
  @include theme.tech-grid(22px, 0.03);
}

.browser-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 225, 0, 0.36);
  background: rgba(0, 0, 0, 0.28);

  h3 {
    margin: 0;
    font-family: theme.$font-en;
    font-size: 15px;
    letter-spacing: 0.08em;
  }

  .close-btn {
    @include theme.ark-button-base;
    width: 34px;
    height: 28px;
    padding: 0;
    line-height: 1;
    font-size: 16px;
  }
}

.browser-dialog-body {
  padding: 14px 18px 16px;
  overflow: auto;
  flex: 1;
  @include theme.ark-scrollbar;
}

@media (max-width: 860px) {
  .browser-overlay {
    align-items: flex-start;
    padding:
      calc(env(safe-area-inset-top) + 6px)
      6px
      calc(env(safe-area-inset-bottom) + 6px);
  }

  .browser-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px);
    clip-path: none;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
  }
}

@media (max-width: 620px) {
  .browser-overlay {
    align-items: stretch;
    padding: 0;
  }

  .browser-dialog {
    width: 100vw;
    max-height: 100dvh;
    box-shadow: none;
    clip-path: none;
    border-left: none;
    border-right: none;
  }

  .browser-dialog-header {
    padding: 12px;
  }

  .browser-dialog-body {
    padding: 10px 12px 12px;
  }
}
</style>
