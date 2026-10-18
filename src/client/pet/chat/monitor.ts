import type { CommentTriggerMode } from '../core/constants';
import { watchTurns } from '../../bridge/tavern';
import { log } from '../utils/dom';

type MonitorCallback = () => void;

/**
 * 聊天监听。
 *
 * 上游版本挂在酒馆的 MESSAGE_SENT / GENERATION_ENDED 事件上，还要处理
 * 「自己调 generateRaw 也会触发一次」的问题。搬进 Tavern 后这两件事都由
 * `watchTurnState` 直接给出：
 *   - 从空闲变忙 = 玩家提交了一轮（对应上游的 user 信号）
 *   - 从忙变闲且结算完 = 这一轮正文写完（对应上游的 ai 信号）
 * 后台结算用的是独立 Agent，不会再冒充一轮，所以不需要 ignoreNextCount。
 *
 * 对外 API 与上游保持一致，PetContainer 的调用点不用改。
 */
export const ChatMonitor = {
  /** 距上次触发累计的轮数。 */
  messageCount: 0,

  /** 上游用来忽略自己生成的回合；Tavern 下用不到，保留字段避免调用点报错。 */
  ignoreNextCount: 0,

  _onTrigger: null as MonitorCallback | null,
  _stops: [] as Array<{ stop: () => void }>,
  _lastUserSignalAt: 0,

  _config: {
    autoTrigger: true,
    triggerInterval: 3,
    triggerProbability: 60,
    commentTriggerMode: 'ai' as CommentTriggerMode,
  },

  init(
    config: {
      autoTrigger: boolean;
      triggerInterval: number;
      triggerProbability: number;
      commentTriggerMode: CommentTriggerMode;
    },
    onTrigger: MonitorCallback,
  ): void {
    this.destroy();
    this._config = { ...config };
    this._onTrigger = onTrigger;
    this._lastUserSignalAt = 0;
    this.messageCount = 0;

    const stop = watchTurns({
      onStart: (turn: number) => {
        log(`检测到玩家提交（第 ${turn} 轮）`);
        this._recordUserSignal();
      },
      onSettled: (turn: number) => {
        log(`检测到正文写完（第 ${turn} 轮）`);
        this._handleTriggerCount('ai');
      },
    });

    if (stop) this._stops.push({ stop });
    log(
      `聊天监听器初始化完成(mode=${this._config.commentTriggerMode}, interval=${this._config.triggerInterval}, prob=${this._config.triggerProbability})`,
    );
  },

  updateConfig(config: {
    autoTrigger: boolean;
    triggerInterval: number;
    triggerProbability: number;
    commentTriggerMode: CommentTriggerMode;
  }): void {
    this._config = { ...config };
  },

  _shouldCountBySource(source: 'user' | 'ai'): boolean {
    const mode = this._config.commentTriggerMode;
    return mode === 'both' || mode === source;
  },

  _recordUserSignal(): void {
    const now = Date.now();
    // 一轮里可能连着来几次状态跳变，800ms 内只算一次。
    if (now - this._lastUserSignalAt < 800) return;
    this._lastUserSignalAt = now;
    this._handleTriggerCount('user');
  },

  _handleTriggerCount(source: 'user' | 'ai'): void {
    if (!this._shouldCountBySource(source)) return;
    this.messageCount++;
    log(`消息计数(${source}): ${this.messageCount}`);
    this._checkAutoTrigger();
  },

  _checkAutoTrigger(): void {
    if (!this._config.autoTrigger || !this._onTrigger) return;
    if (this.messageCount < this._config.triggerInterval) return;

    const roll = Math.random() * 100;
    if (roll > this._config.triggerProbability) {
      log(`概率不满足(${roll.toFixed(1)} > ${this._config.triggerProbability})`);
      return;
    }

    this.messageCount = 0;
    log('自动触发吐槽');
    this._onTrigger();
  },

  manualTrigger(): void {
    if (!this._onTrigger) return;
    log('手动触发吐槽');
    this._onTrigger();
  },

  resetState(): void {
    this.messageCount = 0;
    this.ignoreNextCount = 0;
    this._lastUserSignalAt = 0;
    log('聊天监听状态已重置');
  },

  markSelfGeneration(): void {
    this.ignoreNextCount++;
  },

  destroy(): void {
    for (const stop of this._stops) {
      try {
        stop.stop();
      } catch {
        // ignore
      }
    }
    this._stops = [];
    this._onTrigger = null;
    this.messageCount = 0;
    this.ignoreNextCount = 0;
    this._lastUserSignalAt = 0;
  },
};
