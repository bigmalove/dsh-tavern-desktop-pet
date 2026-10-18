# dsh-tavern-desktop-pet

把 [tavern-desktop-pet](https://github.com/bigmalove/tavern-desktop-pet)（原名「酒馆桌面宠物」，SillyTavern 的 Live2D 桌宠扩展）搬到 DSH Tavern 里的插件。

桌宠是一层浮在页面右下角的 Live2D 模型：它跟着这一局的正文，按间隔吐槽、按情绪换表情、念台词（配音走 Tavern 已有的渠道），长按出功能菜单，双击立刻逗一次。

这是一个独立仓库，不随 Tavern 分发，也不进 `dsh.profile.bundles`：装进 Tavern 的方式是把构建产物放进 Tavern 的用户插件目录（见下）。

## 状态

| 能力 | 状态 |
|---|---|
| 浮层桌宠（Live2D，Cubism 2/4/5） | 已验证：模型从 CDN 加载并挂到 canvas，可拖动、可缩放、自动动作循环 |
| 侧栏「桌宠」面板（打开设置 / 逗一下 / 状态 / 挑吐槽模型） | 已验证 |
| 设置面板（6 页：模型 / Live2D / 吐槽 / 表情 / 朗读 / 关于） | 已验证：逐个点开都有内容，模型页下拉列出真实通道与模型（实测 65 项） |
| 输入框上方「逗一下」按钮 | 已验证 |
| 长按菜单（CHAT / MOTION / MODEL / PERSONA / SETUP / CLOSE） | 已验证 |
| 吐槽链路（读正文 → 宿主 → 模型 → 气泡 → 情绪表情） | 已验证：故事局点「逗一下」拿到 50 字回复，情绪标签 `生气` 驱动了表情 |
| 没有卡的对局（写作 / 剧本） | 已验证：舞台接口拒绝后改按轮读正文 |
| 自动朗读（走 Tavern 配音渠道） | 已接：`tavernUi.speak`，情绪名做了映射；未验证实际发声 |
| 上线/下线的清理（Vue 卸载、样式移除、全局垫片还原） | 已验证 |
| 一轮写完自动吐槽 | 逻辑走单测 + 手动触发验证，未做「真实一轮」的端到端 |

实测注意：模型对极端情节会直接拒绝（连吐槽也一起拒），这是模型自身的内容策略，换个模型或换段剧情即可。

## 装进 Tavern

```sh
npm install          # 首次：装 vite / vue / sass 等构建依赖
npm run deploy       # 构建并放到 <DSH_HOME>/profile-data/tavern/data/plugins/
```

`DSH_HOME` 默认 `~/.dsh-tavern`。刷新页面即可（宿主侧改动要重启 DSH）。开发期改 `src/client/**` 后重跑 `npm run deploy`，浏览器侧几秒内自动换成新代码。

其它脚本：`npm run build`（只构建到 `lib/`）、`npm test`（打包约束测试）。

## 目录

```
src/client/main.js          插件入口：装垫片、挂 Vue、注册面板与按钮
src/client/bridge/shims.js  酒馆全局垫片（toastr / SillyTavern / getVariables / jQuery 壳）
src/client/bridge/tavern.js 桌宠与 Tavern 之间唯一的桥（当前局、舞台、回合、宿主调用、朗读）
src/client/bridge/actions.js React 侧操作 Vue 桌宠的函数指针
src/client/pet/**           上游代码（live2d / audio / ui / chat / core / db / utils）
src/host/index.mjs          宿主侧：tavern.handle 暴露的吐槽生成
build.mjs                   vite + plugin-vue → classic CJS bundle，样式内联注入
tests/packaging.test.mjs    产物形状 / 离线自足 / 元数据
```

## 和上游的差别

- **入口**：上游靠酒馆的 `#extensionsMenu` 插菜单项；这里换成 Tavern 的 `registerPanel` + `registerComposerAction`。
- **聊天监听**：上游挂 `MESSAGE_SENT` / `GENERATION_ENDED`，还要忽略自己 `generateRaw` 引起的回声；这里用 `watchTurnState` 的忙/闲跳变，不需要回声屏蔽。
- **取消息**：`getChatMessages` → `tavernUi.getStage`（最近 5 轮的正文与台词）。
- **调模型**：三个后端（酒馆主 API / 连接配置 / 自定义端点 + Key）合并成一次宿主调用：先 `tavern.runTask`（带卡、世界书、最近两轮，进这局请求记录），失败再直连这局的后台模型。
- **配音**：上游自己带 Edge TTS / GPT-SoVITS / 小白盒；这里改用 Tavern 的配音渠道，删掉了重复的渠道管理。
- **层级**：舞台 `10000 → 1200`、气泡 `10004 → 1300`、菜单 `10002 → 1400`、设置 `10001 → 1500`，压在 Tavern 的弹窗（2300）之下，不再盖住原生 UI。
- **默认尺寸**：`PET_SCALE 0.3 → 0.55`（280×360 的基准画面太小吃不住高分屏）。
- **删除**：`utils/style-teleport.ts`（同窗口下不需要跨文档搬样式）、jQueryUI 拖拽依赖（落到上游自带的 pointer 拖拽回退）。

## 已知问题

1. **同一局没有活跃前台 Agent 时，`tavern.runTask` 会报「前台会话不可用」**。这出现在「刚打开一局还没发言」的时候；这时自动落到直连模型。直连默认跟随本局后台模型，部分通道（如 `deepseek-flash`）直连会返回空——在侧栏「桌宠」页把「吐槽用的模型」换成能用的通道即可（实测 `reapi/claude-opus-5` 正常）。
2. **Live2D 引擎仍从 CDN 取**（pixi、pixi-live2d-display、Cubism Core，各带多级镜像）。断网时不显示模型，但界面不报错——如果需要完全离线，要把这三个文件放进 `assets/` 并改为本地加载。
3. **上游仓库没有 LICENSE**。搬入代码前需要跟原作者确认授权；本包暂按 MIT 声明自己写的部分。
4. **移动端未适配**：窄屏下仍会挂浮层，可能挡住输入框。
5. **上游的配音渠道管理没删干净**：`audio/**` 仍在包里，只是不再被调用（自动朗读已改走 Tavern 渠道）。后续可以整块删掉，能省 ~100 KB。
6. **空局不会吐槽**：这一局还没有正文时，桌宠没有可读的上下文，会安静跳过（日志里是「没有可用的聊天记录」）。这是有意为之，不是卡住。

## 许可

本仓库新增代码 MIT。`src/client/pet/**` 来自上游仓库，版权归原作者。
