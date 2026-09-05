# Talkoda CLI documentation

[中文](README.zh-CN.md) · [Website quick start](https://talkoda.com/docs)

**Talkoda /tɔːˈkoʊdə/** (taw-KOH-duh) turns conversations into music. Codex, Claude Code, pi or OpenCode writes an original Strudel score; the CLI prepares a workspace, renders audio, plays it locally, and manages tracks on Talkoda. No additional LLM API key is required.

## Quick start

Ask your Agent to install:

> Read https://talkoda.com/install.md and install Talkoda CLI and the skill for this Agent.

Then ask it to compose:

> Use the talkoda skill to turn the emotions and turning points of this conversation into an original two-minute Strudel track, render the audio, and publish it to my Talkoda account, keeping the original conversation and prompt private.

Replace “publish” with “save as a draft” when you want to review it first. A request to compose locally does not authorize uploading or publishing.

## Install and connect your Agent

Requires Node.js 22.12 or later; Node.js 24 is recommended.

```sh
npm install --global https://talkoda.com/cli/talkoda-cli-0.4.0.tgz
talkoda --version
```

| Agent       | Skill installation                        | Default user skill directory         |
| ----------- | ----------------------------------------- | ------------------------------------ |
| Codex       | `talkoda skills install --agent codex`    | `~/.agents/skills/talkoda/`          |
| Claude Code | `talkoda skills install --agent claude`   | `~/.claude/skills/talkoda/`          |
| pi          | `talkoda skills install --agent pi`       | `~/.pi/agent/skills/talkoda/`        |
| OpenCode    | `talkoda skills install --agent opencode` | `~/.config/opencode/skills/talkoda/` |

Use `--scope project` for a project-local skill. Existing skills remain untouched unless you add `--force` to update them; preserve local customizations first. The installer honors pi's `PI_CODING_AGENT_DIR` and OpenCode's `XDG_CONFIG_HOME`. Reload skills or start a new conversation if the host has not refreshed discovery. `talkoda skills show` prints the bundled instructions.

Use the host's authorized conversation-reading tool for a specified conversation link. If it cannot access that conversation, supply an export. Talkoda does not search other agents' history databases.

## Home, configuration and song directories

```text
~/.talkoda/
  config.json           Credentials separated by site origin; mode 0600
  songs/
    my-song/            One new directory for every creation
      .private/         Requested conversation and private creative prompt
      BRIEF.md
      song.json
      song.strudel.js
      story.md
      song.mp3          Created after rendering
  cache/                Temporary rendering/playback files, cleaned up afterward
```

`TALKODA_HOME` overrides the root. `TALKODA_CONFIG_FILE` overrides the configuration file independently. With the default paths, an existing legacy `~/.config/talkoda/config.json` (or the previous `XDG_CONFIG_HOME` location) is securely copied when the new configuration is absent. The legacy file is preserved; a new configuration always takes precedence, including an empty one. Explicit home/config overrides do not import legacy credentials automatically.

```sh
talkoda compose init --conversation ./conversation.md --name my-song --bpm 108 --cycles 64
```

`--output` is optional. Without it, a fresh workspace is created under `~/.talkoda/songs/{name}`. Its name comes from `--name`, then `--title`, then the conversation filename. Names are normalized for a safe directory path. If a name is already taken, `name-2`, `name-3`, etc. are reserved atomically; existing songs are never overwritten. An explicit `--output PATH` still requires a new destination directory.

Always use the returned JSON `directory`, which may include a collision suffix. `compose init` supplies a starter and a brief; it does not compose a finished song. Ask your Agent to read `BRIEF.md`, rewrite the score and public story, and keep `song.json` consistent. Raw conversations remain in the ignored `.private` directory with private permissions.

For a native conversation already read by the Agent, it can write a private creative brief to a local file and pass that as `--conversation`.

## Render and play music in the terminal

Run from the returned workspace:

```sh
talkoda render doctor
talkoda render --source ./song.strudel.js --output ./song.mp3 --bpm 108 --cycles 64
talkoda play doctor
talkoda play ./song.mp3
```

Rendering uses Strudel 1.3.0 in a fresh offline Chromium context without browser profiles or Talkoda credentials. It supports the built-in `sine`, `triangle`, `sawtooth`, `square`, `pink`, `white`, `brown`, and `crackle` sounds. External sample libraries and sung vocals are not supported. Keep a constant 4/4 tempo and match `setcps(BPM / 60 / 4)` to the render command. Maximum duration is five minutes; output is 48 kHz stereo, 192 kbps MP3. Render results include duration, sounds, events, signal level, and source/audio hashes.

If Chrome/Chromium is missing, run `talkoda render setup`. `--browser PATH` or `TALKODA_BROWSER` selects a browser. Linux may require [Playwright system dependencies](https://playwright.dev/docs/browsers#install-system-dependencies). Keep the browser sandbox enabled; on Ubuntu, prefer system Google Chrome where available. Playwright manages its own downloaded-browser cache; temporary Talkoda render files use `~/.talkoda/cache`.

```sh
talkoda play ./song.mp3 --player ffplay
talkoda play --track TRACK_ID
```

Local playback accepts MP3, M4A and WAV files. On macOS, automatic selection prefers the built-in `afplay`, then `ffplay`, then `mpv`; elsewhere it tries `ffplay` and `mpv`. `play doctor` reports what is available. Install FFmpeg (which includes ffplay) or mpv if none are found. The CLI searches the current PATH and does not install system players automatically.

Playback stays in the foreground until completion; **Ctrl-C stops it**. Audio comes from the machine running the command. An SSH server, container, or machine without an audio device may not produce sound on your own computer. A successful result means the player exited normally, not that an Agent has heard or assessed the music.

`--track` downloads audio through the authenticated Talkoda API into a private temporary directory under `~/.talkoda/cache`, plays it, and removes it after completion, interruption or failure. Private tracks still require the viewer's own valid credentials. Tokens are never passed in player arguments, URLs, or the player environment. Arbitrary remote media URLs and playlists are not accepted.

External player launch/elapsed time is not reliable evidence of actual audio progress, so `play` does not automatically increment website play counts. Only submit the separate play-event API when your player has verified actual progress.

## Log in and upload

Create an API Token in [your own Talkoda account](https://talkoda.com/settings/tokens), then run this yourself in an interactive terminal:

```sh
talkoda auth login
talkoda auth status
```

Input is hidden. Credentials are stored privately by site origin in `~/.talkoda/config.json`. Do not paste Tokens into Agent conversations or commit them. Automation can use `--token-file FILE`, `--token-stdin` or externally injected `TALKODA_API_TOKEN`. `--url` / `TALKODA_API_URL` selects an API origin; credentials are never reused for another origin, and API redirects are rejected. HTTPS is required except for loopback development.

From the composition directory:

```sh
talkoda tracks upload --title 'A new beginning' --summary-file ./story.md --agent codex --tags 'ambient,warm' --source ./song.strudel.js --audio ./song.mp3 --publish
```

Omit `--publish` for a draft. Only explicitly selected files and metadata are sent. Source must be UTF-8 `.js` up to 128 KB; uploads accept MP3/M4A up to 16 MB and five minutes. The API validates actual audio duration. WAV can be played locally but must be encoded to MP3/M4A for upload.

## Metadata, visibility and rights

- `--agent`, `--model`, `--tokens`: record the actual tools and verified token usage; omit unknown values. `--tokens none` clears usage.
- `--source-visibility public|private` and `--prompt-visibility public|private` are independent. Source defaults to public, prompts to private.
- `--prompt TEXT` or `--prompt-file PATH` uploads a separately approved creative prompt, even when marked private. Never use the raw conversation as an implicit upload input. Publishing music alone does not authorize publishing the prompt.
- `--tags 'ambient,night'`: at most ten tags of 32 characters each, normalized with NFKC, trimmed, lowercased and deduplicated. `tracks list --tag TAG` filters an exact tag; `--query` also searches tags.
- `--copyright-notice TEXT` sets a custom rights statement. Clearing it restores the default: the creator reserves applicable rights and public listening/viewing does not grant redistribution, adaptation or commercial permission. This does not guarantee that all AI outputs are copyrightable.

Agent/model/prompt/copyright limits are 100/120/16000/1000 characters. Usage must be a nonnegative safe integer. Empty strings clear nullable text; empty tags clear the tag list. PATCH updates only explicitly supplied fields. Published audio/source, BPM and engine version remain immutable; withdrawing and republishing preserves the original publication time.

Detail responses expose `canReadSource`, `hasPrompt`, `canReadPrompt` and the allowed prompt; lists omit prompt text. `uploadSource` is author-only and records the server-verified web/API Token channel, Token ID/name/prefix and timestamp. Clients cannot set it; raw Tokens are never returned.

## Discover, share, like and save

```sh
talkoda tracks list --tag ambient --all
talkoda tags list --query amb
talkoda charts
talkoda library --tab favorites --all
talkoda likes add TRACK_ID
talkoda favorites add TRACK_ID
talkoda tracks share TRACK_ID
talkoda tracks download TRACK_ID --kind source --output ./download.strudel.js
```

Likes contribute to the seven-day new-release chart; favorites are private and independent. `tracks share` returns the canonical track URL and X, Facebook, LinkedIn, Telegram, WhatsApp and Weibo URLs without posting. Non-public tracks receive no external sharing URLs. The website also provides a WeChat QR code.

Real player integrations can report `tracks record-play TRACK_ID --event-id UUID --seconds N` after at least five seconds of actual playback. Use a new UUID for a new play, and the same UUID for retries. The server counts only public tracks, excludes author previews and deduplicates a viewer/track within 30 minutes. Downloads, HEAD and metadata requests do not count.

## Errors, recovery and automation

After an upload failure, inspect the returned track ID with `tracks get`. Reuse a draft with `tracks upload --id TRACK_ID` when files are missing; retry only `tracks publish` if files are ready. Do not blindly create duplicate drafts after a timeout.

`--lang en|zh` overrides the system language for help, local errors and progress, and sets HTTP `Accept-Language`. JSON keys and enum values stay stable. Results go to stdout, progress/errors to stderr; `--json` produces compact JSON. Normal success exits 0, errors 1, and interrupted playback 130.

Run `talkoda --help` for all commands, including profile updates, token management and administrator hiding. See [CLI operations and retry guidance](../skills/talkoda/references/cli.md) for details.

## Development and license

```sh
npm ci
npm run check
npm run pack:release
```

Tests use local synthetic fixtures, not production credentials or test publications. Code is [AGPL-3.0-only](../LICENSE); dependencies retain their licenses. User works and private conversations do not automatically inherit the CLI's code license. Talkoda is not an official Strudel service.
