# Talkoda CLI

**把对话，谱成歌。** Create conversation-inspired music and publish it on [Talkoda](https://talkoda.com).

这是独立的 CLI 与 Agent Skill 仓库，包含命令行、技能、通用示例和测试。网站后端、数据库、账号凭证和原始会话不在本仓库中。

Codex、Claude Code、pi 或 OpenCode 负责理解指定会话并创作原创 Strudel；CLI 准备本地工作区、渲染真实 MP3、上传和管理作品。CLI 无需额外的 LLM API Key，也不会读取其他工具的会话数据库。

## 安装

需要 Node.js 22.12+，推荐 Node.js 24。

```sh
npm install --global https://github.com/lowzj/talkoda-cli/releases/download/v0.2.0/talkoda-cli-0.2.0.tgz
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
talkoda compose init --conversation ./conversation.md --output ./my-song --bpm 108 --cycles 64
```

该命令准备文件，由 AI 阅读 `BRIEF.md` 后完成作曲：

```text
my-song/
  .private/conversation.txt   本地素材，Git 忽略，权限 0600
  .gitignore
  BRIEF.md                   给当前 AI 的创作任务
  song.json                  曲名、BPM、cycles 和文件名
  song.strudel.js             由 AI 重写的原创曲谱
  story.md                   由 AI 撰写的公开简介
```

`compose init` 不调用模型，示例曲谱也不是成品。对于 AI 已经读取的原生会话，可先在本地写一份创作摘要，再把该文件作为 `--conversation` 输入。

```sh
talkoda render doctor
talkoda render --source ./my-song/song.strudel.js --output ./my-song/song.mp3 --bpm 108 --cycles 64
```

渲染使用官方 `@strudel/web@1.3.0`，在独立的 Chromium 进程和临时上下文中运行；不使用你的浏览器配置、Cookie 或 Talkoda Token，拦截外部 HTTP/WebSocket 请求。WebRTC、WebTransport 和通用 Worker 在每个窗口/子框架中不可用，保留合成所需的 AudioWorklet。首版支持 `sine`、`triangle`、`sawtooth`、`square`、`pink`、`white`、`brown`、`crackle` 内置声音，可用振荡器和噪声制作鼓组。外部采样库、音色库和人声演唱不在该离线渲染器范围内。

使用恒定速度和 4/4 拍，源码的 `setcps(BPM / 60 / 4)` 与 `--bpm` 一致。从 cycle 0 渲染到指定 cycles，最长 5 分钟。CLI 检查编译、节奏、音符事件、近静音和接近满幅的 PCM，再输出 48 kHz 双声道、192 kbps 的 MP3，调整音量并加短淡出。JSON 结果包含时长、声音、事件数及源码/音频 SHA-256。

未找到 Chrome/Chromium 时运行 `talkoda render setup` 下载 Chromium。已有系统 Chrome 会自动检测，也可使用 `--browser PATH` 或 `TALKODA_BROWSER`。Linux 可能需要 [Playwright 系统依赖](https://playwright.dev/docs/browsers#install-system-dependencies)；从仓库运行 `npx playwright install --with-deps chromium` 安装。保留浏览器沙箱，CLI 不提供关闭沙箱的开关。

只渲染你在当前任务中编写或审阅过的源码。临时渲染上下文并不是任意恶意 JavaScript 的通用安全沙箱；源码不会在已登录的 Talkoda 网站或 Node.js 中执行。

## 登录与发布

每个人在[自己的 Talkoda 账号](https://talkoda.com/settings/tokens)创建 API Token，然后登录：

```sh
talkoda auth login
talkoda auth status
talkoda tracks upload --title '作品标题' --summary-file ./my-song/story.md --genre '电子' --cover blue --bpm 108 --engine-version 1.3.0 --source ./my-song/song.strudel.js --audio ./my-song/song.mp3 --publish
```

Token 输入不回显，按 origin 保存在 `~/.config/talkoda/config.json`（POSIX 权限 0600，支持 `XDG_CONFIG_HOME`）。不要共享这个文件或将 Token 粘贴给 AI。自动化可以使用 `--token-file FILE`、`--token-stdin` 或外部注入的 `TALKODA_API_TOKEN`；`TALKODA_CONFIG_FILE` 可选择独立配置。

省略 `--publish` 时保存草稿。上传命令只发送明确指定的源码、音频和公开资料，不上传原始会话或整个工作区。只要求本地创作并不授权公开发布。

结果为 JSON，`--json` 输出紧凑 JSON；进度/错误在 stderr，退出码为 0/1。API 使用 Bearer，HTTPS 传输（本地回环开发除外），拒绝重定向。`--url` / `TALKODA_API_URL` 指定其他服务器时，不会复用另一 origin 的已保存凭证。

## 管理与重试

`talkoda --help` 列出全部命令，涵盖作品、榜单、个人列表、媒体下载/HEAD/Range、喜欢收藏、资料、Token 与管理员隐藏。详见[命令与重试参考](skills/talkoda/references/cli.md)。

上传失败时先检查返回的作品 ID。文件缺失时用 `tracks upload --id TRACK_ID` 重试；文件就绪则仅重试 `tracks publish TRACK_ID`。不要盲目创建重复草稿。已发布作品的音乐文件固定，下架重发也保留原发布时间。

## 开发

```sh
npm ci
npm run check
npm run pack:release
```

测试使用虚构会话和本地素材，不上传测试作品或使用真实凭证。渲染测试需要 Chrome/Chromium。安装包仅含 CLI、技能和许可证，账号文件与测试工作区不会进入包内。本仓库是 CLI 后续开发的唯一来源。

## 许可

[AGPL-3.0-only](LICENSE)。Talkoda 不是 Strudel 官方服务；渲染依赖 Strudel、Playwright 和 `@breezystack/lamejs`，遵循各自许可证。用户作品和私密会话不自动适用 CLI 的代码许可证。
