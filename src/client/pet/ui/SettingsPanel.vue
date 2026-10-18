<template>
  <div>
    <div v-if="visible" class="settings-overlay dp-settings-overlay" :style="overlayFallbackStyle" @click.self="close">
      <div class="settings-panel dp-settings-panel" :style="panelFallbackStyle">
        <div class="panel-header">
          <div class="header-title">
            <h3>桌面宠物控制终端</h3>
            <p>SYSTEM // SETTINGS</p>
          </div>
          <button class="close-btn" type="button" @click="close">CLOSE</button>
        </div>

        <div class="panel-main">
          <aside class="panel-nav">
            <button
              v-for="item in sectionTabs"
              :key="item.key"
              class="nav-btn"
              type="button"
              :class="{ active: activeSection === item.key }"
              @click="activeSection = item.key"
            >
              <span class="nav-index">{{ item.index }}</span>
              <span class="nav-label">{{ item.label }}</span>
              <span class="nav-sub">{{ item.en }}</span>
            </button>
          </aside>

          <div class="panel-body">
            <section class="setting-section" v-show="activeSection === 'model'">
              <h4>
                <span class="section-index">01</span>
                <span class="section-label">模型</span>
                <span class="section-sub">MODEL CONTROL</span>
              </h4>

              <div class="setting-group">
                <label class="setting-label">吐槽用的模型</label>
                <div class="setting-hint">
                  空着就跟随这一局的后台模型。桌宠读到的正文（人物卡、世界书、最近两轮）由 Tavern 提供，
                  模型和 Key 都在 Tavern 的设置里，这里不用再填一遍。
                </div>
                <select
                  :value="settings.commentModelProvider + '|' + settings.commentModelModel"
                  :disabled="modelCatalogState !== 'ready'"
                  @change="onCommentModelChange"
                >
                  <option value="|">跟随本局后台模型</option>
                  <option v-for="option in commentModelOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <div v-if="modelCatalogState === 'loading'" class="setting-hint">正在读取这台机器的模型通道…</div>
                <div v-else-if="modelCatalogState === 'error'" class="setting-hint hint-error">{{ modelCatalogError }}</div>
                <div v-else-if="commentModelOptions.length === 0" class="setting-hint hint-error">没有读到任何模型通道，请先在 Tavern 里配置模型。</div>
              </div>
            </section>
            <section class="setting-section" v-show="activeSection === 'live2d'">
              <h4>
                <span class="section-index">02</span>
                <span class="section-label">Live2D 模型</span>
                <span class="section-sub">MODEL CONTROL</span>
              </h4>

              <div class="form-group">
                <label>模型路径</label>
                <div class="input-with-btn">
                  <input
                    type="text"
                    v-model="customModelUrl"
                    placeholder="输入 .model.json 或 .model3.json 的完整 URL"
                    @keydown.enter="loadCustomUrl"
                  />
                  <button class="input-btn" type="button" @click="loadCustomUrl" :disabled="!customModelUrl.trim()">
                    加载
                  </button>
                </div>
              </div>

              <div class="form-group">
                <label>推荐模型</label>
                <div class="model-list">
                  <button
                    v-for="m in recommendedModels"
                    :key="m.path"
                    class="model-btn"
                    type="button"
                    :class="{ active: settings.modelPath === m.path }"
                    @click="selectModel(m.path)"
                  >
                    {{ m.name }}
                  </button>
                  <button class="model-btn browse-btn" type="button" @click="showBrowser = true">浏览在线模型库</button>
                </div>
              </div>

              <div class="form-group">
                <label>本地 ZIP 模型（单槽覆盖）</label>
                <div class="model-list">
                  <button
                    class="model-btn"
                    type="button"
                    :disabled="localModelBusy"
                    @click="triggerLocalModelUpload"
                  >
                    {{ uploadingLocalModel ? '上传解析中...' : '上传 ZIP 模型' }}
                  </button>
                  <button
                    class="model-btn"
                    type="button"
                    :disabled="localModelBusy || !localModelExists"
                    @click="useUploadedModel"
                  >
                    使用已上传模型
                  </button>
                  <button
                    class="model-btn"
                    type="button"
                    :disabled="localModelBusy || !localModelExists"
                    @click="clearUploadedModel"
                  >
                    清除已上传模型
                  </button>
                </div>
                <input
                  ref="localModelFileInput"
                  class="hidden-file-input"
                  type="file"
                  accept=".zip,application/zip"
                  @change="onLocalModelFileChange"
                />
                <div class="hint">上传成功后会自动切换到本地路径：{{ LOCAL_LIVE2D_MODEL_PATH }}</div>
                <div v-if="localModelStatus" class="hint">{{ localModelStatus }}</div>
                <div v-if="localModelError" class="hint hint-error">{{ localModelError }}</div>
                <div v-if="localModelInfo" class="local-model-info">
                  <div>文件：{{ localModelInfo.fileName }}</div>
                  <div>版本：Cubism {{ localModelInfo.cubismVersion ?? '未知' }}</div>
                  <div>Runtime：{{ runtimeLabel(localModelInfo.runtimeType) }}</div>
                  <div>上传时间：{{ formatLocalUploadTime(localModelInfo.uploadTime) }}</div>
                  <div>文件大小：{{ formatFileSize(localModelInfo.fileSize) }}</div>
                </div>
                <div v-else class="hint">当前没有已上传本地模型。</div>
              </div>

              <div class="form-group">
                <label>宠物缩放 ({{ petScaleLabel }})</label>
                <input type="range" v-model.number="settings.petScale" min="0.1" max="3" step="0.05" />
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.useCdn" />
                  使用 CDN 加速（jsDelivr）
                </label>
                <div class="hint">关闭后将直接从 GitHub 原始地址加载，适用于 CDN 不可用时。</div>
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.doubleTapRandomMotionEnabled" />
                  双击随机触发动作
                </label>
                <div class="hint">关闭后，双击仍会触发吐槽，但不再追加随机动作。</div>
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.gazeFollowMouseEnabled" />
                  视线跟随鼠标
                </label>
                <div class="hint">全页面范围生效；仅响应鼠标/触控笔，触屏手势不会驱动视线。</div>
              </div>
            </section>

            <section class="setting-section" v-show="activeSection === 'comment'">
              <h4>
                <span class="section-index">03</span>
                <span class="section-label">吐槽设置</span>
                <span class="section-sub">COMMENT SYSTEM</span>
              </h4>

              <div class="form-group">
                <label>吐槽风格</label>
                <select v-model="settings.commentStyle">
                  <option v-for="style in commentStyles" :key="style" :value="style">
                    {{ style }}
                  </option>
                </select>
              </div>

              <div class="form-group" v-if="settings.commentStyle === '自定义'">
                <label>自定义提示词</label>
                <textarea v-model="settings.customPrompt" rows="4" placeholder="输入自定义的系统提示词..."></textarea>
              </div>

              <div class="form-group">
                <label>角色名（留空则关闭角色视角）</label>
                <input type="text" v-model="settings.roleplayName" placeholder="例如：阿米娅" />
                <div class="hint">填写后，吐槽和手动聊天会以该角色视角发言。</div>
              </div>

              <div class="form-group">
                <label>
                  <input
                    type="checkbox"
                    v-model="settings.roleplayIgnoreCommentStyle"
                    :disabled="!settings.roleplayName.trim()"
                  />
                  角色模式下忽略吐槽风格
                </label>
                <div class="hint">开启后将不再套用风格提示词，仅按角色设定发言。</div>
              </div>

              <div class="form-group">
                <label>
                  <input
                    type="checkbox"
                    v-model="settings.sendCharacterCardContent"
                    :disabled="!settings.roleplayName.trim()"
                  />
                  发送角色卡内容（当前聊天角色）
                </label>
                <div class="hint">开启后会附带当前角色卡描述/性格/场景等内容。</div>
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.autoTrigger" />
                  启用自动触发
                </label>
              </div>

              <template v-if="settings.autoTrigger">
                <div class="form-group">
                  <label>触发时机</label>
                  <select v-model="settings.commentTriggerMode">
                    <option v-for="option in commentTriggerModeOptions" :key="option.value" :value="option.value">
                      {{ option.label }}
                    </option>
                  </select>
                </div>

                <div class="form-row">
                  <div class="form-group half">
                    <label>触发间隔（每 N 条消息）</label>
                    <input type="number" v-model.number="settings.triggerInterval" min="1" max="100" />
                  </div>
                  <div class="form-group half">
                    <label>触发概率（{{ settings.triggerProbability }}%）</label>
                    <input type="range" v-model.number="settings.triggerProbability" min="0" max="100" />
                  </div>
                </div>
              </template>

              <div class="form-group">
                <label>传给 LLM 的最近聊天条数</label>
                <input type="number" v-model.number="settings.maxChatContext" min="1" max="50" />
              </div>

              <div class="form-group">
                <label>气泡自动关闭时间（秒）</label>
                <input type="number" v-model.number="settings.bubbleDuration" min="-1" max="600" step="1" />
                <div class="hint">默认 -1 不自动关闭；设置为 0 表示生成完成后立即关闭。</div>
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.useTamakoTodaySpecial" />
                  兼容 Tamako 今日特选
                </label>
                <div class="hint">开启后会优先读取 Tamako Market 今日特选作为上下文。</div>
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.useDiceDatabaseReference" />
                  参考数据库（建议 + 点评）
                </label>
                <div class="hint">启用后会读取骰子数据库摘要作为参考内容。</div>
              </div>

              <div class="form-group" v-if="settings.useDiceDatabaseReference">
                <label>可见数据库表（勾选后才会被引用）</label>

                <div class="form-row">
                  <div class="form-group half">
                    <button
                      class="btn btn-test"
                      type="button"
                      @click="refreshDiceReferenceSheetOptions"
                      :disabled="refreshingDiceSheetOptions"
                    >
                      {{ refreshingDiceSheetOptions ? '刷新中...' : '刷新表列表' }}
                    </button>
                  </div>
                  <div class="form-group half">
                    <button class="btn btn-secondary" type="button" @click="selectAllDiceReferenceSheets">全选</button>
                  </div>
                </div>

                <div class="form-group">
                  <button class="btn btn-secondary" type="button" @click="clearDiceReferenceSheets">清空筛选</button>
                  <div class="hint">{{ diceReferenceSheetSummary }}</div>
                </div>

                <div class="dice-sheet-list" v-if="diceReferenceSheetOptions.length > 0">
                  <label class="dice-sheet-item" v-for="sheetName in diceReferenceSheetOptions" :key="sheetName">
                    <input
                      type="checkbox"
                      :checked="isDiceSheetVisible(sheetName)"
                      @change="onToggleDiceSheetVisibility(sheetName, $event)"
                    />
                    <span>{{ sheetName }}</span>
                  </label>
                </div>
                <div class="hint" v-else>未读取到表名，可先在骰子系统中完成一次数据库更新后再刷新。</div>
              </div>
            </section>

            <section class="setting-section" v-show="activeSection === 'expression'">
              <h4>
                <span class="section-index">04</span>
                <span class="section-label">表情设置</span>
                <span class="section-sub">EMOTION COT</span>
              </h4>

              <div class="emotion-layout">
                <div class="emotion-configs">
                  <div class="form-group">
                    <label>
                      <input type="checkbox" v-model="settings.emotionCotEnabled" />
                      启用表情 COT
                    </label>
                    <div class="hint">
                      开启后，LLM 将按 <code>桌面宠物[表情|语气]: 正文</code> 输出；气泡/TTS 会自动剥离前缀并联动 Live2D。
                    </div>
                    <div class="hint">表情列表：{{ emotionTags.join('、') }}</div>
                  </div>

                  <div class="form-group" v-if="settings.emotionCotEnabled">
                    <label>
                      <input type="checkbox" v-model="settings.emotionCotStripFromText" />
                      从气泡/TTS 文本中剥离前缀
                    </label>
                    <div class="hint">建议保持开启，否则会朗读包含前缀的完整文本。</div>
                  </div>

                  <div class="form-row">
                    <div class="form-group half">
                      <button class="btn btn-secondary" type="button" @click="resetEmotionConfigs">重置为默认表情配置</button>
                    </div>
                    <div class="form-group half">
                      <button
                        class="btn btn-test"
                        type="button"
                        @click="refreshLive2DLists"
                        :disabled="refreshingLive2dLists"
                      >
                        {{ refreshingLive2dLists ? '刷新中...' : '刷新模型表情/动作列表' }}
                      </button>
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group half">
                      <button class="btn btn-test" type="button" @click="autoMatchLive2DOverrides(false)">
                        自动匹配（填充空白覆盖）
                      </button>
                    </div>
                    <div class="form-group half">
                      <button class="btn btn-secondary" type="button" @click="autoMatchLive2DOverrides(true)">
                        自动匹配全部（覆盖）
                      </button>
                    </div>
                  </div>

                  <div class="form-group">
                    <button class="btn btn-secondary" type="button" @click="clearLive2DOverrides">清空 Live2D 覆盖</button>
                    <div class="hint">{{ live2dListSummary }}</div>
                  </div>

                  <div class="form-group">
                    <div class="advanced-toggle" @click="showEmotionAdvanced = !showEmotionAdvanced">
                      <span class="toggle-icon">{{ showEmotionAdvanced ? '▼' : '▶' }}</span>
                      <span>{{ showEmotionAdvanced ? '隐藏高级选项' : '显示高级选项' }}</span>
                    </div>
                    <div class="hint">高级选项包含：别名映射、TTS 默认语气、动作启用开关。</div>
                  </div>

                  <div class="emotion-map-table">
                    <div class="emotion-map-head">
                      <div>标签</div>
                      <div>→</div>
                      <div>Live2D 表情（Expression）</div>
                      <div>Live2D 动作（Motion）</div>
                      <div>预览</div>
                    </div>

                    <div v-for="cfg in settings.emotionConfigs" :key="cfg.tag" class="emotion-map-row">
                      <div class="emotion-map-tag">{{ cfg.tag }}</div>
                      <div class="emotion-map-arrow">→</div>

                      <select v-model="cfg.live2dExpression">
                        <option value="">（自动匹配）</option>
                        <option
                          v-if="cfg.live2dExpression && !live2dExpressionOptionSet.has(cfg.live2dExpression)"
                          :value="cfg.live2dExpression"
                        >
                          {{ cfg.live2dExpression }}（自定义）
                        </option>
                        <option v-for="opt in live2dExpressionSelectOptions" :key="opt.key" :value="opt.value">
                          {{ opt.label }}
                        </option>
                      </select>

                      <select
                        :value="getMotionOverrideValue(cfg)"
                        :disabled="!cfg.live2dMotion.enabled"
                        @change="onMotionOverrideChange(cfg, $event)"
                      >
                        <option value="">（自动匹配）</option>
                        <option
                          v-if="getMotionOverrideValue(cfg) && !live2dMotionOptionSet.has(getMotionOverrideValue(cfg))"
                          :value="getMotionOverrideValue(cfg)"
                        >
                          {{ getMotionOverrideLabel(cfg) }}（自定义）
                        </option>
                        <option v-for="opt in live2dMotionSelectOptions" :key="opt.key" :value="opt.value">
                          {{ opt.label }}
                        </option>
                      </select>

                      <button
                        class="btn btn-secondary emotion-map-preview-btn"
                        type="button"
                        title="预览动作"
                        @click="previewEmotion(cfg.tag)"
                      >
                        ▶
                      </button>
                    </div>
                  </div>

                  <div class="hint">左列绑定 Expressions，右列绑定 Motions（可填动作名或动作组名）。</div>

                  <div class="emotion-advanced-list" v-if="showEmotionAdvanced">
                    <div v-for="cfg in settings.emotionConfigs" :key="`advanced_${cfg.tag}`" class="emotion-advanced-item">
                      <div class="emotion-advanced-title">{{ cfg.tag }} · 高级</div>

                      <div class="form-row">
                        <div class="form-group half">
                          <label>别名（raw tag → 规范表情）</label>
                          <input
                            type="text"
                            :value="(cfg.aliases || []).join(', ')"
                            @blur="onAliasesBlur(cfg, $event)"
                            placeholder="逗号分隔，例如：开心, smile"
                          />
                          <div class="hint">当模型输出不在固定表情列表时，可用别名映射到本行规范表情。</div>
                        </div>

                        <div class="form-group half">
                          <label>TTS 默认语气（可选）</label>
                          <input type="text" v-model="cfg.ttsContext" placeholder="例如：轻松调侃地说" />
                          <div class="hint">当模型未输出 |语气 时，将把此处作为 contextTexts 传给 TTS。</div>
                        </div>
                      </div>

                      <div class="form-group">
                        <label>
                          <input type="checkbox" v-model="cfg.live2dMotion.enabled" />
                          启用动作（关闭后该标签仅切换表情）
                        </label>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="emotion-preview-panel">
                  <div class="emotion-preview-header">
                    <span class="emotion-preview-title">模型预览</span>
                    <span class="emotion-preview-tag">标签: {{ previewTag }}</span>
                  </div>

                  <div class="emotion-preview-canvas" ref="live2dPreviewMountEl">
                    <div class="emotion-preview-interact" ref="live2dPreviewInteractEl"></div>
                    <div v-if="!Live2DManager.model" class="emotion-preview-empty">加载模型后可预览</div>
                  </div>

                  <div class="emotion-preview-controls">
                    <div class="emotion-zoom-row">
                      <span class="zoom-label">缩放</span>
                      <input
                        class="zoom-slider"
                        type="range"
                        min="0.5"
                        max="4"
                        step="0.05"
                        v-model.number="previewZoomFactor"
                        @input="applyPreviewViewport"
                      />
                      <span class="zoom-value">{{ Math.round(previewZoomFactor * 100) }}%</span>
                    </div>

                    <div class="emotion-preview-actions">
                      <button class="btn btn-secondary" type="button" @click="resetPreviewViewport">重置视图</button>
                      <button class="btn btn-secondary" type="button" @click="replayPreview">重播</button>
                    </div>

                    <div class="hint">提示：拖拽预览区可移动模型，滚轮可缩放。</div>
                    <div class="hint" :title="previewStatus">{{ previewStatus }}</div>
                  </div>
                </div>
              </div>
            </section>

            <section class="setting-section" v-show="activeSection === 'tts'">
              <h4>
                <span class="section-index">05</span>
                <span class="section-label">朗读</span>
                <span class="section-sub">VOICE CONTROL</span>
              </h4>

              <div class="notice-box">
                朗读渠道由 Tavern 统一管理（浏览器朗读 / OpenAI 兼容 / GPT-SoVITS / MiniMax），
                在「设置 → DSH Tavern → 显示与交互 → 配音」里选渠道和声音。
                桌宠只负责把该念的句子交给 Tavern，并带上情绪，所以这里不再单独填地址和 Key。
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.ttsAutoPlay" />
                  自动朗读（吐槽完成后念出来）
                </label>
                <div class="hint">关掉就只显示气泡。朗读同一句只合成一次，之后读缓存。</div>
              </div>

              <div class="form-group">
                <label>
                  <input type="checkbox" v-model="settings.ttsBilingualZhJaEnabled" />
                  中日双语模式（显示中文，朗读用日文）
                </label>
                <div class="hint">需模型按「中文文本【JP】日文文本」输出；未命中时自动回退中文朗读。</div>
              </div>

              <div class="form-group">
                <label>试听</label>
                <div class="input-with-btn">
                  <input v-model="ttsTestText" type="text" placeholder="试听文本" />
                  <button class="btn btn-test" type="button" @click="testTts">播放</button>
                  <button class="btn btn-secondary" type="button" @click="stopTts">停止</button>
                </div>
                <div class="hint">{{ ttsTestHint || '用 Tavern 当前选中的配音渠道念一句。' }}</div>
              </div>

            </section>

            <section class="setting-section" v-show="activeSection === 'about'">
              <h4>
                <span class="section-index">06</span>
                <span class="section-label">关于</span>
                <span class="section-sub">ABOUT & LICENSE</span>
              </h4>

              <div class="about-card">
                <div class="about-title">插件发布地址</div>
                <a
                  class="about-link"
                  href="https://discord.com/channels/1134557553011998840/1472242483806077061"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  https://discord.com/channels/1134557553011998840/1472242483806077061
                </a>
              </div>

              <div class="about-card">
                <div class="about-title">版权与使用声明</div>
                <ul class="about-list">
                  <li>
                    本插件加载或展示的 Live2D 模型及配套素材，其版权归原作者或原项目方所有；请在使用前自行确认并遵守对应授权条款。
                  </li>
                  <li>除权利人另有授权外，插件及示例素材仅用于学习、研究与交流，不得用于商业用途或再分发。</li>
                  <li>
                    本项目采用
                    <a
                      class="about-link"
                      href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      CC BY-NC-SA 4.0
                    </a>
                    共享协议。使用、改编与传播时请遵守“署名-非商业性使用-相同方式共享”，并对第三方素材单独核验授权。
                  </li>
                  <li>使用本插件及其衍生内容时，必须遵守你所在地及适用司法辖区的法律法规。</li>
                </ul>
              </div>
            </section>
          </div>
        </div>

        <div class="panel-footer">
          <button class="btn btn-secondary" type="button" @click="resetSettings">恢复默认</button>
          <button class="btn btn-primary" type="button" @click="close">确定</button>
        </div>
      </div>
    </div>



    <div
      v-if="showBrowser"
      class="browser-overlay dp-browser-overlay"
      :style="overlayFallbackStyle"
      @click.self="showBrowser = false"
    >
      <div class="browser-dialog dp-browser-dialog" :style="panelFallbackStyle">
        <div class="browser-dialog-header">
          <h3>在线模型库</h3>
          <button class="close-btn" type="button" @click="showBrowser = false">X</button>
        </div>
        <div class="browser-dialog-body">
          <ModelBrowser :use-cdn="settings.useCdn" @cancel="showBrowser = false" @load-model="onBrowserLoad" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import {
  API_SOURCES,
  COMMENT_STYLES,
  COMMENT_TRIGGER_MODE_OPTIONS,
  DEFAULTS,
  EMOTION_TAGS,
  EMPTY_MOTION_GROUP_VALUE,
  LOCAL_LIVE2D_MODEL_PATH,
  LOCAL_LIVE2D_MODEL_SLOT_ID,
  RECOMMENDED_MODELS,
  SCRIPT_NAME,
  type EmotionTag,
  type Live2DRuntimeType,
} from '../core/constants';
import { createDefaultEmotionConfigs, parseAliasesText, type EmotionConfig } from '../core/emotion';
import { useSettingsStore } from '../core/settings';
import { deleteLive2DModel, getLive2DModel, hasLive2DModel, type StoredLive2DModel } from '../db/live2d-models';
import {
  getBuiltinExpressionByKey,
  getBuiltinExpressionOptions,
  getBuiltinMotionByKey,
  getBuiltinMotionOptions,
  makeBuiltinExpressionToken,
  makeBuiltinMotionToken,
  parseBuiltinMotionToken,
} from '../live2d/builtin-expression-motion';
import { resolveLive2DExpression, resolveLive2DMotion } from '../live2d/expression-motion';
import { Live2DManager } from '../live2d/manager';
import { Live2DStage } from '../live2d/stage';
import { Live2DUploader } from '../live2d/uploader';
import { callHost, speak, stopSpeaking } from '../../bridge/tavern';
import ModelBrowser from './ModelBrowser.vue';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  'model-change': [path: string];
}>();

type SectionKey = 'model' | 'live2d' | 'comment' | 'expression' | 'tts' | 'about';

const sectionTabs: ReadonlyArray<{
  key: SectionKey;
  index: string;
  label: string;
  en: string;
}> = [
  { key: 'model', index: '01', label: '模型', en: 'MODEL CONTROL' },
  { key: 'live2d', index: '02', label: 'Live2D', en: 'LIVE2D MODEL' },
  { key: 'comment', index: '03', label: '吐槽', en: 'COMMENT SYSTEM' },
  { key: 'expression', index: '04', label: '表情', en: 'EMOTION COT' },
  { key: 'tts', index: '05', label: '朗读', en: 'VOICE CONTROL' },
  { key: 'about', index: '06', label: '关于', en: 'ABOUT & LICENSE' },
];

// 默认停在 Live2D：这是玩家最常改的一页（换模型、调大小）。
const activeSection = ref<SectionKey>('live2d');

// 「模型」页的候选列表：由宿主侧列这台机器上可用的通道与模型。
const modelCatalogState = ref<'loading' | 'ready' | 'error'>('loading');
const modelCatalogError = ref('');
const commentModelOptions = ref<Array<{ value: string; label: string }>>([]);

async function loadCommentModelOptions(): Promise<void> {
  if (modelCatalogState.value === 'ready') return;
  modelCatalogState.value = 'loading';
  modelCatalogError.value = '';
  try {
    const reply = await callHost('dsh-tavern-desktop-pet/models', {});
    const options: Array<{ value: string; label: string }> = [];
    for (const provider of reply?.providers || []) {
      for (const model of provider.models || []) {
        options.push({
          value: `${provider.provider}|${model}`,
          label: `${provider.label || provider.provider} · ${model}`,
        });
      }
    }
    commentModelOptions.value = options;
    modelCatalogState.value = 'ready';
  } catch (e) {
    modelCatalogError.value = `读取模型列表失败：${e instanceof Error ? e.message : String(e)}`;
    modelCatalogState.value = 'error';
  }
}

function onCommentModelChange(event: Event): void {
  const raw = String((event.target as HTMLSelectElement | null)?.value || '');
  const [provider, model] = raw.split('|');
  settings.value.commentModelProvider = provider || '';
  settings.value.commentModelModel = model || '';
}

// 打开面板时顺手取一次；失败不阻塞别的设置页。
watch(
  () => props.visible,
  (visible) => {
    if (visible) void loadCommentModelOptions();
  },
  { immediate: true },
);

const store = useSettingsStore();
const { settings } = storeToRefs(store);

function toBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function ensureNumericSettingsIntegrity(): void {
  if (!settings.value.apiConfig || typeof settings.value.apiConfig !== 'object') {
    settings.value.apiConfig = {
      url: '',
      apiKey: '',
      proxyPreset: '',
      model: 'gpt-4o-mini',
      source: 'openai',
      max_tokens: DEFAULTS.MAX_TOKENS,
      temperature: DEFAULTS.TEMPERATURE,
      frequency_penalty: DEFAULTS.FREQUENCY_PENALTY,
      presence_penalty: DEFAULTS.PRESENCE_PENALTY,
      top_p: DEFAULTS.TOP_P,
      top_k: DEFAULTS.TOP_K,
      usePresetSampling: false,
      sendWorldInfo: false,
    } as any;
  }

  const api = settings.value.apiConfig as any;
  api.max_tokens = Math.round(toBoundedNumber(api.max_tokens, DEFAULTS.MAX_TOKENS, 1, 4096));
  api.temperature = toBoundedNumber(api.temperature, DEFAULTS.TEMPERATURE, 0, 2);
  api.frequency_penalty = toBoundedNumber(api.frequency_penalty, DEFAULTS.FREQUENCY_PENALTY, -2, 2);
  api.presence_penalty = toBoundedNumber(api.presence_penalty, DEFAULTS.PRESENCE_PENALTY, -2, 2);
  api.top_p = toBoundedNumber(api.top_p, DEFAULTS.TOP_P, 0, 1);
  api.top_k = Math.round(toBoundedNumber(api.top_k, DEFAULTS.TOP_K, 0, 500));

  if (typeof api.url !== 'string') api.url = String(api.url ?? '');
  if (typeof api.apiKey !== 'string') api.apiKey = String(api.apiKey ?? '');
  if (typeof api.proxyPreset !== 'string') api.proxyPreset = String(api.proxyPreset ?? '');
  if (typeof api.model !== 'string') api.model = String(api.model ?? 'gpt-4o-mini');
  if (typeof api.source !== 'string') api.source = String(api.source ?? 'openai');
  api.usePresetSampling = api.usePresetSampling === true;
  api.sendWorldInfo = api.sendWorldInfo === true;

  settings.value.petScale = toBoundedNumber(settings.value.petScale, DEFAULTS.PET_SCALE, 0.1, 3);
  const rawBubbleDuration =
    typeof settings.value.bubbleDuration === 'number'
      ? settings.value.bubbleDuration
      : Number(settings.value.bubbleDuration ?? Number.NaN);
  const bubbleDurationSeconds =
    Number.isFinite(rawBubbleDuration) && rawBubbleDuration > 600 ? rawBubbleDuration / 1000 : rawBubbleDuration;
  settings.value.bubbleDuration = Math.round(
    toBoundedNumber(bubbleDurationSeconds, DEFAULTS.BUBBLE_DURATION, -1, 600),
  );
}

const petScaleLabel = computed(() => toBoundedNumber(settings.value.petScale, DEFAULTS.PET_SCALE, 0.1, 3).toFixed(2));

ensureNumericSettingsIntegrity();

const recommendedModels = RECOMMENDED_MODELS;
const commentStyles = COMMENT_STYLES;
const commentTriggerModeOptions = COMMENT_TRIGGER_MODE_OPTIONS;
const showBrowser = ref(false);
const customModelUrl = ref(settings.value.modelPath || '');
const localModelFileInput = ref<HTMLInputElement | null>(null);
const uploadingLocalModel = ref(false);
const localModelActionBusy = ref(false);
const localModelStatus = ref('');
const localModelError = ref('');
const localModelInfo = ref<StoredLive2DModel | null>(null);
const localModelBusy = computed(() => uploadingLocalModel.value || localModelActionBusy.value);
const localModelExists = computed(() => !!localModelInfo.value);

const diceReferenceSheetOptions = ref<string[]>([]);
const refreshingDiceSheetOptions = ref(false);

function normalizeDiceReferenceSheetName(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function dedupeDiceReferenceSheetNames(values: string[]): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const value of values) {
    const name = normalizeDiceReferenceSheetName(value);
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    list.push(name);
  }
  return list;
}

function parseDiceReferenceRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try {
      return parseDiceReferenceRecord(JSON.parse(text));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isDiceReferencePayload(record: Record<string, unknown>): boolean {
  return Object.keys(record).some(key => key.startsWith('sheet_'));
}

function extractDiceReferenceSheetNamesFromPayload(payload: unknown): string[] {
  const record = parseDiceReferenceRecord(payload);
  if (!record) return [];

  let tableRecord: Record<string, unknown> | null = record;
  if (!isDiceReferencePayload(tableRecord)) {
    const nested = parseDiceReferenceRecord(tableRecord.independentData);
    if (!nested || !isDiceReferencePayload(nested)) {
      return [];
    }
    tableRecord = nested;
  }

  return dedupeDiceReferenceSheetNames(
    Object.keys(tableRecord)
      .filter(key => key.startsWith('sheet_'))
      .map(key => {
        const sheet = parseDiceReferenceRecord(tableRecord?.[key]);
        return sheet?.name ?? '';
      }),
  );
}

function pickDiceReferencePayloadFromIsolatedData(value: unknown): Record<string, unknown> | null {
  const isolated = parseDiceReferenceRecord(value);
  if (!isolated) return null;

  const keys = Object.keys(isolated);
  for (let i = keys.length - 1; i >= 0; i--) {
    const slot = parseDiceReferenceRecord(isolated[keys[i]]);
    if (!slot) continue;
    const payload = parseDiceReferenceRecord(slot.independentData);
    if (payload && isDiceReferencePayload(payload)) {
      return payload;
    }
  }
  return null;
}

function pickDiceReferencePayloadFromMessage(message: any): Record<string, unknown> | null {
  if (!message || typeof message !== 'object') return null;

  const directCandidates: unknown[] = [
    message.TavernDB_ACU_IndependentData,
    message.TavernDB_ACU_Data,
    message.TavernDB_ACU_SummaryData,
    message.data?.TavernDB_ACU_IndependentData,
    message.data?.TavernDB_ACU_Data,
    message.data?.TavernDB_ACU_SummaryData,
  ];
  for (const candidate of directCandidates) {
    const payload = parseDiceReferenceRecord(candidate);
    if (!payload) continue;
    if (isDiceReferencePayload(payload)) {
      return payload;
    }
    const nested = parseDiceReferenceRecord(payload.independentData);
    if (nested && isDiceReferencePayload(nested)) {
      return nested;
    }
  }

  const isolatedCandidates = [message.TavernDB_ACU_IsolatedData, message.data?.TavernDB_ACU_IsolatedData];
  for (const candidate of isolatedCandidates) {
    const payload = pickDiceReferencePayloadFromIsolatedData(candidate);
    if (payload) return payload;
  }

  return null;
}

function readDiceReferenceSheetNamesFromApi(): string[] {
  try {
    const topWindow = window.parent ?? window;
    const api = (topWindow as any)?.AutoCardUpdaterAPI;
    if (!api || typeof api.exportTableAsJson !== 'function') {
      return [];
    }
    return extractDiceReferenceSheetNamesFromPayload(api.exportTableAsJson());
  } catch {
    return [];
  }
}

function readDiceReferenceSheetNamesFromChat(): string[] {
  try {
    const messages = getChatMessages(`0-{{lastMessageId}}`, {
      role: 'all',
      hide_state: 'all',
    });
    const list = Array.isArray(messages) ? messages : [];
    for (let i = list.length - 1; i >= 0; i--) {
      const payload = pickDiceReferencePayloadFromMessage(list[i] as any);
      if (!payload) continue;
      const names = extractDiceReferenceSheetNamesFromPayload(payload);
      if (names.length > 0) return names;
    }
  } catch {
    // ignore
  }
  return [];
}

function getDiceReferenceSelectedSheets(): string[] {
  const raw = Array.isArray((settings.value as any).diceReferenceVisibleSheets)
    ? ((settings.value as any).diceReferenceVisibleSheets as unknown[])
    : [];
  return dedupeDiceReferenceSheetNames(raw.map(item => String(item ?? '')));
}

function setDiceReferenceSelectedSheets(next: string[]): void {
  (settings.value as any).diceReferenceVisibleSheets = dedupeDiceReferenceSheetNames(next);
}

function isDiceSheetVisible(sheetName: string): boolean {
  const selected = getDiceReferenceSelectedSheets();
  if (selected.length === 0) return true;
  return selected.includes(sheetName);
}

function onToggleDiceSheetVisibility(sheetName: string, event: Event): void {
  const target = event?.target as HTMLInputElement | null;
  const checked = !!target?.checked;
  const options = diceReferenceSheetOptions.value;
  const current = getDiceReferenceSelectedSheets();
  let next = current.length === 0 ? [...options] : [...current];

  if (checked) {
    if (!next.includes(sheetName)) {
      next.push(sheetName);
    }
  } else {
    next = next.filter(name => name !== sheetName);
  }

  // 空数组表示“全部可见”
  if (options.length > 0 && next.length === options.length) {
    next = [];
  }
  setDiceReferenceSelectedSheets(next);
}

const diceReferenceSheetSummary = computed(() => {
  const optionsCount = diceReferenceSheetOptions.value.length;
  const selected = getDiceReferenceSelectedSheets();
  if (optionsCount <= 0) {
    return '暂无可用表名。';
  }
  if (selected.length === 0) {
    return `当前：全部可见（${optionsCount}/${optionsCount}）`;
  }
  return `当前：已勾选 ${selected.length}/${optionsCount}`;
});

function refreshDiceReferenceSheetOptions(): void {
  refreshingDiceSheetOptions.value = true;
  try {
    const fromApi = readDiceReferenceSheetNamesFromApi();
    const fromChat = fromApi.length > 0 ? [] : readDiceReferenceSheetNamesFromChat();
    const selected = getDiceReferenceSelectedSheets();
    diceReferenceSheetOptions.value = dedupeDiceReferenceSheetNames([
      ...fromApi,
      ...fromChat,
      ...selected,
    ]);
  } finally {
    refreshingDiceSheetOptions.value = false;
  }
}

function selectAllDiceReferenceSheets(): void {
  // 空数组表示“全部可见”
  setDiceReferenceSelectedSheets([]);
}

function clearDiceReferenceSheets(): void {
  // 空数组表示“全部可见”
  setDiceReferenceSelectedSheets([]);
}

const ttsTestText = ref('你好，我是桌宠。');
const ttsTestHint = ref('');





const emotionTags = EMOTION_TAGS;
const live2dExpressions = ref<string[]>([]);
const live2dMotionGroups = ref<Array<{ name: string; count: number }>>([]);
const live2dMotions = ref<Array<{ name: string; group: string; index: number }>>([]);
const refreshingLive2dLists = ref(false);

const live2dExpressionOptions = computed(() => {
  const dedup = new Set<string>();
  const list: string[] = [];
  for (const item of live2dExpressions.value) {
    const value = String(item ?? '').trim();
    if (!value) continue;
    if (dedup.has(value)) continue;
    dedup.add(value);
    list.push(value);
  }
  return list.sort((a, b) => a.localeCompare(b));
});

type ExpressionSelectOption = {
  key: string;
  value: string;
  label: string;
};

const live2dExpressionSelectOptions = computed<ExpressionSelectOption[]>(() => {
  const options: ExpressionSelectOption[] = [];
  const seen = new Set<string>();

  for (const expr of live2dExpressionOptions.value) {
    const value = String(expr || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      key: `native_expr_${value}`.replace(/\s+/g, '_'),
      value,
      label: value,
    });
  }

  for (const builtin of getBuiltinExpressionOptions()) {
    if (!builtin?.token || seen.has(builtin.token)) continue;
    seen.add(builtin.token);
    options.push({
      key: `builtin_expr_${builtin.key}`,
      value: builtin.token,
      label: `${builtin.label}（内置）`,
    });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
});

const live2dExpressionOptionSet = computed(() => {
  return new Set(live2dExpressionSelectOptions.value.map(option => option.value));
});

type MotionOverridePayload = {
  group: string;
  index: number;
  name?: string;
  explicitEmptyGroup?: boolean;
};

type MotionSelectOption = {
  key: string;
  value: string;
  label: string;
};

function normalizeMotionIndex(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function normalizeMotionGroupValue(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (raw === EMPTY_MOTION_GROUP_VALUE) return '';
  return raw;
}

function isEmptyMotionGroupMarker(value: unknown): boolean {
  return String(value ?? '').trim() === EMPTY_MOTION_GROUP_VALUE;
}

function normalizeMotionOverridePayload(payload: MotionOverridePayload): MotionOverridePayload {
  const explicitEmptyGroup = payload.explicitEmptyGroup === true || isEmptyMotionGroupMarker(payload.group);
  return {
    group: normalizeMotionGroupValue(payload.group),
    index: normalizeMotionIndex(payload.index),
    name: String(payload.name ?? '').trim(),
    explicitEmptyGroup,
  };
}

function encodeMotionOption(payload: MotionOverridePayload): string {
  const normalized = normalizeMotionOverridePayload(payload);
  const hasExplicitEmpty = normalized.explicitEmptyGroup === true && normalized.group === '';
  if (!normalized.group && normalized.index === 0 && !hasExplicitEmpty) return '';
  return JSON.stringify({
    ...normalized,
    group: normalized.group === '' && hasExplicitEmpty ? EMPTY_MOTION_GROUP_VALUE : normalized.group,
  });
}

function decodeMotionOption(raw: string): MotionOverridePayload | null {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<MotionOverridePayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    const explicitEmptyGroup = isEmptyMotionGroupMarker((parsed as any).group);
    const group = normalizeMotionGroupValue(parsed.group ?? '');
    const index = normalizeMotionIndex(parsed.index);
    if (!group && index === 0 && !explicitEmptyGroup) return null;
    return {
      group,
      index,
      name: String(parsed.name ?? '').trim(),
      explicitEmptyGroup,
    };
  } catch {
    return null;
  }
}

function resolveMotionOverridePayload(cfg: EmotionConfig): MotionOverridePayload | null {
  const rawGroup = String(cfg?.live2dMotion?.group ?? '');
  const explicitEmptyGroup = isEmptyMotionGroupMarker(rawGroup);
  const overrideGroup = normalizeMotionGroupValue(rawGroup);
  const overrideIndex = normalizeMotionIndex(cfg?.live2dMotion?.index);
  const hasExplicitOverride = explicitEmptyGroup || !!overrideGroup || overrideIndex > 0;
  if (!hasExplicitOverride) return null;

  const exactByGroupIndex = live2dMotions.value.find((motion) => {
    const group = normalizeMotionGroupValue(motion?.group);
    const index = normalizeMotionIndex(motion?.index);
    return group === overrideGroup && index === overrideIndex;
  });
  if (exactByGroupIndex) {
    return normalizeMotionOverridePayload({
      group: exactByGroupIndex.group,
      index: exactByGroupIndex.index,
      name: exactByGroupIndex.name,
    });
  }

  // 兼容旧配置：group 字段历史上可能被写成 motion name。
  const lower = overrideGroup.toLowerCase();
  if (lower) {
    const byName =
      live2dMotions.value.find((motion) => {
        const name = String(motion?.name ?? '').trim().toLowerCase();
        const index = normalizeMotionIndex(motion?.index);
        return name === lower && index === overrideIndex;
      }) ||
      live2dMotions.value.find((motion) => String(motion?.name ?? '').trim().toLowerCase() === lower);
    if (byName) {
      return normalizeMotionOverridePayload({
        group: byName.group,
        index: byName.index,
        name: byName.name,
      });
    }
  }

  return normalizeMotionOverridePayload({
    group: overrideGroup,
    index: overrideIndex,
    explicitEmptyGroup,
  });
}

function getMotionOverrideValue(cfg: EmotionConfig): string {
  const payload = resolveMotionOverridePayload(cfg);
  if (!payload) return '';
  return encodeMotionOption(payload);
}

function getMotionOverrideLabel(cfg: EmotionConfig): string {
  const payload = resolveMotionOverridePayload(cfg);
  if (!payload) return '';
  const builtinKey = parseBuiltinMotionToken(payload.group);
  if (builtinKey) {
    const builtinDef = getBuiltinMotionByKey(builtinKey);
    return builtinDef ? `${builtinDef.label}（内置动作）` : `内置动作 ${builtinKey}`;
  }
  if (payload.name) {
    const groupLabel = payload.group ? `${payload.group}#${payload.index}` : `#${payload.index}`;
    return `${payload.name}（动作 ${groupLabel}）`;
  }
  return `${payload.group || '(空动作组)'}#${payload.index}`;
}

function setMotionOverrideValue(cfg: EmotionConfig, rawValue: unknown): void {
  const parsed = decodeMotionOption(String(rawValue || '').trim());
  if (!parsed) {
    cfg.live2dMotion.group = '';
    cfg.live2dMotion.index = 0;
    return;
  }
  cfg.live2dMotion.group =
    parsed.group === '' && parsed.explicitEmptyGroup === true ? EMPTY_MOTION_GROUP_VALUE : parsed.group;
  cfg.live2dMotion.index = parsed.index;
}

function onMotionOverrideChange(cfg: EmotionConfig, event: Event): void {
  const target = event?.target as HTMLSelectElement | null;
  setMotionOverrideValue(cfg, target?.value || '');
}

const live2dMotionSelectOptions = computed<Array<MotionSelectOption>>(() => {
  const seen = new Set<string>();
  const options: MotionSelectOption[] = [];

  for (const motion of live2dMotions.value) {
    const group = normalizeMotionGroupValue(motion?.group);
    const index = normalizeMotionIndex(motion?.index);
    const name = String(motion?.name ?? '').trim();
    const value = encodeMotionOption({ group, index, name, explicitEmptyGroup: group === '' });
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const groupLabel = `${group || '(空动作组)'}#${index}`;
    const safeName = name || '(未命名动作)';
    options.push({
      key: `motion_${groupLabel}_${safeName}`.replace(/\s+/g, '_'),
      value,
      label: `${safeName}（动作 ${groupLabel}）`,
    });
  }

  for (const group of live2dMotionGroups.value) {
    const groupName = normalizeMotionGroupValue(group?.name);
    const value = encodeMotionOption({
      group: groupName,
      index: 0,
      explicitEmptyGroup: groupName === '',
    });
    if (!value || seen.has(value)) continue;
    seen.add(value);
    const groupLabel = groupName || '(空动作组)';
    options.push({
      key: `group_${groupLabel}_${group.count}`.replace(/\s+/g, '_'),
      value,
      label: `${groupLabel}（动作组 ${group.count}）`,
    });
  }

  for (const builtin of getBuiltinMotionOptions()) {
    const token = makeBuiltinMotionToken(builtin.key);
    const value = encodeMotionOption({
      group: token,
      index: 0,
      name: builtin.label,
      explicitEmptyGroup: false,
    });
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      key: `builtin_motion_${builtin.key}`,
      value,
      label: `${builtin.label}（内置动作）`,
    });
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
});

const live2dMotionOptionSet = computed(() => {
  return new Set(live2dMotionSelectOptions.value.map(option => option.value));
});

const live2dListSummary = computed(() => {
  const exprCount = live2dExpressions.value.length;
  const motionCount = live2dMotions.value.length;
  const groupCount = live2dMotionGroups.value.length;
  if (!Live2DManager.model) return '当前未加载 Live2D 模型，加载后可刷新列表。';
  const exprHint = exprCount === 0 ? '（该模型可能未提供独立 Expressions）' : '';
  const motionHint = motionCount === 0 ? '（未识别到 motions）' : '';
  return `当前模型：表情 ${exprCount} 个${exprHint}，动作 ${motionCount} 个${motionHint}，动作组 ${groupCount} 个。`;
});

const live2dPreviewMountEl = ref<HTMLElement | null>(null);
const live2dPreviewInteractEl = ref<HTMLElement | null>(null);
const previewMounted = ref(false);
const previewTag = ref<EmotionTag>('默认');
const previewStatus = ref('切换到“表情”后自动加载预览');
const previewZoomFactor = ref(1.8);
let previewPanOffsetX = 0;
let previewPanOffsetY = 0;
let previewBasePose = { x: 0, y: 0, scale: 1 };
let previewIsDragging = false;
let previewDragStart = { x: 0, y: 0 };
let previewDragOrigin = { x: 0, y: 0 };
let previewMountPromise: Promise<boolean> | null = null;
let previewResizeObserver: ResizeObserver | null = null;
let previewAutoMotionLoopEnabled = true;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getPreviewCanvasSize(): { width: number; height: number } {
  const el = live2dPreviewMountEl.value;
  const rect = el?.getBoundingClientRect?.();
  const width = Math.max(1, Math.floor(rect?.width || el?.clientWidth || 320));
  const height = Math.max(1, Math.floor(rect?.height || el?.clientHeight || 260));
  return { width, height };
}

function capturePreviewBasePose(): void {
  const model = Live2DManager.model as any;
  if (!model) return;

  const baseScale = Number(model.scale?.x);
  previewBasePose = {
    x: Number(model.x) || 0,
    y: Number(model.y) || 0,
    scale: Number.isFinite(baseScale) && baseScale > 0 ? baseScale : 1,
  };
}

function applyPreviewViewport(): void {
  if (!previewMounted.value) return;
  const model = Live2DManager.model as any;
  if (!model) return;

  const { width, height } = getPreviewCanvasSize();
  const maxOffsetX = Math.max(60, width * 0.45);
  const maxOffsetY = Math.max(60, height * 0.45);
  previewPanOffsetX = clamp(previewPanOffsetX, -maxOffsetX, maxOffsetX);
  previewPanOffsetY = clamp(previewPanOffsetY, -maxOffsetY, maxOffsetY);
  previewZoomFactor.value = clamp(previewZoomFactor.value, 0.5, 4);

  const finalScale = previewBasePose.scale * previewZoomFactor.value;
  if (model.scale?.set) {
    model.scale.set(finalScale);
  }
  model.x = previewBasePose.x + previewPanOffsetX;
  model.y = previewBasePose.y + previewPanOffsetY;
}

function resetPreviewViewport(): void {
  previewZoomFactor.value = 1.8;
  previewPanOffsetX = 0;
  previewPanOffsetY = 0;
  applyPreviewViewport();
}

function getPreviewDragPoint(event: unknown): { x: number; y: number } | null {
  const ev: any = (event as any)?.originalEvent || event;
  if (ev?.touches?.length) return { x: ev.touches[0].clientX, y: ev.touches[0].clientY };
  if (ev?.changedTouches?.length) return { x: ev.changedTouches[0].clientX, y: ev.changedTouches[0].clientY };
  if (Number.isFinite(ev?.clientX) && Number.isFinite(ev?.clientY)) return { x: ev.clientX, y: ev.clientY };
  return null;
}

function unbindPreviewViewportEvents(): void {
  const interactEl = live2dPreviewInteractEl.value;
  if (!interactEl) return;
  const top = window.parent ?? window;
  const doc = top.document;

  const handlers = (interactEl as any).__dpPreviewHandlers;
  if (!handlers) return;

  try {
    interactEl.removeEventListener('mousedown', handlers.onDown);
    interactEl.removeEventListener('touchstart', handlers.onDown);
    interactEl.removeEventListener('wheel', handlers.onWheel);
    doc.removeEventListener('mousemove', handlers.onMove);
    doc.removeEventListener('touchmove', handlers.onMove);
    doc.removeEventListener('mouseup', handlers.onUp);
    doc.removeEventListener('touchend', handlers.onUp);
    doc.removeEventListener('touchcancel', handlers.onUp);
  } catch {
    // ignore
  }

  (interactEl as any).__dpPreviewHandlers = null;
}

function bindPreviewViewportEvents(): void {
  const interactEl = live2dPreviewInteractEl.value;
  if (!interactEl) return;
  if ((interactEl as any).__dpPreviewHandlers) return;

  const top = window.parent ?? window;
  const doc = top.document;

  const onDown = (event: any) => {
    if (!previewMounted.value) return;
    const point = getPreviewDragPoint(event);
    if (!point) return;
    previewIsDragging = true;
    previewDragStart = point;
    previewDragOrigin = { x: previewPanOffsetX, y: previewPanOffsetY };
    interactEl.style.cursor = 'grabbing';
    if (typeof event.preventDefault === 'function') event.preventDefault();
  };

  const onMove = (event: any) => {
    if (!previewIsDragging) return;
    const point = getPreviewDragPoint(event);
    if (!point) return;
    previewPanOffsetX = previewDragOrigin.x + (point.x - previewDragStart.x);
    previewPanOffsetY = previewDragOrigin.y + (point.y - previewDragStart.y);
    applyPreviewViewport();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  };

  const onUp = () => {
    if (!previewIsDragging) return;
    previewIsDragging = false;
    interactEl.style.cursor = 'grab';
  };

  const onWheel = (event: WheelEvent) => {
    if (!previewMounted.value) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    previewZoomFactor.value = clamp(previewZoomFactor.value + delta, 0.5, 4);
    applyPreviewViewport();
  };

  interactEl.style.cursor = 'grab';
  interactEl.addEventListener('mousedown', onDown);
  interactEl.addEventListener('touchstart', onDown, { passive: false });
  interactEl.addEventListener('wheel', onWheel, { passive: false });
  doc.addEventListener('mousemove', onMove);
  doc.addEventListener('touchmove', onMove, { passive: false });
  doc.addEventListener('mouseup', onUp);
  doc.addEventListener('touchend', onUp);
  doc.addEventListener('touchcancel', onUp);

  (interactEl as any).__dpPreviewHandlers = { onDown, onMove, onUp, onWheel };
}

function disconnectPreviewResizeObserver(): void {
  try {
    previewResizeObserver?.disconnect();
  } catch {
    // ignore
  } finally {
    previewResizeObserver = null;
  }
}

function bindPreviewResizeObserver(): void {
  const mountEl = live2dPreviewMountEl.value;
  if (!mountEl) return;
  disconnectPreviewResizeObserver();
  if (typeof ResizeObserver === 'undefined') return;

  try {
    previewResizeObserver = new ResizeObserver(() => {
      if (!previewMounted.value) return;
      const { width, height } = getPreviewCanvasSize();
      Live2DStage.resizePreview(width, height);
      applyPreviewViewport();
    });
    previewResizeObserver.observe(mountEl);
  } catch {
    previewResizeObserver = null;
  }
}

async function ensurePreviewMounted(): Promise<boolean> {
  if (previewMounted.value) return true;
  if (previewMountPromise) return previewMountPromise;

  previewMountPromise = (async () => {
    await nextTick();
    const mountEl = live2dPreviewMountEl.value;
    if (!mountEl) return false;
    if (!Live2DManager.model) {
      previewStatus.value = '当前未加载 Live2D 模型';
      return false;
    }
    if (!Live2DStage.container) {
      previewStatus.value = 'Live2D 舞台未就绪';
      return false;
    }

    previewStatus.value = '正在挂载预览...';
    const attached = Live2DStage.pushMount(mountEl);
    if (!attached) {
      previewStatus.value = '预览挂载失败';
      return false;
    }

    previewAutoMotionLoopEnabled = Live2DManager.autoMotionLoopEnabled !== false;
    Live2DManager.setAutoMotionLoopEnabled(false);
    Live2DManager.stopBuiltinMotion();
    Live2DManager.stopCurrentMotion('preview-enter');

    previewMounted.value = true;
    bindPreviewViewportEvents();
    bindPreviewResizeObserver();

    const { width, height } = getPreviewCanvasSize();
    Live2DStage.resizePreview(width, height);
    Live2DManager.mountToStage(width, height, 1);
    capturePreviewBasePose();
    resetPreviewViewport();

    // 自动刷新一次列表，方便快速绑定
    refreshLive2DLists();

    previewStatus.value = '预览就绪，可拖拽移动/滚轮缩放';
    return true;
  })().finally(() => {
    previewMountPromise = null;
  });

  return previewMountPromise;
}

function cleanupPreviewMount(reloadModel = true): void {
  disconnectPreviewResizeObserver();
  unbindPreviewViewportEvents();
  previewIsDragging = false;
  Live2DManager.stopBuiltinMotion();
  Live2DManager.stopCurrentMotion('preview-cleanup');

  if (!previewMounted.value) return;
  previewMounted.value = false;

  const restored = Live2DStage.popMount();
  if (restored && Live2DManager.model) {
    Live2DManager.mountToStage(restored.width, restored.height, 1);
  }
  Live2DManager.setAutoMotionLoopEnabled(previewAutoMotionLoopEnabled);
  if (reloadModel) {
    const currentPath = String(settings.value.modelPath || '').trim();
    if (currentPath) {
      emit('model-change', currentPath);
    }
  }
  previewStatus.value = '切换到“表情”后自动加载预览';
}

function replayPreview(): void {
  void previewEmotion(previewTag.value);
}

watch(
  () => ({ visible: props.visible, section: activeSection.value }),
  ({ visible, section }) => {
    if (visible && section === 'expression') {
      void (async () => {
        const mounted = await ensurePreviewMounted();
        if (mounted) {
          void previewEmotion(previewTag.value);
        }
      })();
      return;
    }
    cleanupPreviewMount();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  cleanupPreviewMount(false);
});

const modelList = ref<string[]>([]);
const fetchingModels = ref(false);
const modelFetchError = ref('');
const testingConnection = ref(false);
const connectionStatus = ref<'idle' | 'success' | 'fail'>('idle');
const connectionError = ref('');
const proxyPresetOptions = ref<ProxyPresetOption[]>([]);
const proxyPresetLoading = ref(false);
const proxyPresetLoadStatus = ref<'idle' | 'success' | 'fail'>('idle');
const proxyPresetLoadError = ref('');
const showEmotionAdvanced = ref(false);
const overlayFallbackStyle = {
  position: 'fixed',
  inset: '0',
  width: '100vw',
  height: '100vh',
  minHeight: '100vh',
  zIndex: '1500',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
const panelFallbackStyle = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: 'min(1080px, calc(100vw - 24px))',
  maxHeight: 'calc(100vh - 24px)',
  minHeight: '280px',
};

type CustomApiModelConfig = {
  apiurl: string;
  key?: string;
};

type ProxyPresetOption = {
  name: string;
  id?: string;
  api?: string;
  model?: string;
  source?: string;
  type?: string;
  proxyPresetName?: string;
  url?: string;
  password?: string;
};

const CONNECTION_PROFILE_NONE = '<None>';

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProxyPresetName(value: unknown): string {
  return String(value ?? '').trim();
}

function getConnectionProfileApiMap(apiValue: unknown): Record<string, unknown> | null {
  const apiName = normalizeProxyPresetName(apiValue);
  if (!apiName) return null;

  try {
    const context = SillyTavern.getContext?.();
    const apiMap = context?.CONNECT_API_MAP?.[apiName];
    if (!isPlainRecord(apiMap)) return null;
    return apiMap;
  } catch {
    return null;
  }
}

function resolveConnectionProfileSource(apiValue: unknown): string {
  const apiMap = getConnectionProfileApiMap(apiValue);
  if (!apiMap || normalizeProxyPresetName(apiMap.selected) !== 'openai') {
    return '';
  }
  return normalizeProxyPresetName(apiMap.source);
}

function isSupportedConnectionProfile(profile: Record<string, unknown>): boolean {
  const apiName = normalizeProxyPresetName(profile.api);
  if (!apiName) return false;

  try {
    const context = SillyTavern.getContext?.();
    const requestService = context?.ConnectionManagerRequestService;
    if (requestService && typeof requestService.isProfileSupported === 'function') {
      return !!requestService.isProfileSupported(profile);
    }
  } catch {
    // ignore
  }

  const apiMap = getConnectionProfileApiMap(apiName);
  if (!apiMap) return false;

  switch (normalizeProxyPresetName(apiMap.selected)) {
    case 'openai':
      return !!normalizeProxyPresetName(apiMap.source);
    case 'textgenerationwebui':
      return !!normalizeProxyPresetName(apiMap.type);
    default:
      return false;
  }
}

function normalizeConnectionProfileOptions(value: unknown): ProxyPresetOption[] {
  if (!Array.isArray(value)) return [];

  const out: ProxyPresetOption[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (!isPlainRecord(item)) continue;
    const name = normalizeProxyPresetName(item.name);
    if (!name || seen.has(name)) continue;
    if (name === CONNECTION_PROFILE_NONE) continue;
    if (!isSupportedConnectionProfile(item)) continue;

    const api = normalizeProxyPresetName(item.api);
    const source = resolveConnectionProfileSource(api);
    const apiMap = getConnectionProfileApiMap(api);

    seen.add(name);
    out.push({
      name,
      id: normalizeProxyPresetName(item.id),
      api,
      model: normalizeProxyPresetName(item.model),
      source,
      type: normalizeProxyPresetName(apiMap?.type),
      proxyPresetName: normalizeProxyPresetName(item.proxy),
    });
  }

  return out.sort((lhs, rhs) => lhs.name.localeCompare(rhs.name));
}

function readConnectionManagerSettings(settingsPayload: Record<string, unknown>): Record<string, unknown> | null {
  const extensionSettings = settingsPayload.extensionSettings;
  if (isPlainRecord(extensionSettings) && isPlainRecord(extensionSettings.connectionManager)) {
    return extensionSettings.connectionManager;
  }

  const legacyExtensionSettings = settingsPayload.extension_settings;
  if (isPlainRecord(legacyExtensionSettings) && isPlainRecord(legacyExtensionSettings.connectionManager)) {
    return legacyExtensionSettings.connectionManager;
  }

  if (isPlainRecord(settingsPayload.connectionManager)) {
    return settingsPayload.connectionManager;
  }

  return null;
}

function readConnectionProfilesFromContext(): { options: ProxyPresetOption[]; selectedName: string } | null {
  try {
    const context = SillyTavern.getContext?.();
    const manager = context?.extensionSettings?.connectionManager;
    const options = normalizeConnectionProfileOptions(manager?.profiles);
    const selectedId = normalizeProxyPresetName(manager?.selectedProfile);
    const selectedName = options.find(option => option.id === selectedId)?.name || '';

    if (options.length > 0 || selectedName) {
      return { options, selectedName };
    }
  } catch {
    // ignore
  }
  return null;
}

function readConnectionProfilesFromDom(): { options: ProxyPresetOption[]; selectedName: string } | null {
  try {
    const topWindow = window.parent ?? window;
    const doc = topWindow.document;
    const select = doc.querySelector('#connection_profiles') as HTMLSelectElement | null;
    if (!select) return null;

    const out: ProxyPresetOption[] = [];
    let selectedName = '';
    const seen = new Set<string>();

    for (const option of Array.from(select.options)) {
      const name = normalizeProxyPresetName(option.textContent);
      const id = normalizeProxyPresetName(option.value);
      if (!name || !id || seen.has(name)) continue;
      seen.add(name);
      out.push({ name, id });
      if (option.selected) {
        selectedName = name;
      }
    }

    if (out.length > 0 || selectedName) {
      return { options: out, selectedName };
    }
  } catch {
    // ignore
  }
  return null;
}

function readSelectedConnectionProfileName(
  manager: Record<string, unknown>,
  options: ProxyPresetOption[],
): string {
  const selectedId = normalizeProxyPresetName(manager.selectedProfile);
  if (!selectedId) return '';
  return options.find(option => option.id === selectedId)?.name || '';
}

function resetCustomApiState(): void {
  modelList.value = [];
  modelFetchError.value = '';
  fetchingModels.value = false;
  testingConnection.value = false;
  connectionStatus.value = 'idle';
  connectionError.value = '';
}

async function loadProxyPresetOptionsFromTavern(): Promise<{
  options: ProxyPresetOption[];
  selectedName: string;
}> {
  const fromContext = readConnectionProfilesFromContext();
  if (fromContext) {
    return fromContext;
  }

  const fromDom = readConnectionProfilesFromDom();
  if (fromDom) {
    return fromDom;
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
    try {
      parsedSettings = JSON.parse(rawSettings);
    } catch {
      throw new Error('酒馆设置解析失败');
    }
  }

  if (!isPlainRecord(parsedSettings)) {
    throw new Error('酒馆设置格式无效');
  }

  const manager = readConnectionManagerSettings(parsedSettings);
  if (!manager) {
    throw new Error('酒馆设置中未找到 API 连接配置');
  }

  const options = normalizeConnectionProfileOptions(manager.profiles);

  return {
    options,
    selectedName: readSelectedConnectionProfileName(manager, options),
  };
}

async function refreshProxyPresetOptions(): Promise<void> {
  proxyPresetLoading.value = true;
  proxyPresetLoadStatus.value = 'idle';
  proxyPresetLoadError.value = '';

  try {
    const { options, selectedName } = await loadProxyPresetOptionsFromTavern();
    proxyPresetOptions.value = options;
    proxyPresetLoadStatus.value = 'success';

    const savedName = normalizeProxyPresetName(settings.value.apiConfig.proxyPreset);
    const tavernSelectedName = normalizeProxyPresetName(selectedName);
    const tavernSelectedExists = options.some(option => option.name === tavernSelectedName);

    if (!savedName && tavernSelectedExists) {
      settings.value.apiConfig.proxyPreset = tavernSelectedName;
    }
  } catch (e: unknown) {
    proxyPresetOptions.value = [];
    proxyPresetLoadStatus.value = 'fail';
    const detail = e instanceof Error ? e.message : String(e);
    proxyPresetLoadError.value = `API 连接配置列表加载失败，请重试：${detail}`;
  } finally {
    proxyPresetLoading.value = false;
  }
}









function formatFileSize(fileSize: unknown): string {
  const bytes = Number(fileSize || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatLocalUploadTime(timestamp: unknown): string {
  const value = Number(timestamp || 0);
  if (!Number.isFinite(value) || value <= 0) return '未知';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '未知';
  }
}

function runtimeLabel(runtimeType: unknown): string {
  const runtime = String(runtimeType || '').trim().toLowerCase() as Live2DRuntimeType;
  if (runtime === 'cubism5') return 'cubism5';
  return 'legacy';
}

async function refreshLocalModelInfo(): Promise<void> {
  try {
    const model = await getLive2DModel(LOCAL_LIVE2D_MODEL_SLOT_ID);
    localModelInfo.value = model;
    if (!model && settings.value.modelPath === LOCAL_LIVE2D_MODEL_PATH) {
      localModelStatus.value = '当前本地槽位为空，请先上传 ZIP 模型。';
    } else if (model) {
      localModelStatus.value = `本地模型槽位就绪：${model.fileName}`;
    }
  } catch (e) {
    localModelInfo.value = null;
    localModelError.value = `读取本地模型失败: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function triggerLocalModelUpload(): void {
  localModelError.value = '';
  localModelStatus.value = '';
  const inputEl = localModelFileInput.value;
  if (!inputEl) return;
  inputEl.value = '';
  inputEl.click();
}

async function onLocalModelFileChange(event: Event): Promise<void> {
  const inputEl = event.target as HTMLInputElement | null;
  const file = inputEl?.files?.[0];
  if (!file) return;

  uploadingLocalModel.value = true;
  localModelError.value = '';
  localModelStatus.value = `正在解析 ${file.name}...`;

  try {
    const storedModel = await Live2DUploader.uploadZip(file);
    localModelStatus.value = `上传成功：${storedModel.fileName}`;
    await refreshLocalModelInfo();
    settings.value.modelPath = LOCAL_LIVE2D_MODEL_PATH;
    customModelUrl.value = LOCAL_LIVE2D_MODEL_PATH;
    emit('model-change', LOCAL_LIVE2D_MODEL_PATH);
    toastr.success('本地模型上传成功，已切换到本地模型');
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    localModelError.value = `上传失败：${message}`;
    localModelStatus.value = '';
    toastr.error(`本地模型上传失败：${message}`);
  } finally {
    uploadingLocalModel.value = false;
    if (inputEl) inputEl.value = '';
  }
}

async function useUploadedModel(): Promise<void> {
  localModelActionBusy.value = true;
  localModelError.value = '';
  try {
    const exists = await hasLive2DModel(LOCAL_LIVE2D_MODEL_SLOT_ID);
    if (!exists) {
      localModelStatus.value = '当前没有可用的本地模型，请先上传 ZIP。';
      toastr.warning('当前没有可用的本地模型，请先上传 ZIP');
      return;
    }
    await refreshLocalModelInfo();
    settings.value.modelPath = LOCAL_LIVE2D_MODEL_PATH;
    customModelUrl.value = LOCAL_LIVE2D_MODEL_PATH;
    localModelStatus.value = '已切换到本地模型。';
    emit('model-change', LOCAL_LIVE2D_MODEL_PATH);
  } catch (e) {
    localModelError.value = `切换本地模型失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    localModelActionBusy.value = false;
  }
}

async function clearUploadedModel(): Promise<void> {
  localModelActionBusy.value = true;
  localModelError.value = '';
  try {
    await deleteLive2DModel(LOCAL_LIVE2D_MODEL_SLOT_ID);
    localModelInfo.value = null;
    localModelStatus.value = '已清除本地模型槽位。';

    if (settings.value.modelPath === LOCAL_LIVE2D_MODEL_PATH) {
      settings.value.modelPath = DEFAULTS.MODEL_PATH;
      customModelUrl.value = DEFAULTS.MODEL_PATH;
      emit('model-change', DEFAULTS.MODEL_PATH);
    }
    toastr.success('已清除本地模型');
  } catch (e) {
    localModelError.value = `清除失败: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    localModelActionBusy.value = false;
  }
}

function selectModel(path: string) {
  settings.value.modelPath = path;
  customModelUrl.value = path;
  emit('model-change', path);
}

function onBrowserLoad(url: string) {
  settings.value.modelPath = url;
  customModelUrl.value = url;
  showBrowser.value = false;
  emit('model-change', url);
}

function loadCustomUrl() {
  let url = customModelUrl.value.trim();
  if (!url) return;
  const blobMatch = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/);
  if (blobMatch) {
    url = `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}`;
    customModelUrl.value = url;
  }
  settings.value.modelPath = url;
  emit('model-change', url);
}

function resetSettings() {
  store.resetSettings();
}

function resetEmotionConfigs(): void {
  settings.value.emotionConfigs = createDefaultEmotionConfigs() as any;
  try {
    toastr.success('表情配置已重置为默认');
  } catch {
    // ignore
  }
}

function onAliasesBlur(cfg: EmotionConfig, ev: Event): void {
  const input = ev.target as HTMLInputElement | null;
  if (!input) return;
  cfg.aliases = parseAliasesText(input.value) as any;
}

function refreshLive2DLists(): void {
  refreshingLive2dLists.value = true;
  try {
    live2dExpressions.value = Live2DManager.getExpressions();
    live2dMotions.value = Live2DManager.getMotions()
      .map(m => ({ name: m.name, group: m.group, index: m.index }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const groups = Live2DManager.getMotionGroups();
    live2dMotionGroups.value = Object.entries(groups)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));

    try {
      toastr.info('已刷新模型表情/动作列表');
    } catch {
      // ignore
    }
  } catch (e) {
    console.warn(`[${SCRIPT_NAME}] 刷新模型表情/动作列表失败:`, e);
    live2dExpressions.value = [];
    live2dMotions.value = [];
    live2dMotionGroups.value = [];
    try {
      toastr.error('刷新列表失败，请先确保模型已加载');
    } catch {
      // ignore
    }
  } finally {
    refreshingLive2dLists.value = false;
  }
}

function autoMatchLive2DOverrides(overwrite = false): void {
  const model = Live2DManager.model as any;
  if (!model) {
    try {
      toastr.warning('当前未加载模型，无法自动匹配');
    } catch {
      // ignore
    }
    return;
  }

  let filled = 0;
  for (const cfg of settings.value.emotionConfigs as any as EmotionConfig[]) {
    const exprOverride = String(cfg.live2dExpression || '').trim();
    if (overwrite || !exprOverride) {
      const resolvedExpr = resolveLive2DExpression(model, cfg.tag);
      if (resolvedExpr) {
        cfg.live2dExpression =
          resolvedExpr.type === 'builtin' ? makeBuiltinExpressionToken(resolvedExpr.key) : resolvedExpr.name;
        filled += 1;
      }
    }

    const motionEnabled = cfg.live2dMotion?.enabled !== false;
    const motionGroupOverride = String(cfg.live2dMotion?.group || '').trim();
    if (motionEnabled && (overwrite || !motionGroupOverride)) {
      const resolvedMotion = resolveLive2DMotion(model, cfg.tag);
      if (resolvedMotion?.type === 'native') {
        cfg.live2dMotion.group = resolvedMotion.group;
        cfg.live2dMotion.index = resolvedMotion.index;
        filled += 1;
      } else if (resolvedMotion?.type === 'builtin') {
        cfg.live2dMotion.group = makeBuiltinMotionToken(resolvedMotion.key);
        cfg.live2dMotion.index = 0;
        filled += 1;
      }
    }
  }

  try {
    if (overwrite) {
      toastr.success(filled > 0 ? `已自动匹配并覆盖 ${filled} 项` : '未找到可覆盖的匹配结果');
    } else {
      toastr.success(filled > 0 ? `已自动匹配并填充 ${filled} 项空白覆盖` : '未找到可填充的空白覆盖');
    }
  } catch {
    // ignore
  }
}

function clearLive2DOverrides(): void {
  let cleared = 0;
  for (const cfg of settings.value.emotionConfigs as any as EmotionConfig[]) {
    const hadExpr = !!String(cfg.live2dExpression || '').trim();
    const hadGroup = !!String(cfg.live2dMotion?.group || '').trim();

    if (hadExpr) {
      cfg.live2dExpression = '';
      cleared += 1;
    }
    if (hadGroup) {
      cfg.live2dMotion.group = '';
      cfg.live2dMotion.index = 0;
      cleared += 1;
    }
  }

  try {
    toastr.info(cleared > 0 ? `已清空 ${cleared} 项 Live2D 覆盖` : '当前没有需要清空的 Live2D 覆盖');
  } catch {
    // ignore
  }
}

async function previewEmotion(tag: EmotionTag): Promise<void> {
  previewTag.value = tag;

  const mounted = await ensurePreviewMounted();
  if (!mounted) return;

  const model = Live2DManager.model as any;
  if (!model) {
    previewStatus.value = '模型未就绪';
    return;
  }

  applyPreviewViewport();

  const cfg = (settings.value.emotionConfigs as any as EmotionConfig[]).find(c => c.tag === tag);
  const exprResolved = resolveLive2DExpression(model, tag, cfg?.live2dExpression);
  let exprText = '表情: (无匹配)';
  if (exprResolved?.type === 'native') {
    Live2DManager.playExpression(exprResolved.name);
    exprText = `表情: ${exprResolved.name}`;
  } else if (exprResolved?.type === 'builtin') {
    Live2DManager.applyBuiltinExpression(exprResolved.key);
    const builtinDef = getBuiltinExpressionByKey(exprResolved.key);
    exprText = `表情: ${builtinDef?.label || exprResolved.key}（内置）`;
  }

  const motionResolved = resolveLive2DMotion(model, tag, cfg?.live2dMotion);
  let motionText = '动作: (无匹配)';
  if (motionResolved?.type === 'native') {
    Live2DManager.playMotion(motionResolved.group, motionResolved.index);
    motionText = motionResolved.name
      ? `动作: ${motionResolved.name} (${motionResolved.group || '(空动作组)'}#${motionResolved.index})`
      : `动作: ${motionResolved.group || '(空动作组)'}#${motionResolved.index}`;
  } else if (motionResolved?.type === 'builtin') {
    Live2DManager.playBuiltinMotion(motionResolved.key);
    const builtinDef = getBuiltinMotionByKey(motionResolved.key);
    motionText = `动作: ${builtinDef?.label || motionResolved.key}（内置）`;
  } else if (motionResolved?.type === 'disabled') {
    Live2DManager.stopBuiltinMotion();
    motionText = '动作: 已禁用';
  }

  previewStatus.value = `${tag} | ${exprText} | ${motionText}`;

  if (!exprResolved && !motionResolved) {
    try {
      toastr.info('未匹配到可用的表情/动作（可尝试刷新列表或手动覆盖）');
    } catch {
      // ignore
    }
  }
}


function normalizePathSepLocal(input: unknown): string {
  return String(input || '').replace(/\\/g, '/').trim();
}

function normalizeImportRootPathLocal(input: unknown): string {
  let normalized = normalizePathSepLocal(input).replace(/[\\/]+$/g, '');
  if (/^[a-zA-Z]:$/.test(normalized)) normalized = `${normalized}/`;
  return normalized;
}































































/** 试听：直接用 Tavern 当前选中的配音渠道念一句，不再经过上游那三个 TTS 引擎。 */
async function testTts(): Promise<void> {
  const body = String(ttsTestText.value || '').trim() || '你好，我是桌宠。';
  ttsTestHint.value = '合成中…';
  try {
    // 不指定 speaker：桌宠的吐槽是它自己在说话，不是卡里某个角色的台词，
    // 让 Tavern 用默认声音；指定了反而会去角色素材里找一个不存在的人。
    const ok = await speak(body);
    ttsTestHint.value = ok ? '已交给 Tavern 播放。听不到声音的话，检查「设置 → DSH Tavern → 显示与交互 → 配音」里的渠道。' : '这一局没有可用的配音渠道，或朗读被关掉了。';
  } catch (e) {
    ttsTestHint.value = `试听失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

function stopTts(): void {
  stopSpeaking();
  ttsTestHint.value = '';
}




watch(
  () => props.visible,
  visible => {
    if (!visible) return;

    ensureNumericSettingsIntegrity();
    // 记住上次看的分区；第一次打开停在 Live2D。
    if (!sectionTabs.some((tab) => tab.key === activeSection.value)) activeSection.value = 'live2d';
    customModelUrl.value = settings.value.modelPath || '';
    showEmotionAdvanced.value = false;
    localModelStatus.value = '';
    localModelError.value = '';
    refreshDiceReferenceSheetOptions();
    void refreshLocalModelInfo();
    if (settings.value.apiMode !== 'custom') {
      resetCustomApiState();
    }
    if (settings.value.apiMode === 'preset') {
      void refreshProxyPresetOptions();
    }
  },
  { immediate: true },
);

watch(
  () => settings.value.apiMode,
  apiMode => {
    if (apiMode !== 'custom') {
      resetCustomApiState();
    }
    if (props.visible && apiMode === 'preset') {
      void refreshProxyPresetOptions();
    }
  },
);

watch(
  () => settings.value.useDiceDatabaseReference,
  enabled => {
    if (!enabled) return;
    refreshDiceReferenceSheetOptions();
  },
);
</script>

<style lang="scss" scoped>
@use './styles/theme-arknights.scss' as theme;

.settings-overlay {
  @include theme.overlay-backdrop(1500, 0.82);
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
}

.settings-panel {
  width: min(1080px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: theme.$ark-text-main;
  background: theme.$ark-base;
  font-family: theme.$font-cn;
  @include theme.tech-panel(theme.$ark-accent-yellow);
  @include theme.tech-grid(22px, 0.03);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px 18px;
  border-bottom: 2px solid theme.$ark-accent-yellow;
  background: rgba(0, 0, 0, 0.32);
}

.header-title {
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 20px;
    line-height: 1;
    font-family: theme.$font-en;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  p {
    margin: 4px 0 0;
    font-size: 10px;
    color: theme.$ark-text-sub;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
}

.close-btn {
  @include theme.ark-button-base;
  min-width: 88px;
  height: 32px;
  padding: 0 10px;
  font-size: 12px;
}

.panel-main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
}

.panel-nav {
  border-right: 1px solid rgba(255, 255, 255, 0.16);
  padding: 12px;
  overflow: auto;
  @include theme.ark-scrollbar;
}

.nav-btn {
  @include theme.ark-button-base;
  width: 100%;
  min-height: 62px;
  padding: 10px 12px;
  margin-bottom: 10px;
  text-align: left;
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    'idx label'
    'idx sub';
  column-gap: 8px;
  row-gap: 2px;

  &:last-child {
    margin-bottom: 0;
  }

  &.active {
    background: theme.$ark-accent-yellow;
    color: #000;
    border-color: theme.$ark-accent-yellow;
  }
}

.nav-index {
  grid-area: idx;
  align-self: center;
  font-family: theme.$font-en;
  color: theme.$ark-accent-cyan;
  font-size: 18px;
}

.nav-label {
  grid-area: label;
  font-family: theme.$font-en;
  font-size: 13px;
  letter-spacing: 0.05em;
}

.nav-sub {
  grid-area: sub;
  font-size: 10px;
  color: theme.$ark-text-sub;
  letter-spacing: 0.06em;
}

.panel-body {
  padding: 14px 18px 16px;
  overflow: auto;
  @include theme.ark-scrollbar;
}

.setting-section {
  max-width: 740px;

  h4 {
    @include theme.section-title;
  }
}

.section-index {
  color: theme.$ark-accent-cyan;
  font-family: theme.$font-en;
  font-size: 13px;
}

.section-label {
  font-family: theme.$font-en;
  font-size: 14px;
  letter-spacing: 0.04em;
}

.section-sub {
  font-size: 10px;
  color: theme.$ark-text-sub;
  letter-spacing: 0.06em;
}

.form-group {
  margin-bottom: 12px;

  > label {
    display: block;
    margin-bottom: 5px;
    font-size: 12px;
    color: #d5d5d5;
    line-height: 1.35;
  }

  > label > input[type='checkbox'] {
    margin-right: 8px;
    accent-color: theme.$ark-accent-cyan;
  }

  input[type='text'],
  input[type='password'],
  input[type='number'],
  select,
  textarea {
    @include theme.ark-input-base;
  }

  textarea {
    resize: vertical;
    min-height: 86px;
    font-family: theme.$font-mono;
    color: #fff;
  }

  select {
    color: #fff;
    font-family: theme.$font-cn;
  }

  select option {
    background: #101010;
    color: #fff;
  }

  input[type='range'] {
    width: 100%;
    appearance: none;
    height: 4px;
    border: none;
    background: #4a4a4a;
    border-radius: 0;
    padding: 0;
    margin: 7px 0 4px;
  }

  input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    background: theme.$ark-accent-yellow;
    border: 2px solid #000;
    transform: rotate(45deg);
  }

  input[type='range']::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border: 2px solid #000;
    border-radius: 0;
    background: theme.$ark-accent-yellow;
    transform: rotate(45deg);
  }

  input[type='range']::-moz-range-track {
    height: 4px;
    background: #4a4a4a;
    border: none;
  }

  input[type='checkbox'] {
    accent-color: theme.$ark-accent-cyan;
  }

  .hint {
    margin-top: 4px;
    font-size: 11px;
    color: theme.$ark-text-sub;
  }
}

.hint-error {
  color: theme.$ark-danger !important;
}

/* 说明块：告诉玩家这件事现在由谁负责（例如朗读渠道归 Tavern 管）。 */
.notice-box {
  margin-bottom: 12px;
  padding: 8px 10px;
  font-size: 11px;
  line-height: 1.6;
  color: theme.$ark-text-sub;
  border-left: 2px solid theme.$ark-accent-cyan;
  background: rgba(0, 218, 194, 0.06);
}

.form-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;

  .half {
    flex: 1;
    min-width: 0;
  }
}

.dice-sheet-list {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.dice-sheet-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  color: #e8e8e8;
  line-height: 1.35;
}

.dice-sheet-item input[type='checkbox'] {
  margin: 0;
}

.input-with-btn {
  display: grid;
  /* 输入框 + 两个按钮（如「播放 / 停止」）；只放一个按钮时第三个单元格自然空着也不挤。 */
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: stretch;

  .input-btn,
  .btn {
    min-width: 84px;
    padding: 0 12px;
    font-size: 11px;
    white-space: nowrap;
  }
}

.model-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hidden-file-input {
  display: none;
}

.local-model-info {
  margin-top: 6px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.04);
  font-size: 12px;
  line-height: 1.45;
  color: #e8e8e8;
}

.model-btn {
  @include theme.ark-button-base;
  min-height: 30px;
  padding: 0 12px;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0.03em;

  &.active {
    background: theme.$ark-accent-yellow;
    border-color: theme.$ark-accent-yellow;
    color: #000;
  }

  &.browse-btn {
    border-color: rgba(0, 218, 194, 0.55);
    color: #b2fff6;

    &:hover {
      background: theme.$ark-accent-cyan;
      border-color: theme.$ark-accent-cyan;
      color: #000;
    }
  }
}

.emotion-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 14px;
  align-items: start;
}

.emotion-configs {
  min-width: 0;
}

.emotion-preview-panel {
  position: sticky;
  top: 10px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.28);
  padding: 10px 12px 12px;
  @include theme.tech-grid(18px, 0.02);
}

.emotion-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.emotion-preview-title {
  font-family: theme.$font-en;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: theme.$ark-accent-cyan;
}

.emotion-preview-tag {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}

.emotion-preview-canvas {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: 10px;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.18);
}

.emotion-preview-interact {
  position: absolute;
  inset: 0;
  z-index: 3;
}

.emotion-preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px;
  text-align: center;
  z-index: 4;
  pointer-events: none;
  color: rgba(255, 255, 255, 0.78);
  font-size: 12px;
}

.emotion-preview-controls {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.emotion-zoom-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 10px;
  align-items: center;
}

.zoom-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
}

.zoom-value {
  font-size: 12px;
  color: theme.$ark-accent-yellow;
  font-variant-numeric: tabular-nums;
}

.emotion-preview-actions {
  display: flex;
  gap: 8px;
}

.emotion-tag {
  font-family: theme.$font-en;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: theme.$ark-accent-yellow;
  text-transform: uppercase;
}

.emotion-map-table {
  margin-top: 4px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.22);
  max-height: none;
  overflow: visible;
  @include theme.tech-grid(20px, 0.02);
}

.emotion-map-head,
.emotion-map-row {
  display: grid;
  grid-template-columns: 72px 22px minmax(0, 1fr) minmax(0, 1fr) 52px;
  gap: 10px;
  align-items: center;
}

.emotion-map-head {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 8px 10px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.68);
  letter-spacing: 0.03em;
  background: rgba(2, 8, 20, 0.92);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.emotion-map-row {
  padding: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.emotion-map-row:nth-child(odd) {
  background: rgba(255, 255, 255, 0.02);
}

.emotion-map-tag {
  font-family: theme.$font-en;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: theme.$ark-accent-yellow;
}

.emotion-map-arrow {
  text-align: center;
  color: rgba(255, 255, 255, 0.78);
  font-size: 18px;
  line-height: 1;
}

.emotion-map-preview-btn {
  min-width: 0;
  width: 44px;
  height: 32px;
  padding: 0;
  font-size: 14px;
  line-height: 1;
}

.emotion-map-row select {
  width: 100%;
  min-width: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.emotion-advanced-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.emotion-advanced-item {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.28);
  padding: 10px 12px 2px;
  @include theme.tech-grid(18px, 0.025);
}

.emotion-advanced-title {
  margin-bottom: 8px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.85);
}

.advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
  color: #d5d5d5;
  cursor: pointer;
  user-select: none;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);

  &:hover {
    border-color: rgba(255, 225, 0, 0.65);
    color: theme.$ark-accent-yellow;
  }

  .toggle-icon {
    width: 12px;
    text-align: center;
    color: theme.$ark-accent-cyan;
  }
}

.advanced-params {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.2);
}

.about-card {
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(0, 0, 0, 0.26);
  @include theme.tech-grid(18px, 0.02);
}

.about-title {
  margin-bottom: 8px;
  font-size: 12px;
  letter-spacing: 0.06em;
  color: theme.$ark-accent-yellow;
}

.about-link {
  color: theme.$ark-accent-cyan;
  word-break: break-all;
  text-decoration: underline;
}

.about-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #d5d5d5;
}

.status-badge {
  margin-left: 8px;
  font-size: 12px;
}

.status-success {
  color: theme.$ark-accent-cyan;
}

.status-fail {
  color: #ff9c94;
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(0, 0, 0, 0.36);
}

.btn {
  @include theme.ark-button-base;
  min-width: 100px;
  height: 34px;
  padding: 0 14px;
  font-size: 12px;
}

.btn-primary {
  background: theme.$ark-accent-yellow;
  color: #000;
  border-color: theme.$ark-accent-yellow;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.3);
}

.btn-test {
  min-width: 96px;
  background: rgba(0, 218, 194, 0.1);
  border-color: rgba(0, 218, 194, 0.6);
  color: #bcfff7;

  &:hover:not(:disabled) {
    background: theme.$ark-accent-cyan;
    border-color: theme.$ark-accent-cyan;
    color: #000;
  }
}

.browser-overlay {
  @include theme.overlay-backdrop(1550, 0.8);
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
}

.browser-dialog {
  width: min(980px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: theme.$ark-text-main;
  background: theme.$ark-base;
  font-family: theme.$font-cn;
  @include theme.tech-panel(theme.$ark-accent-yellow);
  @include theme.tech-grid(22px, 0.03);
}

.browser-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 225, 0, 0.36);
  background: rgba(0, 0, 0, 0.28);

  h3 {
    margin: 0;
    font-family: theme.$font-en;
    font-size: 15px;
    letter-spacing: 0.08em;
  }

  .close-btn {
    @include theme.ark-button-base;
    width: 34px;
    height: 28px;
    padding: 0;
    line-height: 1;
    font-size: 16px;
  }
}

.browser-dialog-body {
  padding: 14px 18px 16px;
  overflow: auto;
  flex: 1;
  @include theme.ark-scrollbar;
}

.gpt-model-dialog {
  width: min(1240px, calc(100vw - 24px));
}

.gpt-model-editor-dialog {
  width: min(1080px, calc(100vw - 24px));
}

.gpt-model-header {
  align-items: flex-start;
}

.gpt-model-header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
}

.gpt-model-header-actions .btn {
  min-width: 84px;
  height: 30px;
  padding: 0 10px;
  font-size: 11px;
}

.gpt-model-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gpt-model-tools {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 8px;
  align-items: center;
}

.gpt-model-tools input {
  @include theme.ark-input-base;
}

.gpt-model-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.gpt-model-card {
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.03);
  padding: 10px 12px;
  @include theme.tech-grid(18px, 0.02);
}

.gpt-model-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.gpt-model-card-head label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.gpt-model-id {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.65);
  font-family: theme.$font-mono;
  word-break: break-all;
}

.gpt-model-card-actions {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.gpt-model-card-actions .btn {
  min-width: 110px;
}

.gpt-ref-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 8px;
}

.gpt-ref-item {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.02);
  padding: 10px;
}

.gpt-ref-actions {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.gpt-expression-map-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 8px;
}

.gpt-expression-map-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.gpt-expression-map-row input,
.gpt-expression-map-row select {
  @include theme.ark-input-base;
  width: 100%;
}

@media (max-width: 860px) {
  .settings-overlay {
    align-items: flex-start;
    padding: calc(env(safe-area-inset-top) + 6px) 6px calc(env(safe-area-inset-bottom) + 6px);
  }

  .settings-panel {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px);
    clip-path: none;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
  }

  .settings-panel::before {
    width: 40px;
  }

  .panel-main {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr;
    min-height: 0;
  }

  .panel-nav {
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
    display: flex;
    gap: 6px;
    padding: 8px 10px;
    overflow-x: auto;
    overflow-y: hidden;
    @include theme.ark-scrollbar;
  }

  .nav-btn {
    flex: 0 0 auto;
    width: 150px;
    min-height: 42px;
    padding: 6px 10px;
    margin-bottom: 0;
    grid-template-areas: 'idx label';
    grid-template-columns: auto 1fr;
    row-gap: 0;
    align-items: center;
  }

  .panel-body {
    min-height: 0;
  }

  .nav-index {
    font-size: 16px;
  }

  .nav-label {
    font-size: 12px;
  }

  .nav-sub {
    display: none;
  }

  .browser-overlay {
    align-items: flex-start;
    padding: calc(env(safe-area-inset-top) + 6px) 6px calc(env(safe-area-inset-bottom) + 6px);
  }

  .browser-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px);
    clip-path: none;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
  }

  .gpt-model-dialog,
  .gpt-model-editor-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 12px);
  }

  .gpt-model-tools {
    grid-template-columns: 1fr;
  }

  .gpt-expression-map-row {
    grid-template-columns: 1fr;
  }

  .emotion-layout {
    grid-template-columns: 1fr;
  }

  .emotion-preview-panel {
    order: -1;
    position: sticky;
    top: 8px;
    z-index: 8;
    margin-bottom: 8px;
    padding: 8px 10px 10px;
    background: rgba(0, 0, 0, 0.9);
  }

  .emotion-preview-header {
    margin-bottom: 6px;
  }

  .emotion-preview-canvas {
    aspect-ratio: 16 / 9;
    max-height: 210px;
  }

  .emotion-preview-controls {
    margin-top: 8px;
    gap: 6px;
  }

  .emotion-map-head {
    position: static;
  }

  .emotion-preview-controls .hint {
    display: none;
  }
}

@media (max-width: 620px) {
  .settings-overlay {
    align-items: stretch;
    padding: 0;
  }

  .settings-panel {
    width: 100vw;
    max-height: 100dvh;
    border-left: none;
    border-right: none;
    box-shadow: none;
  }

  .panel-header {
    padding: 10px 12px;
  }

  .header-title {
    h3 {
      font-size: 15px;
      letter-spacing: 0.06em;
    }

    p {
      display: none;
    }
  }

  .panel-nav {
    padding: 6px 8px;
  }

  .nav-btn {
    width: 126px;
    min-height: 38px;
    padding: 5px 8px;
  }

  .nav-index {
    font-size: 14px;
  }

  .nav-label {
    font-size: 11px;
    letter-spacing: 0.04em;
  }

  .close-btn {
    min-width: 66px;
    height: 28px;
    padding: 0 8px;
    font-size: 11px;
  }

  .panel-footer {
    padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
  }

  .panel-body {
    padding: 8px 10px;
  }

  .form-row {
    flex-direction: column;
    gap: 0;
  }

  .input-with-btn {
    grid-template-columns: 1fr;
  }

  .btn {
    min-width: 86px;
  }

  .emotion-preview-panel {
    top: 6px;
    padding: 8px;
  }

  .emotion-preview-canvas {
    max-height: 180px;
  }

  .emotion-map-head,
  .emotion-map-row {
    grid-template-columns: 56px 16px minmax(0, 1fr) minmax(0, 1fr) 42px;
    gap: 6px;
  }

  .emotion-map-row {
    padding: 8px;
  }

  .emotion-map-arrow {
    font-size: 14px;
  }

  .emotion-map-preview-btn {
    width: 38px;
    height: 30px;
    font-size: 12px;
  }

  .browser-overlay {
    align-items: stretch;
    padding: 0;
  }

  .browser-dialog {
    width: 100vw;
    max-height: 100dvh;
    box-shadow: none;
    clip-path: none;
  }

  .gpt-model-dialog,
  .gpt-model-editor-dialog {
    width: 100vw;
    max-height: 100dvh;
    box-shadow: none;
    clip-path: none;
  }

  .browser-dialog-header {
    padding: 12px;
  }

  .browser-dialog-body {
    padding: 10px 12px 12px;
  }

  .gpt-model-header-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .gpt-model-card-actions .btn {
    min-width: 0;
    flex: 1 1 120px;
  }
}
</style>
