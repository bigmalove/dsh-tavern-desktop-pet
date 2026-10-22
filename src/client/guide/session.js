// 引导控制器的单例：悬浮桌宠（PetContainer）和停靠区（GuideDock）是同一个页面里的
// 两个 Vue 应用，状态只能有一份，否则两边各订阅一次 watchReply 会出现两份气泡。
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
import { Live2DManager } from '../pet/live2d/manager';
import { createGuideController } from './guide-controller.js';

let talkTimer = null;

/** 念一句时的口型：与 TTS 无关，没配置配音也动嘴。 */
function animateTalking(text) {
  const body = String(text || '').trim();
  if (!body) return;
  Live2DManager.startTalking();
  if (talkTimer !== null) clearTimeout(talkTimer);
  talkTimer = setTimeout(() => {
    talkTimer = null;
    Live2DManager.stopTalking();
  }, Math.min(9000, Math.max(1000, body.length * 160)));
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
    // 口型先动：配音是可选增强，没有 TTS 时也该像在说话。
    animateTalking(text);
    const settings = getVariables() || {};
    if (settings.ttsAutoPlay === false) return;
    void speak({ text, emotion: standardEmotion(mood) });
  },
  submitChoice: (text) => {
    stopGuideTalking();
    return submitChoice(text);
  },
  fillInput: () => fillInput(''),
});
