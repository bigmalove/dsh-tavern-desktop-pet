// registerReplyPresenter 的 present()：只认「提问轮」，其余一律返回 null，
// 让主区保持原样。解析规则与桌宠气泡共用 reply-parser。

import { foldSummary, parseReply } from './reply-parser.js';

export function createGuidePresenter() {
  return {
    id: 'workbench-question',
    modes: ['card'],
    present(message) {
      const text = String((message && message.text) || '');
      if (!text.trim()) return null;
      if (message && message.streaming === true) return null;
      const parsed = parseReply(text, { changed: message && message.changed === true });
      const summary = foldSummary(parsed);
      return summary === null ? null : { fold: { summary } };
    },
  };
}
