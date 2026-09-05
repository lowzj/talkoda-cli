import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { delimiter, extname, isAbsolute, join, resolve } from 'node:path'
import { apiOrigin, client, tokenFor } from './client.mjs'
import { ensureTalkodaHome, talkodaHome } from './paths.mjs'
import { formatError, t } from './i18n.mjs'

const names = ['afplay', 'ffplay', 'mpv']
const maxDownloadBytes = 16 * 1024 * 1024
const formats = { '.mp3': 'mp3', '.m4a': 'mov', '.wav': 'wav' }
const redact = (value) => {
  const text = String(value)
  const token = process.env.TALKODA_API_TOKEN
  return (token ? text.replaceAll(token, '[redacted]') : text).replace(
    /tk_[a-f\d]{64}/gi,
    '[redacted]',
  )
}

async function executable(name) {
  for (const directory of (process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin').split(delimiter)) {
    if (!isAbsolute(directory)) continue
    const file = join(directory, `${name}${process.platform === 'win32' ? '.exe' : ''}`)
    try {
      await access(file, constants.X_OK)
      if ((await stat(file)).isFile()) return await realpath(file)
    } catch {
      /* Try the next PATH entry. */
    }
  }
  return null
}
async function doctor(choice) {
  const players = await Promise.all(
    names.map(async (name) => {
      const path = await executable(name)
      return { name, available: Boolean(path), path }
    }),
  )
  const order =
    choice === 'auto' ? (process.platform === 'darwin' ? names : ['ffplay', 'mpv']) : [choice]
  const selected = order
    .map((name) => players.find((player) => player.name === name))
    .find((player) => player.available)
  return {
    status: selected ? 'ready' : 'unavailable',
    platform: process.platform,
    selectedPlayer: selected?.name ?? null,
    players,
  }
}
function childEnvironment() {
  // Audio/session routing is retained; credentials and application configuration are not inherited.
  const allowed = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LC_MESSAGES',
    'TERM',
    'COLORTERM',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'PULSE_SERVER',
    'PIPEWIRE_REMOTE',
    'DBUS_SESSION_BUS_ADDRESS',
    'SYSTEMROOT',
    'WINDIR',
    'APPDATA',
    'LOCALAPPDATA',
    'PATHEXT',
  ]
  return Object.fromEntries(
    allowed
      .filter(
        (key) => typeof process.env[key] === 'string' && !/tk_[a-f\d]{64}/i.test(process.env[key]),
      )
      .map((key) => [key, process.env[key]]),
  )
}
async function audioFormat(path, expected) {
  const handle = await open(path, 'r')
  try {
    if (!(await handle.stat()).isFile())
      throw new Error(t('请提供普通音频文件。', 'Provide a regular audio file.'))
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    let extension
    if (
      bytesRead >= 12 &&
      header.toString('ascii', 0, 4) === 'RIFF' &&
      header.toString('ascii', 8, 12) === 'WAVE'
    )
      extension = '.wav'
    else if (bytesRead >= 12 && header.toString('ascii', 4, 8) === 'ftyp') extension = '.m4a'
    else if (
      bytesRead >= 4 &&
      (header.toString('ascii', 0, 3) === 'ID3' ||
        (header[0] === 0xff && (header[1] & 0xe0) === 0xe0 && (header[1] & 0x06) !== 0))
    )
      extension = '.mp3'
    if (!extension || (expected && extension !== expected))
      throw new Error(
        t(
          '文件内容不是所声明的 MP3、M4A 或 WAV 音频，不支持播放列表。',
          'The file is not the declared MP3, M4A, or WAV audio. Playlists are not supported.',
        ),
      )
    return extension
  } finally {
    await handle.close()
  }
}
function argumentsFor(name, path, extension) {
  if (name === 'afplay') return [path]
  // Force the audio container, disable GUI/config/scripts, and permit local file input only.
  // https://ffmpeg.org/ffplay.html ; https://mpv.io/manual/master/
  if (name === 'ffplay')
    return [
      '-nodisp',
      '-autoexit',
      '-loglevel',
      'error',
      '-nostats',
      '-protocol_whitelist',
      'file',
      '-f',
      formats[extension],
      '-i',
      path,
    ]
  return [
    '--no-video',
    '--no-config',
    '--load-scripts=no',
    '--ytdl=no',
    '--terminal=no',
    '--idle=no',
    '--keep-open=no',
    '--audio-file-auto=no',
    '--sub-auto=no',
    '--demuxer=lavf',
    `--demuxer-lavf-format=${formats[extension]}`,
    '--demuxer-lavf-o=protocol_whitelist=file',
    '--',
    path,
  ]
}
async function downloadTrack(id, flags, signal, onDirectory) {
  const origin = apiOrigin(flags.url || process.env.TALKODA_API_URL)
  const token = await tokenFor(origin)
  const api = client(origin, token)
  await ensureTalkodaHome()
  const cache = join(talkodaHome(), 'cache')
  await mkdir(cache, { recursive: true, mode: 0o700 })
  const info = await lstat(cache)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(
      t(
        '播放缓存必须是普通目录，不能是符号链接。',
        'The playback cache must be a regular directory, not a symlink.',
      ),
    )
  await chmod(cache, 0o700)
  const directory = await mkdtemp(join(cache, 'play-'))
  onDirectory(directory)
  await chmod(directory, 0o700)
  signal.throwIfAborted()
  process.stderr.write(t('正在下载作品音频…\n', 'Downloading track audio…\n'))
  const response = await api.request(`/api/tracks/${encodeURIComponent(id)}/media/audio`, {
    raw: true,
    signal,
  })
  signal.throwIfAborted()
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel()
    throw new Error(t('服务未返回完整音频。', 'The server did not return complete audio.'))
  }
  const length = Number(response.headers.get('content-length'))
  if (Number.isFinite(length) && length > maxDownloadBytes) {
    await response.body.cancel()
    throw new Error(
      t('作品音频超过 16 MB 下载上限。', 'Track audio exceeds the 16 MB download limit.'),
    )
  }
  const temporary = join(directory, 'audio.download')
  const handle = await open(temporary, 'wx', 0o600)
  try {
    let bytes = 0
    for await (const chunk of response.body) {
      signal.throwIfAborted()
      bytes += chunk.byteLength
      if (bytes > maxDownloadBytes)
        throw new Error(
          t('作品音频超过 16 MB 下载上限。', 'Track audio exceeds the 16 MB download limit.'),
        )
      await handle.writeFile(chunk)
    }
  } finally {
    await handle.close()
  }
  signal.throwIfAborted()
  const extension = await audioFormat(temporary)
  const path = join(directory, `audio${extension}`)
  await rename(temporary, path)
  return { path, extension, source: { kind: 'track', id, origin } }
}

/** Prints one JSON result, routes progress to stderr, and never infers listening counts. */
export async function playbackCommand(args, flags = {}) {
  const print = (value) => {
    console.log(redact(JSON.stringify(value, null, flags.json ? 0 : 2)))
    return value
  }
  let directory, source, player, child, forceStop
  let interrupted = null
  const controller = new globalThis.AbortController()
  const stop = (signal) => {
    interrupted ||= signal
    controller.abort()
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill(signal)
      if (!forceStop)
        forceStop = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        }, 1500)
    }
  }
  const interrupt = () => stop('SIGINT')
  const terminate = () => stop('SIGTERM')
  try {
    const invalid = Object.keys(flags).filter(
      (key) => !['lang', 'json', 'url', 'player', 'track'].includes(key),
    )
    if (invalid.length)
      throw new Error(
        t(
          `play 不支持 ${invalid.map((key) => `--${key}`).join(', ')}。`,
          `play does not support ${invalid.map((key) => `--${key}`).join(', ')}.`,
        ),
      )
    const choice = flags.player ?? 'auto'
    if (!['auto', ...names].includes(choice))
      throw new Error(
        t(
          '--player 必须是 auto、afplay、ffplay 或 mpv。',
          '--player must be auto, afplay, ffplay, or mpv.',
        ),
      )
    const inspection =
      args[0] === 'play' && args[1] === 'doctor' && args.length === 2 && !flags.track
    if (
      args[0] !== 'play' ||
      (!inspection && (flags.track ? args.length !== 1 : args.length !== 2))
    )
      throw new Error(
        t(
          '使用 play FILE、play --track ID 或 play doctor。',
          'Use play FILE, play --track ID, or play doctor.',
        ),
      )
    if (flags.track && !/^[a-zA-Z0-9_-]{1,100}$/.test(flags.track))
      throw new Error(
        t('--track 必须是作品 ID，不能是链接。', '--track must be a track ID, not a URL.'),
      )
    const status = await doctor(choice)
    if (inspection) return print(status)
    player = status.selectedPlayer
    if (!player)
      throw new Error(
        t(
          '没有找到可用播放器。macOS 可用 afplay，或安装 ffplay / mpv；运行 play doctor 检查。',
          'No audio player found. Use afplay on macOS or install ffplay / mpv; run play doctor to check.',
        ),
      )
    let path, extension
    process.on('SIGINT', interrupt)
    process.on('SIGTERM', terminate)
    if (flags.track) {
      source = {
        kind: 'track',
        id: flags.track,
        origin: apiOrigin(flags.url || process.env.TALKODA_API_URL),
      }
      const downloaded = await downloadTrack(flags.track, flags, controller.signal, (value) => {
        directory = value
      })
      ;({ path, extension, source } = downloaded)
    } else {
      const input = args[1]
      if (/^[a-z][a-z\d+.-]*:/i.test(input) && !/^[a-z]:[\\/]/i.test(input))
        throw new Error(
          t(
            '仅支持本地音频文件；远程作品请使用 --track ID。',
            'Only local audio files are supported; use --track ID for a remote track.',
          ),
        )
      extension = extname(input).toLowerCase()
      if (!formats[extension])
        throw new Error(
          t('请选择 .mp3、.m4a 或 .wav 文件。', 'Choose an .mp3, .m4a, or .wav file.'),
        )
      path = await realpath(resolve(input))
      if (!(await stat(path)).isFile())
        throw new Error(t('请提供普通音频文件。', 'Provide a regular audio file.'))
      await audioFormat(path, extension)
      source = { kind: 'file', path }
    }
    controller.signal.throwIfAborted()
    process.stderr.write(
      t(
        `正在通过 ${player} 播放，按 Ctrl-C 停止。\n`,
        `Playing with ${player}. Press Ctrl-C to stop.\n`,
      ),
    )
    const result = await new Promise((done, reject) => {
      let spawnError
      child = spawn(
        status.players.find((item) => item.name === player).path,
        argumentsFor(player, path, extension),
        { shell: false, env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] },
      )
      child.stdout.on('data', (chunk) => process.stderr.write(chunk))
      child.stderr.on('data', (chunk) => process.stderr.write(chunk))
      child.on('error', (error) => {
        spawnError = error
      })
      child.on('close', (code, signal) => {
        if (spawnError) reject(spawnError)
        else done({ code, signal })
      })
    })
    if (interrupted || ['SIGINT', 'SIGTERM'].includes(result.signal)) {
      const signal = interrupted || result.signal
      process.exitCode = signal === 'SIGINT' ? 130 : 143
      process.stderr.write(t('播放已停止。\n', 'Playback stopped.\n'))
      return print({ status: 'stopped', player, source, signal, exitCode: process.exitCode })
    }
    if (result.code !== 0)
      throw new Error(
        t(
          `播放器未能完成播放（退出码 ${result.code ?? result.signal}）。`,
          `The player could not complete playback (exit ${result.code ?? result.signal}).`,
        ),
      )
    process.stderr.write(t('播放器已完成播放。\n', 'The player completed playback.\n'))
    return print({ status: 'completed', player, source, exitCode: 0 })
  } catch (error) {
    if (interrupted) {
      process.exitCode = interrupted === 'SIGINT' ? 130 : 143
      process.stderr.write(t('播放已停止。\n', 'Playback stopped.\n'))
      return print({
        status: 'stopped',
        ...(player ? { player } : {}),
        ...(source ? { source } : {}),
        signal: interrupted,
        exitCode: process.exitCode,
      })
    }
    const message = redact(formatError(error))
    print({
      status: 'error',
      ...(player ? { player } : {}),
      ...(source ? { source } : {}),
      error: message,
      exitCode: 1,
    })
    throw new Error(message, { cause: error })
  } finally {
    clearTimeout(forceStop)
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', terminate)
    // The child close event is awaited above; never remove a file while a player uses it.
    if (directory) await rm(directory, { recursive: true, force: true })
  }
}
