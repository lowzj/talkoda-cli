import { chmod, lstat, mkdir } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { homedir } from 'node:os'
import { basename, extname, join, resolve } from 'node:path'
import { t } from './i18n.mjs'

function context(options = {}) {
  return {
    environment: options.environment || process.env,
    userDirectory: options.userDirectory || homedir(),
    workingDirectory: options.workingDirectory || process.cwd(),
  }
}

function expand(value, options) {
  const { userDirectory, workingDirectory } = context(options)
  if (value === '~') return userDirectory
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(userDirectory, value.slice(2))
  return resolve(workingDirectory, value)
}

export function talkodaHome(options) {
  const { environment, userDirectory } = context(options)
  return environment.TALKODA_HOME
    ? expand(environment.TALKODA_HOME, options)
    : join(userDirectory, '.talkoda')
}

export function configPath(options) {
  const { environment } = context(options)
  return environment.TALKODA_CONFIG_FILE
    ? expand(environment.TALKODA_CONFIG_FILE, options)
    : join(talkodaHome(options), 'config.json')
}

export function legacyConfigPath(options) {
  const { environment, userDirectory } = context(options)
  const root = environment.XDG_CONFIG_HOME
    ? expand(environment.XDG_CONFIG_HOME, options)
    : join(userDirectory, '.config')
  return join(root, 'talkoda', 'config.json')
}

export function canMigrateLegacyConfig(options) {
  const { environment } = context(options)
  return !environment.TALKODA_HOME && !environment.TALKODA_CONFIG_FILE
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      t(`工作目录不是普通目录：${path}`, `Not a regular workspace directory: ${path}`),
    )
  await chmod(path, 0o700)
  return path
}

export async function ensureTalkodaHome(options) {
  return privateDirectory(talkodaHome(options))
}

export function songDirectoryName(value, { explicit = false } = {}) {
  const normalized = value.normalize('NFKC').trim()
  if (explicit && (/[/\\]/u.test(normalized) || ['.', '..'].includes(normalized)))
    throw new Error(
      t(
        '--name 必须是作品名称，不能包含路径分隔符或目录跳转。',
        '--name must be a song name without path separators or directory traversal.',
      ),
    )
  let name = normalized
    .replace(/[\p{C}<>:"/\\|?*]+/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[. -]+|[. -]+$/gu, '')
  // Leave ample room for unique suffixes under common 255-byte filename limits.
  let shortened = '',
    bytes = 0
  for (const character of name) {
    bytes += Buffer.byteLength(character, 'utf8')
    if (bytes > 180) break
    shortened += character
  }
  name = shortened
  name = name.replace(/[. -]+$/gu, '') || 'song'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) name = `song-${name}`
  return name
}

export async function createSongDirectory({ output, name, title, conversation }, options) {
  if (output) {
    const path = expand(output, options)
    await mkdir(path, { mode: 0o700 })
    return path
  }
  const base = songDirectoryName(name || title || basename(conversation, extname(conversation)), {
    explicit: Boolean(name),
  })
  const songs = await privateDirectory(join(await ensureTalkodaHome(options), 'songs'))
  for (let number = 1; ; number++) {
    const path = join(songs, number === 1 ? base : `${base}-${number}`)
    try {
      // Atomic reservation also protects against concurrent compositions and existing symlinks.
      await mkdir(path, { mode: 0o700 })
      return path
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
  }
}
