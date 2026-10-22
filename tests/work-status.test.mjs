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
