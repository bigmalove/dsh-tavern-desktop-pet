// 卡片工作台的回复解析：把一条助手消息分成「提问 / 摘要 / 建好 / 未识别」。
//
// 规则来自真实建卡对话的样本（结构与 output/pet-guide-demo 一致），但模型
// 并不被提示词强制成这个格式，所以这里的原则是：宁可降级成 unknown 原样显示，
// 也不要猜错把主区折起来。纯函数，测试见 tests/reply-parser.test.mjs。

const OPTION_BOLD = /^\s*[-*]\s*\*\*([A-H])[.．、]\s*([^*]+?)\*\*\s*[:：]?\s*(.*)$/;
const OPTION_PLAIN = /^\s*[-*]\s*([A-H])[.．、]\s*([^：:]+?)[：:]\s*(.+)$/;
// 真实对话里也常出现不加列表符号、不加粗的选项：「A. 现代都市：…」。
const OPTION_BARE = /^\s*([A-H])[.．、]\s*([^：:]{1,60}?)[：:]\s*(.+)$/;
// 「第 8 题（最后一题）：…」的括注在冒号前，不能要求题号后面紧跟冒号。
const QUESTION_NO = /\*\*\s*第\s*(\d+)\s*题([^*]*?)\*\*/;
const QUESTION_BOLD = /^\s*\*\*([^*]{2,160})\*\*\s*(.*)$/;
const FREEFORM = /其他|你来定|你定|自定义|自由/;
const DONE_LEAD = /^(建好了|已创建|已保存|已提交|改好了|保存好了)/;
const CARD_PATH = /`?\s*(cards\/[^`\s]+\.json)\s*`?/;

function str(value) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

/** 去掉 Markdown 的强调、行内代码和列表符号，供气泡与朗读使用。 */
export function clean(text) {
  return str(text)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function firstSentence(text, max = 40) {
  const plain = clean(text).split('\n').find((line) => line.trim() && !/^[-|]/.test(line)) || '';
  const cut = (plain.match(/^[^。！？!?]*[。！？!?]?/) || [plain])[0] || plain;
  return cut.length > max ? cut.slice(0, max - 1) + '…' : cut;
}

/** 去掉按钮文字末尾的句号，避免「你定。」这种按钮。 */
function labelOf(text) {
  return str(text).trim().replace(/[。．.]$/, '').trim();
}

function parseOptions(lines) {
  for (let start = 0; start < lines.length; start += 1) {
    const out = [];
    let index = start;
    while (index < lines.length) {
      const match = OPTION_BOLD.exec(lines[index]) || OPTION_PLAIN.exec(lines[index]) || OPTION_BARE.exec(lines[index]);
      if (!match || match[1] !== String.fromCharCode(65 + out.length)) break;
      const label = labelOf(match[2]);
      const detail = clean(match[3]);
      if (label === '') break;
      out.push({ key: match[1], label, detail, freeform: FREEFORM.test(label + detail) });
      index += 1;
    }
    if (out.length >= 2) return { options: out, start, end: index };
  }
  return null;
}

/** 问题行：优先认「第 N 题」，其次整行加粗，最后任意带问号的一行。 */
function findQuestion(lines, end) {
  for (let index = end - 1; index >= 0; index -= 1) {
    const numbered = QUESTION_NO.exec(lines[index]);
    if (!numbered) continue;
    const tail = lines[index].slice((numbered.index || 0) + numbered[0].length);
    // 「（最后一题）：要不要…」——括注是补充说明，冒号后才是问题。
    const aside = /^[（(]([^）)]*)[）)]/.exec(numbered[2]);
    let body = numbered[2];
    if (aside) body = body.slice(aside[0].length);
    body = body.replace(/^\s*[:：]\s*/, '');
    const question = clean(body) || clean(tail);
    return {
      line: index,
      index: Number(numbered[1]),
      question,
      hint: aside ? clean(aside[1]) : clean(tail.replace(/^[（(]|[）)]$/g, '')),
    };
  }
  for (let index = end - 1; index >= 0; index -= 1) {
    const bold = QUESTION_BOLD.exec(lines[index]);
    if (bold && /[？?]\s*$/.test(bold[1])) {
      return { line: index, index: undefined, question: clean(bold[1]), hint: clean(bold[2].replace(/^[（(]|[）)]$/g, '')) };
    }
  }
  for (let index = end - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!/[？?]/.test(line) || line.trim() === '') continue;
    // 「第一题，也是定方向的一题：你想开的是什么样的一局？也就是…」
    // 问号在句子中间，取含问号的那一句；题号可能写成中文数字。
    return { line: index, index: chineseQuestionIndex(line), question: questionSentence(line), hint: '' };
  }
  // 「第三题：**她给人的第一印象，也就是她的外貌气质**。」——没有问号，
  // 但「第 N 题」本身就是问题行的强信号。
  for (let index = end - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const match = /第\s*([0-9一二三四五六七八九十]+)\s*题/.exec(line);
    if (!match) continue;
    const body = clean(line.slice((match.index || 0) + match[0].length)).replace(/^\s*[:：，,]\s*/, '').replace(/[。．.]\s*$/, '').trim();
    if (body === '') continue;
    return { line: index, index: parseQuestionIndex(match[1]), question: body, hint: '' };
  }
  return null;
}

const CHINESE_DIGITS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function parseQuestionIndex(value) {
  const text = String(value || '');
  if (/^[0-9]+$/.test(text)) return Number(text);
  if (text === '十') return 10;
  if (text.length === 1) return CHINESE_DIGITS[text];
  return undefined;
}

function chineseQuestionIndex(line) {
  const match = /第\s*([0-9一二三四五六七八九十]+)\s*题/.exec(String(line));
  return match ? parseQuestionIndex(match[1]) : undefined;
}

function questionSentence(line) {
  // 按句末标点切开，找含问号的那一句。
  const parts = String(line).split(/(?<=[。！？!?；;：:])/u);
  const found = parts.find((part) => /[？?]/.test(part));
  return clean(found || line);
}

/**
 * @param {string} text 助手回复原文
 * @param {{ changed?: boolean, cardSaved?: string }} [context]
 *   cardSaved：本轮刚落盘的新卡路径（tavernUi.watchReply 的 cardSaved）
 * @returns {{kind:'question',ack:string,question:string,hint:string,note:string,options:Array,index?:number}
 *   | {kind:'summary',lead:string}
 *   | {kind:'done',lead:string,cardPath:string,created:boolean}
 *   | {kind:'unknown',lead:string}}
 */
export function parseReply(text, { changed = false, cardSaved = '' } = {}) {
  const raw = str(text).trim();
  const lines = raw.split('\n');
  const head = firstSentence(raw);

  // 1. 建好 / 改好：宿主给的落盘信号最可靠；刷新后没有信号时只认首行。
  const savedPath = str(cardSaved) || (CARD_PATH.exec(raw) || [])[1] || '';
  const firstLine = clean(lines[0] || '');
  const doneByText = DONE_LEAD.test(firstLine);
  if (cardSaved || (changed && (doneByText || savedPath)) || (doneByText && (savedPath || /^建好了/.test(firstLine)))) {
    return { kind: 'done', lead: head, cardPath: savedPath, created: Boolean(cardSaved) || /^(建好了|已创建)/.test(firstLine) };
  }

  // 2. 提问：连续的 A～H 选项 + 选项块之前的问题行。
  const block = parseOptions(lines);
  if (block) {
    const after = clean(lines.slice(block.end).join('\n'));
    if (after.length <= 80) {
      const question = findQuestion(lines, block.start);
      if (question !== null && question.question !== '') {
        const before = lines.slice(0, question.line);
        const paragraphs = before.join('\n').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
        const ackText = paragraphs.length ? clean(paragraphs[0]) : '';
        const ack = /^(已定|已记录|好|可以|没问题|[A-H]\s*记下了)/.test(ackText) ? (ackText.split(/(?<=[。！？])/)[0] || ackText) : '';
        const noteRaw = clean(lines.slice(question.line + 1, block.start).join('\n'));
        return {
          kind: 'question',
          index: question.index,
          ack,
          question: question.question,
          hint: question.hint,
          note: noteRaw.length > 200 ? noteRaw.slice(0, 199) + '…' : noteRaw,
          options: block.options,
        };
      }
    }
  }

  // 3. 摘要：分隔线 + 键值列表，或长文 + 表格/键值列表。
  const keyValues = lines.filter((line) => /^\s*\*\*[^*]{1,14}\*\*\s*[:：]/.test(line)).length;
  if ((/^---\s*$/m.test(raw) && keyValues >= 3) || (raw.length > 500 && (/\|.*\|/.test(raw) || keyValues >= 3))) {
    return { kind: 'summary', lead: head };
  }

  // 4. 其余原样显示，气泡只说第一句。
  return { kind: 'unknown', lead: head };
}

/** 呈现器用：只有提问才折叠，摘要取问题本身（最多 40 字）。 */
export function foldSummary(parsed) {
  if (!parsed || parsed.kind !== 'question') return null;
  const question = str(parsed.question);
  if (question === '') return null;
  const short = question.length > 40 ? question.slice(0, 39) + '…' : question;
  return parsed.index ? '第 ' + parsed.index + ' 题：' + short : short;
}

/** 朗读只读「已定 + 问题」，不读选项和利弊说明。 */
export function speechText(parsed) {
  if (!parsed) return '';
  if (parsed.kind === 'question') return [str(parsed.ack).replace(/[。！？!?]+$/, ''), parsed.question].filter(Boolean).join('。');
  return str(parsed.lead);
}

export const __testing = { findQuestion, parseOptions, labelOf };
