import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bubbleForWorkStatus,
  faceForWorkStatus,
  labelForWorkStatus,
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

test('工作状态 → 气泡短句：生成中、等你回答、写完了、出错了；干活时认工具', () => {
  assert.equal(bubbleForWorkStatus({ state: 'thinking' }), '生成中…');
  assert.equal(bubbleForWorkStatus({ state: 'working' }), '干活中…');
  assert.equal(bubbleForWorkStatus({ state: 'working', tool: 'tavern_update_card' }), '写进卡里…');
  assert.equal(bubbleForWorkStatus({ state: 'working', tool: 'ask_user_question' }), '等你回答…');
  assert.equal(bubbleForWorkStatus({ state: 'working', role: 'settlement' }), '后台结算中…');
  assert.equal(bubbleForWorkStatus({ state: 'waiting' }), '等你回答…');
  assert.equal(bubbleForWorkStatus({ state: 'success' }), '写完了！');
  assert.equal(bubbleForWorkStatus({ state: 'error' }), '出错了…');
  assert.equal(bubbleForWorkStatus({ state: 'idle' }), '');
  assert.equal(bubbleForWorkStatus(null), '');
});
