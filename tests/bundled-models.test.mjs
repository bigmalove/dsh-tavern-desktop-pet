// 内置 Live2D 形象的回归测试：
// 设置里能看到的每一套内置模型，都必须真的在 assets/ 里，且 model3.json 引用的
// moc3 / 贴图 / 动作 / 表情一个不缺；否则玩家点一下就只剩一个空舞台。
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const bundledSource = path.join(root, 'src/client/pet/core/bundled-model.ts')

async function readBundledModels() {
  const source = await readFile(bundledSource, 'utf8')
  const block = source.match(/export const BUNDLED_MODELS[^=]*=\s*\[([\s\S]*?)\n\];/)
  assert.ok(block, 'bundled-model.ts 里找不到 BUNDLED_MODELS')
  const models = []
  for (const entry of block[1].matchAll(/\{([^{}]*)\}/g)) {
    const id = entry[1].match(/id:\s*'([^']+)'/)?.[1]
    const name = entry[1].match(/name:\s*'([^']+)'/)?.[1]
    const asset = entry[1].match(/asset:\s*'([^']+)'/)?.[1]
    const suffix = entry[1].match(/suffix:\s*'([^']+)'/)?.[1]
    assert.ok(id && name && asset && suffix, `内置模型条目不完整：${entry[0]}`)
    models.push({ id, name, asset, suffix })
  }
  return models
}

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

function collectFileRefs(value, out = []) {
  if (typeof value === 'string') {
    if (/\.(json|moc3|png)$/i.test(value)) out.push(value)
  } else if (Array.isArray(value)) {
    for (const item of value) collectFileRefs(item, out)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectFileRefs(item, out)
  }
  return out
}

test('内置三套形象都在：女仆 / Claude / 铁盆', async () => {
  const models = await readBundledModels()
  assert.deepEqual(
    models.map((model) => model.id),
    ['dafeiyu', 'dafeiyu-claude', 'dafeiyu-basin'],
    '内置形象顺序与 id 不能悄悄变（默认形象固定取第一个）',
  )
  assert.equal(new Set(models.map((model) => model.asset)).size, models.length, 'asset 不能重复')
  assert.equal(new Set(models.map((model) => model.suffix)).size, models.length, 'suffix 不能重复')
  for (const model of models) {
    assert.ok(model.name.includes('鲸鱼娘'), `${model.id} 的显示名应标明鲸鱼娘`)
    assert.ok(model.suffix.endsWith(model.asset.split('/').slice(-2).join('/')), `${model.id} 的 suffix 与 asset 对不上`)
    assert.ok(await exists(path.join(root, 'assets', model.asset)), `缺少内置模型 ${model.asset}`)
  }
})

test('每套内置模型的 model3.json 引用文件齐全', async () => {
  const models = await readBundledModels()
  for (const model of models) {
    const manifestPath = path.join(root, 'assets', model.asset)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const dir = path.dirname(manifestPath)
    const refs = [...new Set(collectFileRefs(manifest.FileReferences))]

    assert.ok(refs.length >= 8, `${model.id} 的 model3.json 引用太少：${refs.length}`)
    assert.ok(refs.some((ref) => ref.endsWith('.moc3')), `${model.id} 缺少 moc3 引用`)
    assert.ok(refs.some((ref) => ref.endsWith('.png')), `${model.id} 缺少贴图引用`)

    const missing = []
    for (const ref of refs) {
      if (!(await exists(path.join(dir, ref)))) missing.push(ref)
    }
    assert.deepEqual(missing, [], `${model.id} 引用了不存在的文件`)
  }
})

test('默认形象仍是第一套，设置面板列出全部内置选项', async () => {
  const source = await readFile(bundledSource, 'utf8')
  assert.match(source, /DEFAULT_BUNDLED_MODEL_ID\s*=\s*BUNDLED_MODELS\[0\]\.id/)

  const panel = await readFile(path.join(root, 'src/client/pet/ui/SettingsPanel.vue'), 'utf8')
  assert.ok(panel.includes('getBundledModelOptions()'), '设置面板应使用内置模型列表')
  assert.ok(panel.includes('isRecommendedModelActive'), '设置面板应高亮当前内置形象')

  const main = await readFile(path.join(root, 'src/client/main.js'), 'utf8')
  assert.ok(main.includes('setBundledModelUrls('), '启动时应写入所有内置模型地址')
  assert.ok(main.includes('resolveBundledModelUrl('), '启动时应迁移旧内置模型地址')
})

test('提交的 client.js 已按三套内置形象重新构建', async () => {
  const code = await readFile(path.join(root, 'client.js'), 'utf8')
  for (const name of ['鲸鱼娘·女仆', '鲸鱼娘·Claude', '鲸鱼娘·铁盆']) {
    assert.ok(code.includes(name), `client.js 里缺少「${name}」：改了源码要重新 npm run build`)
  }
  for (const asset of ['live2d/dafeiyu/dafeiyu.model3.json', 'live2d/dafeiyu-claude/dafeiyu-claude.model3.json', 'live2d/dafeiyu-basin/dafeiyu.model3.json']) {
    assert.ok(code.includes(asset), `client.js 里缺少内置资源 ${asset}`)
  }
})
