# Talkoda CLI

**/tɔːˈkoʊdə/** · 把对话，谱成歌。 Turn conversations into music.

[中文文档](docs/README.zh-CN.md) · [English documentation](docs/README.en.md) · [Talkoda](https://talkoda.com)

The standalone CLI and portable skill for Codex, Claude Code, pi and OpenCode. Your Agent composes original Strudel music; Talkoda renders, plays, uploads and manages it.

在 Agent 对话中安装：

> 请阅读 https://talkoda.com/install.md，为当前 Agent 安装 Talkoda CLI 和 Skill。

Install from your Agent conversation:

> Read https://talkoda.com/install.md and install Talkoda CLI and the skill for this Agent.

```sh
npm install --global https://talkoda.com/cli/talkoda-cli-0.4.0.tgz
talkoda skills install --agent codex
talkoda --help
```

Use `talkoda compose init --conversation ./conversation.md --name my-song` to start a fresh workspace, then ask your Agent to compose and render. Play the resulting audio with `talkoda play ./song.mp3`. Use the returned `directory`; repeated names receive a suffix.

Defaults: `~/.talkoda/config.json` for configuration and `~/.talkoda/songs/{name}` for songs. Each person connects their own account with `talkoda auth login`; raw conversations stay local.

[AGPL-3.0-only](LICENSE). User works and private conversations are not covered by the CLI code license automatically.
