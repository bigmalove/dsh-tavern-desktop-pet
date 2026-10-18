// 把本仓库装进 Tavern 的用户插件目录。
//
// Tavern 的标准插件加载方式就是「一个文件夹放进 <data>/plugins/」：
// 加载器读 package.json 的 exports "."（宿主侧）与 dsh.client + exports "./client"
//（浏览器侧），再自己生成 guard 与 cordis 补丁条目。所以这里只做复制，
// 不写任何 Tavern 的内部文件。
//
// 用法：
//   node install.mjs                 # 装到 ~/.dsh-tavern/profile-data/tavern/data/plugins/
//   DSH_HOME=/path node install.mjs  # 装到别的 DSH 安装
//
// 只依赖 node 内置模块：克隆下来直接跑，不需要 npm install。
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const PLUGIN_ID = pkg.name

// 插件文件夹只需要这几样：清单 + 两个半身 + 说明。源码与构建脚本不进目标目录。
const FILES = ['package.json', 'index.mjs', 'client.js', 'README.md', 'LICENSE']

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

const home = process.env.DSH_HOME || path.join(process.env.HOME || '', '.dsh-tavern')
const dataRoot = path.join(home, 'profile-data', 'tavern', 'data')
const target = path.join(dataRoot, 'plugins', PLUGIN_ID)

for (const file of FILES) {
  if (!(await exists(path.join(root, file)))) {
    console.error(`缺少 ${file}：先在仓库里跑 npm run build 生成 client.js 与 index.mjs`)
    process.exit(1)
  }
}

await mkdir(target, { recursive: true })
for (const file of FILES) {
  await copyFile(path.join(root, file), path.join(target, file))
}

// assets/ 是插件自己的静态资源目录（tavernUi.assetUrl 会读它），有就一起带上。
if (await exists(path.join(root, 'assets'))) {
  const files = await readdir(path.join(root, 'assets'))
  if (files.length > 0) {
    await mkdir(path.join(target, 'assets'), { recursive: true })
    for (const file of files) {
      await copyFile(path.join(root, 'assets', file), path.join(target, 'assets', file))
    }
  }
}

await writeFile(
  path.join(target, 'INSTALLED.txt'),
  `装自 ${root}\n时间 ${new Date().toISOString()}\n版本 ${pkg.version}\n`,
  'utf8',
)

console.log(`已装到 ${target}`)
if (await exists(path.join(home, 'profiles', 'tavern', 'package.json'))) {
  console.log('宿主侧（index.mjs）的改动要重启 Tavern；只改浏览器侧刷新页面即可。')
} else {
  console.log(`没找到 ${home}/profiles/tavern，确认 DSH_HOME 指对了再启动 Tavern。`)
}
