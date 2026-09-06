# Talkoda CLI 中文文档

[English](README.en.md) · [官网快速开始](https://talkoda.com/docs)

发音：**/tɔːˈkoʊdə/**（taw-KOH-duh）。

**把对话，谱成歌。** Create conversation-inspired music and publish it on [Talkoda](https://talkoda.com).

这是独立的 CLI 与 Agent Skill 仓库，包含命令行、技能、通用示例和测试。网站后端、数据库、账号凭证和原始会话不在本仓库中。

Codex、Claude Code、pi 或 OpenCode 负责理解指定会话并创作原创 Strudel；CLI 准备本地工作区、渲染真实 MP3、上传和管理作品。CLI 无需额外的 LLM API Key，也不会读取其他工具的会话数据库。

## 安装

需要 Node.js 22.12+，推荐 Node.js 24。

```sh
npm install --global https://talkoda.com/cli/talkoda-cli-0.4.1.tgz
talkoda --version
```

也可以只克隆这个公开仓库：

```sh
git clone https://github.com/lowzj/talkoda-cli.git
cd talkoda-cli
npm ci
npm install --global .
```

## 接入 AI 编程工具

为你使用的工具安装同一份技能：

| 工具        | 安装命令                                  | 默认用户目录                         |
| ----------- | ----------------------------------------- | ------------------------------------ |
| Codex       | `talkoda skills install --agent codex`    | `~/.agents/skills/talkoda/`          |
| Claude Code | `talkoda skills install --agent claude`   | `~/.claude/skills/talkoda/`          |
| pi          | `talkoda skills install --agent pi`       | `~/.pi/agent/skills/talkoda/`        |
| OpenCode    | `talkoda skills install --agent opencode` | `~/.config/opencode/skills/talkoda/` |

添加 `--scope project` 可安装到当前项目；默认保留已有技能，明确加 `--force` 才更新。安装后重新加载技能或开启新会话。

用户级安装也支持 pi 的 `PI_CODING_AGENT_DIR` 和 OpenCode 的 `XDG_CONFIG_HOME`；项目级安装保持使用项目目录。

随后告诉 AI：

> 使用 talkoda 技能，根据当前会话创作一首约两分钟的原创 Strudel 器乐曲，把讨论中的转折变成音乐段落，渲染音频，并上传到我的 Talkoda 账号公开发布。原始会话保持私密。

也可以指定文件或可访问的会话链接：

> 使用 talkoda 技能，读取 ./conversation.md，根据这段会话创作音乐并发布到 Talkoda。风格偏温暖的 Lo-fi，保留一次明显的情绪转折。

Codex 可显式使用 `$talkoda`；Claude Code 使用 `/talkoda`；pi 使用 `/skill:talkoda`；OpenCode 可以直接要求 Agent 加载 `talkoda` 技能。不能读取跨工具会话链接时，提供该会话的导出文件。没有技能发现功能的工具可读取 `talkoda skills show`。

安装路径依据：[Codex](https://learn.chatgpt.com/docs/customization/overview#skills)、[Claude Code](https://code.claude.com/docs/en/skills)、[pi](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md)、[OpenCode](https://opencode.ai/docs/skills/)。

## 本地创作与渲染

```sh
talkoda compose init --conversation ./conversation.md --name my-song --bpm 108 --cycles 64
```

`--output` 可以省略：默认根目录为 `~/.talkoda`，每首新作品创建独立的 `~/.talkoda/songs/{name}`。目录名优先使用 `--name`，其次是 `--title`，最后是会话文件名；重名时依次使用 `name-2`、`name-3`，不会覆盖已有作品。明确指定 `--output PATH` 时保持原行为，目标目录必须尚不存在。

始终使用返回 JSON 中的 `directory`（可能有重名后缀）。以下以首次创建 `my-song` 为例：

```sh
cd ~/.talkoda/songs/my-song
```

由 AI 阅读返回目录内的 `BRIEF.md` 后完成作曲：

```text
~/.talkoda/songs/my-song/
  .private/conversation.txt   本地素材，Git 忽略，权限 0600
  .gitignore
  BRIEF.md                   给当前 AI 的创作任务
  song.json                  曲名、BPM、生成来源、可见性、标签和文件名
  song.strudel.js             由 AI 重写的原创曲谱
  story.md                   由 AI 撰写的公开简介
```

`compose init` 不调用模型，示例曲谱也不是成品。它也接受 `--agent`、`--model`、`--tokens`、`--tags`、`--source-visibility`、`--prompt-visibility`、`--copyright-notice`，把明确提供的值记录在 `song.json`。未知的 Agent、模型、Token 使用量保持 `null`，不得用猜测或示例值冒充实际用量。显式提供的 `--prompt` / `--prompt-file` 另存为 `.private/prompt.txt`，`song.json` 仅保存路径；不会从原始会话自动提取上传提示词。对于 AI 已经读取的原生会话，可先在本地写一份创作摘要，再把该文件作为 `--conversation` 输入。

```sh
talkoda render doctor
talkoda render --source ./song.strudel.js --output ./song.mp3 --bpm 108 --cycles 64
```

渲染使用官方 `@strudel/web@1.3.0`，在独立的 Chromium 进程和临时上下文中运行；不使用你的浏览器配置、Cookie 或 Talkoda Token，拦截外部 HTTP/WebSocket 请求。WebRTC、WebTransport 和通用 Worker 在每个窗口/子框架中不可用，保留合成所需的 AudioWorklet。首版支持 `sine`、`triangle`、`sawtooth`、`square`、`pink`、`white`、`brown`、`crackle` 内置声音，可用振荡器和噪声制作鼓组。外部采样库、音色库和人声演唱不在该离线渲染器范围内。

使用恒定速度和 4/4 拍，源码的 `setcps(BPM / 60 / 4)` 与 `--bpm` 一致。从 cycle 0 渲染到指定 cycles，最长 5 分钟。CLI 检查编译、节奏、音符事件、近静音和接近满幅的 PCM，再输出 48 kHz 双声道、192 kbps 的 MP3，调整音量并加短淡出。JSON 结果包含时长、声音、事件数及源码/音频 SHA-256。

未找到 Chrome/Chromium 时运行 `talkoda render setup` 下载 Chromium。已有系统 Chrome 会自动检测，也可使用 `--browser PATH` 或 `TALKODA_BROWSER`。Linux 可能需要 [Playwright 系统依赖](https://playwright.dev/docs/browsers#install-system-dependencies)；从仓库运行 `npx playwright install --with-deps chromium` 安装。保留浏览器沙箱，CLI 不提供关闭沙箱的开关。

Ubuntu 等启用 AppArmor 限制的系统，优先使用系统安装的 Google Chrome；CLI 在 Linux 上会优先检测它。下载版 Chromium 可能需要额外的沙箱配置，详见 [Chromium 官方说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md)。

只渲染你在当前任务中编写或审阅过的源码。临时渲染上下文并不是任意恶意 JavaScript 的通用安全沙箱；源码不会在已登录的 Talkoda 网站或 Node.js 中执行。

## 故事简介长度

`story.md` 会通过 `--summary-file` 上传为作品 `summary`。**默认目标 1200 字符以内，硬上限 2000**；无需凑字数，较短也可以。保留母题、关键转折和音乐映射，长篇创作笔记可另存本地文件。

```sh
talkoda story check ./story.md
```

此命令无需登录，不发送网络请求，也不改写文件；省略文件名时检查当前目录的 `story.md`。计数与服务端一致，等于 `Array.from(text.trim()).length`：去掉首尾空白后按 Unicode 码点计数，内部空格、换行和标点都计入，组合 emoji 可能占多个码点。不要用词数、文件字节数或肉眼估算代替检查。

JSON 显示 `characters`、默认 `target: 1200`、`max: 2000`、`unit: "unicode-code-points"`、`withinTarget` 和 `valid`。超过目标但未超过 2000 仍可提交（退出码 0）；超过 2000 则退出码 1。超限时一次压缩回约 1200 字符后重新检查，避免反复试探 2000 的边界。

CLI 在创建、更新和新建/续传上传请求前，也会自动检查 `--summary` / `--summary-file`。超限会显示实际长度并停止，不创建草稿、不修改作品、不静默截断正文。省略 summary 保留原值，明确传空字符串可清除。这里的限制只适用于公开 story/summary，原始会话和 prompt 沿用各自的限制。

## 终端播放

```sh
talkoda play doctor
talkoda play ./song.mp3
talkoda play --track TRACK_ID
talkoda play ./song.mp3 --player ffplay
```

本地支持 MP3、M4A、WAV；不会把 Strudel 源码当音频执行。macOS 优先使用系统自带的 `afplay`，其次 `ffplay`、`mpv`；其他系统优先 `ffplay`、`mpv`。`play doctor` 显示检测结果；没有可用播放器时，安装 FFmpeg（包含 ffplay）或 mpv，再运行该命令。程序从当前 PATH 检测播放器，不自动安装系统软件。

播放在当前终端等待结束，按 Ctrl-C 停止。声音通过当前运行机器的音频设备输出；SSH、容器或无声卡环境不保证能在你电脑上听到。返回成功表示播放器进程正常完成，不代表 Agent 已具备听觉或审听了作品。

`--track` 经 Talkoda API 下载当前身份可访问的音频，在 `~/.talkoda/cache` 的独立私密临时目录中播放，结束、中止或失败后清理。私有作品仍需自己的有效 Token；Token 不进入播放器参数、URL 或子进程环境。CLI 不接受任意远程音频 URL，也不通过浏览器绕过作品权限。

本命令不自动上报播放次数：启动外部播放器或进程经过时间不能可靠证明实际收听进度。网站播放与有真实进度回执的 `tracks record-play` 接口仍按既有规则计数。

渲染临时文件也使用 `~/.talkoda/cache` 并在结束后清理。下载的 Chrome/Chromium 由 Playwright 管理其自身缓存目录；Agent 技能仍安装在各工具规定的位置。

## 登录与发布

每个人在[自己的 Talkoda 账号](https://talkoda.com/settings/tokens)创建 API Token，然后登录：

```sh
talkoda auth login
talkoda auth status
talkoda tracks upload --title '作品标题' --summary-file ./story.md --genre '电子' --cover blue --bpm 108 --engine-version 1.3.0 --source ./song.strudel.js --audio ./song.mp3 --publish
```

Token 输入不回显，按 origin 保存在 `~/.talkoda/config.json`（POSIX 权限 0600）。默认根目录为 `~/.talkoda`；`TALKODA_HOME` 可改变根目录，`TALKODA_CONFIG_FILE` 单独覆盖配置文件位置。首次读取默认配置时，如果新文件不存在，会从旧 `~/.config/talkoda/config.json`（或旧 `XDG_CONFIG_HOME` 路径）安全迁移；原文件保留，新文件始终优先。显式设置新根目录或配置路径时不自动导入旧配置。不要共享这个文件或将 Token 粘贴给 AI。自动化可以使用 `--token-file FILE`、`--token-stdin` 或外部注入的 `TALKODA_API_TOKEN`；`TALKODA_CONFIG_FILE` 可选择独立配置。

省略 `--publish` 时保存草稿。上传命令只发送明确指定的源码、音频和公开资料，不上传原始会话或整个工作区。只要求本地创作并不授权公开发布。

CLI 默认根据系统 locale（`LC_ALL`、`LC_MESSAGES`、`LANG`，否则系统区域设置）选择中文或英文；使用 `--lang zh` / `--lang en` 覆盖。帮助、本地错误和进度使用所选语言，HTTP 请求也发送 `Accept-Language`，由 API 返回对应语言的错误。JSON 字段名与枚举值保持不变。

结果为 JSON，`--json` 输出紧凑 JSON；进度/错误在 stderr，通常退出码为 0/1，播放时 Ctrl-C 中止为 130。API 使用 Bearer，HTTPS 传输（本地回环开发除外），拒绝重定向。`--url` / `TALKODA_API_URL` 指定其他服务器时，不会复用另一 origin 的已保存凭证。

## 作品来源、提示词与社区资料

```sh
talkoda tracks create --title '夜航' --agent codex --source-visibility private --tags 'ambient,夜色'
talkoda tracks update TRACK_ID --model '实际使用的模型名称' --tokens 1234
talkoda tracks update TRACK_ID --prompt-file ./approved-prompt.txt --prompt-visibility private
talkoda tracks update TRACK_ID --copyright-notice '填写你有权作出的版权声明'
talkoda tracks list --tag ambient --query '夜航'
talkoda tags list --query amb
talkoda tracks share TRACK_ID
```

模型名称和 `1234` 仅展示命令格式；仅在宿主提供可核实的信息时填写实际值。`agent`、`model` 和 `tokenCount` 描述创作来源；上传渠道与当时已验证的 Token 信息由服务端自动记录，不能通过 CLI 伪造。`uploadSource` 仅在作者自己的响应中出现，只包含渠道及 Token 的 ID、名称、前缀等标识，绝不包含原始 Token。

源码默认公开，`--source-visibility private` 可以改为私密。访问者能否查看/下载由 API 的 `canReadSource` 和媒体权限决定，CLI 不绕过权限。提示词默认私密；只有用户明确选择公开提示词时，才使用 `--prompt-visibility public`。提供提示词表示上传该文本，即使设置为私密也会发送给服务器；原始会话仍只留本地，不应直接作为 `--prompt-file`。CLI 不会因为公开发布作品而自动公开提示词。

`--tags` 使用逗号分隔，空字符串清空标签；最多 10 个，每个不超过 32 字符，按 NFKC 规范化、移除开头 `#`、合并空白、转小写并去重。`--tag` 是单个完整标签的精确筛选，`--query` 也会搜索标签。Agent 最长 100 字符，模型 120 字符，提示词 16000 字符，版权声明 1000 字符。`--tokens` 接受非负安全整数或 `none`（清空）；未知用量保持空缺。空 `--agent` / `--model` / `--prompt` / `--copyright-notice` 可清空对应资料。清空自定义版权声明后使用站点默认说明：“作者保留依法享有的权利，公开收听和查看不构成转载/改编/商业使用许可”。这不保证所有 AI 输出均受著作权保护。

`tracks update` 和 `tracks upload --id` 只修改显式提供的字段，其他字段保持原值。`tracks get` 会原样输出 API 返回的权限与元数据，包括 `hasPrompt`、`canReadPrompt`、`playCount`；不能阅读的提示词为 `null`。作品列表不含提示词正文。`tracks share` 仅返回作品 URL 和 X、Facebook、LinkedIn、WhatsApp、Telegram、微博分享链接，不打开浏览器或发帖；非公开作品的 `shareUrls` 为空。

实际播放器集成可以在播放满 5 秒后提交事件：

```sh
talkoda tracks record-play TRACK_ID --event-id 12345678-1234-4234-8234-123456789abc --seconds 5.25
```

上述 UUID 仅为格式示例；为每次实际播放生成 UUID，重试同一事件时复用该 UUID。此命令需要 Token；API 只统计公开作品，作者本人预览不计，同一账号/浏览器对同一作品 30 分钟内去重。结果是 `{ "counted": true|false, "playCount": N }`。下载、HEAD 和获取详情都不是播放事件，CLI 不会因此增加播放量。

## 管理与重试

`talkoda --help` 列出全部命令，涵盖作品、榜单、个人列表、媒体下载/HEAD/Range、喜欢收藏、资料、Token 与管理员隐藏。详见[命令与重试参考](../skills/talkoda/references/cli.md)。

上传失败时先检查返回的作品 ID。文件缺失时用 `tracks upload --id TRACK_ID` 重试；文件就绪则仅重试 `tracks publish TRACK_ID`。不要盲目创建重复草稿。已发布作品的音乐文件固定，下架重发也保留原发布时间。

## 默认目录

```text
~/.talkoda/
  config.json       按站点保存的登录凭证，权限 0600
  songs/
    my-song/        每首作品独立目录，重名自动加后缀
      .private/     本地会话与私密提示词
      BRIEF.md
      song.json
      song.strudel.js
      story.md
      song.mp3      渲染后生成
  cache/            播放/渲染临时文件，结束后清理
```

## 喜欢、收藏、榜单和版权

公开作品无需登录即可收听。喜欢参与七日新作榜，收藏仅自己可见，两者相互独立。源码和 prompt 公开权限独立控制；默认版权声明不授予转载、改编或商业使用权，作者可填写自己的许可。公开播放或源码可读不等于代码许可证自动适用于作品。

## 开发与许可

```sh
npm ci
npm run check
npm run pack:release
```

代码采用 [AGPL-3.0-only](../LICENSE)。Talkoda 不是 Strudel 官方服务；Strudel、Playwright 和编码器各遵循其许可证，用户作品与私密对话不自动适用 CLI 的代码许可。
