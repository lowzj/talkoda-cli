import { access, mkdtemp, open, readFile, rm, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { dirname, extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { Mp3Encoder } from '@breezystack/lamejs'
import { TextDecoder } from 'node:util'

const require = createRequire(import.meta.url)
const offlineOrigin = 'https://render.talkoda.invalid'

async function browserPath(explicit) {
  if (explicit || process.env.TALKODA_BROWSER) {
    const path = resolve(explicit || process.env.TALKODA_BROWSER)
    await access(path, constants.X_OK)
    return path
  }
  const candidates = [
    chromium.executablePath(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    ...(process.platform === 'win32'
      ? [
          join(
            process.env.PROGRAMFILES || 'C:\\Program Files',
            'Google/Chrome/Application/chrome.exe',
          ),
          join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : []),
  ]
  for (const path of candidates) {
    if (
      await access(path, constants.X_OK).then(
        () => true,
        () => false,
      )
    )
      return path
  }
  return null
}

export async function rendererStatus(explicit) {
  const executable = await browserPath(explicit)
  return {
    available: Boolean(executable),
    executable,
    engine: '@strudel/web@1.3.0',
    format: 'MP3 48 kHz stereo 192 kbps',
    network: 'external HTTP and WebSocket requests blocked',
    ...(executable
      ? {}
      : {
          next: '运行 talkoda render setup 安装 Chromium。Linux 还需满足 Playwright 浏览器系统依赖。',
        }),
  }
}

export async function setupRenderer() {
  await new Promise((done, reject) => {
    const child = spawn(
      process.execPath,
      [join(dirname(require.resolve('playwright/package.json')), 'cli.js'), 'install', 'chromium'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    child.stdout.on('data', (chunk) => process.stderr.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0
        ? done()
        : reject(new Error('Chromium 安装失败，请检查网络和 Playwright 系统依赖。')),
    )
  })
  return rendererStatus()
}

function pcmFromWav(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('Strudel 未返回有效 WAV。')
  let format, data
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4),
      size = bytes.readUInt32LE(offset + 4),
      begin = offset + 8
    if (begin + size > bytes.length) throw new Error('WAV 数据不完整。')
    if (name === 'fmt ' && size >= 16)
      format = {
        type: bytes.readUInt16LE(begin),
        channels: bytes.readUInt16LE(begin + 2),
        sampleRate: bytes.readUInt32LE(begin + 4),
        bits: bytes.readUInt16LE(begin + 14),
      }
    if (name === 'data') data = bytes.subarray(begin, begin + size)
    offset = begin + size + (size % 2)
  }
  if (
    !format ||
    !data ||
    format.type !== 1 ||
    format.channels !== 2 ||
    format.bits !== 16 ||
    format.sampleRate !== 48000
  )
    throw new Error('渲染结果必须是 48 kHz 双声道 16-bit PCM。')
  return { data, frames: data.length / 4, sampleRate: format.sampleRate }
}

export async function renderAudio(flags) {
  if (!flags.source || !flags.output || !flags.bpm || !flags.cycles)
    throw new Error('使用 render --source FILE --output FILE.mp3 --bpm N --cycles N。')
  const bpm = Number(flags.bpm),
    cycles = Number(flags.cycles),
    seconds = (cycles * 240) / bpm
  if (
    !Number.isInteger(bpm) ||
    bpm < 20 ||
    bpm > 300 ||
    !Number.isInteger(cycles) ||
    cycles < 1 ||
    seconds > 300
  )
    throw new Error('渲染要求 20–300 BPM、正整数 cycles，4/4 总时长不超过 5 分钟。')
  const sourcePath = resolve(flags.source),
    output = resolve(flags.output)
  if (extname(output).toLowerCase() !== '.mp3') throw new Error('渲染输出使用 .mp3 扩展名。')
  const sourceInfo = await stat(sourcePath)
  if (!sourceInfo.isFile() || !sourceInfo.size || sourceInfo.size > 128 * 1024)
    throw new Error('Strudel 源码需为 1 B–128 KB 的文本文件。')
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(sourcePath))
  const executable = await browserPath(flags.browser)
  if (!executable) throw new Error('未找到 Chrome/Chromium，请先运行 talkoda render setup。')
  // Reserve the output before expensive work; the handle avoids following a later symlink.
  const target = await open(output, 'wx', 0o600)
  let browser,
    timer,
    temporary,
    success = false
  try {
    temporary = await mkdtemp(join(tmpdir(), 'talkoda-render-'))
    const enginePath = join(dirname(require.resolve('@strudel/web/package.json')), 'dist/index.mjs')
    const engine = await readFile(enginePath)
    const environment = Object.fromEntries(
      ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG']
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    )
    browser = await chromium.launch({
      executablePath: executable,
      headless: true,
      env: environment,
      chromiumSandbox: true,
      timeout: 30000,
    })
    const context = await browser.newContext({
      acceptDownloads: true,
      serviceWorkers: 'block',
    })
    // HTTP routing alone cannot intercept STUN/QUIC traffic. Keep these capabilities
    // unavailable in every window/frame, including worker-based escape routes.
    // AudioWorklet remains available for Strudel's built-in synthesis.
    await context.addInitScript(() => {
      for (const name of [
        'RTCPeerConnection',
        'webkitRTCPeerConnection',
        'WebTransport',
        'Worker',
        'SharedWorker',
      ]) {
        Object.defineProperty(window, name, {
          value: undefined,
          writable: false,
          configurable: false,
        })
      }
    })
    let blockedRequests = 0
    await context.route('**/*', async (route) => {
      const request = route.request()
      if (request.method() === 'GET' && request.url() === `${offlineOrigin}/`) {
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><meta charset="utf-8"><title>Talkoda offline audio renderer</title><body></body>',
        })
      }
      if (request.method() === 'GET' && request.url() === `${offlineOrigin}/engine.mjs`)
        return route.fulfill({ contentType: 'text/javascript', body: engine })
      blockedRequests++
      await route.abort('blockedbyclient')
    })
    await context.routeWebSocket('**/*', (socket) => {
      blockedRequests++
      socket.close()
    })
    const page = await context.newPage()
    await page.goto(offlineOrigin)
    const problems = []
    page.on('console', (message) => {
      if (message.type() === 'error' || /\] error:/i.test(message.text()))
        problems.push(message.text())
    })
    page.on('pageerror', (error) => problems.push(error.message))
    const download = page.waitForEvent('download', { timeout: 120000 })
    // Attach a rejection handler before evaluating source that might fail before a download.
    download.catch(() => {})
    const work = page.evaluate(
      async ({ code, bpm, cycles }) => {
        const engine = await import('/engine.mjs')
        let compileError = ''
        const repl = await engine.initStrudel({
          miniAllStrings: false,
          sync: false,
          onEvalError: (error) => {
            compileError = error.message
          },
        })
        repl.setCps(bpm / 240)
        const pattern = await repl.evaluate(code, false)
        if (!pattern) throw new Error(`Strudel 编译失败：${compileError}`)
        if (Math.abs(repl.scheduler.cps - bpm / 240) > 0.000001)
          throw new Error('源码的 setcps/setcpm 与 --bpm 不一致，请同步修改。')
        const events = pattern
          .queryArc(0, cycles, { _cps: bpm / 240 })
          .filter((event) => event.hasOnset())
        if (!events.length || events.length > 50000)
          throw new Error('作品必须包含 1–50000 个音符事件。')
        const sounds = [
          ...new Set(
            events.map((event) => {
              event.ensureObjectValue()
              return event.value.s || 'sine'
            }),
          ),
        ]
        const supported = [
          'sine',
          'triangle',
          'sawtooth',
          'square',
          'pink',
          'white',
          'brown',
          'crackle',
        ]
        if (sounds.some((sound) => !supported.includes(sound)))
          throw new Error(
            `离线渲染仅支持内置合成器；请替换这些声音：${sounds.filter((sound) => !supported.includes(sound)).join(', ')}`,
          )
        await engine.renderPatternAudio(pattern, bpm / 240, 0, cycles, 48000, 512, false, 'talkoda')
        return { events: events.length, sounds }
      },
      { code: source, bpm, cycles },
    )
    const completed = await Promise.race([
      work,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('渲染超过 120 秒，已停止。请简化声部或缩短编曲。')),
          120000,
        )
      }),
    ])
    const file = await download
    if (await file.failure()) throw new Error('WAV 导出失败。')
    const wavPath = join(temporary, 'render.wav')
    await file.saveAs(wavPath)
    if (blockedRequests)
      throw new Error('源码尝试访问网络；离线渲染仅使用内置合成器，请移除外部资源。')
    if (problems.length) throw new Error(`Strudel 渲染存在错误：${problems[0].slice(0, 250)}`)
    if ((await stat(wavPath)).size > 60 * 1024 * 1024) throw new Error('渲染文件超出限制。')
    const pcm = pcmFromWav(await readFile(wavPath))
    if (Math.abs(pcm.frames / pcm.sampleRate - seconds) > 0.05)
      throw new Error('渲染时长与计划不匹配。')
    let peak = 0,
      energy = 0
    for (let i = 0; i < pcm.data.length; i += 2) {
      const value = pcm.data.readInt16LE(i) / 32768
      peak = Math.max(peak, Math.abs(value))
      energy += value * value
    }
    if (peak < 0.0001) throw new Error('渲染结果接近静音，请检查音符和声音名称。')
    if (peak >= 0.999) throw new Error('合成音频接近满幅，请降低各声部 gain 后重新渲染。')
    const gain = Math.min(8, Math.pow(10, -1.5 / 20) / peak)
    const encoder = new Mp3Encoder(2, 48000, 192),
      chunks = []
    for (let start = 0; start < pcm.frames; start += 1152) {
      const length = Math.min(1152, pcm.frames - start),
        left = new Int16Array(length),
        right = new Int16Array(length)
      for (let i = 0; i < length; i++) {
        const frame = start + i,
          fade = Math.min(
            1,
            frame / 240,
            (pcm.frames - frame - 1) / Math.min(48000, pcm.frames / 8),
          )
        left[i] = Math.round(pcm.data.readInt16LE(frame * 4) * gain * fade)
        right[i] = Math.round(pcm.data.readInt16LE(frame * 4 + 2) * gain * fade)
      }
      chunks.push(Buffer.from(encoder.encodeBuffer(left, right)))
    }
    chunks.push(Buffer.from(encoder.flush()))
    const mp3 = Buffer.concat(chunks)
    if (mp3.length > 16 * 1024 * 1024) throw new Error('MP3 超出 Talkoda 的 16 MB 上限。')
    await target.writeFile(mp3)
    await target.sync()
    success = true
    return {
      output,
      bytes: mp3.length,
      bpm,
      cycles,
      durationSeconds: seconds,
      engineVersion: '1.3.0',
      sourceHash: createHash('sha256').update(source).digest('hex'),
      audioHash: createHash('sha256').update(mp3).digest('hex'),
      ...completed,
      sourcePeak: peak,
      sourceRms: Math.sqrt(energy / (pcm.data.length / 2)),
      gain,
      offline: true,
    }
  } finally {
    clearTimeout(timer)
    if (browser) await browser.close().catch(() => {})
    await target.close()
    if (!success) await rm(output, { force: true })
    if (temporary) await rm(temporary, { recursive: true, force: true })
  }
}
