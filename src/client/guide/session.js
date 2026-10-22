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
import { createGuideController } from './guide-controller.js';

export const guide = createGuideController({
  currentSessionId: () => currentGameId(),
  onSessionChange: (listener) => onGameChange((next) => listener(next)),
  watchReply: (sessionId, listener) => watchReply(sessionId, listener),
  speak: (text, mood) => {
    const settings = getVariables() || {};
    if (settings.ttsAutoPlay === false) return;
    void speak({ text, emotion: standardEmotion(mood) });
  },
  submitChoice: (text) => submitChoice(text),
  fillInput: () => fillInput(''),
});
