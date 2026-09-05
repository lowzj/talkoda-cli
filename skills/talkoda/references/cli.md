# CLI operations

Run `talkoda --help` for the complete command list. Results are JSON; `--json` makes them compact. Progress/errors go to stderr. Success exits 0, errors exit 1.

## Identity

`talkoda auth login` accepts a Token with hidden input. Automation can use `--token-file FILE`, `--token-stdin`, or an externally injected `TALKODA_API_TOKEN`. `talkoda auth status` checks identity. `auth logout` revokes the active Token and clears the saved login. Never print or share a user's credential file.

Credentials are saved per origin in `~/.config/talkoda/config.json` with mode 0600 (or under `XDG_CONFIG_HOME`). `TALKODA_CONFIG_FILE` chooses another file. `--url` / `TALKODA_API_URL` select the server; default is `https://talkoda.com`. HTTPS is required except for local loopback development. API redirects are rejected.

## Tracks and interaction

```sh
talkoda tracks list --query '主题' --all
talkoda charts
talkoda library --tab tracks --all
talkoda library --tab favorites --all
talkoda tracks get TRACK_ID
talkoda tracks create --title '作品名'
talkoda tracks update TRACK_ID --title '新标题' --summary-file ./story.md
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

## Upload recovery

`tracks upload` prints a created draft ID before uploading. On failure, inspect it with `tracks get`. If files are missing, retry with `--id` and the intended files. If files are ready, retry only `tracks publish`. Do not rerun a title-only creation blindly; a timeout does not prove the server created nothing.

401 means invalid/expired/revoked credentials. 404 can mean the current user cannot access a private track. 409 commonly means music is already published or changed concurrently. 422 means invalid input/audio. 429 means the user quota was reached. Keep the user's requested publication scope on every retry.
