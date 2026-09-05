# CLI operations

Run `talkoda --help` for the complete command list. Results are JSON; `--json` makes them compact. Progress/errors go to stderr. Success exits 0, errors exit 1. `--lang en|zh` overrides the system locale and sets HTTP `Accept-Language`; JSON keys and enum values are unchanged.

## Identity

`talkoda auth login` accepts a Token with hidden input. Automation can use `--token-file FILE`, `--token-stdin`, or an externally injected `TALKODA_API_TOKEN`. `talkoda auth status` checks identity. `auth logout` revokes the active Token and clears the saved login. Never print or share a user's credential file.

Credentials are saved per origin in `~/.config/talkoda/config.json` with mode 0600 (or under `XDG_CONFIG_HOME`). `TALKODA_CONFIG_FILE` chooses another file. `--url` / `TALKODA_API_URL` select the server; default is `https://talkoda.com`. HTTPS is required except for local loopback development. API redirects are rejected.

## Tracks and interaction

```sh
talkoda tracks list --query '主题' --tag ambient --all
talkoda tags list --query amb
talkoda charts
talkoda library --tab tracks --all
talkoda library --tab favorites --all
talkoda tracks get TRACK_ID
talkoda tracks create --title '作品名'
talkoda tracks update TRACK_ID --title '新标题' --summary-file ./story.md
talkoda tracks update TRACK_ID --agent codex --source-visibility private --tags 'ambient,warm'
talkoda tracks update TRACK_ID --prompt-file ./approved-prompt.txt --prompt-visibility private
talkoda tracks upload --id TRACK_ID --source ./song.strudel.js --audio ./song.mp3
talkoda tracks publish TRACK_ID
talkoda tracks unpublish TRACK_ID
talkoda tracks hide TRACK_ID
talkoda tracks delete TRACK_ID --yes
talkoda tracks share TRACK_ID
talkoda tracks download TRACK_ID --kind source --output ./download.strudel.js
talkoda tracks download TRACK_ID --kind audio --output ./download.mp3
talkoda tracks download TRACK_ID --kind audio --head
talkoda likes add TRACK_ID
talkoda likes remove TRACK_ID
talkoda favorites add TRACK_ID
talkoda favorites remove TRACK_ID
talkoda profile update --name '昵称'
talkoda tokens list
talkoda tokens create --name '工具名' --days 30 --output ./token.txt
talkoda tokens revoke TOKEN_ID --yes
```

`hide` requires an administrator. Publicly released music is immutable; withdrawal does not unlock its files or reset publication time. Partial metadata updates preserve unspecified fields. Downloads and Token exports require a new output file. Favorites remain private.

## Generation metadata and privacy

Track responses include `sourceVisibility`, `canReadSource`, `agent`, `model`, `tokenCount`, `promptVisibility`, `canReadPrompt`, `hasPrompt`, `tags`, `playCount` and `copyrightNotice`. Only detail responses include `prompt`, which is `null` when the caller cannot read it. `uploadSource` is visible only to the track author; it identifies the server-recorded channel (`web`, `api-token` or `unknown`), Token ID/name/prefix when applicable, and upload time. Original Token secrets are never returned. Do not send this server-owned field.

`--agent` (100 characters), `--model` (120), `--tokens` (a nonnegative safe integer), `--prompt` / `--prompt-file` (16000 characters), and `--copyright-notice` (1000) describe the actual creation. Only record verified facts and actual token usage. `--tokens none` clears unknown usage; an empty string clears agent, model, prompt or custom copyright text (the site default notice then applies). Updates preserve all unspecified fields and do not refetch/replay prior metadata.

Source visibility defaults to public; private source downloads require server authorization. Prompts default to private. Uploading a private prompt still sends it to the server; only upload a separate creative prompt explicitly authorized by the user, never the raw conversation. Music publication does not grant permission to make prompts public. `--prompt-visibility public` requires the user's explicit choice.

`--tags` accepts comma-separated tags (at most 10, each up to 32 characters). Normalization uses NFKC, removes leading `#`, lowercases, collapses whitespace and removes duplicates. An empty value clears tags. `tracks list --tag TAG` selects one exact normalized tag; `--query` also searches tags. `tags list --query TEXT` returns `{tags:[{tag,count}]}`.

## Sharing and real playback

`tracks share ID` outputs the canonical `url`, publication `status`, and `shareUrls` for X, Facebook, LinkedIn, WhatsApp, Telegram and Weibo. Non-public tracks have empty `shareUrls`. It does not open a browser, post to a social network or grant access to a private draft.

A player may call `tracks record-play ID --event-id UUID --seconds N` after at least 5 seconds of actual playback. It requires a Token and returns `{counted,playCount}`. Generate an event UUID for a real play and reuse it for retries. The server counts only public tracks, excludes author previews, and deduplicates each account/browser and track for 30 minutes. Do not call this for downloads, HEAD, metadata requests or fabricated events.

## Upload recovery

`tracks upload` prints a created draft ID before uploading. On failure, inspect it with `tracks get`. If files are missing, retry with `--id` and the intended files. If files are ready, retry only `tracks publish`. Do not rerun a title-only creation blindly; a timeout does not prove the server created nothing.

401 means invalid/expired/revoked credentials. 404 can mean the current user cannot access a private track. 409 commonly means music is already published or changed concurrently. 422 means invalid input/audio. 429 means the user quota was reached. Keep the user's requested publication scope on every retry.
