// 把中文情绪标签落到 Live2D：先找原生表情/动作，再退回内置（程序化）动作。
// 悬浮桌宠的吐槽和卡片工作台引导共用这一份，避免两套映射各走各的。
import type { EmotionTag } from '../core/constants';
import { getEmotionConfigByTag, type EmotionConfig } from '../core/emotion';
import { error as logError } from '../utils/dom';
import { resolveLive2DExpression, resolveLive2DMotion } from './expression-motion';
import { Live2DManager } from './manager';

export function applyEmotionToLive2D(tag: EmotionTag, configs: unknown): boolean {
  try {
    const model = Live2DManager.model as any;
    if (!model) return false;

    let applied = false;
    const cfg: EmotionConfig | null = getEmotionConfigByTag(tag, configs);

    const expressionResolved = resolveLive2DExpression(model, tag, cfg?.live2dExpression);
    if (expressionResolved?.type === 'native') {
      Live2DManager.playExpression(expressionResolved.name);
      applied = true;
    } else if (expressionResolved?.type === 'builtin') {
      if (Live2DManager.applyBuiltinExpression(expressionResolved.key)) {
        applied = true;
      }
    }

    const motionResolved = resolveLive2DMotion(model, tag, cfg?.live2dMotion);
    if (motionResolved?.type === 'native') {
      Live2DManager.playMotion(motionResolved.group, motionResolved.index);
      applied = true;
    } else if (motionResolved?.type === 'builtin') {
      if (Live2DManager.playBuiltinMotion(motionResolved.key)) {
        applied = true;
      }
    } else if (motionResolved?.type === 'disabled') {
      Live2DManager.stopBuiltinMotion();
    }
    return applied;
  } catch (error) {
    logError('表情联动播放失败', error);
    return false;
  }
}
