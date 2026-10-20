// 打包约束的回归测试：产物形状、离线自足、清单字段。
//
// 这些任何一条坏了，插件在玩家的 Tavern 里就加载不出来或报一堆网络错误，
// 而单看源码完全看不出来——所以对着仓库根目录的产物测。
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFile(path.join(root, relative), 'utf8')

const exists = async (relative) => {
  try {
    await stat(path.join(root, relative))
    return true
  } catch {
    return false
  }
}

test('client bundle 是 Tavern 加载器要的 classic CJS 形状', async () => {
  const code = await read('client.js')
  assert.match(code, /^\/\/ dsh-tavern-desktop-pet/, '缺少产物头注释')
  assert.match(code, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, /id: "dsh-tavern-desktop-pet"/, 'id 必须与 package.json 的 name 一致')
  assert.match(code, /factory: \(require\) => \{/)
  assert.match(code, /return module\.exports;/)
  assert.match(code, /exports\.apply\s*=/, '要导出 apply')
  assert.match(code, /exports\.inject\s*=/, '要导出 inject')
})

test('运行时不再从 CDN 取框架：Vue/Pinia/zod/klona 全部内联', async () => {
  const code = await read('client.js')
  assert.doesNotMatch(code, /from\s*['"]https:\/\/[^'"]*jsdelivr[^'"]*['"]/, '不允许 ESM 形式的外链 import')
  assert.doesNotMatch(code, /import\(\s*['"]https:\/\/[^'"]*jsdelivr/, '不允许动态 import 外链')
  assert.doesNotMatch(code, /pinia\/\+esm|klona\/\+esm/, '上游那种从 CDN 取 ESM 的写法必须换掉')
  // Live2D 引擎仍按需从 CDN 取（带本地兜底），那是运行期行为，不算框架内联。
  assert.ok(code.includes('live2dcubismcore'), 'Live2D 引擎应保留（可回退到本地文件）')
})

test('react 走加载器提供的 require，不内联', async () => {
  const code = await read('client.js')
  assert.match(code, /require\("react"\)/, '面板要用的 React 必须由 factory 的 require 取')
  // vue 依然内联（它不是平台基座里的模块）。
  assert.ok(code.includes('createApp'), 'Vue 应当内联进 bundle')
})

test('样式里不引外部字体', async () => {
  const code = await read('client.js')
  assert.doesNotMatch(code, /fonts\.googleapis\.com/, '桌宠要能在断网环境里跑')
})

test('样式跟着 bundle 走，卸载时能摘掉', async () => {
  const code = await read('client.js')
  assert.ok(code.includes('dsh-tavern-desktop-pet-style'), '要注入带固定 id 的 style')
  assert.ok(code.includes('chat-bubble'), '组件样式应被打进产物')
})

test('仓库根目录就是插件文件夹：清单指向的两个半身都在', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, 'dsh-tavern-desktop-pet')
  assert.ok(pkg.version, 'version 不能省：DSH 的请求扩展会列 name@version')
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'index.mjs')

  // 加载器先看 exports["."] 再回退 main，两者必须指向真实存在的宿主侧文件。
  assert.equal(pkg.exports['.'], './index.mjs')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(await exists('index.mjs'), '宿主侧产物必须随仓库提交')
  assert.ok(await exists('client.js'), '浏览器侧产物必须随仓库提交')
})

test('浏览器侧按 dsh.client 契约声明，且不再要求 cordis 补丁', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.dsh.client.platform, 'web', '少了它界面不加载')
  assert.ok(pkg.dsh.client.inject.includes('dsh-tavern-plugin'))
  // plugins/ 文件夹加载由 Tavern 自己生成 guard 与补丁条目，
  // 自己再带一份 dsh.bundle.patch 只会让人以为要走 npm 安装。
  assert.equal(pkg.dsh.bundle, undefined)
  assert.equal(await exists('cordis.patch.yml'), false)
})

test('宿主侧只走 Tavern 的公开接口', async () => {
  const code = await read('index.mjs')
  assert.ok(code.includes('ctx.tavern.handle('), '要用 tavern.handle 暴露给浏览器侧')
  assert.doesNotMatch(code, /tavern-plugin\/lib|profile-data\/tavern\/data/, '不许读 Tavern 的数据目录或内部模块')
  // 宿主侧随手写 ESM，不依赖任何 npm 包：装进 plugins/ 后不需要 npm install。
  assert.doesNotMatch(code, /^import .* from '(?!\.)/m, '宿主侧不应 import 外部包')
})

test('清单里没有运行时 npm 依赖：dependencies 必须为空', async () => {
  const pkg = JSON.parse(await read('package.json'))
  // Tavern 的一键安装（tavern-plugin/lib/domain/user-plugin-install.js）看到非空
  // dependencies、压缩包里又没有 node_modules/，就会直接拒绝：「这个插件依赖 npm 包…」。
  // 本插件的 Vue / Pinia / zod / klona 都在构建时被 vite 打进 client.js，宿主侧也不
  // import 任何外部包，所以它们只是构建依赖。写回 dependencies 会让一键安装重新坏掉。
  assert.deepEqual(Object.keys(pkg.dependencies || {}), [], 'dependencies 非空会挡住 Tavern 一键安装')
  for (const name of ['vue', 'pinia', 'zod', 'klona']) {
    assert.ok(pkg.devDependencies?.[name], name + ' 是构建依赖，应放在 devDependencies')
  }

  // 光移位置不够：产物里也不能留下这几个包的运行时 require，否则装到 plugins/ 后照样加载失败。
  const code = await read('client.js')
  for (const name of ['vue', 'pinia', 'zod', 'klona']) {
    assert.equal(code.includes(`require("${name}")`), false, name + ' 必须内联进 bundle，不能留运行时 require')
  }
})

test('install.mjs 只复制插件文件，不碰 Tavern 内部', async () => {
  const code = await read('install.mjs')
  assert.ok(code.includes('profile-data'), '要落到 profile-data/tavern/data/plugins')
  assert.doesNotMatch(code, /cordis\.patch\.yml|\.tavern-entry\.mjs/, '补丁与 guard 由 Tavern 自己维护')
  assert.match(code, /from 'node:/, '只用 node 内置模块，克隆后无需 npm install')
})
