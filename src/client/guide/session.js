// 引导控制器的单例：悬浮桌宠（PetContainer）和停靠区（GuideDock）是同一个页面里的
// 两个 Vue 应用，状态只能有一份，否则两边各订阅一次 watchReply 会出现两份气泡。
//
// 这里也负责「配合台词做表情和姿势动作」：只改本文件与共享的 emotion-apply，
// 不动 main.js。
import { getVariables } from '../bridge/shims.js';
import {
  currentGameId,
  fillInput,
  onGameChange,
  speak,
  standardEmotion,
  submitChoice,
  watchReply,
} from '../bridge/tavern.js';
import { applyEmotionToLive2D } from '../pet/live2d/emotion-apply';
import { Live2DManager } from '../pet/live2d/manager';
import { createGuideController } from './guide-controller.js';

let talkTimer = null;
let talkSerial = 0;
// 同一个情绪标签连续两轮不重复触发内置动作；换轮次或换阶段才重播。
let poseSerial = 0;

function emotionConfigs() {
  const settings = getVariables() || {};
  return Array.isArray(settings.emotionConfigs) ? settings.emotionConfigs : [];
}

/**
 * 按情绪标签做表情 + 姿势动作。模型还没加载时短暂重试，新的一次调用会作废旧的重试。
 * 返回是否真的播到了什么；什么都没匹配到时由调用方退回随机动作。
 */
function applyGuidePose(mood) {
  const tag = String(mood || '默认');
  const serial = ++poseSerial;
  const attempt = (left) => {
    if (serial !== poseSerial) return false;
    if (!Live2DManager.model) {
      // 模型从 CDN 加载可能要十几秒：等它一会儿，但新的一次调用会作废旧重试。
      if (left > 0) setTimeout(() => attempt(left - 1), 1200);
      return false;
    }
    const applied = applyEmotionToLive2D(tag, emotionConfigs());
    if (!applied) Live2DManager.playRandomAnimation();
    try {
      console.log('[dsh-tavern-desktop-pet] 引导动作', { mood: tag, applied });
    } catch {
      // ignore
    }
    return applied;
  };
  return attempt(10);
}

/** 念一句时的口型：与 TTS 无关，没配置配音也动嘴。模型没就绪时等它一会儿。 */
function animateTalking(text) {
  const body = String(text || '').trim();
  if (!body) return;
  const serial = ++talkSerial;
  const duration = Math.min(9000, Math.max(1000, body.length * 160));
  const start = (left) => {
    if (serial !== talkSerial) return;
    if (!Live2DManager.startTalking()) {
      if (left > 0) setTimeout(() => start(left - 1), 1200);
      return;
    }
    if (talkTimer !== null) clearTimeout(talkTimer);
    talkTimer = setTimeout(() => {
      talkTimer = null;
      Live2DManager.stopTalking();
    }, duration);
  };
  start(10);
}

export function stopGuideTalking() {
  if (talkTimer !== null) {
    clearTimeout(talkTimer);
    talkTimer = null;
  }
  Live2DManager.stopTalking();
}

export const guide = createGuideController({
  currentSessionId: () => currentGameId(),
  onSessionChange: (listener) => onGameChange((next) => listener(next)),
  watchReply: (sessionId, listener) => watchReply(sessionId, listener),
  speak: (text, mood) => {
    // 先摆姿势、再动口型；配音是可选增强，没有 TTS 时也该像在说话。
    applyGuidePose(mood);
    animateTalking(text);
    const settings = getVariables() || {};
    if (settings.ttsAutoPlay === false) return;
    void speak({ text, emotion: standardEmotion(mood) });
  },
  submitChoice: (text) => {
    stopGuideTalking();
    // 玩家点了选项：点一下头（模型有自带动作就随机挑一个）。
    Live2DManager.playRandomAnimation();
    return submitChoice(text);
  },
  fillInput: () => {
    // 「你定」：换成思考的表情，等玩家自己写。
    applyGuidePose('思考');
    return fillInput('');
  },
});

// 生成中 / 刚进空工作台也要有反应。呈现阶段由 speak 里的 applyGuidePose 负责，
// 这里跳过 presenting，避免同一轮播两次。
let lastPoseKey = '';
guide.subscribe((state) => {
  if (!state || !state.active) {
    lastPoseKey = '';
    return;
  }
  const key = String(state.turn) + '|' + state.phase + '|' + state.kind;
  if (key === lastPoseKey) return;
  lastPoseKey = key;
  if (state.phase === 'thinking' || state.phase === 'streaming') {
    applyGuidePose('思考');
    return;
  }
  if (state.phase === 'idle' && state.bubble && state.bubble.lead) {
    applyGuidePose('微笑');
  }
});
