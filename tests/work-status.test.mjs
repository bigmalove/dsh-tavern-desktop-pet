import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bubblesForWorkStatus,
  faceForWorkStatus,
  labelForWorkStatus,
  pickBubbleForWorkStatus,
  shouldApplyWorkStatusFace,
} from '../src/client/pet/core/work-status.js';

test('工作状态 → 表情：六个状态各有归宿，idle 与未知不动表情', () => {
  assert.equal(faceForWorkStatus('thinking'), '思考');
  assert.equal(faceForWorkStatus('working'), '思考');
  assert.equal(faceForWorkStatus('waiting'), '惊讶');
  assert.equal(faceForWorkStatus('success'), '微笑');
  assert.equal(faceForWorkStatus('error'), '难过');
  assert.equal(faceForWorkStatus('idle'), '');
  assert.equal(faceForWorkStatus(''), '');
  assert.equal(faceForWorkStatus('nonsense'), '');
  assert.equal(faceForWorkStatus(null), '');
});

test('工作状态 → 面板文案：干活时带上工具名', () => {
  assert.equal(labelForWorkStatus({ state: 'idle' }), '空闲');
  assert.equal(labelForWorkStatus({ state: 'thinking' }), '思考中');
  assert.equal(labelForWorkStatus({ state: 'working', tool: 'tavern_update_card' }), '干活中 · tavern_update_card');
  assert.equal(labelForWorkStatus({ state: 'working', tool: '' }), '干活中');
  assert.equal(labelForWorkStatus({ state: 'waiting' }), '等你回答');
  assert.equal(labelForWorkStatus({ state: 'success' }), '刚忙完');
  assert.equal(labelForWorkStatus({ state: 'error' }), '出错了');
  assert.equal(labelForWorkStatus(null), '未知');
});

test('工作状态的表情让位规则：引导员在、气泡在、idle 都不动', () => {
  assert.equal(shouldApplyWorkStatusFace({ status: { state: 'thinking' } }), true);
  assert.equal(shouldApplyWorkStatusFace({ status: { state: 'thinking' }, guideActive: true }), false);
  assert.equal(shouldApplyWorkStatusFace({ status: { state: 'thinking' }, bubbleVisible: true }), false);
  assert.equal(shouldApplyWorkStatusFace({ status: { state: 'idle' } }), false);
  assert.equal(shouldApplyWorkStatusFace({ status: { state: 'unknown' } }), false);
  assert.equal(shouldApplyWorkStatusFace(null), false);
});

test('工作状态 → 气泡短句：每类都有多句，工具/结算优先，挑的时候避开上一句', () => {
  assert.ok(bubblesForWorkStatus({ state: 'thinking' }).length >= 3);
  assert.ok(bubblesForWorkStatus({ state: 'thinking' }).includes('生成中…'));
  assert.ok(bubblesForWorkStatus({ state: 'working' }).includes('干活中…'));
  assert.ok(bubblesForWorkStatus({ state: 'working', role: 'settlement' }).includes('后台结算中…'));
  assert.ok(bubblesForWorkStatus({ state: 'working', tool: 'tavern_update_card' }).includes('写进卡里…'));
  assert.ok(bubblesForWorkStatus({ state: 'waiting' }).includes('等你回答…'));
  assert.ok(bubblesForWorkStatus({ state: 'success' }).includes('写完了！'));
  assert.ok(bubblesForWorkStatus({ state: 'error' }).includes('出错了…'));
  assert.deepEqual(bubblesForWorkStatus({ state: 'idle' }), []);
  assert.deepEqual(bubblesForWorkStatus(null), []);

  const thinking = bubblesForWorkStatus({ state: 'thinking' });
  assert.equal(pickBubbleForWorkStatus({ state: 'thinking' }, '', () => 0), thinking[0]);
  assert.equal(pickBubbleForWorkStatus({ state: 'thinking' }, thinking[0], () => 0), thinking[1], '避开上一句');
  assert.equal(pickBubbleForWorkStatus({ state: 'thinking' }, '', () => 0.999), thinking.at(-1));
  assert.equal(pickBubbleForWorkStatus({ state: 'idle' }, '', () => 0), '');
  assert.equal(pickBubbleForWorkStatus(null, '', () => 0), '');
  // random 越小越靠前；单句池也能挑。
  assert.ok(bubblesForWorkStatus({ state: 'working', tool: 'tavern_copy_card' }).includes(
    pickBubbleForWorkStatus({ state: 'working', tool: 'tavern_copy_card' }, '', () => 0),
  ));
});

// ---- 「仅生成时显示」的进度气泡 ----
import {
  formatElapsed,
  formatRunProgress,
  formatRunSummary,
  stepLabelForWorkStatus,
} from '../src/client/pet/core/work-status.js';

test('时间线步骤名：思考 / 已登记工具 / 结算 / 其他工具去前缀；不在跑的状态返回空串', () => {
  assert.equal(stepLabelForWorkStatus({ state: 'thinking' }), '思考');
  assert.equal(stepLabelForWorkStatus({ state: 'working', tool: 'tavern_update_card' }), '改卡');
  assert.equal(stepLabelForWorkStatus({ state: 'working', tool: 'tavern_validate_card' }), '校验');
  assert.equal(stepLabelForWorkStatus({ state: 'working', role: 'settlement' }), '结算');
  assert.equal(stepLabelForWorkStatus({ state: 'working' }), '干活');
  assert.equal(stepLabelForWorkStatus({ state: 'working', tool: 'tavern_roll_dice' }), 'roll_dice');
  assert.equal(stepLabelForWorkStatus({ state: 'working', tool: 'a_very_long_tool_name_here' }), 'a_very_long_…');
  for (const state of ['idle', 'waiting', 'success', 'error', 'nope', '']) {
    assert.equal(stepLabelForWorkStatus({ state }), '', state);
  }
  assert.equal(stepLabelForWorkStatus(null), '');
});

test('耗时格式：不足一分钟用秒，超过补零', () => {
  assert.equal(formatElapsed(0), '0s');
  assert.equal(formatElapsed(12.7), '12s');
  assert.equal(formatElapsed(65), '1m05s');
  assert.equal(formatElapsed(-3), '0s');
  assert.equal(formatElapsed('abc'), '0s');
});

test('进度气泡：当前一句 + 第 N 步 · 已用；两步以上才带时间线', () => {
  assert.equal(
    formatRunProgress({ line: '让我想想…', step: 1, elapsedSec: 3, trail: ['思考'] }),
    '让我想想…\n第 1 步 · 已用 3s',
  );
  assert.equal(
    formatRunProgress({ line: '写进卡里…', step: 3, elapsedSec: 12, trail: ['思考', '改卡', '校验'] }),
    '写进卡里…\n第 3 步 · 已用 12s\n思考 → 改卡 → 校验',
  );
  assert.equal(formatRunProgress({}), '生成中…\n已用 0s');
});

test('收尾气泡：一句 + 共 N 步 · 用时', () => {
  assert.equal(formatRunSummary({ line: '写完了！', steps: 4, elapsedSec: 75 }), '写完了！\n共 4 步 · 用时 1m15s');
  assert.equal(formatRunSummary({}), '这轮结束！\n用时 0s');
});
