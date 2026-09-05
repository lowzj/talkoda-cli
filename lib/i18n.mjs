/** Language affects messages only; API and result field names remain stable. */
export function detectLanguage(environment = process.env, systemLocale) {
  const locale =
    environment.LC_ALL ||
    environment.LC_MESSAGES ||
    environment.LANG ||
    systemLocale ||
    Intl.DateTimeFormat().resolvedOptions().locale
  return /^zh(?:[-_.@]|$)/i.test(locale) ? 'zh' : 'en'
}

let language = detectLanguage()

export function setLanguage(value) {
  if (value !== undefined && !['en', 'zh'].includes(value))
    throw new Error(t('--lang 必须是 en 或 zh。', '--lang must be en or zh.'))
  language = value || detectLanguage()
  return language
}

export function getLanguage() {
  return language
}

export function t(zh, en) {
  return language === 'zh' ? zh : en
}

export function formatError(error) {
  const descriptions = {
    ENOENT: t('文件或目录不存在', 'File or directory does not exist'),
    EEXIST: t(
      '文件或目录已存在，请使用新的输出路径',
      'File or directory already exists; choose a new output path',
    ),
    EACCES: t('没有访问文件或目录的权限', 'Permission denied for file or directory'),
    EISDIR: t('此路径是目录，请提供文件', 'This path is a directory; provide a file'),
    ERR_PARSE_ARGS_UNKNOWN_OPTION: t(
      '未知选项，请运行 talkoda --help。',
      'Unknown option; run talkoda --help.',
    ),
    ERR_PARSE_ARGS_INVALID_OPTION_VALUE: t(
      '选项值无效或缺失，请运行 talkoda --help。',
      'Invalid or missing option value; run talkoda --help.',
    ),
  }
  return descriptions[error.code]
    ? `${descriptions[error.code]}${error.path ? `: ${error.path}` : ''}`
    : error.message
}
