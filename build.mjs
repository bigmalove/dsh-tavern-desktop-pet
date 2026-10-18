// 把 src/client 下的 Vue 应用打成 Tavern 浏览器侧要的 classic CJS bundle。
//
// 产物落在仓库根目录，跟 package.json 的 exports 一一对应：
//   client.js  ← 浏览器侧（window.__ModuleLoader__.load({ id, factory })）
//   index.mjs  ← 宿主侧（ESM，命名导出 name / inject / apply）
//
// 也就是说这个仓库本身就是插件文件夹：克隆下来放进
// <Tavern data>/plugins/dsh-tavern-desktop-pet/ 就能加载，不需要先构建。
//
// 三点和普通 vite 库构建不同：
//   1. external 只留 react（平台基座提供）：Vue / Pinia / zod / klona 全部内联，运行时不发网络请求；
//   2. CSS 不单独出文件：读取后在 factory 顶部注入一个 <style>，卸载时移除；
//   3. 产物直接写根目录，供 package.json 的 main / exports 引用。
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_ID = 'dsh-tavern-desktop-pet'
const STYLE_ID = `${PLUGIN_ID}-style`
const scratch = path.join(root, '.build')

await rm(scratch, { recursive: true, force: true })
await mkdir(scratch, { recursive: true })

// react 由 Tavern 的模块表提供（文档要求插件用 require('react') 取），所以不能内联：
// 保留成 require("react")，让加载器 factory 的 require 去解析平台基座；Vue 等其余全部内联。
const EXTERNALS = ['react', 'react-dom', 'react/jsx-runtime']

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
    rollupOptions: { external: EXTERNALS },
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

await writeFile(path.join(root, 'client.js'), banner + body + footer, 'utf8')

// 宿主侧是手写的 ESM，直接复制到根目录，保证插件文件夹两半齐全。
await writeFile(
  path.join(root, 'index.mjs'),
  await readFile(path.join(root, 'src/host/index.mjs'), 'utf8'),
  'utf8',
)

await rm(scratch, { recursive: true, force: true })

const size = (n) => `${(n / 1024).toFixed(0)} KB`
console.log(`client.js ${size((await readFile(path.join(root, 'client.js'))).length)}`)
console.log(`index.mjs ${size((await readFile(path.join(root, 'index.mjs'))).length)}`)
console.log(`css       ${size(css.length)}`)
