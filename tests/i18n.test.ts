import { describe, expect, it } from 'vitest'
import { detectLanguage } from '../lib/i18n.mjs'

describe('system language selection', () => {
  it('uses POSIX locale precedence and falls back to the system locale', () => {
    expect(detectLanguage({ LC_ALL: 'zh_TW.UTF-8', LANG: 'en_US.UTF-8' })).toBe('zh')
    expect(detectLanguage({ LC_MESSAGES: 'en_GB.UTF-8', LANG: 'zh_CN.UTF-8' })).toBe('en')
    expect(detectLanguage({ LANG: 'zh_CN.UTF-8' })).toBe('zh')
    expect(detectLanguage({ LANG: 'C' })).toBe('en')
    expect(detectLanguage({}, 'zh-Hans-CN')).toBe('zh')
    expect(detectLanguage({}, 'fr-FR')).toBe('en')
  })
})
