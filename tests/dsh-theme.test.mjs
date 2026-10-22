// 设置界面的换肤约束：面板必须用 DSH 的设计令牌，不能再回到写死的
// Arknights 深色主题。这样浅色 / 深色、内置皮肤和 Dream Skin 的任意配色
// 都会通过 body 上的 --dsw-alias-* 自动切换，不需要重新挂载 Vue。
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFile(path.join(root, relative), 'utf8')

const themed = [
  'src/client/pet/ui/SettingsPanel.vue',
  'src/client/pet/ui/ModelBrowser.vue',
  'src/client/pet/ui/TreeNode.vue',
  'src/client/pet/ui/PetContainer.vue',
  'src/client/pet/ui/ChatBubble.vue',
  'src/client/pet/ui/FunctionMenu.vue',
  'src/client/pet/ui/GuideDock.vue',
]

test('桌宠 UI 只依赖 DSH 主题令牌，不再回到 Arknights 皮肤', async () => {
  for (const file of themed) {
    const code = await read(file)
    assert.doesNotMatch(
      code,
      /theme-arknights/,
      `${file} 不应再引入写死的 Arknights 主题；换肤会失效`,
    )
    assert.match(
      code,
      /--dsw-alias-/,
      `${file} 应通过 --dsw-alias-* 读取当前皮肤的颜色`,
    )
    assert.doesNotMatch(
      code,
      /#181818|#ffe100|#00dac2/i,
      `${file} 里不应再出现 Arknights 写死色值`,
    )
  }
})

test('设置界面的表面、文字、描边、强调色都走令牌', async () => {
  const code = await read('src/client/pet/ui/SettingsPanel.vue')
  for (const token of [
    '--dsw-alias-bg-layer-2', // 面板表面
    '--dsw-alias-label-primary', // 主文字
    '--dsw-alias-label-secondary', // 次要文字
    '--dsw-alias-border-l2', // 卡片描边
    '--dsw-alias-brand-primary', // 选中 / 主按钮
    '--dsw-alias-interactive-bg-hover', // 悬停
    '--dsw-alias-bg-layer-1', // 卡片 / 选中底色
  ]) {
    assert.ok(code.includes(token), `设置面板缺了 ${token}，换肤时这一块不会跟着变`)
  }
})

test('侧栏「桌宠」页同样跟随 DSH 主题', async () => {
  const code = await read('src/client/main.js')
  assert.match(code, /--dsw-alias-label-primary/, '侧栏面板文字应使用 DSH 令牌')
  assert.match(code, /--dsw-alias-brand-primary/, '侧栏面板强调色应使用 DSH 令牌')
  assert.doesNotMatch(
    code,
    /--color-text-primary|--color-background-secondary/,
    'Tavern 里没有这套 --color-* 变量，留着会退回写死的浅色',
  )
})

test('主题令牌集中在 theme-dsh.scss，兜底值可用', async () => {
  const code = await read('src/client/pet/ui/styles/theme-dsh.scss')
  for (const token of [
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-label-primary',
    '--dsw-alias-border-l2',
    '--dsw-alias-state-business-primary',
    '--dsw-specific-input-major',
    '--dsw-radius-panel',
  ]) {
    assert.ok(code.includes(token), `theme-dsh.scss 缺了 ${token}`)
  }
  assert.match(code, /@mixin surface/, '面板表面应有共享 mixin，避免各组件各写一套')
  assert.match(code, /@mixin input-base/, '输入控件应有共享 mixin')
})

test('旧的 Arknights 主题文件已删除，避免组件又引回去', async () => {
  await assert.rejects(
    stat(path.join(root, 'src/client/pet/ui/styles/theme-arknights.scss')),
    'theme-arknights.scss 应随 DSH 换肤一起删除',
  )
})
