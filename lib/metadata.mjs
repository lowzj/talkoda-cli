import { readFile, stat } from 'node:fs/promises'
import { t } from './i18n.mjs'

export const generationOptions = [
  'agent',
  'model',
  'tokens',
  'prompt',
  'prompt-file',
  'source-visibility',
  'prompt-visibility',
  'tags',
  'copyright-notice',
]
export const metadataOptions = [
  'title',
  'summary',
  'summary-file',
  'genre',
  'cover',
  'bpm',
  'engine-version',
  ...generationOptions,
]

export function integerOption(flags, key, fallback, min, max) {
  const raw = flags[key]
  const value = raw === undefined ? fallback : raw.trim() ? Number(raw) : NaN
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(
      t(
        `--${key} 必须是 ${min}–${max} 的整数。`,
        `--${key} must be an integer from ${min} to ${max}.`,
      ),
    )
  return value
}

export function normalizeTag(value) {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ')
}

export function parseTags(value) {
  if (!value.trim()) return []
  const tags = [...new Set(value.split(/[,，]/u).map(normalizeTag).filter(Boolean))]
  if (tags.length > 10 || tags.some((tag) => tag.length > 32))
    throw new Error(
      t(
        '--tags 最多包含 10 个标签，每个标签最多 32 个字符。',
        '--tags accepts at most 10 tags of up to 32 characters each.',
      ),
    )
  return tags
}

function limited(value, key, max) {
  if (value.length > max)
    throw new Error(
      t(`--${key} 最多 ${max} 个字符。`, `--${key} allows at most ${max} characters.`),
    )
  return value || null
}

/** Send only supplied fields. A PATCH must never replay stale server metadata. */
export async function metadataFromFlags(flags) {
  const data = {}
  for (const key of ['title', 'summary', 'genre', 'cover'])
    if (flags[key] !== undefined) data[key] = flags[key]
  if (flags['summary-file'] !== undefined) {
    if (flags.summary !== undefined)
      throw new Error(
        t(
          '--summary 和 --summary-file 只能选择一个。',
          'Choose either --summary or --summary-file.',
        ),
      )
    data.summary = await readFile(flags['summary-file'], 'utf8')
  }
  if (flags.bpm !== undefined)
    data.bpm = flags.bpm === 'none' ? null : integerOption(flags, 'bpm', 108, 20, 300)
  if (flags['engine-version'] !== undefined) data.engineVersion = flags['engine-version']
  for (const [flag, key] of [
    ['source-visibility', 'sourceVisibility'],
    ['prompt-visibility', 'promptVisibility'],
  ]) {
    if (flags[flag] === undefined) continue
    if (!['public', 'private'].includes(flags[flag]))
      throw new Error(
        t(`--${flag} 必须是 public 或 private。`, `--${flag} must be public or private.`),
      )
    data[key] = flags[flag]
  }
  for (const [flag, key, max] of [
    ['agent', 'agent', 100],
    ['model', 'model', 120],
    ['copyright-notice', 'copyrightNotice', 1000],
  ])
    if (flags[flag] !== undefined) data[key] = limited(flags[flag].trim(), flag, max)
  if (flags.tokens !== undefined)
    data.tokenCount =
      flags.tokens === 'none' ? null : integerOption(flags, 'tokens', 0, 0, Number.MAX_SAFE_INTEGER)
  if (flags.prompt !== undefined && flags['prompt-file'] !== undefined)
    throw new Error(
      t('--prompt 和 --prompt-file 只能选择一个。', 'Choose either --prompt or --prompt-file.'),
    )
  if (flags['prompt-file'] !== undefined) {
    const info = await stat(flags['prompt-file'])
    if (!info.isFile() || info.size > 64000)
      throw new Error(
        t(
          '提示词文件需为不超过 64 KB 的文本文件。',
          'The prompt must be a text file no larger than 64 KB.',
        ),
      )
    data.prompt = limited(await readFile(flags['prompt-file'], 'utf8'), 'prompt-file', 16000)
  } else if (flags.prompt !== undefined) data.prompt = limited(flags.prompt, 'prompt', 16000)
  if (flags.tags !== undefined) data.tags = parseTags(flags.tags)
  return data
}
