// 守住「关掉桌宠后刷新不再出现」这条行为。
//
// 之前 CLOSE 只销毁实例、不写任何状态，刷新后 onMounted 一律 initPet，
// 桌宠必然复活。这个 bug 构建不报、单测不看，只能靠源码约束守住：
//   1. 设置里有 petVisible 这个持久化字段；默认 true（老用户升级后照常显示）
//   2. closePet 把它写成 false
//   3. onMounted 在 petVisible === false 时直接早退，不初始化
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const petDir = path.join(root, 'src/client/pet')

const settingsSrc = await readFile(path.join(petDir, 'core/settings.ts'), 'utf8')
const containerSrc = await readFile(path.join(petDir, 'ui/PetContainer.vue'), 'utf8')

test('petVisible 是持久化设置，默认显示', () => {
  assert.match(settingsSrc, /^\s{4}petVisible:\s*z\.boolean\(\)\.default\(true\),/m)
})

test('closePet 会把关闭状态写回设置', () => {
  const start = containerSrc.indexOf('function closePet(')
  assert.ok(start >= 0, '没找到 closePet')
  const body = containerSrc.slice(start, containerSrc.indexOf('\n}', start))
  assert.match(body, /settings\.value\.petVisible\s*=\s*false/)
})

test('onMounted 在关闭状态下不初始化桌宠', () => {
  const start = containerSrc.indexOf('onMounted(')
  assert.ok(start >= 0, '没找到 onMounted')
  const body = containerSrc.slice(start, containerSrc.indexOf('\n})', start))
  assert.match(body, /settings\.value\.petVisible === false/)
  // 早退分支之后才允许 initPet，否则等于没拦。
  const guard = body.indexOf('settings.value.petVisible === false')
  const init = body.indexOf('initPet()')
  assert.ok(init > guard, 'initPet 出现在关闭判断之前，刷新仍会复活')
})
