<template>
  <div
    v-if="active"
    class="guide-dock"
  >
    <div
      ref="stageHost"
      class="guide-dock-stage"
      aria-hidden="true"
      @click="patPet"
    ></div>
    <div class="guide-dock-main">
      <div class="guide-dock-bubble">
        <template v-if="streaming">
          <div class="guide-streaming">
            {{ bubble.lead || '…' }}<span class="cursor">|</span>
          </div>
        </template>
        <template v-else>
          <div
            v-if="bubble.ack"
            class="guide-ack"
          >
            {{ bubble.ack }}
          </div>
          <div
            v-if="bubble.question"
            class="guide-question"
          >
            <span
              v-if="index"
              class="guide-index"
            >第 {{ index }} 题 · </span>{{ bubble.question }}
          </div>
          <div
            v-if="bubble.lead"
            class="guide-lead"
          >
            {{ bubble.lead }}
          </div>
          <div
            v-if="bubble.hint"
            class="guide-hint"
          >
            {{ bubble.hint }}
          </div>
          <div
            v-if="bubble.note"
            class="guide-note"
          >
            {{ bubble.note }}
          </div>
          <div
            v-if="bubble.detail"
            class="guide-detail"
          >
            {{ bubble.detail }}
          </div>
        </template>
      </div>
      <div
        v-if="options.length"
        class="guide-dock-options"
      >
        <button
          v-for="(option, at) in options"
          :key="(option.key || 'free') + at"
          type="button"
          class="guide-dock-option"
          :class="{ 'is-free': option.freeform, 'is-action': option.action }"
          :disabled="choiceDisabled"
          :title="option.detail || undefined"
          @click="choose(option)"
        >
          <b v-if="option.key">{{ option.key }}</b> {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getVariables } from '../../bridge/shims';
import { guide } from '../../guide/session';
import { guideDockActive } from '../../guide/dock-state';
import { Live2DManager } from '../live2d/manager';
import { Live2DStage } from '../live2d/stage';

const state = ref<any>(null);
const stageHost = ref<HTMLElement | null>(null);
let stopGuide: (() => void) | null = null;
let stageTimer: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;
let lastWidth = 0;
let lastHeight = 0;
let fittedModel: unknown = null;
let lastFitAt = 0;
// 是否由停靠区把舞台搬走了。恢复时不能看 stageHost：active 翻成 false 时
// v-if 已经先把宿主元素卸掉，host 变 null，但舞台还在那个脱离文档的元素里。
let pushedByDock = false;

const active = computed(() => Boolean(state.value && state.value.active));
const bubble = computed(() => (state.value && state.value.bubble) || {});
const options = computed(() => (state.value && state.value.options) || []);
const streaming = computed(() => Boolean(state.value && state.value.streaming));
const choiceDisabled = computed(() => Boolean(state.value && state.value.choiceDisabled));
const index = computed(() => Number(bubble.value.index) || 0);

function choose(option: { key?: string; label: string; freeform?: boolean }): void {
  guide.choose(option);
}

function patPet(): void {
  Live2DManager.playRandomAnimation();
}

function measure(): { width: number; height: number } {
  const rect = stageHost.value?.getBoundingClientRect?.();
  return {
    width: Math.max(60, Math.round(rect?.width || 0)),
    height: Math.max(80, Math.round(rect?.height || 0)),
  };
}

/** 把舞台搬进停靠区，并按半身取景缩放；舞台还没建好时等下一轮。 */
function placeStage(): void {
  const host = stageHost.value;
  const container = Live2DStage.container;
  if (!host || !container || !Live2DStage.getStage()) return;
  if (!host.contains(container)) {
    if (!Live2DStage.pushMount(host)) return;
    pushedByDock = true;
    lastWidth = 0;
    lastHeight = 0;
    fittedModel = null;
  }
  const model = Live2DManager.model;
  if (!model) return;
  const { width, height } = measure();
  const sizeChanged = width !== lastWidth || height !== lastHeight;
  // 模型加载完成 / 换模型会重新挂载并整身取景；隔一会儿再校一次，避免被它覆盖。
  const stale = fittedModel !== model || Date.now() - lastFitAt > 2000;
  if (!sizeChanged && !stale) return;
  try {
    if (sizeChanged) Live2DStage.resizePreview(width, height);
    if (Live2DManager.fitDock(width, height)) {
      lastWidth = width;
      lastHeight = height;
      fittedModel = model;
      lastFitAt = Date.now();
    }
  } catch (error) {
    console.warn('[dsh-tavern-desktop-pet] 停靠区取景失败', error);
  }
}

/** 离开停靠区：把舞台还给右下角，恢复原来的尺寸与整身取景。 */
function restoreStage(): void {
  if (pushedByDock) {
    pushedByDock = false;
    try {
      Live2DStage.popMount();
    } catch (error) {
      console.warn('[dsh-tavern-desktop-pet] 取回舞台失败', error);
    }
  }
  const settings = getVariables() || {};
  const scale = Number(settings.petScale) || 0.55;
  const width = Math.max(1, Math.round(280 * scale));
  const height = Math.max(1, Math.round(360 * scale));
  try {
    Live2DStage.resizeFloating(width, height);
    Live2DManager.updateScale(width, height, 1);
  } catch {
    // 模型可能已经销毁，下次初始化会重新挂载。
  }
  lastWidth = 0;
  lastHeight = 0;
  fittedModel = null;
  lastFitAt = 0;
}

function observeStage(): void {
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (typeof ResizeObserver === 'function' && stageHost.value) {
    resizeObserver = new ResizeObserver(() => {
      if (active.value) placeStage();
    });
    resizeObserver.observe(stageHost.value);
  }
}

onMounted(() => {
  stopGuide = guide.subscribe((next: unknown) => {
    state.value = next;
  });
  guideDockActive.value = true;
  // 舞台由悬浮桌宠在应用启动后创建，这里等它出现；关掉再打开也会重新挂。
  stageTimer = setInterval(() => {
    if (active.value) placeStage();
  }, 400);
  if (active.value) void nextTick(() => { observeStage(); placeStage(); });
});

watch(active, (value) => {
  guideDockActive.value = value;
  if (value) {
    void nextTick(() => { observeStage(); placeStage(); });
    return;
  }
  restoreStage();
});

onUnmounted(() => {
  guideDockActive.value = false;
  if (stageTimer) clearInterval(stageTimer);
  stageTimer = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  stopGuide?.();
  stopGuide = null;
  restoreStage();
});
</script>

<style scoped>
.guide-dock {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  width: 100%;
  min-width: 0;
  padding: 2px 2px 8px;
  box-sizing: border-box;
}

.guide-dock-stage {
  position: relative;
  flex: none;
  width: 124px;
  height: 156px;
  overflow: hidden;
  cursor: pointer;
}

.guide-dock-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.guide-dock-bubble {
  position: relative;
  max-height: 28vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 13px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, var(--dsw-specific-sidebar-fill, #fff));
  color: var(--dsw-alias-label-primary, inherit);
  font-size: 13px;
  line-height: 1.6;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
}

/* 气泡的小尾巴，指向左边的桌宠。 */
.guide-dock-bubble::before {
  content: '';
  position: absolute;
  left: -7px;
  bottom: 26px;
  width: 12px;
  height: 12px;
  border-left: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.28));
  background: inherit;
  transform: rotate(45deg);
}

.guide-ack {
  color: var(--dsw-alias-label-secondary, #666);
  font-size: 12px;
}

.guide-question {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.guide-index {
  color: var(--dsw-alias-label-secondary, #666);
  font-weight: 500;
}

.guide-lead {
  font-size: 13px;
  line-height: 1.5;
}

.guide-hint,
.guide-detail,
.guide-note {
  margin-top: 4px;
  color: var(--dsw-alias-label-secondary, #666);
  font-size: 12px;
  line-height: 1.5;
}

.guide-streaming {
  white-space: pre-wrap;
  word-break: break-word;
}

.cursor {
  margin-left: 1px;
  color: var(--dsw-alias-brand-primary, #c96442);
  animation: guide-blink 0.64s infinite;
}

@keyframes guide-blink {
  50% {
    opacity: 0;
  }
}

.guide-dock-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.guide-dock-option {
  appearance: none;
  padding: 4px 11px;
  border: 1px solid var(--dsh-tavern-accent-border, var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.35)));
  border-radius: 999px;
  background: var(--dsw-alias-bg-base, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.guide-dock-option b {
  margin-right: 4px;
  color: var(--dsh-tavern-accent, #c96442);
}

.guide-dock-option:hover:not(:disabled) {
  border-color: var(--dsh-tavern-accent, #c96442);
  color: var(--dsh-tavern-accent, #c96442);
}

.guide-dock-option.is-free {
  border-style: dashed;
}

.guide-dock-option.is-action {
  border-color: transparent;
  background: var(--dsh-tavern-accent, #c96442);
  color: #fff;
}

.guide-dock-option.is-action b {
  color: #fff;
}

.guide-dock-option:disabled {
  opacity: 0.4;
  cursor: default;
}

@media (max-width: 900px), (pointer: coarse) {
  .guide-dock {
    gap: 8px;
    padding-bottom: 6px;
  }

  .guide-dock-stage {
    width: 88px;
    height: 112px;
  }

  .guide-dock-bubble {
    max-height: 24vh;
    padding: 8px 10px;
    font-size: 12px;
  }

  .guide-dock-options {
    flex-wrap: nowrap;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
  }

  .guide-dock-option {
    flex: none;
  }
}
</style>
