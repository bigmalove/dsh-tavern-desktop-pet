// 打包约束的回归测试：产物形状、离线自足、元数据。
//
// 这三条任何一条坏了，插件在玩家的 Tavern 里就加载不出来或报一堆网络错误，
// 而单看源码完全看不出来——所以对着构建产物测。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFile(path.join(root, relative), 'utf8')

test('client bundle 是 Tavern 加载器要的 classic CJS 形状', async () => {
  const code = await read('lib/client.js')
  assert.match(code, /^\/\/ dsh-tavern-desktop-pet/, '缺少产物头注释')
  assert.match(code, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(code, /id: "dsh-tavern-desktop-pet"/, 'id 必须与 package.json 的 name 一致')
  assert.match(code, /factory: \(require\) => \{/)
  assert.match(code, /return module\.exports;/)
  assert.match(code, /exports\.apply\s*=/, '要导出 apply')
  assert.match(code, /exports\.inject\s*=/, '要导出 inject')
})

test('运行时不再从 CDN 取框架：Vue/Pinia/zod/klona 全部内联', async () => {
  const code = await read('lib/client.js')
  assert.doesNotMatch(code, /from\s*['"]https:\/\/[^'"]*jsdelivr[^'"]*['"]/, '不允许 ESM 形式的外链 import')
  assert.doesNotMatch(code, /import\(\s*['"]https:\/\/[^'"]*jsdelivr/, '不允许动态 import 外链')
  assert.doesNotMatch(code, /pinia\/\+esm|klona\/\+esm/, '上游那种从 CDN 取 ESM 的写法必须换掉')
  // Live2D 引擎仍按需从 CDN 取（带本地兜底），那是运行期行为，不算框架内联。
  assert.ok(code.includes('live2dcubismcore'), 'Live2D 引擎应保留（可回退到本地文件）')
})

test('样式里不引外部字体', async () => {
  const code = await read('lib/client.js')
  assert.doesNotMatch(code, /fonts\.googleapis\.com/, '桌宠要能在断网环境里跑')
})

test('样式跟着 bundle 走，卸载时能摘掉', async () => {
  const code = await read('lib/client.js')
  assert.ok(code.includes('dsh-tavern-desktop-pet-style'), '要注入带固定 id 的 style')
  assert.ok(code.includes('chat-bubble'), '组件样式应被打进产物')
})

test('package.json 声明了宿主侧、浏览器侧与版本', async () => {
  const pkg = JSON.parse(await read('package.json'))
  assert.equal(pkg.name, 'dsh-tavern-desktop-pet')
  assert.ok(pkg.version, 'version 不能省：DSH 的请求扩展会列 name@version')
  assert.equal(pkg.exports['.'], './lib/index.js')
  assert.equal(pkg.exports['./client'], './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('dsh-tavern-plugin'))
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
})

test('宿主侧只走 Tavern 的公开接口', async () => {
  const code = await read('lib/index.js')
  assert.ok(code.includes("ctx.tavern.handle("), '要用 tavern.handle 暴露给浏览器侧')
  assert.doesNotMatch(code, /tavern-plugin\/lib|profile-data\/tavern\/data/, '不许读 Tavern 的数据目录或内部模块')
})

test('cordis 补丁层登记了插件包', async () => {
  const yml = await read('cordis.patch.yml')
  assert.match(yml, /id: tavern-desktop-pet/)
  assert.match(yml, /name: dsh-tavern-desktop-pet/)
})
