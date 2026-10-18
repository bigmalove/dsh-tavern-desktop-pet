// 源码一致性检查：模板引用的每个符号、v-model 绑定的每个设置字段，都必须真实存在。
//
// 起因是一次真实的线上 bug：清理死代码时删掉了 SettingsPanel 里的 close()，
// 因为「脚本里没有别的引用」，但模板里的 CLOSE / 确定 / @click.self 三处还在调它。
// 点击抛 "close is not a function"，被 Vue 的 errorHandler 吞掉，症状是「点了没反应」。
// 这类错误构建不报、单测不看，只有点下去才知道——所以在这里守住。
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const petDir = path.join(root, 'src/client/pet')

async function walk(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

// 模板里由 v-for / 作用域插槽引入的局部变量，不属于脚本符号。
const SCOPE_LOCALS = new Set(['entry', 'child', 'sheetName', 'style', 'commentStyle', 'searchQuery'])
const BUILTINS = new Set([
  '$emit', '$attrs', '$slots', '$props', 'Math', 'Number', 'String', 'Boolean',
  'Array', 'Object', 'JSON', 'Date', 'console', 'undefined', 'null', 'true', 'false',
])
const IDENT = /^[A-Za-z_$][\w$]*$/

function scriptSymbols(script) {
  const names = new Set(BUILTINS)
  for (const m of script.matchAll(/(?:function|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1])
  for (const m of script.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from/g)) names.add(m[1])
  for (const m of script.matchAll(/import\s+\{([^}]*)\}\s+from/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(' as ').pop().trim()
      if (IDENT.test(name)) names.add(name)
    }
  }
  for (const m of script.matchAll(/(?:const|let)\s+\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().split('=')[0].trim()
      if (IDENT.test(name)) names.add(name)
    }
  }
  // 对象字面量里的方法简写
  for (const m of script.matchAll(/^\s{2,}([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) names.add(m[1])
  return names
}

function templateRefs(template) {
  const refs = []
  for (const m of template.matchAll(/@[\w:.-]+="([^"]*)"/g)) refs.push(['事件', m[1]])
  for (const m of template.matchAll(/:[\w.-]+="([^"]*)"/g)) refs.push(['属性', m[1]])
  for (const m of template.matchAll(/v-model(?::\w+)?(?:\.\w+)*="([^"]*)"/g)) refs.push(['v-model', m[1]])
  for (const m of template.matchAll(/\{\{([\s\S]*?)\}\}/g)) refs.push(['插值', m[1]])
  return refs
}

async function schemaFields() {
  const text = await readFile(path.join(petDir, 'core/settings.ts'), 'utf8')
  return new Set([...text.matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]))
}

test('模板里的每个调用 / 绑定都能在脚本里找到定义', async () => {
  const files = (await walk(petDir)).filter((f) => f.endsWith('.vue'))
  assert.ok(files.length > 0, '没找到 .vue 文件')

  const dangling = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    const script = text.match(/<script[^>]*>([\s\S]*?)<\/script>/)
    assert.ok(script, `${path.basename(file)} 缺少 <script>`)
    const symbols = scriptSymbols(script[1])
    const template = text.slice(0, script.index)

    for (const [kind, raw] of templateRefs(template)) {
      const expr = raw.trim()
      // 只检查「单个标识符」或「单个函数调用」这类能确定指向脚本符号的写法，
      // 复杂表达式（含运算符、字面量、成员访问）不做静态判定。
      const call = expr.match(/^([A-Za-z_$][\w$]*)\s*\(/)
      const name = call ? call[1] : IDENT.test(expr) ? expr : null
      if (!name || SCOPE_LOCALS.has(name) || symbols.has(name)) continue
      dangling.push(`${path.relative(root, file)} [${kind}] ${name}`)
    }
  }

  assert.deepEqual([...new Set(dangling)], [], '模板引用了脚本里不存在的符号')
})

test('v-model 绑定的 settings 字段都在 schema 里', async () => {
  const fields = await schemaFields()
  const files = (await walk(petDir)).filter((f) => f.endsWith('.vue'))
  const missing = []

  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const m of text.matchAll(/v-model(?::\w+)?(?:\.\w+)*="settings\.([A-Za-z_$][\w$]*)"/g)) {
      if (!fields.has(m[1])) missing.push(`${path.relative(root, file)} settings.${m[1]}`)
    }
  }

  assert.deepEqual([...new Set(missing)], [], 'v-model 绑定了 schema 里不存在的字段')
})
