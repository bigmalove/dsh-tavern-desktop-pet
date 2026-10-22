// 卡片工作台的引导状态机（纯 JS，单测见 tests/guide-controller.test.mjs）。
//
// 输入是 tavernUi.watchReply 推来的 ReplyState，输出是桌宠要显示的一小块状态：
// 气泡内容、选项、表情、回看历史。宿主负责解析主区折叠，这里只管桌宠这一侧。
//
// 关键约束：
//   - 同一轮的最终结果只解析 / 朗读一次（turn + 文本去重）；
//   - 生成中只显示，不解析选项、不朗读；
//   - 离开工作台、关掉开关、桌宠被关掉时一律回到 idle，不吞主区内容。

import { GUIDE_LINES, GUIDE_MOODS, thinkingLine } from './lines.js';
import { clean, foldSummary, parseReply, speechText } from './reply-parser.js';

const SUMMARY_OPTIONS = Object.freeze([
  { key: '就这样', label: '就这样', action: true },
  { label: '我要改…', freeform: true },
]);

function idleState() {
  return {
    sessionId: '',
    active: false,
    phase: 'idle',
    mood: GUIDE_MOODS.idle,
    turn: 0,
    text: '',
    streaming: false,
    busy: false,
    tool: null,
    kind: 'idle',
    bubble: { ack: '', question: '', hint: '', note: '', lead: '', detail: '' },
    options: [],
    choiceDisabled: false,
    history: [],
    error: '',
  };
}

export function createGuideController(deps = {}) {
  const watchReply = typeof deps.watchReply === 'function' ? deps.watchReply : () => () => {};
  const onSessionChange = typeof deps.onSessionChange === 'function' ? deps.onSessionChange : () => () => {};
  const currentSessionId = typeof deps.currentSessionId === 'function' ? deps.currentSessionId : () => '';
  const speak = typeof deps.speak === 'function' ? deps.speak : () => {};
  const submitChoice = typeof deps.submitChoice === 'function' ? deps.submitChoice : () => {};
  const fillInput = typeof deps.fillInput === 'function' ? deps.fillInput : () => {};
  const parse = typeof deps.parse === 'function' ? deps.parse : parseReply;
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();

  const listeners = new Set();
  let state = idleState();
  let enabled = true;
  let visible = true;
  let stopReply = null;
  let stopSession = null;
  let settledKey = '';
  let spokenKey = '';
  let lastReply = null;

  function snapshot() {
    return state;
  }

  function emit() {
    state = { ...state, history: state.history.slice() };
    for (const listener of Array.from(listeners)) {
      try {
        listener(state);
      } catch (error) {
        console.warn('[dsh-tavern-desktop-pet] 引导状态回调失败', error);
      }
    }
  }

  function patch(next) {
    state = { ...state, ...next };
    emit();
  }

  function subscribe(listener) {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  }

  function clearSubscription() {
    if (typeof stopReply === 'function') {
      try {
        stopReply();
      } catch {
        // ignore
      }
    }
    stopReply = null;
    settledKey = '';
    spokenKey = '';
    lastReply = null;
  }

  function reset(preserveSession = false) {
    clearSubscription();
    const sessionId = preserveSession ? state.sessionId : '';
    state = idleState();
    state.sessionId = sessionId;
    emit();
  }

  // Leaving the workbench keeps the subscription: the same session may come back
  // (the view is refreshed while switching) and a re-subscribe would lose the turn.
  function deactivate(sessionId) {
    settledKey = '';
    spokenKey = '';
    lastReply = null;
    state = { ...idleState(), sessionId: String(sessionId || '') };
    emit();
  }

  function currentSession() {
    return String(currentSessionId() || '');
  }

  function attach() {
    const sessionId = currentSession();
    if (!sessionId) return;
    clearSubscription();
    state = { ...idleState(), sessionId, active: true };
    emit();
    try {
      stopReply = watchReply(sessionId, receive);
    } catch (error) {
      patch({ active: false, phase: 'error', error: String((error && error.message) || error), mood: GUIDE_MOODS.error });
    }
  }

  function remember(line) {
    const history = state.history.slice();
    const last = history[history.length - 1];
    if (last && last.turn === state.turn && last.text === line) return history;
    history.push({ turn: state.turn, text: line });
    return history.slice(-6);
  }

  function present(parsed, reply) {
    const options = parsed.kind === 'question' ? parsed.options.slice()
      : parsed.kind === 'summary' ? SUMMARY_OPTIONS.slice()
        : parsed.kind === 'done' ? [{ label: '再改改', freeform: true }]
          : [];
    const detail = parsed.kind === 'done' && parsed.cardPath ? GUIDE_LINES.doneHint.replace('{path}', parsed.cardPath) : '';
    const bubble =
      parsed.kind === 'question'
        ? { ack: parsed.ack || '', question: parsed.question, hint: parsed.hint || '', note: parsed.note || '', lead: '', detail: '' }
        : parsed.kind === 'summary'
          ? { ack: '', question: '', hint: GUIDE_LINES.summaryHint, note: '', lead: GUIDE_LINES.summary, detail: '' }
          : parsed.kind === 'done'
            ? { ack: '', question: '', hint: '', note: '', lead: GUIDE_LINES.done, detail }
            : { ack: '', question: '', hint: GUIDE_LINES.unknownHint, note: '', lead: parsed.lead || '', detail: '' };
    const mood =
      parsed.kind === 'question'
        ? GUIDE_MOODS.question
        : parsed.kind === 'summary'
          ? GUIDE_MOODS.summary
          : parsed.kind === 'done'
            ? GUIDE_MOODS.done
            : parsed.kind === 'unknown'
              ? GUIDE_MOODS.unknown
              : GUIDE_MOODS.idle;
    const key = String(reply.turn) + '|' + parsed.kind + '|' + (parsed.question || parsed.lead || '');
    const history = remember(foldSummary(parsed) || parsed.lead || parsed.question || '');
    patch({
      phase: 'presenting',
      mood,
      kind: parsed.kind,
      bubble,
      options,
      choiceDisabled: false,
      history,
      text: reply.text,
      streaming: false,
    });
    if (key !== spokenKey) {
      spokenKey = key;
      const line = speechText(parsed);
      if (line) {
        try {
          speak(line, mood);
        } catch {
          // ignore
        }
      }
    }
  }

  function receive(reply) {
    if (!reply || !enabled || !visible) return;
    lastReply = reply;
    const mode = String(reply.mode || '');
    if (mode !== 'card') {
      if (state.active) deactivate(reply.sessionId);
      return;
    }
    if (!state.active || state.sessionId !== reply.sessionId) {
      patch({ sessionId: reply.sessionId, active: true, error: '' });
    }
    const turn = Math.max(0, Number(reply.turn) || 0);
    const text = String(reply.text || '');
    const streaming = reply.streaming === true;
    const busy = reply.busy === true;
    const tool = reply.tool || null;
    if (streaming || busy) {
      patch({
        phase: streaming ? 'streaming' : 'thinking',
        mood: GUIDE_MOODS.question,
        turn,
        text,
        streaming,
        busy,
        tool,
        kind: 'working',
        bubble: { ack: '', question: '', hint: '', note: '', lead: text ? clean(text) : thinkingLine(tool), detail: '' },
        options: [],
        choiceDisabled: false,
      });
      return;
    }
    if (!text.trim()) {
      patch({
        phase: 'idle',
        mood: GUIDE_MOODS.idle,
        turn,
        text: '',
        streaming: false,
        busy: false,
        tool: null,
        kind: 'idle',
        bubble: { ack: '', question: '', hint: '', note: '', lead: GUIDE_LINES.empty, detail: '' },
        options: [],
        choiceDisabled: false,
      });
      return;
    }
    const key = String(turn) + '|' + text;
    if (key === settledKey) {
      patch({ turn, streaming: false, busy: false, tool: null });
      return;
    }
    settledKey = key;
    const parsed = parse(text, { changed: reply.changed === true, cardSaved: reply.cardSaved || '' });
    patch({ turn, streaming: false, busy: false, tool: null, text });
    present(parsed, { turn, text });
  }

  function choose(option) {
    if (!option || state.choiceDisabled || !state.active) return;
    if (state.phase !== 'presenting') return;
    if (option.freeform) {
      try {
        fillInput('');
      } catch (error) {
        patch({ error: String((error && error.message) || error) });
      }
      return;
    }
    const text = String(option.key || option.label || '').trim();
    if (!text) return;
    patch({ choiceDisabled: true, phase: 'waiting', options: [] });
    try {
      const result = submitChoice(text);
      if (result && typeof result.catch === 'function') result.catch(() => patch({ choiceDisabled: false }));
    } catch (error) {
      patch({ choiceDisabled: false, error: String((error && error.message) || error) });
    }
  }

  function setEnabled(value) {
    const next = value !== false;
    if (next === enabled) return;
    enabled = next;
    if (!enabled) {
      clearSubscription();
      stopSession?.();
      stopSession = null;
      reset(false);
      return;
    }
    start();
  }

  function setVisible(value) {
    const next = value !== false;
    if (next === visible) return;
    visible = next;
    if (!visible) {
      clearSubscription();
      patch({ active: false, phase: 'idle', bubble: idleState().bubble, options: [], choiceDisabled: false });
      return;
    }
    attach();
  }

  function setSession(sessionId) {
    const next = String(sessionId || '');
    if (next === state.sessionId && stopReply !== null) return;
    reset(false);
    if (next !== '') attach();
  }

  function start() {
    if (stopSession === null) {
      try {
        stopSession = onSessionChange((sessionId) => setSession(sessionId));
      } catch {
        stopSession = () => {};
      }
    }
    if (enabled && visible) attach();
  }

  function stop() {
    clearSubscription();
    if (typeof stopSession === 'function') stopSession();
    stopSession = null;
    reset(false);
  }

  /** 供面板显示：当前识别到哪一步，调试用。 */
  function describe() {
    if (!enabled) return '引导已关闭';
    if (!visible) return '桌宠已隐藏';
    if (!state.active) return '不在卡片工作台';
    const source = state.tool ? '工具 ' + state.tool : state.phase;
    return '第 ' + (state.turn || 0) + ' 轮 · ' + source + ' · ' + (state.kind || '');
  }

  return { subscribe, getState: snapshot, start, stop, setEnabled, setVisible, setSession, choose, describe, receive };
}
