// 引导员台词：全部是插件内的模板，不调用模型。
// 语气与桌宠原有吐槽不同：这里是「陪你建卡」的助手，不毒舌。

export const GUIDE_LINES = Object.freeze({
  empty: '想做点什么？建卡、改卡、写 Skill 都行，我陪你一步步来～',
  thinking: '想想…',
  summary: '信息齐了！摘要放在上面，看看哪里要改～',
  summaryHint: '确认没问题就点「就这样」。',
  done: '建好啦！',
  doneEdit: '改好啦！',
  doneHint: '已保存到 {path}。',
  error: '呜，好像出错了，上面有详细信息。',
  waiting: '收到，我看看…',
  unknownHint: '详细内容在上面。',
});

const TOOL_LINES = Object.freeze({
  tavern_update_card: '写进卡里…',
  tavern_validate_card: '检查一下格式…',
  tavern_copy_card: '复制一份…',
  tavern_read_card: '翻翻这张卡…',
  tavern_read_card_raw: '读原始卡…',
  tavern_search_card: '翻卡…',
  tavern_replace_card_text: '整卡替换…',
  tavern_restore_card: '恢复卡片…',
  tavern_update_worldbook: '写世界书…',
  tavern_read_worldbook: '翻世界书…',
  tavern_update_preset: '改预设…',
  tavern_read_preset: '读预设…',
  tavern_save_skill: '写 Skill…',
  tavern_read_skill_reference: '查 Skill 参考…',
  tavern_apply_mvu: '加变量…',
  tavern_mvu_overview: '看变量…',
  tavern_read_script: '读剧本…',
  tavern_export_card_png: '导出卡图…',
  tavern_set_card_cover: '换封面…',
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
