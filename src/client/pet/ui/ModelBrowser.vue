<template>
  <div class="model-browser">
    <!-- 模型库地址：插件不内置，玩家自己填并保存 -->
    <div class="repo-box">
      <div class="repo-row">
        <input
          type="text"
          v-model="repoInput"
          placeholder="GitHub 仓库，如 owner/repo、owner/repo@main/models 或仓库链接"
          @keydown.enter="saveRepo"
        />
        <button class="btn btn-primary repo-btn" type="button" :disabled="!repoInput.trim()" @click="saveRepo">
          保存并加载
        </button>
      </div>
      <div class="repo-hint">插件不内置在线模型库：填一个存放 Live2D 模型的 GitHub 仓库地址，保存后会记住。</div>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMsg" class="error-bar">
      <span>{{ errorMsg }}</span>
      <button v-if="source" class="retry-btn" @click="loadRoot">重试</button>
    </div>

    <template v-if="source">
      <!-- 搜索框 -->
      <div class="search-box">
        <input
          type="text"
          v-model="searchQuery"
          placeholder="搜索已加载的目录..."
        />
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
          <div v-if="rootEntries.length === 0 && !rootLoading && !errorMsg" class="empty-state">
            该目录下暂无内容
          </div>
        </template>
      </div>
    </template>
    <div v-else class="tree-container empty-state">还没有设置模型库地址，先在上面填一个并保存。</div>

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
import { storeToRefs } from 'pinia';
import { ref, computed } from 'vue';
import { useSettingsStore } from '../core/settings';
import {
  buildModelUrl,
  fetchDirectory,
  formatRepoSource,
  parseRepoSource,
  RateLimitError,
  resolveRepoSource,
} from '../live2d/model-browser';
import type { RepoEntry, RepoSource } from '../live2d/model-browser';
import TreeNode from './TreeNode.vue';

const props = defineProps<{
  useCdn: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  'load-model': [url: string];
}>();

const store = useSettingsStore();
const { settings } = storeToRefs(store);
const repoInput = ref(settings.value.modelRepo || '');
const source = ref<RepoSource | null>(null);
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
  if (!selectedPath.value || !source.value) return;
  emit('load-model', buildModelUrl(source.value, selectedPath.value, props.useCdn));
}

function saveRepo() {
  const parsed = parseRepoSource(repoInput.value);
  if (!parsed) {
    errorMsg.value = '地址格式不对：请填 owner/repo、owner/repo@分支/目录，或 GitHub 仓库链接';
    return;
  }
  const normalized = formatRepoSource(parsed);
  repoInput.value = normalized;
  settings.value.modelRepo = normalized;
  void loadRoot();
}

async function loadRoot() {
  rootEntries.value = [];
  selectedPath.value = '';
  errorMsg.value = '';
  const parsed = parseRepoSource(settings.value.modelRepo);
  source.value = parsed;
  if (!parsed) return;

  rootLoading.value = true;
  try {
    // 没写分支就先查默认分支，目录列表和模型地址要指向同一个分支。
    const resolved = await resolveRepoSource(parsed);
    source.value = resolved;
    rootEntries.value = await fetchDirectory(resolved, resolved.basePath);
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

// 已保存过地址就直接加载；没保存过只显示输入框。
void loadRoot();
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

.repo-box {
  margin-bottom: 10px;

  .repo-row {
    display: flex;
    gap: 8px;

    input {
      @include dsh.input-base;
      flex: 1;
      min-width: 0;
    }
  }

  .repo-btn {
    flex: none;
  }

  .repo-hint {
    margin-top: 6px;
    color: var(--dsw-alias-label-tertiary, #827d75);
    font-size: 12px;
    line-height: 1.5;
  }
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
