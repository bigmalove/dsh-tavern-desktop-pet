import { ref } from 'vue';

// 停靠区是否已经接管了桌宠：固定气泡据此让位，避免同一句话显示两遍。
export const guideDockActive = ref(false);
