import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseFile } from 'music-metadata'
import { skillLocation } from '../lib/creative.mjs'

const executable = resolve('bin/talkoda.mjs')
let directory: string
async function run(args: string[]) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, reject) => {
    const child = spawn(process.execPath, [executable, ...args, '--json'], {
      cwd: directory,
      // Creative commands must work without opening or validating account credentials.
      env: {
        ...process.env,
        TALKODA_API_TOKEN: 'not-a-valid-token',
        TALKODA_CONFIG_FILE: join(directory, 'invalid-config.json'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', (code) => done({ code, stdout, stderr }))
  })
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'talkoda-creative-test-'))
  await writeFile(join(directory, 'invalid-config.json'), 'this is deliberately not valid JSON')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('portable agent workflow', () => {
  it('respects custom pi and OpenCode user directories without changing project locations', () => {
    const paths = {
      userDirectory: '/test-user',
      workingDirectory: '/workspace',
      environment: { PI_CODING_AGENT_DIR: '~/custom-pi', XDG_CONFIG_HOME: '/custom-xdg' },
    }
    expect(skillLocation('pi', 'user', paths)).toBe('/test-user/custom-pi/skills/talkoda')
    expect(skillLocation('opencode', 'user', paths)).toBe('/custom-xdg/opencode/skills/talkoda')
    expect(skillLocation('pi', 'project', paths)).toBe('/workspace/.pi/skills/talkoda')
    expect(
      skillLocation('pi', 'user', { ...paths, environment: { PI_CODING_AGENT_DIR: 'custom-pi' } }),
    ).toBe('/workspace/custom-pi/skills/talkoda')
  })
  it.each([
    ['codex', '.agents/skills/talkoda'],
    ['claude', '.claude/skills/talkoda'],
    ['pi', '.pi/skills/talkoda'],
    ['opencode', '.opencode/skills/talkoda'],
  ])(
    'installs a complete project skill for %s without replacing user edits by default',
    async (agent, path) => {
      const installed = await run(['skills', 'install', '--agent', agent, '--scope', 'project'])
      expect(installed.code, installed.stderr).toBe(0)
      const skillFile = join(directory, path, 'SKILL.md')
      expect(await readFile(skillFile, 'utf8')).toContain('name: talkoda')
      expect(await readFile(join(directory, path, 'references/music.md'), 'utf8')).toContain(
        'Strudel',
      )
      await writeFile(skillFile, 'user edit')
      expect((await run(['skills', 'install', '--agent', agent, '--scope', 'project'])).code).toBe(
        1,
      )
      expect(await readFile(skillFile, 'utf8')).toBe('user edit')
      expect(
        (await run(['skills', 'install', '--agent', agent, '--scope', 'project', '--force'])).code,
      ).toBe(0)
    },
  )
  it('keeps the selected transcript private and prepares an editable, local-only workspace', async () => {
    const transcript = 'User: Our first attempt failed.\nAssistant: Simplify, then try again.\n'
    await writeFile(join(directory, 'chat.md'), transcript)
    const result = await run([
      'compose',
      'init',
      '--conversation',
      'chat.md',
      '--output',
      'song',
      '--bpm',
      '120',
      '--cycles',
      '8',
    ])
    expect(result.code, result.stderr).toBe(0)
    expect(result.stdout).not.toContain(transcript)
    expect(await readFile(join(directory, 'song/.private/conversation.txt'), 'utf8')).toBe(
      transcript,
    )
    expect((await stat(join(directory, 'song/.private/conversation.txt'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(directory, 'song/.gitignore'), 'utf8')).toContain('.private/')
    expect(await readFile(join(directory, 'song/story.md'), 'utf8')).toBe('')
    expect(JSON.parse(await readFile(join(directory, 'song/song.json'), 'utf8'))).toMatchObject({
      bpm: 120,
      cycles: 8,
    })
    expect(
      (await run(['compose', 'init', '--conversation', 'chat.md', '--output', 'song'])).code,
    ).toBe(1)
    expect(
      (
        await run([
          'compose',
          'init',
          '--conversation',
          'chat.md',
          '--output',
          'too-long',
          '--bpm',
          '20',
          '--cycles',
          '64',
        ])
      ).code,
    ).toBe(1)
  })
  it('does not follow transcript symlinks or install through an existing skill symlink', async () => {
    await writeFile(join(directory, 'chat.md'), 'A conversation')
    await symlink(join(directory, 'chat.md'), join(directory, 'linked.md'))
    expect(
      (await run(['compose', 'init', '--conversation', 'linked.md', '--output', 'song'])).code,
    ).toBe(1)
    expect(
      (await run(['skills', 'install', '--agent', 'constructor', '--scope', 'project'])).code,
    ).toBe(1)
  })
})

describe('offline Strudel renderer', () => {
  it('does not expose UDP-capable browser APIs or general-purpose workers to the score', async () => {
    await writeFile(
      join(directory, 'isolated.js'),
      `for (const key of ['RTCPeerConnection','webkitRTCPeerConnection','WebTransport','Worker','SharedWorker']) { if (window[key] !== undefined) throw new Error('network primitive exposed') }\nnote('c4').s('sine').gain(.2)`,
    )
    const result = await run([
      'render',
      '--source',
      'isolated.js',
      '--output',
      'isolated.mp3',
      '--bpm',
      '120',
      '--cycles',
      '1',
    ])
    expect(result.code, result.stderr).toBe(0)
  }, 60000)
  it('renders actual stereo MP3 and checks tempo, non-silent audio and source identity', async () => {
    await writeFile(
      join(directory, 'score.js'),
      `setcps(120/60/4)\nstack(note("c4 e4 g4 b4").s("sine").gain(.22).room(.1), s("white*8").hpf(7000).decay(.02).sustain(0).gain(.02))`,
    )
    const rendered = await run([
      'render',
      '--source',
      'score.js',
      '--output',
      'song.mp3',
      '--bpm',
      '120',
      '--cycles',
      '2',
    ])
    expect(rendered.code, rendered.stderr).toBe(0)
    const result = JSON.parse(rendered.stdout)
    expect(result).toMatchObject({
      durationSeconds: 4,
      engineVersion: '1.3.0',
      offline: true,
    })
    expect(result.sourceRms).toBeGreaterThan(0)
    expect(result.sourceHash).toHaveLength(64)
    const metadata = await parseFile(join(directory, 'song.mp3'))
    expect(metadata.format.sampleRate).toBe(48000)
    expect(metadata.format.numberOfChannels).toBe(2)
    expect(metadata.format.duration).toBeCloseTo(4, 0)
    expect(
      (
        await run([
          'render',
          '--source',
          'score.js',
          '--output',
          'song.mp3',
          '--bpm',
          '120',
          '--cycles',
          '2',
        ])
      ).code,
    ).toBe(1)
  }, 60000)
  it.each([
    ['tempo', 'setcps(90/240); note("c4").s("sine")', '不一致'],
    ['sample', 's("bd*4")', '内置合成器'],
    ['silent', 'silence', '音符事件'],
    [
      'network',
      "fetch('https://example.invalid/blocked').catch(()=>{}); note('c4').s('sine')",
      '网络',
    ],
    ['syntax', 'unknownFunction()', '编译失败'],
  ])(
    'rejects %s problems and cleans up incomplete output',
    async (_name, source, message) => {
      await writeFile(join(directory, 'bad.js'), source)
      const result = await run([
        'render',
        '--source',
        'bad.js',
        '--output',
        'bad.mp3',
        '--bpm',
        '120',
        '--cycles',
        '1',
      ])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain(message)
      await expect(stat(join(directory, 'bad.mp3'))).rejects.toMatchObject({
        code: 'ENOENT',
      })
    },
    60000,
  )
})
