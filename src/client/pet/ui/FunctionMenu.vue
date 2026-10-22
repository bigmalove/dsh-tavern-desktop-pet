<template>
  <div v-if="visible" class="menu-overlay" @click.self="close">
    <div
      ref="menuEl"
      class="menu-cluster"
      :class="[`is-${placement}`, { 'chat-open': chatOpen }]"
      :style="panelStyle"
      @click.stop
    >
      <div class="menu-panel" role="menu" aria-label="桌宠菜单">
        <div class="panel-top">
          <span class="panel-title">桌宠</span>
          <button class="icon-btn" type="button" aria-label="关闭菜单" @click="close">
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <button class="command-btn" type="button" role="menuitem" :class="{ active: chatOpen }" @click="openChat">
          <svg class="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 14a3 3 0 0 1-3 3H8l-4 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
          </svg>
          <span class="command-main">聊天</span>
          <span class="command-sub">说句话</span>
        </button>

        <button class="command-btn" type="button" role="menuitem" @click="$emit('toggle-motion-loop')">
          <svg class="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M8 5l11 7-11 7z" />
          </svg>
          <span class="command-main">动作</span>
          <span class="command-sub">{{ motionLoopEnabled ? '自动开' : '自动关' }}</span>
        </button>

        <button class="command-btn" type="button" role="menuitem" @click="$emit('switch-model')">
          <svg class="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3l8 4.5-8 4.5-8-4.5zM4 12l8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
          </svg>
          <span class="command-main">换形象</span>
          <span class="command-sub">模型库</span>
        </button>

        <button class="command-btn" type="button" role="menuitem" @click="$emit('switch-persona')">
          <svg class="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 21a7.5 7.5 0 0 1 15 0" />
          </svg>
          <span class="command-main">吐槽人设</span>
          <span class="command-sub">{{ commentStyle }}</span>
        </button>

        <button class="command-btn" type="button" role="menuitem" @click="$emit('open-settings')">
          <svg class="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          <span class="command-main">设置</span>
          <span class="command-sub">全部选项</span>
        </button>

        <button class="command-btn danger" type="button" role="menuitem" @click="$emit('close-model')">
          <svg class="command-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v9M6.6 6.6a8 8 0 1 0 10.8 0" />
          </svg>
          <span class="command-main">关闭桌宠</span>
          <span class="command-sub">停止显示</span>
        </button>
      </div>

      <transition name="drawer">
        <div v-if="chatOpen" class="chat-drawer">
          <div class="drawer-head">
            <span class="drawer-title">和桌宠说句话</span>
            <button class="drawer-close" type="button" aria-label="关闭聊天" @click="chatOpen = false">
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <textarea
            ref="inputEl"
            v-model="input"
            class="chat-input"
            rows="4"
            placeholder="输入想说的话…（Enter 发送 / Shift+Enter 换行）"
            @keydown="onInputKeydown"
          />

          <div class="drawer-actions">
            <button class="send-btn" type="button" :disabled="!input.trim()" @click="send">
              发送
            </button>
          </div>
          <div class="drawer-hint">会带着最近聊天上下文。</div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import type { CommentStyle } from '../core/constants';

const props = defineProps<{
  visible: boolean;
  x: number;
  y: number;
  placement: 'left' | 'right';
  motionLoopEnabled: boolean;
  commentStyle: CommentStyle;
}>();

const emit = defineEmits<{
  close: [];
  'send-chat': [message: string];
  'toggle-motion-loop': [];
  'switch-model': [];
  'switch-persona': [];
  'open-settings': [];
  'close-model': [];
}>();

const menuEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const input = ref('');
const chatOpen = ref(false);

const posX = ref(0);
const posY = ref(0);

function getTopWindow(): Window {
  try {
    return window.parent ?? window;
  } catch {
    return window;
  }
}

const panelTransform = computed(() => (props.placement === 'left'
  ? 'translate(-100%, -50%)'
  : 'translate(0, -50%)'));

const panelStyle = computed(() => ({
  left: `${posX.value}px`,
  top: `${posY.value}px`,
  transform: panelTransform.value,
}));

function clampIntoViewport(): void {
  const el = menuEl.value;
  if (!el) return;

  const top = getTopWindow();
  const vw = top.innerWidth || top.document.documentElement.clientWidth || 0;
  const vh = top.innerHeight || top.document.documentElement.clientHeight || 0;
  const margin = 8;

  const rect = el.getBoundingClientRect();

  if (vw > 0) {
    if (rect.left < margin) {
      posX.value += margin - rect.left;
    } else if (rect.right > vw - margin) {
      posX.value -= rect.right - (vw - margin);
    }
  }

  if (vh > 0) {
    if (rect.top < margin) {
      posY.value += margin - rect.top;
    } else if (rect.bottom > vh - margin) {
      posY.value -= rect.bottom - (vh - margin);
    }
  }
}

function close(): void {
  chatOpen.value = false;
  emit('close');
}

function send(): void {
  const message = input.value.trim();
  if (!message) return;
  emit('send-chat', message);
  input.value = '';
}

function openChat(): void {
  chatOpen.value = true;
  void nextTick(() => {
    clampIntoViewport();
    inputEl.value?.focus();
    inputEl.value?.select();
  });
}

function onInputKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

const onGlobalKeydown = (e: KeyboardEvent) => {
  if (!props.visible) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
  }
};

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) {
      chatOpen.value = false;
      return;
    }
    posX.value = Number.isFinite(props.x) ? props.x : 0;
    posY.value = Number.isFinite(props.y) ? props.y : 0;
    chatOpen.value = false;
    await nextTick();
    clampIntoViewport();
  },
  { immediate: true },
);

watch(
  () => [props.x, props.y, props.placement, chatOpen.value] as const,
  async () => {
    if (!props.visible) return;
    posX.value = Number.isFinite(props.x) ? props.x : 0;
    posY.value = Number.isFinite(props.y) ? props.y : 0;
    await nextTick();
    clampIntoViewport();
  },
);

try {
  getTopWindow().addEventListener('keydown', onGlobalKeydown);
} catch {
  // ignore
}

onUnmounted(() => {
  try {
    getTopWindow().removeEventListener('keydown', onGlobalKeydown);
  } catch {
    // ignore
  }
});
</script>

<style lang="scss" scoped>
@use './styles/theme-dsh.scss' as dsh;

/* 长按菜单：DSH 的浮层菜单 + 设置面板同款表面 / 控件令牌。 */
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 1400;
  background: transparent;
}

.menu-cluster {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: calc(100vw - 16px);
  pointer-events: auto;

  &.is-left {
    flex-direction: row-reverse;
  }
}

.menu-panel {
  width: 220px;
  padding: 6px;
  overflow: hidden;
  @include dsh.surface(var(--dsw-radius-lg, 16px));
}

.panel-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 4px;
  padding: 6px 8px 8px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, #eee8e0);
}

.panel-title {
  color: var(--dsw-alias-label-primary, #141413);
  font-size: 13px;
  font-weight: 600;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6c6a64);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--dsw-alias-label-primary, #141413);
  }

  &:focus-visible {
    outline: 2px solid
      color-mix(
        in srgb,
        var(--dsw-alias-state-business-primary, #cc785c) 55%,
        transparent
      );
    outline-offset: 2px;
  }
}

.command-btn {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: var(--dsw-radius-md, 12px);
  background: transparent;
  color: var(--dsw-alias-label-primary, #141413);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
  }

  &.active {
    background: color-mix(
      in srgb,
      var(--dsw-alias-brand-primary, #cc785c) 16%,
      transparent
    );
  }

  &.active .command-icon {
    color: var(--dsw-alias-brand-primary, #cc785c);
  }

  &.danger {
    color: var(--dsw-alias-state-error-primary, #ec1313);

    .command-icon {
      color: inherit;
    }

    .command-sub {
      color: var(--dsw-alias-label-tertiary, #827d75);
    }

    &:hover:not(:disabled) {
      background: var(
        --dsw-alias-interactive-bg-hover-danger,
        color-mix(
          in srgb,
          var(--dsw-alias-state-error-primary, #ec1313) 10%,
          transparent
        )
      );
    }
  }

  &:focus-visible {
    outline: 2px solid
      color-mix(
        in srgb,
        var(--dsw-alias-state-business-primary, #cc785c) 55%,
        transparent
      );
    outline-offset: -2px;
  }
}

.command-icon {
  flex: none;
  width: 17px;
  height: 17px;
  color: var(--dsw-alias-label-secondary, #6c6a64);
}

.command-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-sub {
  flex: none;
  max-width: 96px;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary, #827d75);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-drawer {
  width: min(320px, calc(100vw - 36px));
  max-height: min(68vh, 420px);
  padding: 14px;
  overflow: auto;
  @include dsh.surface(var(--dsw-radius-lg, 16px));
  @include dsh.scrollbar;
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  padding-bottom: 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, #eee8e0);
}

.drawer-title {
  color: var(--dsw-alias-label-primary, #141413);
  font-size: 13px;
  font-weight: 600;
}

.drawer-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #6c6a64);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;

  &:hover {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--dsw-alias-label-primary, #141413);
  }

  &:focus-visible {
    outline: 2px solid
      color-mix(
        in srgb,
        var(--dsw-alias-state-business-primary, #cc785c) 55%,
        transparent
      );
    outline-offset: 2px;
  }
}

.chat-input {
  @include dsh.input-base;
  height: auto;
  min-height: 96px;
  padding: 9px 11px;
  line-height: 1.6;
  resize: vertical;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}

.send-btn {
  @include dsh.button-base(34px);
  min-width: 88px;
  border-color: var(--dsw-alias-brand-primary, #cc785c);
  background: var(--dsw-alias-brand-primary, #cc785c);
  color: var(--dsw-alias-brand-text, #fff);

  &:hover:not(:disabled) {
    border-color: var(--dsw-alias-button-primary-hover, #a9583e);
    background: var(--dsw-alias-button-primary-hover, #a9583e);
    color: var(--dsw-alias-brand-text, #fff);
  }
}

.drawer-hint {
  margin-top: 8px;
  color: var(--dsw-alias-label-tertiary, #827d75);
  font-size: 11px;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
  transform: translateX(-8px);
}

.menu-cluster.is-left {
  .drawer-enter-from,
  .drawer-leave-to {
    transform: translateX(8px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .drawer-enter-active,
  .drawer-leave-active {
    transition: none;
  }
}

@media (max-width: 620px) {
  /* 窄屏放不下「菜单 + 聊天」并排，改成上下两块。 */
  .menu-cluster,
  .menu-cluster.is-left {
    flex-direction: column;
    align-items: stretch;
    width: min(280px, calc(100vw - 16px));
    gap: 8px;
  }

  .menu-panel,
  .chat-drawer {
    width: 100%;
  }
}
</style>
