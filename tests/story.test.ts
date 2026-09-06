import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const executable = resolve('bin/talkoda.mjs')
let directory: string
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'talkoda-story-test-')))
  await writeFile(join(directory, 'invalid-config.json'), 'not json')
})
afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})
function run(args: string[], lang = 'en') {
  return spawnSync(process.execPath, [executable, ...args, '--json', '--lang', lang], {
    cwd: directory,
    encoding: 'utf8',
    env: {
      ...process.env,
      TALKODA_HOME: join(directory, 'data'),
      TALKODA_CONFIG_FILE: join(directory, 'invalid-config.json'),
      TALKODA_API_TOKEN: 'invalid',
      TALKODA_API_URL: 'not-an-api-origin',
    },
  })
}

describe('offline story preflight', () => {
  it('checks the default file using API counting without touching credentials or contents', async () => {
    const text = ' \n母题\r\n🎵 \n'
    const file = join(directory, 'story.md')
    await writeFile(file, text)
    const result = run(['story', 'check'])
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      file,
      characters: 6,
      target: 1200,
      max: 2000,
      unit: 'utf16',
      withinTarget: true,
      valid: true,
    })
    expect(await readFile(file, 'utf8')).toBe(text)
  })

  it('distinguishes the soft writing target from the accepted hard boundary', async () => {
    for (const characters of [0, 1200, 1201, 2000]) {
      await writeFile(join(directory, 'custom-story.txt'), ` \n${'文'.repeat(characters)}\r\n `)
      const result = run(['story', 'check', 'custom-story.txt'])
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({
        characters,
        valid: true,
        withinTarget: characters <= 1200,
      })
    }
  })

  it.each(['en', 'zh'])(
    'rejects oversized emoji text with useful %s counts and no truncation',
    async (lang) => {
      const text = '🎵'.repeat(1000) + 'x'
      const file = join(directory, 'story.md')
      await writeFile(file, text)
      const result = run(['story', 'check'], lang)
      expect(result.status).toBe(1)
      expect(JSON.parse(result.stdout)).toMatchObject({
        characters: 2001,
        max: 2000,
        target: 1200,
        valid: false,
      })
      for (const value of ['2001', '2000', '1200']) expect(result.stderr).toContain(value)
      expect(result.stderr).not.toContain(text)
      expect(await readFile(file, 'utf8')).toBe(text)
    },
  )

  it('fails missing files instead of reporting an empty valid story', () => {
    const result = run(['story', 'check', 'missing.md'])
    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('does not exist')
  })

  it.each(['en', 'zh'])(
    'carries the story budget and preflight command into new %s composition briefs',
    async (lang) => {
      await writeFile(
        join(directory, 'conversation.md'),
        'A synthetic conversation for the composition brief.',
      )
      const result = run(['compose', 'init', '--conversation', 'conversation.md'], lang)
      expect(result.status, result.stderr).toBe(0)
      const brief = await readFile(JSON.parse(result.stdout).brief, 'utf8')
      for (const value of ['1200', '2000', 'UTF-16', 'talkoda story check story.md'])
        expect(brief).toContain(value)
    },
  )
})
