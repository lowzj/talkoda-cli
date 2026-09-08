<p align="center">
  <img src="docs/assets/talkoda-logo.png" alt="Talkoda logo" width="112" height="112" />
</p>

<h1 align="center">Talkoda CLI</h1>

<p align="center">把对话，谱成歌。<br />Turn conversations into music.</p>

<p align="center">
  <a href="https://talkoda.com">Talkoda</a> ·
  <a href="docs/README.zh-CN.md">中文文档</a> ·
  <a href="docs/README.en.md">English docs</a>
</p>

为 **Codex、Claude Code、pi 和 OpenCode** 提供的 CLI 与 Skill。Agent 作曲，Talkoda 负责渲染、播放和发布；无需额外的 LLM API Key，原始对话保留在本地。

## 两句话开始

在 Agent 对话中依次发送：

**1. 安装**

> 阅读 https://talkoda.com/install.md，安装 Talkoda CLI 和技能。

**2. 创作并发布**

> 用 talkoda 技能，把当前对话谱成音乐并公开发布。

只想先试听，可将“公开发布”改为“保存到本地”。[English quick start →](docs/README.en.md#quick-start)

## 手动安装

需要 Node.js 22.12+（推荐 24），以下以 Codex 为例：

```sh
npm install --global https://talkoda.com/cli/talkoda-cli-0.4.1.tgz
talkoda skills install --agent codex
```

其他 Agent 使用 `claude`、`pi` 或 `opencode`。安装后重新加载技能；首次发布前，在终端运行 `talkoda auth login` 连接自己的账号。

完整命令、渲染与配置见[中文文档](docs/README.zh-CN.md)或 [English docs](docs/README.en.md)。

---

[AGPL-3.0-only](LICENSE) · [Logo 署名](docs/assets/NOTICE.txt)。代码许可不自动适用于用户作品与私密对话。
