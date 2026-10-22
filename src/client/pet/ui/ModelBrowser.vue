<template>
  <div class="model-browser">
    <!-- 搜索框 -->
    <div class="search-box">
      <input
        type="text"
        v-model="searchQuery"
        placeholder="搜索已加载的目录..."
      />
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="error-bar">
      <span>{{ errorMsg }}</span>
      <button class="retry-btn" @click="loadRoot">重试</button>
    </div>

    <!-- 树形列表 -->
    <div class="tree-container">
      <div v-if="rootLoading" class="loading-state">
        <span class="spinner"></span> 加载中...
      </div>
      <template v-else>
        <TreeNode
          v-for="entry in filteredRootEntries"
          :key="entry.path"
          :entry="entry"
          :depth="0"
          :search-query="searchQuery"
          @select-model="onSelectModel"
        />
        <div v-if="rootEntries.length === 0 && !rootLoading" class="empty-state">
          该目录下暂无内容
        </div>
      </template>
    </div>

    <!-- 已选模型 & 操作 -->
    <div class="browser-footer">
      <div class="selected-info" v-if="selectedPath">
        已选: <span class="selected-path">{{ selectedName }}</span>
      </div>
      <div class="selected-info" v-else>
        <span class="no-selection">请选择一个模型文件</span>
      </div>
      <div class="footer-actions">
        <button class="btn btn-secondary" @click="$emit('cancel')">取消</button>
        <button
          class="btn btn-primary"
          :disabled="!selectedPath"
          @click="confirmLoad"
        >
          确认加载
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { fetchDirectory, buildCdnUrl, RateLimitError } from '../live2d/model-browser';
import type { RepoEntry } from '../live2d/model-browser';
import TreeNode from './TreeNode.vue';

const props = defineProps<{
  useCdn: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  'load-model': [url: string];
}>();

const rootEntries = ref<RepoEntry[]>([]);
const rootLoading = ref(false);
const errorMsg = ref('');
const searchQuery = ref('');
const selectedPath = ref('');

const selectedName = computed(() => {
  if (!selectedPath.value) return '';
  const parts = selectedPath.value.split('/');
  return parts[parts.length - 1];
});

const filteredRootEntries = computed(() => {
  if (!searchQuery.value.trim()) return rootEntries.value;
  const q = searchQuery.value.toLowerCase();
  return rootEntries.value.filter(e => e.name.toLowerCase().includes(q));
});

function onSelectModel(path: string) {
  selectedPath.value = path;
}

function confirmLoad() {
  if (!selectedPath.value) return;
  const cdnUrl = buildCdnUrl(selectedPath.value, props.useCdn);
  emit('load-model', cdnUrl);
}

async function loadRoot() {
  rootLoading.value = true;
  errorMsg.value = '';
  try {
    rootEntries.value = await fetchDirectory('');
  } catch (e: any) {
    if (e instanceof RateLimitError) {
      errorMsg.value = e.message;
    } else {
      errorMsg.value = `加载失败: ${e.message || '网络错误'}`;
    }
  } finally {
    rootLoading.value = false;
  }
}

// 初始加载根目录
loadRoot();
</script>

<style lang="scss" scoped>
@use './styles/theme-dsh.scss' as dsh;

.model-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  max-height: 60vh;
  color: var(--dsw-alias-label-primary, #141413);
  @include dsh.font;
}

.search-box {
  margin-bottom: 10px;

  input {
    @include dsh.input-base;
  }
}

.error-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  padding: 9px 12px;
  border: 0.5px solid
    color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 36%, transparent);
  border-radius: var(--dsw-radius-md, 12px);
  background: color-mix(
    in srgb,
    var(--dsw-alias-state-error-primary, #ec1313) 8%,
    transparent
  );
  color: var(--dsw-alias-state-error-primary, #ec1313);
  font-size: 12px;
  line-height: 1.5;

  .retry-btn {
    @include dsh.button-base(28px);
    flex: none;
    padding: 0 10px;
    font-size: 12px;
  }
}

.tree-container {
  flex: 1;
  min-height: 150px;
  padding: 4px 0;
  overflow-y: auto;
  border: 0.5px solid var(--dsw-alias-border-l2, #e6dfd8);
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-bg-layer-1, #f5f0e8);
  @include dsh.scrollbar;

  &:empty {
    border-style: dashed;
  }
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--dsw-alias-label-secondary, #6c6a64);
  font-size: 13px;
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--dsw-alias-border-l2, #e6dfd8);
  border-top-color: var(--dsw-alias-brand-primary, #cc785c);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-state {
  padding: 24px;
  color: var(--dsw-alias-label-tertiary, #827d75);
  font-size: 13px;
  text-align: center;
}

.browser-footer {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 0.5px solid var(--dsw-alias-border-l1, #eee8e0);

  .selected-info {
    margin-bottom: 8px;
    overflow: hidden;
    color: var(--dsw-alias-label-secondary, #6c6a64);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;

    .selected-path {
      color: var(--dsw-alias-brand-primary, #cc785c);
      font-weight: 600;
    }

    .no-selection {
      color: var(--dsw-alias-label-tertiary, #827d75);
    }
  }

  .footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
}

.btn {
  @include dsh.button-base(32px);
  min-width: 90px;
  padding: 0 14px;
  font-size: 12px;

  &.btn-primary {
    border-color: var(--dsw-alias-brand-primary, #cc785c);
    background: var(--dsw-alias-brand-primary, #cc785c);
    color: var(--dsw-alias-brand-text, #fff);

    &:hover:not(:disabled) {
      border-color: var(--dsw-alias-button-primary-hover, #a9583e);
      background: var(--dsw-alias-button-primary-hover, #a9583e);
      color: var(--dsw-alias-brand-text, #fff);
    }
  }

  &.btn-secondary {
    background: var(--dsw-alias-bg-layer-3, #fff);
  }
}
</style>
