import { useSettingsStore } from '../core/settings';
import { error, log, warn } from '../utils/dom';
import { callHost, currentGameId, getRecentMessages } from '../../bridge/tavern';
import {
  buildChatPrompt,
  buildPrompt,
  type RoleplayPromptOptions,
} from './prompt-templates';

type CommentCallback = (text: string, isDone: boolean) => void;

type OrderedPrompt =
  | 'world_info_before'
  | 'world_info_after'
  | { role: 'system' | 'assistant' | 'user'; content: string };
const CONNECTION_PROFILE_NONE = '<None>';

/** 把宿主侧的失败翻成玩家看得懂的一句话。 */
function friendlyFailure(error: unknown): string {
  const message = String((error as any)?.message || error || '');
  if (/前台会话不可用|后台 Agent/.test(message)) return '这一局还没真正开始，先发一句话再逗我。';
  if (/后台模型/.test(message)) return '这一局还没选后台模型，去「本局设置」里选一个再来。';
  if (/玩家在本局关闭了插件/.test(message)) return '这一局把桌宠关掉了，去「本局设置 → 插件」重新打开。';
  return `刚才走神了：${message.slice(0, 80)}`;
}

type ApiConnectionProfile = {
  name: string;
  id?: string;
  api?: string;
  model?: string;
  source?: string;
  apiUrl?: string;
  proxyPresetName?: string;
};

/**
 * 吐槽生成器
 * 调用 LLM 生成吐槽/聊天文案，并通过回调把流式结果传给 UI。
 */
export const Commentator = {
  isGenerating: false,

  _onComment: null as CommentCallback | null,
  _streamStop: null as { stop: () => void } | null,
  _latestStreamText: '',

  setCallback(cb: CommentCallback): void {
    this._onComment = cb;
  },

  async generate(): Promise<void> {
    if (this.isGenerating) {
      log('已有生成任务进行中，跳过');
      return;
    }

    this.isGenerating = true;
    log('开始生成吐槽');
    let emittedDone = false;

    try {
      this._onComment?.('', false);

      const store = useSettingsStore();
      const s = store.settings;

      const chatMessages = await this._getChatContext(s.maxChatContext);

      if (chatMessages.length === 0) {
        log('没有可用的聊天记录，跳过吐槽');
        return;
      }

      const roleplayOptions = this._resolveRoleplayOptions({
        roleName: s.roleplayName,
        ignoreCommentStyle: !!s.roleplayIgnoreCommentStyle,
        sendCharacterCardContent: !!s.sendCharacterCardContent,
      });
      const { system, user } = buildPrompt(
        s.commentStyle,
        s.customPrompt,
        chatMessages,
        !!s.emotionCotEnabled,
        roleplayOptions,
        !!s.ttsBilingualZhJaEnabled,
      );

      this._latestStreamText = '';
      let result: string;

      result = await this._generateViaTavern(system, user);

      const finalText = String(result || '').trim() || String(this._latestStreamText || '').trim();
      if (finalText) {
        this._onComment?.(finalText, true);
        emittedDone = true;
      } else {
        warn('吐槽生成结果为空');
      }
    } catch (e) {
      error('吐槽生成失败:', e);
      // 失败也放进气泡：玩家点了「逗一下」总得看到反应，不能只在控制台里报错。
      this._onComment?.(friendlyFailure(e), true);
      emittedDone = true;
    } finally {
      if (!emittedDone) {
        this._onComment?.('', true);
      }
      this.isGenerating = false;
    }
  },

  /**
   * 手动聊天（从功能菜单输入框触发）
   * - 会读取最近聊天上下文作为参考（与吐槽一致）
   * - 使用相同 API 配置（酒馆主 API / 自定义 API）
   */
  async chat(userMessage: string): Promise<void> {
    const input = String(userMessage || '').trim();
    if (!input) return;

    if (this.isGenerating) {
      log('已有生成任务进行中，跳过');
      return;
    }

    this.isGenerating = true;
    log('开始手动聊天生成');
    let emittedDone = false;

    try {
      this._onComment?.('', false);

      const store = useSettingsStore();
      const s = store.settings;

      const chatMessages = await this._getChatContext(s.maxChatContext);
      const roleplayOptions = this._resolveRoleplayOptions({
        roleName: s.roleplayName,
        ignoreCommentStyle: !!s.roleplayIgnoreCommentStyle,
        sendCharacterCardContent: !!s.sendCharacterCardContent,
      });
      const { system, user } = buildChatPrompt(
        s.commentStyle,
        s.customPrompt,
        chatMessages,
        input,
        !!s.emotionCotEnabled,
        roleplayOptions,
        !!s.ttsBilingualZhJaEnabled,
      );

      this._latestStreamText = '';
      let result: string;

      result = await this._generateViaTavern(system, user);

      const finalText = String(result || '').trim() || String(this._latestStreamText || '').trim();
      if (finalText) {
        this._onComment?.(finalText, true);
        emittedDone = true;
      } else {
        warn('手动聊天生成结果为空');
      }
    } catch (e) {
      error('聊天生成失败:', e);
    } finally {
      if (!emittedDone) {
        this._onComment?.('', true);
      }
      this.isGenerating = false;
    }
  },

  _buildOrderedPrompts(system: string, user: string, sendWorldInfo: boolean): OrderedPrompt[] {
    return sendWorldInfo
      ? ['world_info_before', { role: 'system', content: system }, 'world_info_after', { role: 'user', content: user }]
      : [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ];
  },

  _normalizeProxyPresetName(value: unknown): string {
    return String(value ?? '').trim();
  },

  _normalizeConnectionProfileSelectionName(value: unknown): string {
    const normalized = this._normalizeProxyPresetName(value);
    if (!normalized || normalized === CONNECTION_PROFILE_NONE) {
      return '';
    }
    return normalized;
  },

  _getConnectionProfileApiMap(apiValue: unknown): Record<string, unknown> | null {
    const apiName = this._normalizeProxyPresetName(apiValue);
    if (!apiName) return null;

    try {
      const context = SillyTavern.getContext?.();
      const apiMap = context?.CONNECT_API_MAP?.[apiName];
      if (!apiMap || typeof apiMap !== 'object' || Array.isArray(apiMap)) {
        return null;
      }
      return apiMap as Record<string, unknown>;
    } catch {
      return null;
    }
  },

  _resolveConnectionProfileSource(apiValue: unknown): string {
    const apiMap = this._getConnectionProfileApiMap(apiValue);
    if (!apiMap || this._normalizeProxyPresetName(apiMap.selected) !== 'openai') {
      return '';
    }
    return this._normalizeProxyPresetName(apiMap.source);
  },

  _isSupportedConnectionProfile(profile: Record<string, unknown>): boolean {
    const apiName = this._normalizeProxyPresetName(profile.api);
    if (!apiName) {
      return false;
    }

    try {
      const context = SillyTavern.getContext?.();
      const requestService = context?.ConnectionManagerRequestService;
      if (requestService && typeof requestService.isProfileSupported === 'function') {
        return !!requestService.isProfileSupported(profile);
      }
    } catch {
      // ignore
    }

    const apiMap = this._getConnectionProfileApiMap(apiName);
    if (!apiMap) {
      return false;
    }

    switch (this._normalizeProxyPresetName(apiMap.selected)) {
      case 'openai':
        return !!this._normalizeProxyPresetName(apiMap.source);
      case 'textgenerationwebui':
        return !!this._normalizeProxyPresetName(apiMap.type);
      default:
        return false;
    }
  },

  _normalizeApiConnectionProfiles(value: unknown): ApiConnectionProfile[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const profiles: ApiConnectionProfile[] = [];

    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const record = item as Record<string, unknown>;
      const name = this._normalizeProxyPresetName(record.name);
      if (!name || seen.has(name)) continue;

      if (!this._isSupportedConnectionProfile(record)) continue;

      const api = this._normalizeProxyPresetName(record.api);
      const source = this._resolveConnectionProfileSource(api);
      seen.add(name);
      profiles.push({
        name,
        id: this._normalizeProxyPresetName(record.id) || undefined,
        api: api || undefined,
        model: this._normalizeProxyPresetName(record.model) || undefined,
        source: source || undefined,
        apiUrl: this._normalizeProxyPresetName(record['api-url']) || undefined,
        proxyPresetName: this._normalizeProxyPresetName(record.proxy) || undefined,
      });
    }

    return profiles.sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));
  },

  _readApiConnectionManagerSettings(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const root = value as Record<string, unknown>;
    const extensionSettings = root.extensionSettings;
    if (
      extensionSettings &&
      typeof extensionSettings === 'object' &&
      !Array.isArray(extensionSettings) &&
      (extensionSettings as Record<string, unknown>).connectionManager &&
      typeof (extensionSettings as Record<string, unknown>).connectionManager === 'object' &&
      !Array.isArray((extensionSettings as Record<string, unknown>).connectionManager)
    ) {
      return (extensionSettings as Record<string, unknown>).connectionManager as Record<string, unknown>;
    }

    const extension_settings = root.extension_settings;
    if (
      extension_settings &&
      typeof extension_settings === 'object' &&
      !Array.isArray(extension_settings) &&
      (extension_settings as Record<string, unknown>).connectionManager &&
      typeof (extension_settings as Record<string, unknown>).connectionManager === 'object' &&
      !Array.isArray((extension_settings as Record<string, unknown>).connectionManager)
    ) {
      return (extension_settings as Record<string, unknown>).connectionManager as Record<string, unknown>;
    }

    const connectionManager = root.connectionManager;
    if (connectionManager && typeof connectionManager === 'object' && !Array.isArray(connectionManager)) {
      return connectionManager as Record<string, unknown>;
    }

    return null;
  },

  _readApiConnectionProfilesFromContext(): ApiConnectionProfile[] {
    try {
      const context = SillyTavern.getContext?.();
      return this._normalizeApiConnectionProfiles(context?.extensionSettings?.connectionManager?.profiles);
    } catch {
      return [];
    }
  },

  _readApiConnectionProfilesFromDom(): ApiConnectionProfile[] {
    try {
      const topWindow = window.parent ?? window;
      const select = topWindow.document.querySelector('#connection_profiles') as HTMLSelectElement | null;
      if (!select) return [];

      const seen = new Set<string>();
      const profiles: ApiConnectionProfile[] = [];
      for (const option of Array.from(select.options)) {
        const name = this._normalizeProxyPresetName(option.textContent);
        const id = this._normalizeProxyPresetName(option.value);
        if (!name || !id || seen.has(name)) continue;
        seen.add(name);
        profiles.push({ name, id });
      }

      return profiles;
    } catch {
      return [];
    }
  },

  async _loadApiConnectionProfileByName(name: string): Promise<ApiConnectionProfile | null> {
    const profileName = this._normalizeProxyPresetName(name);
    if (!profileName) return null;

    const profiles = this._readApiConnectionProfilesFromContext();
    const matched = profiles.find(profile => profile.name === profileName);
    if (matched) {
      return matched;
    }

    if (typeof triggerSlash !== 'function') {
      return null;
    }

    const escapedName = profileName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const raw = await triggerSlash(`/profile-get "${escapedName}"`);
    const text = String(raw || '').trim();
    if (!text) {
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      const normalized = this._normalizeApiConnectionProfiles([parsed]);
      return normalized[0] ?? null;
    } catch {
      return null;
    }
  },

  async _loadApiConnectionProfiles(): Promise<ApiConnectionProfile[]> {
    const contextProfiles = this._readApiConnectionProfilesFromContext();
    if (contextProfiles.length > 0) {
      return contextProfiles;
    }

    const domProfiles = this._readApiConnectionProfilesFromDom();
    if (domProfiles.length > 0) {
      return domProfiles;
    }

    const response = await fetch('/api/settings/get', {
      method: 'POST',
      headers: {
        ...SillyTavern.getRequestHeaders(),
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { settings?: unknown };
    const rawSettings = payload?.settings;
    let parsedSettings: unknown = rawSettings;

    if (typeof rawSettings === 'string') {
      parsedSettings = JSON.parse(rawSettings);
    }

    const manager = this._readApiConnectionManagerSettings(parsedSettings);
    if (!manager) {
      return [];
    }

    return this._normalizeApiConnectionProfiles(manager.profiles);
  },

  _escapeSlashArgument(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  },

  async _getCurrentConnectionProfileName(): Promise<string> {
    try {
      const context = SillyTavern.getContext?.();
      const selectedId = this._normalizeProxyPresetName(context?.extensionSettings?.connectionManager?.selectedProfile);
      const profiles = this._normalizeApiConnectionProfiles(context?.extensionSettings?.connectionManager?.profiles);
      if (selectedId) {
        const matched = profiles.find(profile => profile.id === selectedId);
        if (matched) {
          return matched.name;
        }
      }
    } catch {
      // ignore
    }

    if (typeof triggerSlash !== 'function') {
      return '';
    }

    const current = await triggerSlash('/profile');
    return this._normalizeConnectionProfileSelectionName(current);
  },

  async _switchConnectionProfileByName(name: string): Promise<void> {
    if (typeof triggerSlash !== 'function') {
      throw new Error('当前环境不支持切换 API 连接配置');
    }

    const normalizedName = this._normalizeConnectionProfileSelectionName(name);
    const targetName = normalizedName || CONNECTION_PROFILE_NONE;
    const escapedName = this._escapeSlashArgument(targetName);
    await triggerSlash(`/profile await=true timeout=5000 "${escapedName}"`);
  },

  async _withTemporaryConnectionProfile<T>(name: string, task: () => Promise<T>): Promise<T> {
    const targetName = this._normalizeConnectionProfileSelectionName(name);
    const currentName = await this._getCurrentConnectionProfileName();
    if (currentName === targetName) {
      return await task();
    }

    await this._switchConnectionProfileByName(targetName);

    try {
      return await task();
    } finally {
      try {
        await this._switchConnectionProfileByName(currentName);
      } catch (restoreError) {
        error('恢复 API 连接配置失败:', restoreError);
      }
    }
  },

  async _generateTavern(system: string, user: string, sendWorldInfo: boolean): Promise<string> {
    this._setupStreamListener();
    const orderedPrompts = this._buildOrderedPrompts(system, user, sendWorldInfo);

    try {
      return await generateRaw({
        should_silence: true,
        should_stream: true,
        ordered_prompts: orderedPrompts,
        custom_api: undefined,
      });
    } finally {
      this._cleanupStreamListener();
    }
  },

  async _generatePreset(
    system: string,
    user: string,
    apiConfig: {
      proxyPreset?: string;
      max_tokens: number;
      temperature: number;
      frequency_penalty: number;
      presence_penalty: number;
      top_p: number;
      top_k: number;
      usePresetSampling: boolean;
      sendWorldInfo?: boolean;
    },
  ): Promise<string> {
    const proxyPreset = this._normalizeProxyPresetName(apiConfig.proxyPreset);
    if (!proxyPreset) {
      throw new Error('请选择 API 连接配置');
    }

    let presetNames: string[];
    let matchedProfile: ApiConnectionProfile | null = null;
    try {
      const profiles = await this._loadApiConnectionProfiles();
      presetNames = profiles.map(profile => profile.name);
      matchedProfile = profiles.find(profile => profile.name === proxyPreset) ?? null;
    } catch {
      throw new Error('API 连接配置列表加载失败，请重试');
    }

    if (!presetNames.includes(proxyPreset)) {
      throw new Error('当前保存的 API 连接配置不存在，请重新选择');
    }

    const fullProfile =
      matchedProfile && matchedProfile.api ? matchedProfile : await this._loadApiConnectionProfileByName(proxyPreset);
    if (!fullProfile || !fullProfile.api || !this._isSupportedConnectionProfile(fullProfile as Record<string, unknown>)) {
      throw new Error('当前 API 连接配置不支持聊天补全');
    }

    if (!apiConfig.usePresetSampling) {
      warn('酒馆 API 连接配置模式固定跟随所选连接配置的采样参数，已忽略手动采样覆盖');
    }

    return await this._withTemporaryConnectionProfile(proxyPreset, async () => {
      this._setupStreamListener();
      try {
        return await generateRaw({
          should_silence: true,
          should_stream: true,
          ordered_prompts: this._buildOrderedPrompts(system, user, !!apiConfig.sendWorldInfo),
          custom_api: undefined,
        });
      } finally {
        this._cleanupStreamListener();
      }
    });
  },

  async _generateCustom(
    system: string,
    user: string,
    apiConfig: {
      url: string;
      apiKey: string;
      model: string;
      source: string;
      max_tokens: number;
      temperature: number;
      frequency_penalty: number;
      presence_penalty: number;
      top_p: number;
      top_k: number;
      usePresetSampling: boolean;
      sendWorldInfo?: boolean;
    },
  ): Promise<string> {
    const apiUrl = String(apiConfig.url || '').trim();
    const apiKey = String(apiConfig.apiKey || '').trim();
    const model = String(apiConfig.model || '')
      .trim()
      .replace(/^models\//, '');

    if (!apiUrl) {
      throw new Error('自定义 API URL 不能为空。');
    }
    if (!model) {
      throw new Error('自定义 API 模型不能为空，请先在设置中填写或选择模型。');
    }

    const usePreset = !!apiConfig.usePresetSampling;
    const sendWorldInfo = !!apiConfig.sendWorldInfo;
    const requestUrl = '/api/backends/chat-completions/generate';
    const orderedPrompts = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const buildAttemptBody = (attempt: 'full' | 'safe' | 'minimal') => {
      const body: Record<string, unknown> = {
        messages: orderedPrompts,
        model,
        stream: false,
        chat_completion_source: 'custom',
        custom_prompt_post_processing: sendWorldInfo ? 'strict' : 'none',
        reverse_proxy: apiUrl,
        custom_url: apiUrl,
        custom_include_headers: apiKey ? `Authorization: Bearer ${apiKey}` : '',
      };

      // 分级回退请求参数，尽量兼容不同 OpenAI 兼容后端。
      if (!usePreset && attempt !== 'minimal') {
        body.max_tokens = apiConfig.max_tokens;
        body.temperature = apiConfig.temperature;
        body.top_p = apiConfig.top_p;
      }

      if (!usePreset && attempt === 'full') {
        body.frequency_penalty = apiConfig.frequency_penalty;
        body.presence_penalty = apiConfig.presence_penalty;
        body.top_k = apiConfig.top_k;
      }

      return body;
    };

    const requestWithAttempt = async (attempt: 'full' | 'safe' | 'minimal'): Promise<string> => {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          ...SillyTavern.getRequestHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(buildAttemptBody(attempt)),
      });

      if (!response.ok) {
        const errTxt = await response.text();
        const err = new Error(`API请求失败: ${response.status} ${errTxt || response.statusText}`);
        (err as Error & { status?: number }).status = response.status;
        throw err;
      }

      const data = (await response.json()) as any;
      if (data?.choices?.[0]?.message?.content) {
        return String(data.choices[0].message.content).trim();
      }
      if (typeof data?.content === 'string') {
        return data.content.trim();
      }
      if (typeof data?.text === 'string') {
        return data.text.trim();
      }

      const details = typeof data === 'object' ? JSON.stringify(data) : String(data);
      throw new Error(`API调用返回无效响应: ${details}`);
    };

    const attempts: Array<'full' | 'safe' | 'minimal'> = ['full', 'safe', 'minimal'];
    let lastError: unknown = null;

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      try {
        if (i > 0) {
          warn(`自定义 API 参数回退重试：${attempt}`);
        }
        return await requestWithAttempt(attempt);
      } catch (e) {
        lastError = e;
        const status = (e as { status?: number } | null)?.status;
        const msg = e instanceof Error ? e.message : String(e);
        const is422 = status === 422 || /\b422\b/.test(msg);
        const canRetry = is422 && i < attempts.length - 1;
        if (!canRetry) throw e;
        warn(`自定义 API 返回 422，准备继续回退参数：${attempt} -> ${attempts[i + 1]}`);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  },

  _setupStreamListener(): void {
    this._cleanupStreamListener();
    this._streamStop = eventOn(iframe_events.STREAM_TOKEN_RECEIVED_FULLY, (fullText: string) => {
      this._latestStreamText = String(fullText || '');
      this._onComment?.(fullText, false);
    });
  },

  _cleanupStreamListener(): void {
    if (this._streamStop) {
      this._streamStop.stop();
      this._streamStop = null;
    }
  },

  /**
   * 这一局的最近几轮。上游从酒馆聊天记录里取；这里换成 Tavern 的舞台快照，
   * 正文按 assistant、卡名当 name，形状与上游一致。
   */
  async _getChatContext(maxCount: number): Promise<Array<{ role: string; name: string; message: string }>> {
    try {
      return await getRecentMessages(maxCount);
    } catch (e) {
      warn('获取聊天记录失败:', e);
      return [];
    }
  },

  /**
   * 生成。宿主侧先试这局的后台任务（带卡与世界书），再退到直连模型。
   * 上游那三个后端（酒馆主 API / 连接配置 / 自定义端点）不再需要：
   * 模型、Key、代理都由这局的 Tavern 设置决定；玩家在桌宠设置里选的模型优先。
   */
  async _generateViaTavern(system: string, user: string): Promise<string> {
    const gameId = currentGameId();
    if (!gameId) throw new Error('还没有打开一局游戏');
    const store = useSettingsStore();
    const provider = String(store.settings.commentModelProvider || '').trim();
    const model = String(store.settings.commentModelModel || '').trim();
    const selection = provider && model ? { provider, model } : undefined;
    const reply = await callHost('dsh-tavern-desktop-pet/comment', { gameId, system, user, selection });
    const text = String(reply?.text || '').trim();
    if (text) this._onComment?.(text, false);
    return text;
  },

  _resolveRoleplayOptions(config: {
    roleName?: string;
    ignoreCommentStyle?: boolean;
    sendCharacterCardContent?: boolean;
  }): RoleplayPromptOptions | undefined {
    const roleName = String(config.roleName || '').trim();
    if (!roleName) {
      return undefined;
    }

    const roleplay: RoleplayPromptOptions = {
      roleName,
      ignoreCommentStyle: config.ignoreCommentStyle === true,
    };
    if (config.sendCharacterCardContent) {
      const characterCardContent = this._getCurrentCharacterCardContent();
      if (characterCardContent) {
        roleplay.characterCardContent = characterCardContent;
      } else {
        log('角色卡内容开关已开启，但未读取到可用角色卡文本');
      }
    }

    return roleplay;
  },

  _getCurrentCharacterCardContent(): string {
    try {
      const context = SillyTavern?.getContext?.() as any;
      if (!context) {
        return '';
      }

      const characters = Array.isArray(context.characters) ? context.characters : [];
      if (characters.length === 0) {
        return '';
      }

      const charIdRaw = context.characterId;
      let current: any = null;

      if (charIdRaw !== undefined && charIdRaw !== null) {
        const idText = String(charIdRaw).trim();
        const idNum = Number(idText);
        if (Number.isFinite(idNum) && idNum >= 0 && idNum < characters.length) {
          current = characters[idNum];
        }
      }

      if (!current) {
        const currentName = String(context.name2 || '').trim();
        if (currentName) {
          current = characters.find((item: any) => String(item?.name || '').trim() === currentName) || null;
        }
      }

      if (!current && characters.length === 1) {
        current = characters[0];
      }

      if (!current) {
        return '';
      }

      const fields: Array<[string, unknown]> = [
        ['角色名', current.name],
        ['角色描述', current.description ?? current.data?.description],
        ['角色性格', current.personality ?? current.data?.personality],
        ['场景设定', current.scenario ?? current.data?.scenario],
        ['开场白', current.first_mes ?? current.data?.first_mes],
        ['示例对话', current.mes_example ?? current.data?.mes_example],
        ['系统提示', current.data?.system_prompt],
        ['历史后提示', current.data?.post_history_instructions],
      ];

      const lines = fields
        .map(([label, value]) => {
          const text = this._normalizeCharacterCardField(value);
          return text ? `${label}: ${text}` : '';
        })
        .filter(line => !!line);

      return lines.join('\n');
    } catch (e) {
      warn('读取角色卡内容失败:', e);
      return '';
    }
  },

  _normalizeCharacterCardField(value: unknown): string {
    return String(value ?? '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  },

  destroy(): void {
    this._cleanupStreamListener();
    this._onComment = null;
    this._latestStreamText = '';
    this.isGenerating = false;
  },
};
