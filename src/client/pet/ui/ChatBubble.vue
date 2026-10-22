<template>
  <div
    v-if="visible"
    class="chat-bubble"
    :class="{ 'is-guide': guide }"
    :style="bubbleStyle"
  >
    <div class="bubble-content" :class="{ 'is-guide': guide }">
      <button
        v-if="isDone && !guide"
        type="button"
        class="bubble-close"
        aria-label="关闭聊天气泡"
        @click="closeBubble"
      >
        ×
      </button>
      <template v-if="guide">
        <div
          v-if="guide.streaming"
          class="guide-streaming"
        >
          {{ guide.lead || '…' }}<span class="cursor">|</span>
        </div>
        <template v-else>
          <div
            v-if="guide.ack"
            class="guide-ack"
          >
            {{ guide.ack }}
          </div>
          <div
            v-if="guide.question"
            class="guide-question"
          >
            <span
              v-if="guide.index"
              class="guide-index"
            >第 {{ guide.index }} 题 · </span>{{ guide.question }}
          </div>
          <div
            v-if="guide.lead"
            class="guide-lead"
          >
            {{ guide.lead }}
          </div>
          <div
            v-if="guide.hint"
            class="guide-hint"
          >
            {{ guide.hint }}
          </div>
          <div
            v-if="guide.note"
            class="guide-note"
          >
            {{ guide.note }}
          </div>
          <div
            v-if="guide.detail"
            class="guide-detail"
          >
            {{ guide.detail }}
          </div>
        </template>
        <div
          v-if="optionList.length"
          class="guide-options"
        >
          <button
            v-for="(option, index) in optionList"
            :key="(option.key || 'free') + index"
            type="button"
            class="guide-option"
            :class="{ 'is-free': option.freeform, 'is-action': option.action }"
            :disabled="choiceLocked"
            :title="option.detail || undefined"
            @click="$emit('choose', option)"
          >
            <b v-if="option.key">{{ option.key }}</b> {{ option.label }}
          </button>
        </div>
      </template>
      <template v-else>
        <span class="bubble-text">{{ displayText }}</span>
        <span
          v-if="!isDone"
          class="cursor"
        >|</span>
      </template>
    </div>
    <div class="bubble-arrow"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { Live2DManager } from '../live2d/manager';

export interface GuideBubbleContent {
  ack?: string;
  question?: string;
  index?: number;
  hint?: string;
  note?: string;
  lead?: string;
  detail?: string;
  streaming?: boolean;
  kind?: string;
}

export interface GuideOption {
  key?: string;
  label: string;
  detail?: string;
  freeform?: boolean;
  action?: boolean;
}

const props = defineProps<{
  text: string;
  isDone: boolean;
  autoCloseDelaySeconds?: number;
  // 卡片工作台引导：有内容时气泡按结构化内容显示，选项变按钮，不自动关闭。
  guide?: GuideBubbleContent | null;
  options?: GuideOption[];
  choiceDisabled?: boolean;
}>();

const emit = defineEmits<{
  hidden: [];
  choose: [option: GuideOption];
}>();

const visible = ref(false);
const displayText = ref('');
const bubbleStyle = ref<Record<string, string>>({});
const optionList = computed(() => (props.guide && Array.isArray(props.options) ? props.options : []));
const choiceLocked = computed(() => props.choiceDisabled === true);

const HEAD_ANCHOR_RATIO = 0.2;
const BUBBLE_GAP = 12;
const MIN_BUBBLE_TOP = 8;
const EDGE_PADDING = 8;
const LOADING_FRAMES = ['。。。', '。。', '。', '。。'] as const;
const LOADING_INTERVAL_MS = 340;

let positionTimer: ReturnType<typeof setInterval> | null = null;
let loadingTimer: ReturnType<typeof setInterval> | null = null;
let autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
let loadingFrameIndex = 0;

function getTopWindow(): Window {
  try {
    return window.parent ?? window;
  } catch {
    return window;
  }
}

function getFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function getModelHeadAnchor(rect: DOMRect): { x: number; y: number } | null {
  const model = Live2DManager.model as any;
  if (!model || typeof model.getBounds !== 'function') return null;

  try {
    const bounds = model.getBounds?.();
    const x = getFiniteNumber(bounds?.x);
    const y = getFiniteNumber(bounds?.y);
    const width = getFiniteNumber(bounds?.width);
    const height = getFiniteNumber(bounds?.height);
    if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
      return null;
    }

    return {
      x: rect.left + x + width / 2,
      y: rect.top + y + height * HEAD_ANCHOR_RATIO,
    };
  } catch {
    return null;
  }
}

function updateBubblePosition(): void {
  try {
    const top = getTopWindow();
    const stage = top.document.getElementById('desktop-pet-stage') as HTMLElement | null;
    const rect = stage?.getBoundingClientRect?.();
    const vw = top.innerWidth || top.document.documentElement.clientWidth || 0;
    const vh = top.innerHeight || top.document.documentElement.clientHeight || 0;

    if (rect && rect.width > 0 && rect.height > 0) {
      const anchor = getModelHeadAnchor(rect);
      const fallbackX = rect.left + rect.width / 2;
      const fallbackY = rect.top + rect.height * 0.22;
      const rawLeft = anchor?.x ?? fallbackX;
      const rawTop = (anchor?.y ?? fallbackY) - BUBBLE_GAP;
      // 气泡有固定宽度，左右各留半宽，避免贴边被裁掉。
      const halfBubble = Math.min(160, Math.max(40, (vw - 32) / 2));
      const safeLeft = Math.max(halfBubble + EDGE_PADDING, Math.min(rawLeft, Math.max(halfBubble + EDGE_PADDING, vw - halfBubble - EDGE_PADDING)));
      const safeTop = Math.max(MIN_BUBBLE_TOP, Math.min(rawTop, Math.max(MIN_BUBBLE_TOP, vh - EDGE_PADDING)));

      bubbleStyle.value = {
        left: `${Math.round(safeLeft)}px`,
        top: `${Math.round(safeTop)}px`,
      };
      return;
    }

    bubbleStyle.value = {
      left: `${Math.round(vw * 0.5)}px`,
      top: `${Math.round(Math.max(8, vh * 0.2))}px`,
    };
  } catch {
    bubbleStyle.value = {
      left: '50vw',
      top: '20vh',
    };
  }
}

function startPositionSync(): void {
  stopPositionSync();
  updateBubblePosition();
  positionTimer = setInterval(updateBubblePosition, 100);
}

function stopPositionSync(): void {
  if (!positionTimer) return;
  clearInterval(positionTimer);
  positionTimer = null;
}

function startLoadingAnimation(): void {
  if (loadingTimer) return;
  loadingFrameIndex = 0;
  displayText.value = LOADING_FRAMES[loadingFrameIndex];
  loadingTimer = setInterval(() => {
    loadingFrameIndex = (loadingFrameIndex + 1) % LOADING_FRAMES.length;
    displayText.value = LOADING_FRAMES[loadingFrameIndex];
  }, LOADING_INTERVAL_MS);
}

function stopLoadingAnimation(): void {
  if (!loadingTimer) return;
  clearInterval(loadingTimer);
  loadingTimer = null;
}

function stopAutoCloseTimer(): void {
  if (!autoCloseTimer) return;
  clearTimeout(autoCloseTimer);
  autoCloseTimer = null;
}

function getAutoCloseDelayMs(): number {
  const delaySeconds =
    typeof props.autoCloseDelaySeconds === 'number'
      ? props.autoCloseDelaySeconds
      : Number(props.autoCloseDelaySeconds ?? Number.NaN);
  if (!Number.isFinite(delaySeconds)) return -1;

  const normalizedSeconds = Math.round(delaySeconds);
  if (normalizedSeconds < 0) return normalizedSeconds;
  return normalizedSeconds * 1000;
}

function scheduleAutoClose(): void {
  stopAutoCloseTimer();
  if (!props.isDone) return;
  if (!String(props.text || '').trim()) return;

  const delayMs = getAutoCloseDelayMs();
  if (delayMs < 0) return;

  autoCloseTimer = setTimeout(() => {
    autoCloseTimer = null;
    closeBubble();
  }, delayMs);
}

function syncBubbleState(): void {
  if (props.guide) {
    // 引导气泡：内容由 props.guide 决定，不自动关闭，也不显示「。。。」加载帧。
    visible.value = true;
    displayText.value = '';
    stopLoadingAnimation();
    stopAutoCloseTimer();
    startPositionSync();
    return;
  }
  const text = String(props.text || '');

  if (text) {
    visible.value = true;
    displayText.value = text;
    stopLoadingAnimation();
    startPositionSync();
    scheduleAutoClose();
    return;
  }

  if (!props.isDone) {
    visible.value = true;
    startLoadingAnimation();
    startPositionSync();
    stopAutoCloseTimer();
    return;
  }

  visible.value = false;
  displayText.value = '';
  stopLoadingAnimation();
  stopPositionSync();
  stopAutoCloseTimer();
}

watch(
  [() => props.text, () => props.isDone, () => props.autoCloseDelaySeconds, () => props.guide, () => props.options],
  syncBubbleState,
  { immediate: true, deep: true },
);

function closeBubble(): void {
  visible.value = false;
  displayText.value = '';
  stopLoadingAnimation();
  stopPositionSync();
  stopAutoCloseTimer();
  emit('hidden');
}

onUnmounted(() => {
  stopLoadingAnimation();
  stopPositionSync();
  stopAutoCloseTimer();
});
</script>

<style lang="scss" scoped>
@use './styles/theme-arknights.scss' as theme;

.chat-bubble {
  position: fixed;
  transform: translate(-50%, -100%);
  /* 定死宽度：父节点是零尺寸的浮层根，shrink-to-fit 会把气泡压成 min-width 一条竖线。 */
  width: min(320px, calc(100vw - 32px));
  animation: bubble-in 0.22s ease-out;
  z-index: 1300;
  pointer-events: none;
}

.bubble-content {
  position: relative;
  background: rgba(14, 14, 14, 0.96);
  color: theme.$ark-text-main;
  border: 1px solid theme.$ark-accent-yellow;
  padding: 9px 26px 10px 13px;
  clip-path: polygon(
    10px 0,
    100% 0,
    100% calc(100% - 10px),
    calc(100% - 10px) 100%,
    0 100%,
    0 10px
  );
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
  box-shadow: 8px 8px 0 rgba(0, 0, 0, 0.56);
  font-family: theme.$font-cn;
  pointer-events: auto;

  &::after {
    content: '';
    position: absolute;
    right: 22px;
    bottom: -2px;
    width: 30px;
    height: 3px;
    background: theme.$ark-accent-yellow;
  }
}

.bubble-text {
  white-space: pre-wrap;
}

.cursor {
  animation: blink 0.64s infinite;
  margin-left: 1px;
  color: theme.$ark-accent-cyan;
}

.bubble-close {
  position: absolute;
  right: 6px;
  top: 5px;
  width: 15px;
  height: 15px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  line-height: 13px;
  text-align: center;
  cursor: pointer;
  font-size: 10px;
  padding: 0;
  font-family: theme.$font-en;

  &:hover {
    background: theme.$ark-danger;
    border-color: theme.$ark-danger;
  }
}

.bubble-arrow {
  width: 11px;
  height: 11px;
  background: rgba(14, 14, 14, 0.96);
  border-left: 1px solid theme.$ark-accent-yellow;
  border-bottom: 1px solid theme.$ark-accent-yellow;
  transform: rotate(-45deg);
  margin: 0 auto;
  margin-top: -6px;
}

@keyframes bubble-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(8px) scale(0.9);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
  }
}

@keyframes blink {
  0%, 50% {
    opacity: 1;
  }
  51%, 100% {
    opacity: 0;
  }
}

/* 卡片工作台引导：比吐槽气泡宽，内容可滚动，选项是一排按钮。 */
.chat-bubble.is-guide {
  width: min(380px, calc(100vw - 32px));
}

.bubble-content.is-guide {
  max-height: 55vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  pointer-events: auto;
}

.guide-ack {
  color: theme.$ark-text-sub;
  font-size: 12px;
}

.guide-question {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.guide-lead {
  font-size: 13px;
  line-height: 1.5;
}

.guide-hint,
.guide-detail,
.guide-note {
  margin-top: 4px;
  color: theme.$ark-text-sub;
  font-size: 12px;
  line-height: 1.5;
}

.guide-streaming {
  white-space: pre-wrap;
  word-break: break-word;
}

.guide-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.guide-option {
  border: 1px solid rgba(255, 225, 0, 0.45);
  border-radius: 999px;
  padding: 3px 10px;
  background: rgba(255, 225, 0, 0.08);
  color: theme.$ark-text-main;
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
  text-align: left;

  b {
    color: theme.$ark-accent-yellow;
    margin-right: 4px;
  }

  &:hover:not(:disabled) {
    border-color: theme.$ark-accent-yellow;
    background: rgba(255, 225, 0, 0.18);
  }

  &.is-free {
    border-style: dashed;
  }

  &.is-action {
    background: theme.$ark-accent-yellow;
    color: #141414;

    b {
      color: #141414;
    }
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
}
</style>
