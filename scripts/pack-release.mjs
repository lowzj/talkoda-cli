import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const output = join(root, 'dist')
const expected = new Set([
  'package.json',
  'LICENSE',
  'README.md',
  'bin/talkoda.mjs',
  'lib/client.mjs',
  'lib/i18n.mjs',
  'lib/metadata.mjs',
  'lib/creative.mjs',
  'lib/render.mjs',
  'lib/paths.mjs',
  'lib/playback.mjs',
  'docs/README.zh-CN.md',
  'docs/README.en.md',
  'skills/talkoda/SKILL.md',
  'skills/talkoda/references/cli.md',
  'skills/talkoda/references/music.md',
  'skills/talkoda/assets/starter.strudel.js',
])
if (!process.env.npm_execpath) throw new Error('Run this task with npm run pack:release.')
await mkdir(output, { recursive: true })
const result = spawnSync(
  process.execPath,
  [process.env.npm_execpath, 'pack', '--json', '--ignore-scripts', '--pack-destination', output],
  { cwd: root, encoding: 'utf8' },
)
if (result.status !== 0) throw new Error(result.stderr || 'npm pack failed')
const [packed] = JSON.parse(result.stdout)
const actual = new Set(packed.files.map((file) => file.path))
if (actual.size !== expected.size || [...actual].some((path) => !expected.has(path))) {
  throw new Error(
    'Release contains unexpected or missing files. Review the explicit CLI/skill allowlist before publishing.',
  )
}
for (const path of actual) {
  const text = await readFile(join(root, path), 'utf8')
  if (/tk_[a-f0-9]{64}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)) {
    throw new Error(`Credential-like content found in ${path}; release stopped.`)
  }
}
const artifact = join(output, packed.filename)
const checksum = createHash('sha256')
  .update(await readFile(artifact))
  .digest('hex')
await writeFile(artifact + '.sha256', `${checksum}  ${packed.filename}\n`)
console.log(
  JSON.stringify({ artifact, bytes: packed.size, files: [...actual], sha256: checksum }, null, 2),
)
