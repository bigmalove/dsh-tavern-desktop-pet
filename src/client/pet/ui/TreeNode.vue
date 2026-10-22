<template>
  <div class="tree-node">
    <div
      class="node-row"
      :style="{ paddingLeft: depth * 16 + 'px' }"
      :class="{ 'is-model': entry.isModel, 'is-selected': isSelected }"
      @click="handleClick"
    >
      <!-- 展开/折叠箭头（仅目录） -->
      <span v-if="entry.type === 'dir'" class="expand-icon" :class="{ expanded }">
        ▶
      </span>
      <span v-else class="expand-icon placeholder"></span>

      <!-- 图标 -->
      <span class="node-icon">
        <template v-if="entry.type === 'dir'">📁</template>
        <template v-else-if="entry.isModel">⭐</template>
        <template v-else>📄</template>
      </span>

      <!-- 名称 -->
      <span class="node-name" :title="entry.path">{{ entry.name }}</span>

      <!-- 加载指示器 -->
      <span v-if="loading" class="node-spinner"></span>
    </div>

    <!-- 子节点 -->
    <template v-if="expanded && children.length > 0">
      <TreeNode
        v-for="child in filteredChildren"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :search-query="searchQuery"
        @select-model="$emit('select-model', $event)"
      />
    </template>

    <!-- 子目录为空 -->
    <div
      v-if="expanded && !loading && children.length === 0 && loadedOnce"
      class="empty-hint"
      :style="{ paddingLeft: (depth + 1) * 16 + 8 + 'px' }"
    >
      暂无模型文件
    </div>

    <!-- 子目录加载错误 -->
    <div
      v-if="expanded && childError"
      class="child-error"
      :style="{ paddingLeft: (depth + 1) * 16 + 8 + 'px' }"
    >
      {{ childError }}
      <button class="retry-link" @click.stop="loadChildren">重试</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { fetchDirectory, RateLimitError } from '../live2d/model-browser';
import type { RepoEntry } from '../live2d/model-browser';

const props = defineProps<{
  entry: RepoEntry;
  depth: number;
  searchQuery: string;
}>();

const emit = defineEmits<{
  'select-model': [path: string];
}>();

const expanded = ref(false);
const children = ref<RepoEntry[]>([]);
const loading = ref(false);
const loadedOnce = ref(false);
const childError = ref('');
const isSelected = ref(false);

const filteredChildren = computed(() => {
  if (!props.searchQuery.trim()) return children.value;
  const q = props.searchQuery.toLowerCase();
  return children.value.filter(c =>
    c.name.toLowerCase().includes(q) || c.type === 'dir'
  );
});

async function loadChildren() {
  loading.value = true;
  childError.value = '';
  try {
    children.value = await fetchDirectory(props.entry.path);
    loadedOnce.value = true;
  } catch (e: any) {
    if (e instanceof RateLimitError) {
      childError.value = e.message;
    } else {
      childError.value = `加载失败: ${e.message || '网络错误'}`;
    }
  } finally {
    loading.value = false;
  }
}

function handleClick() {
  if (props.entry.type === 'dir') {
    expanded.value = !expanded.value;
    if (expanded.value && !loadedOnce.value) {
      loadChildren();
    }
  } else if (props.entry.isModel) {
    isSelected.value = true;
    emit('select-model', props.entry.path);
  }
}
</script>

<style lang="scss" scoped>
@use './styles/theme-dsh.scss' as dsh;

.node-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 0.5px solid var(--dsw-alias-border-l1, #eee8e0);
  color: var(--dsw-alias-label-secondary, #6c6a64);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  transition: background 0.14s ease, color 0.14s ease;

  &:hover {
    background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
    color: var(--dsw-alias-label-primary, #141413);
  }

  &.is-model {
    .node-name {
      color: var(--dsw-alias-brand-primary, #cc785c);
      font-weight: 500;
    }
  }

  &.is-selected {
    background: color-mix(
      in srgb,
      var(--dsw-alias-brand-primary, #cc785c) 14%,
      transparent
    );

    .node-name {
      color: var(--dsw-alias-label-primary, #141413);
    }
  }
}

.expand-icon {
  flex-shrink: 0;
  width: 14px;
  color: var(--dsw-alias-label-tertiary, #827d75);
  font-size: 8px;
  text-align: center;
  transition: transform 0.2s;

  &.expanded {
    transform: rotate(90deg);
  }

  &.placeholder {
    visibility: hidden;
  }
}

.node-icon {
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1;
}

.node-name {
  flex: 1;
  overflow: hidden;
  color: var(--dsw-alias-label-primary, #141413);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-spinner {
  display: inline-block;
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  margin-left: 4px;
  border: 1.5px solid var(--dsw-alias-border-l2, #e6dfd8);
  border-top-color: var(--dsw-alias-brand-primary, #cc785c);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.empty-hint {
  padding: 4px 10px;
  color: var(--dsw-alias-label-tertiary, #827d75);
  font-size: 11px;
}

.child-error {
  padding: 4px 10px;
  color: var(--dsw-alias-state-error-primary, #ec1313);
  font-size: 11px;

  .retry-link {
    @include dsh.button-base(26px);
    min-width: 56px;
    margin-left: 6px;
    padding: 0 8px;
    font-size: 11px;
  }
}
</style>
