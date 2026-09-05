import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const playback = pathToFileURL(resolve('lib/playback.mjs')).href
const i18n = pathToFileURL(resolve('lib/i18n.mjs')).href
const credential = `tk_${'c'.repeat(64)}`
const wav = Buffer.alloc(52)
wav.write('RIFF', 0)
wav.writeUInt32LE(44, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(8000, 24)
wav.writeUInt32LE(16000, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(8, 40)
let directory: string, bin: string, home: string, driver: string, capture: string, closed: string
let server: Server, origin: string
let mode = 'audio'
let requests: { path: string; authorization?: string; language?: string; method?: string }[] = []
let children: ChildProcess[] = []

async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  )
}
async function eventually(check: () => Promise<boolean>) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error('Timed out waiting for the fake player')
}
async function fakePlayer(name = 'ffplay', behavior = 'success') {
  await writeFile(
    join(bin, name),
    `#!${process.execPath}
import fs from 'node:fs';
const path = process.argv.at(-1);
fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ argv:process.argv.slice(2), env:process.env, path, fileMode:fs.statSync(path).mode & 511, directoryMode:fs.statSync(new URL('.', 'file://' + path)).mode & 511 }));
process.stdout.write('fake player output\\n');
${behavior === 'wait' ? `process.on('SIGINT', () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(closed)}, JSON.stringify({ audioStillExists: fs.existsSync(path) })); process.exit(0); }, 150)); setInterval(() => {}, 1000);` : behavior === 'failure' ? 'process.exit(7);' : 'process.exit(0);'}
`,
    { mode: 0o755 },
  )
}
function launch(
  args: string[],
  flags: Record<string, unknown> = {},
  environment: Record<string, string> = {},
) {
  const child = spawn(process.execPath, [driver, JSON.stringify(args), JSON.stringify(flags)], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: bin,
      TALKODA_HOME: home,
      TALKODA_CONFIG_FILE: join(home, 'config.json'),
      TALKODA_API_URL: origin,
      TALKODA_API_TOKEN: credential,
      OPENAI_API_KEY: 'synthetic-api-key',
      AWS_SECRET_ACCESS_KEY: 'synthetic-secret',
      UNUSUAL_VALUE: credential,
      LANG: 'en_US.UTF-8',
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let stdout = '',
    stderr = ''
  child.stdout!.on('data', (chunk) => {
    stdout += chunk
  })
  child.stderr!.on('data', (chunk) => {
    stderr += chunk
  })
  const completion = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (done, reject) => {
      child.on('error', reject)
      child.on('close', (code) => done({ code, stdout, stderr }))
    },
  )
  return { child, completion }
}
const run = (
  args: string[],
  flags: Record<string, unknown> = {},
  environment: Record<string, string> = {},
) => launch(args, flags, environment).completion
async function cacheEntries() {
  return readdir(join(home, 'cache')).catch(() => [])
}

beforeAll(async () => {
  server = createServer((request, response) => {
    requests.push({
      path: request.url!,
      authorization: request.headers.authorization,
      language: request.headers['accept-language'],
      method: request.method,
    })
    if (mode === 'redirect') {
      response.writeHead(302, { Location: `${origin}/should-not-follow` })
      response.end()
      return
    }
    if (mode === 'denied') {
      response.writeHead(403, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ error: 'private track forbidden' }))
      return
    }
    if (mode === 'oversized') {
      response.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': String(20 * 1024 * 1024),
      })
      response.write(wav)
      return
    }
    if (mode === 'missing-player') {
      void rm(join(bin, 'ffplay')).then(() => {
        response.writeHead(200, { 'Content-Type': 'audio/wav' })
        response.end(wav)
      })
      return
    }
    if (mode === 'chunked-limit') {
      response.writeHead(200, { 'Content-Type': 'audio/wav' })
      response.write(wav)
      response.end(Buffer.alloc(16 * 1024 * 1024))
      return
    }
    if (mode === 'slow-body') {
      response.writeHead(200, { 'Content-Type': 'audio/wav' })
      response.write(wav.subarray(0, 16))
      const timer = setTimeout(() => response.end(wav.subarray(16)), 10000)
      response.on('close', () => clearTimeout(timer))
      return
    }
    if (mode === 'slow') {
      const timer = setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'audio/wav' })
        response.end(wav)
      }, 10000)
      response.on('close', () => clearTimeout(timer))
      return
    }
    response.writeHead(200, {
      'Content-Type': mode === 'invalid' ? 'application/octet-stream' : 'audio/wav',
    })
    response.end(mode === 'invalid' ? '#EXTM3U\nhttps://example.com/private.mp3\n' : wav)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'talkoda-playback-test-')))
  bin = join(directory, 'bin')
  home = join(directory, 'private-home')
  capture = join(directory, 'captured.json')
  closed = join(directory, 'closed.json')
  driver = join(directory, 'driver.mjs')
  await mkdir(bin)
  await writeFile(
    driver,
    `import {playbackCommand} from ${JSON.stringify(playback)}; import {setLanguage} from ${JSON.stringify(i18n)}; const flags=JSON.parse(process.argv[3]); setLanguage(flags.lang || 'en'); playbackCommand(JSON.parse(process.argv[2]), flags).catch(error=>{process.stderr.write(error.message+'\\n');process.exitCode=1;});`,
  )
  mode = 'audio'
  requests = []
  children = []
})
afterEach(async () => {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  await rm(directory, { recursive: true, force: true })
})
afterAll(async () => {
  server.closeAllConnections()
  await new Promise<void>((done) => server.close(() => done()))
})

describe('terminal audio playback', () => {
  it('checks players without starting playback, reading credentials, or creating a home', async () => {
    await fakePlayer('ffplay')
    await fakePlayer('mpv')
    const result = await run(
      ['play', 'doctor'],
      { player: 'ffplay' },
      { TALKODA_API_TOKEN: 'not-a-valid-token' },
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'ready',
      selectedPlayer: 'ffplay',
      players: expect.arrayContaining([
        { name: 'ffplay', available: true, path: join(bin, 'ffplay') },
      ]),
    })
    expect(await exists(capture)).toBe(false)
    expect(await exists(home)).toBe(false)
    expect(requests).toEqual([])
  })

  it('selects the first available platform player and honestly reports missing executables', async () => {
    for (const name of ['afplay', 'ffplay', 'mpv']) await fakePlayer(name)
    const available = await run(['play', 'doctor'])
    expect(JSON.parse(available.stdout).selectedPlayer).toBe(
      process.platform === 'darwin' ? 'afplay' : 'ffplay',
    )
    await rm(join(bin, 'mpv'))
    const missing = await run(['play', 'doctor'], { player: 'mpv' })
    expect(JSON.parse(missing.stdout)).toMatchObject({
      status: 'unavailable',
      selectedPlayer: null,
    })
    const failed = await run(['play', 'no.wav'], { player: 'mpv' })
    expect(failed.code).toBe(1)
    expect(JSON.parse(failed.stdout).status).toBe('error')
  })

  it('passes a local filename as one argument, strips credentials from env, and reserves stdout for JSON', async () => {
    await fakePlayer()
    const path = join(directory, 'a song; echo $(touch INJECTED).wav')
    await writeFile(path, wav)
    const result = await run(
      ['play', path],
      { player: 'ffplay' },
      { TALKODA_API_TOKEN: 'invalid-on-purpose' },
    )
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'completed',
      player: 'ffplay',
      source: { kind: 'file', path },
      exitCode: 0,
    })
    const child = JSON.parse(await readFile(capture, 'utf8'))
    expect(child.argv.at(-1)).toBe(path)
    expect(child.argv.filter((arg: string) => arg === path)).toHaveLength(1)
    expect(child.argv).toContain('-nodisp')
    expect(child.argv).toContain('-autoexit')
    expect(child.argv).toContain('-protocol_whitelist')
    expect(child.env).not.toHaveProperty('TALKODA_API_TOKEN')
    expect(child.env).not.toHaveProperty('TALKODA_CONFIG_FILE')
    expect(child.env).not.toHaveProperty('OPENAI_API_KEY')
    expect(child.env).not.toHaveProperty('AWS_SECRET_ACCESS_KEY')
    expect(child.env).not.toHaveProperty('UNUSUAL_VALUE')
    expect(child.env.PATH).toBe(bin)
    expect(result.stderr).toContain('fake player output')
    expect(result.stdout).not.toContain('fake player output')
    expect(await exists(join(directory, 'INJECTED'))).toBe(false)
    expect(await exists(home)).toBe(false)
    expect(requests).toEqual([])
  })

  it('configures mpv without video, user scripts, or URL helpers', async () => {
    await fakePlayer('mpv')
    const path = join(directory, 'song.wav')
    await writeFile(path, wav)
    expect((await run(['play', path], { player: 'mpv' })).code).toBe(0)
    const child = JSON.parse(await readFile(capture, 'utf8'))
    expect(child.argv).toEqual(
      expect.arrayContaining([
        '--no-video',
        '--no-config',
        '--load-scripts=no',
        '--ytdl=no',
        '--demuxer-lavf-format=wav',
        '--',
        path,
      ]),
    )
  })

  it('rejects URLs, playlists, disguised playlists, and conflicting inputs before spawning', async () => {
    await fakePlayer()
    const fakeAudio = join(directory, 'playlist.wav')
    await writeFile(fakeAudio, '#EXTM3U\nhttps://example.com/song.wav')
    for (const [args, flags] of [
      [['play', 'https://example.com/song.wav'], {}],
      [['play', 'songs.m3u'], {}],
      [['play', fakeAudio], {}],
      [['play', fakeAudio], { track: 'other' }],
      [['play'], { track: 'https://example.com/song' }],
      [['play', fakeAudio], { player: '/bin/sh' }],
    ] as [string[], Record<string, unknown>][]) {
      const result = await run(args, { player: 'ffplay', ...flags })
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stdout).status).toBe('error')
    }
    expect(await exists(capture)).toBe(false)
    expect(requests).toEqual([])
  })

  it('redacts credentials from JSON and stderr when a filesystem error echoes the input', async () => {
    await fakePlayer()
    const result = await run(['play', join(directory, `${credential}.wav`)], {
      player: 'ffplay',
      lang: 'zh',
    })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('[redacted]'),
    })
    expect(result.stdout + result.stderr).not.toContain(credential)
    expect(result.stderr).toContain('文件或目录不存在')
  })

  it('downloads authorized audio privately, keeps tokens in fetch only, and deletes it after completion', async () => {
    await fakePlayer()
    const result = await run(['play'], { track: 'private-song', player: 'ffplay', lang: 'zh' })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'completed',
      source: { kind: 'track', id: 'private-song', origin },
    })
    expect(requests).toEqual([
      {
        path: '/api/tracks/private-song/media/audio',
        method: 'GET',
        authorization: `Bearer ${credential}`,
        language: 'zh',
      },
    ])
    const child = JSON.parse(await readFile(capture, 'utf8'))
    expect(child.path).toMatch(new RegExp(`${home}/cache/play-[^/]+/audio\\.wav$`))
    expect(child.fileMode).toBe(0o600)
    expect(child.directoryMode).toBe(0o700)
    expect(JSON.stringify(child)).not.toContain(credential)
    expect(await exists(child.path)).toBe(false)
    expect(await cacheEntries()).toEqual([])
    expect((await stat(join(home, 'cache'))).mode & 0o777).toBe(0o700)
    expect(result.stderr).toContain('正在下载作品音频')
    expect(result.stdout + result.stderr).not.toContain(credential)
  })

  it('supports anonymous public playback and uses a unique download path each time', async () => {
    await fakePlayer()
    const first = await run(
      ['play'],
      { track: 'public', player: 'ffplay' },
      { TALKODA_API_TOKEN: '' },
    )
    expect(first.code).toBe(0)
    const firstPath = JSON.parse(await readFile(capture, 'utf8')).path
    const second = await run(
      ['play'],
      { track: 'public', player: 'ffplay' },
      { TALKODA_API_TOKEN: '' },
    )
    expect(second.code).toBe(0)
    const secondPath = JSON.parse(await readFile(capture, 'utf8')).path
    expect(firstPath).not.toBe(secondPath)
    expect(requests.every((request) => !request.authorization)).toBe(true)
    expect(
      requests.every(
        (request) => request.method === 'GET' && request.path.endsWith('/media/audio'),
      ),
    ).toBe(true)
    expect(await cacheEntries()).toEqual([])
  })

  it('cleans private downloads when the player fails', async () => {
    await fakePlayer('ffplay', 'failure')
    const result = await run(['play'], { track: 'song', player: 'ffplay' })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'error', exitCode: 1 })
    expect(result.stderr).toContain('exit 7')
    expect(await cacheEntries()).toEqual([])
  })

  it.each(['redirect', 'denied', 'oversized', 'chunked-limit', 'invalid'])(
    'cleans a rejected %s response without spawning or forwarding credentials',
    async (responseMode) => {
      await fakePlayer()
      mode = responseMode
      const result = await run(['play'], { track: 'song', player: 'ffplay' })
      expect(result.code).toBe(1)
      expect(JSON.parse(result.stdout).status).toBe('error')
      expect(await exists(capture)).toBe(false)
      expect(await cacheEntries()).toEqual([])
      expect(requests).toHaveLength(1)
      expect(requests[0].path).toBe('/api/tracks/song/media/audio')
    },
  )

  it('cleans a downloaded file when executable startup fails', async () => {
    await fakePlayer()
    mode = 'missing-player'
    const result = await run(['play'], { track: 'song', player: 'ffplay' })
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout).status).toBe('error')
    expect(await exists(capture)).toBe(false)
    expect(await cacheEntries()).toEqual([])
  })

  it('waits for the player to exit before cleaning a Ctrl-C download and returns stopped/130', async () => {
    await fakePlayer('ffplay', 'wait')
    const operation = launch(['play'], { track: 'song', player: 'ffplay' })
    await eventually(() => exists(capture))
    const path = JSON.parse(await readFile(capture, 'utf8')).path
    operation.child.kill('SIGINT')
    const result = await operation.completion
    expect(result.code).toBe(130)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'stopped',
      signal: 'SIGINT',
      exitCode: 130,
    })
    expect(JSON.parse(await readFile(closed, 'utf8')).audioStillExists).toBe(true)
    expect(await exists(path)).toBe(false)
    expect(await cacheEntries()).toEqual([])
  })

  it('cancels a streamed response and closes its partial file before cleanup', async () => {
    await fakePlayer()
    mode = 'slow-body'
    const operation = launch(['play'], { track: 'song', player: 'ffplay' })
    await eventually(async () => {
      const entries = await cacheEntries()
      return (
        entries.length === 1 && (await exists(join(home, 'cache', entries[0], 'audio.download')))
      )
    })
    operation.child.kill('SIGINT')
    const result = await operation.completion
    expect(result.code).toBe(130)
    expect(JSON.parse(result.stdout).status).toBe('stopped')
    expect(await cacheEntries()).toEqual([])
    expect(await exists(capture)).toBe(false)
  })

  it('cancels a pending download on Ctrl-C and removes its private directory', async () => {
    await fakePlayer()
    mode = 'slow'
    const operation = launch(['play'], { track: 'song', player: 'ffplay' })
    await eventually(async () => requests.length === 1)
    operation.child.kill('SIGINT')
    const result = await operation.completion
    expect(result.code).toBe(130)
    expect(JSON.parse(result.stdout).status).toBe('stopped')
    expect(await cacheEntries()).toEqual([])
    expect(await exists(capture)).toBe(false)
  })
})
