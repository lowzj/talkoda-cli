import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  configPath,
  createSongDirectory,
  legacyConfigPath,
  songDirectoryName,
  talkodaHome,
} from '../lib/paths.mjs'
import { readConfig, saveToken, tokenFor } from '../lib/client.mjs'

let directory: string
let options: {
  userDirectory: string
  workingDirectory: string
  environment: Record<string, string>
}
const primary = 'https://talkoda.com'
const secondary = 'http://localhost:5173'
const primaryToken = `tk_${'1'.repeat(64)}`
const secondaryToken = `tk_${'2'.repeat(64)}`
const legacyData = {
  version: 1,
  credentials: {
    [primary]: { token: primaryToken },
    [secondary]: { token: secondaryToken },
  },
}

async function writeLegacy() {
  const path = legacyConfigPath(options)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify(legacyData), { mode: 0o600 })
  return path
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'talkoda-paths-test-'))
  options = { userDirectory: directory, workingDirectory: directory, environment: {} }
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('private Talkoda configuration', () => {
  it('resolves the default root and independent explicit overrides without mutating system environment', () => {
    expect(talkodaHome(options)).toBe(join(directory, '.talkoda'))
    expect(configPath(options)).toBe(join(directory, '.talkoda/config.json'))
    options.environment.TALKODA_HOME = '~/custom-talkoda'
    expect(talkodaHome(options)).toBe(join(directory, 'custom-talkoda'))
    expect(configPath(options)).toBe(join(directory, 'custom-talkoda/config.json'))
    options.environment.TALKODA_CONFIG_FILE = 'custom-config.json'
    expect(configPath(options)).toBe(join(directory, 'custom-config.json'))
    expect(talkodaHome(options)).toBe(join(directory, 'custom-talkoda'))
  })

  it('migrates legacy credentials atomically with private permissions and retains origin scoping', async () => {
    options.environment.XDG_CONFIG_HOME = join(directory, 'legacy-config-root')
    const legacy = await writeLegacy()
    const results = await Promise.all(Array.from({ length: 20 }, () => readConfig(options)))
    for (const result of results) expect(result).toEqual(legacyData)
    expect(JSON.parse(await readFile(configPath(options), 'utf8'))).toEqual(legacyData)
    expect(JSON.parse(await readFile(legacy, 'utf8'))).toEqual(legacyData)
    expect((await stat(configPath(options))).mode & 0o777).toBe(0o600)
    expect((await stat(talkodaHome(options))).mode & 0o777).toBe(0o700)
    expect(await readdir(talkodaHome(options))).toEqual(['config.json'])
    expect(await tokenFor(primary, options)).toBe(primaryToken)
    expect(await tokenFor(secondary, options)).toBe(secondaryToken)
    expect(await tokenFor('https://other.example', options)).toBeNull()
  })

  it('never resurrects logged-out credentials from the retained legacy file', async () => {
    const legacy = await writeLegacy()
    await saveToken(primary, null, options)
    expect(await tokenFor(primary, options)).toBeNull()
    expect(await tokenFor(secondary, options)).toBe(secondaryToken)
    await saveToken(secondary, null, options)
    for (const result of await Promise.all(Array.from({ length: 12 }, () => readConfig(options))))
      expect(result).toEqual({ version: 1, credentials: {} })
    expect(JSON.parse(await readFile(legacy, 'utf8'))).toEqual(legacyData)
  })

  it.each(['TALKODA_HOME', 'TALKODA_CONFIG_FILE'])(
    'does not migrate when %s is explicitly configured',
    async (key) => {
      await writeLegacy()
      options.environment[key] =
        key === 'TALKODA_HOME' ? join(directory, 'custom') : join(directory, 'custom.json')
      expect(await readConfig(options)).toEqual({ version: 1, credentials: {} })
      await expect(stat(configPath(options))).rejects.toMatchObject({ code: 'ENOENT' })
      await saveToken(secondary, secondaryToken, options)
      expect(await tokenFor(primary, options)).toBeNull()
      expect(await tokenFor(secondary, options)).toBe(secondaryToken)
      expect((await stat(configPath(options))).mode & 0o777).toBe(0o600)
    },
  )

  it('honors an existing empty new credentials map over populated legacy credentials', async () => {
    await writeLegacy()
    await mkdir(talkodaHome(options), { mode: 0o700 })
    await writeFile(configPath(options), JSON.stringify({ version: 1, credentials: {} }))
    expect(await tokenFor(primary, options)).toBeNull()
    expect(await readConfig(options)).toEqual({ version: 1, credentials: {} })
  })

  it.each(['', '{invalid', '{"version":1,"credentials":[]}'])(
    'reports invalid new config without falling back to legacy: %j',
    async (contents) => {
      await writeLegacy()
      await mkdir(talkodaHome(options), { mode: 0o700 })
      await writeFile(configPath(options), contents)
      await expect(readConfig(options)).rejects.toThrow('TALKODA_HOME')
      expect(await readFile(configPath(options), 'utf8')).toBe(contents)
    },
  )

  it('rejects a dangling new config symlink instead of falling back or overwriting it', async () => {
    await writeLegacy()
    await mkdir(talkodaHome(options), { mode: 0o700 })
    await symlink(join(directory, 'missing.json'), configPath(options))
    await expect(readConfig(options)).rejects.toThrow('TALKODA_HOME')
    await expect(stat(join(directory, 'missing.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps the home and newly saved config private even if their prior permissions were broad', async () => {
    await mkdir(talkodaHome(options), { mode: 0o755 })
    await writeFile(configPath(options), JSON.stringify({ version: 1, credentials: {} }))
    await chmod(configPath(options), 0o644)
    await saveToken(primary, primaryToken, options)
    expect((await stat(talkodaHome(options))).mode & 0o777).toBe(0o700)
    expect((await stat(configPath(options))).mode & 0o777).toBe(0o600)
  })
})

describe('song workspaces', () => {
  it('reserves a fresh private Unicode workspace for each concurrent invocation', async () => {
    const folders = await Promise.all(
      Array.from({ length: 16 }, () =>
        createSongDirectory({ name: '再试一次', conversation: 'chat.md' }, options),
      ),
    )
    expect(new Set(folders).size).toBe(16)
    expect(folders).toContain(join(directory, '.talkoda/songs/再试一次'))
    expect(folders).toContain(join(directory, '.talkoda/songs/再试一次-16'))
    for (const path of [talkodaHome(options), join(talkodaHome(options), 'songs'), ...folders])
      expect((await stat(path)).mode & 0o777).toBe(0o700)
  })

  it('uses the supplied name, then title, then conversation basename and sanitizes derived titles', async () => {
    expect(
      await createSongDirectory(
        { name: '独立名称', title: '作品标题', conversation: '/exports/chat.md' },
        options,
      ),
    ).toBe(join(talkodaHome(options), 'songs/独立名称'))
    expect(
      await createSongDirectory(
        { title: 'A / second: attempt', conversation: '/exports/chat.md' },
        options,
      ),
    ).toBe(join(talkodaHome(options), 'songs/A-second-attempt'))
    expect(await createSongDirectory({ conversation: '/exports/会话记录.md' }, options)).toBe(
      join(talkodaHome(options), 'songs/会话记录'),
    )
    expect(songDirectoryName('..')).toBe('song')
    expect(songDirectoryName('CON')).toBe('song-CON')
    expect(Buffer.byteLength(songDirectoryName('音乐'.repeat(100)))).toBeLessThanOrEqual(180)
  })

  it.each(['../elsewhere', 'nested/song', 'nested\\song', '.', '..', '．．／outside'])(
    'rejects explicit name %j without creating a workspace',
    async (name) => {
      await expect(createSongDirectory({ name, conversation: 'chat.md' }, options)).rejects.toThrow(
        '--name',
      )
      await expect(stat(talkodaHome(options))).rejects.toMatchObject({ code: 'ENOENT' })
    },
  )

  it('preserves explicit output and never overwrites an existing directory or symlink', async () => {
    const explicit = await createSongDirectory(
      { output: 'chosen', conversation: 'chat.md' },
      options,
    )
    expect(explicit).toBe(join(directory, 'chosen'))
    await writeFile(join(explicit, 'keep.txt'), 'Existing work')
    await expect(
      createSongDirectory({ output: 'chosen', conversation: 'chat.md' }, options),
    ).rejects.toMatchObject({ code: 'EEXIST' })
    await symlink(explicit, join(directory, 'linked'))
    await expect(
      createSongDirectory({ output: 'linked', conversation: 'chat.md' }, options),
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(explicit, 'keep.txt'), 'utf8')).toBe('Existing work')
    await expect(stat(talkodaHome(options))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
