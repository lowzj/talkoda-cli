# Talkoda CLI

- Public repository: include only CLI, skill, examples and tests. Never copy website backend code, credentials, private conversations or local user configuration into this repository or release archives.
- Node.js 22.12+ (Node 24 recommended). ESM, two-space indentation. Keep API commands independent of the audio-renderer startup.
- Use Bearer authentication; store credentials privately by origin and never follow API redirects. Preserve ownership, upload limits and immutable published music.
- Rendering uses a fresh, offline Chromium context, never the user's browser profile or talkoda.com origin. Never pass authentication credentials into the renderer.
- The skill uses the host agent to understand only the requested conversation. Raw conversation content stays local; publishing requires the user's task to authorize it.
- Validate changes with `npm run check`. Render tests use only local synthetic fixtures; do not publish test tracks.
- Branches follow `<type>/<lowercase-hyphenated-description>`. Use Conventional Commits and `git commit -s`.
