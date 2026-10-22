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

// 每种状态都准备几句，出状态时随机挑一句；同一次状态里不换，免得一句话闪来闪去。
const THINKING_LINES = Object.freeze([
  '生成中…',
  '让我想想…',
  '正在编故事…',
  '组织语言中…',
  '别急，在写了…',
  '正在酝酿…',
  '脑子转起来了…',
]);

const WORKING_LINES = Object.freeze([
  '干活中…',
  '忙起来了…',
  '手上有点活…',
  '正在处理…',
  '稍等，在办…',
  '这步有点费劲…',
]);

const WAITING_LINES = Object.freeze([
  '等你回答…',
  '想听听你的…',
  '轮到你了…',
  '在等你的答复…',
  '你说，我听着…',
]);

const SUCCESS_LINES = Object.freeze([
  '写完了！',
  '这轮搞定！',
  '完事收工～',
  '新鲜出炉！',
  '写好啦。',
  '这轮结束！',
]);

const ERROR_LINES = Object.freeze([
  '出错了…',
  '哎呀，翻车了…',
  '这轮没跑通…',
  '卡住了…',
  '出了点问题…',
]);

const SETTLEMENT_LINES = Object.freeze([
  '后台结算中…',
  '正在算这轮的账…',
  '更新状态中…',
  '对一下账…',
]);

/** 干活时按工具说一句更具体的；没登记的工具回落 WORKING_LINES。 */
const WORK_STATUS_TOOL_LINES = Object.freeze({
  ask_user_question: WAITING_LINES,
  tavern_update_card: Object.freeze(['写进卡里…', '正在改卡…', '把这段记进卡里…', '落笔到卡上…']),
  tavern_validate_card: Object.freeze(['检查格式…', '看看有没有写歪…', '校验中…']),
  tavern_copy_card: Object.freeze(['复制一份…', '正在备份…']),
});

/**
 * 状态 → 这一类的候选短句。idle 与未知状态返回空数组（气泡收起）。
 * 返回的是冻结数组，调用方不要改。
 */
export function bubblesForWorkStatus(status) {
  const state = String((status && status.state) || '').trim();
  if (state === 'thinking') return THINKING_LINES;
  if (state === 'working') {
    if (status.role === 'settlement') return SETTLEMENT_LINES;
    const tool = typeof status.tool === 'string' ? status.tool.trim() : '';
    return Object.prototype.hasOwnProperty.call(WORK_STATUS_TOOL_LINES, tool)
      ? WORK_STATUS_TOOL_LINES[tool]
      : WORKING_LINES;
  }
  if (state === 'waiting') return WAITING_LINES;
  if (state === 'success') return SUCCESS_LINES;
  if (state === 'error') return ERROR_LINES;
  return [];
}

/**
 * 从候选里挑一句；尽量避开上一句。`random` 可注入，单测用。
 * 一次状态只挑一次（由调用方在状态/工具变化时调用），不要在每次渲染里调。
 */
export function pickBubbleForWorkStatus(status, previous = '', random = Math.random) {
  const lines = bubblesForWorkStatus(status);
  if (lines.length === 0) return '';
  const usable = lines.length > 1 ? lines.filter((line) => line !== previous) : lines;
  const pool = usable.length > 0 ? usable : lines;
  const roll = typeof random === 'function' ? Number(random()) : 0;
  const index = Math.min(pool.length - 1, Math.max(0, Math.floor((Number.isFinite(roll) ? roll : 0) * pool.length)));
  return pool[index];
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
