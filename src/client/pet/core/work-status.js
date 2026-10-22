// 工作状态 → 桌宠反应。纯函数，单测见 tests/work-status.test.mjs。
//
// 状态来自 Tavern 第 7 版的 tavernUi.watchWorkStatus：
//   idle / thinking / working / waiting / success / error。
// 这里只决定「摆什么表情、面板显示什么字」，不碰 Live2D 实例，
// 也不决定何时订阅（那是 PetContainer 的事）。

/** 状态 → 情绪标签；idle 不动表情，未知状态同样返回空串。 */
export const WORK_STATUS_FACES = Object.freeze({
  thinking: '思考',
  working: '思考',
  waiting: '惊讶',
  success: '微笑',
  error: '难过',
  idle: '',
});

/** 状态 → 面板文案。 */
export const WORK_STATUS_LABELS = Object.freeze({
  idle: '空闲',
  thinking: '思考中',
  working: '干活中',
  waiting: '等你回答',
  success: '刚忙完',
  error: '出错了',
});

/** 状态 → 情绪标签；不认识的返回空串（调用方据此不动表情）。 */
export function faceForWorkStatus(state) {
  const key = String(state || '').trim();
  return Object.prototype.hasOwnProperty.call(WORK_STATUS_FACES, key) ? WORK_STATUS_FACES[key] : '';
}

/** 状态 → 面板文案；干活时把工具名附上，便于确认状态是从哪来的。 */
export function labelForWorkStatus(status) {
  const state = String((status && status.state) || '').trim();
  const label = Object.prototype.hasOwnProperty.call(WORK_STATUS_LABELS, state) ? WORK_STATUS_LABELS[state] : '未知';
  const tool = status && typeof status.tool === 'string' ? status.tool.trim() : '';
  return state === 'working' && tool ? label + ' · ' + tool : label;
}

/**
 * 工作状态的表情该不该现在动：
 *   - 引导员在工作台里自己管表情，不抢；
 *   - 气泡正显示时也不动（那是吐槽/对话/引导的台词）；
 *   - idle 与未知状态不动。
 */
export function shouldApplyWorkStatusFace(input) {
  const status = input && input.status;
  const state = String((status && status.state) || '');
  if (!state || state === 'idle') return false;
  if (input.guideActive === true) return false;
  if (input.bubbleVisible === true) return false;
  return faceForWorkStatus(state) !== '';
}
