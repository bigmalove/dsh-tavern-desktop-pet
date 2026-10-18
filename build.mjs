// 把 src/client 下的 Vue 应用打成 Tavern 浏览器侧要的 classic CJS bundle。
//
// 产物形状和 dsh-tavern-remote / dsh-dream-skin 一致：整份 bundle 包在
// window.__ModuleLoader__.load({ id, factory }) 里，factory 是 CJS，
// 返回的 module.exports 带 name / inject / apply，由 cordis 当普通插件消费。
//
// 三点和普通 vite 库构建不同：
//   1. external 为空：Vue / Pinia / zod / klona 全部内联，运行时不发网络请求；
//   2. CSS 不单独出文件：读取后在 factory 顶部注入一个 <style>，卸载时移除；
//   3. 产物固定叫 lib/client.js，供 package.json 的 exports 引用。
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ID = 'dsh-tavern-desktop-pet'
const STYLE_ID = `${PLUGIN_ID}-style`
const scratch = path.join(root, '.build')
const outDir = path.join(root, 'lib')

await rm(scratch, { recursive: true, force: true })
await mkdir(scratch, { recursive: true })
await mkdir(outDir, { recursive: true })

await build({
  root,
  configFile: false,
  logLevel: 'warn',
  plugins: [vue()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: scratch,
    emptyOutDir: true,
    target: 'es2022',
    minify: 'esbuild',
    cssCodeSplit: false,
    lib: {
      entry: path.join(root, 'src/client/main.js'),
      formats: ['cjs'],
      fileName: () => 'client.js',
    },
    rollupOptions: { external: [] },
  },
})

const body = await readFile(path.join(scratch, 'client.js'), 'utf8')
// vite 7 的 lib 模式把样式表按包名输出（dsh-tavern-desktop-pet.css），名字不固定。
const cssFiles = (await readdir(scratch)).filter((file) => file.endsWith('.css'))
const css = cssFiles.length
  ? (await Promise.all(cssFiles.map((file) => readFile(path.join(scratch, file), 'utf8')))).join('\n')
  : ''

const stylePrelude = css.trim()
  ? `var style = document.createElement("style");
style.id = ${JSON.stringify(STYLE_ID)};
style.textContent = ${JSON.stringify(css)};
var previousStyle = document.getElementById(${JSON.stringify(STYLE_ID)});
if (previousStyle) previousStyle.remove();
(document.head || document.documentElement).appendChild(style);
`
  : ''

const banner = `// ${PLUGIN_ID} — 浏览器侧（构建产物，由 build.mjs 生成，不要直接改）。
// 源码在 src/client/，上游 Live2D 桌宠代码在 src/client/pet/。
window.__ModuleLoader__.load({
  id: ${JSON.stringify(PLUGIN_ID)},
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${stylePrelude}`

const footer = `    return module.exports;
  },
});
`

await writeFile(path.join(outDir, 'client.js'), banner + body + footer, 'utf8')

// 宿主侧是手写的 ESM，直接复制，保证 lib/ 里两个半身齐全。
await writeFile(
  path.join(outDir, 'index.js'),
  await readFile(path.join(root, 'src/host/index.mjs'), 'utf8'),
  'utf8',
)

await rm(scratch, { recursive: true, force: true })

const size = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`client.js ${size((await readFile(path.join(outDir, 'client.js'))).length)}`)
console.log(`index.js  ${size((await readFile(path.join(outDir, 'index.js'))).length)}`)
console.log(`css       ${size(css.length)}`)

// `node build.mjs --deploy`：把这一份装进 Tavern 的用户插件目录，刷新页面即可看到。
// 用这种方式验证改动最快；正式分发仍走 dsh.profile.bundles。
if (process.argv.includes('--deploy')) {
  const home = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh-tavern')
  const target = path.join(home, 'profile-data', 'tavern', 'data', 'plugins', PLUGIN_ID)
  await mkdir(target, { recursive: true })
  await writeFile(path.join(target, 'client.js'), await readFile(path.join(outDir, 'client.js')))
  await writeFile(path.join(target, 'index.mjs'), await readFile(path.join(outDir, 'index.js')))
  await writeFile(
    path.join(target, 'package.json'),
    JSON.stringify(
      {
        name: PLUGIN_ID,
        // version 不能省：DSH 的请求扩展会把已加载插件包列进请求（name@version），
        // 缺 version 时清单解析失败，整次模型调用报 request extension preparation failed。
        version: JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version,
        private: true,
        type: 'module',
        exports: { '.': './index.mjs', './client': './client.js' },
        dsh: {
          client: {
            platform: 'web',
            inject: ['dsh-tavern-plugin', '@deepseek-ai/dsh-api-session-controller'],
          },
        },
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`已安装到 ${target}`)
}
