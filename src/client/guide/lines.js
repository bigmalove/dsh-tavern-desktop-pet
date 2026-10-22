// 引导员台词：全部是插件内的模板，不调用模型。
// 语气与桌宠原有吐槽不同：这里是「陪你建卡」的助手，不毒舌。

export const GUIDE_LINES = Object.freeze({
  empty: '要做一张新卡吗？点左边「新建人物卡」，我陪你一题一题来～',
  thinking: '想想…',
  summary: '信息齐了！摘要放在上面，看看哪里要改～',
  summaryHint: '确认没问题就点「就这样」。',
  done: '建好啦！',
  doneHint: '已保存到 {path}。',
  error: '呜，好像出错了，上面有详细信息。',
  waiting: '收到，我看看…',
  unknownHint: '详细内容在上面。',
});

const TOOL_LINES = Object.freeze({
  tavern_update_card: '写进卡里…',
  tavern_validate_card: '检查一下格式…',
  tavern_copy_card: '复制一份…',
  tavern_update_worldbook: '翻世界书…',
  tavern_read_worldbook: '翻世界书…',
  tavern_read_card: '翻翻这张卡…',
  tavern_apply_mvu: '加变量…',
});

/** 「想想…」之外，能认出工具时给一句更具体的短句。 */
export function thinkingLine(tool) {
  const name = String(tool || '').trim();
  return name && TOOL_LINES[name] ? TOOL_LINES[name] : GUIDE_LINES.thinking;
}

/** 桌宠表情标签 → Live2D 表情路由（与 core/emotion 的中文标签一致）。 */
export const GUIDE_MOODS = Object.freeze({
  idle: '默认',
  question: '思考',
  summary: '微笑',
  done: '大笑',
  error: '难过',
  unknown: '默认',
});
