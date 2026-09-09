# Contributing

Thanks for helping improve Voice Append.

## Development setup

1. Install Node.js 20 or later.
2. Run `npm ci`.
3. Run `npm test` and `npm run build` before submitting a change.
4. Test user-facing changes in both desktop and mobile Obsidian when they affect shared behavior.

Set `OBSIDIAN_PLUGIN_DIR` when running `npm run dev` to copy successful builds into a dedicated test vault. Do not develop against a vault containing important notes.

## Pull requests

Keep changes focused and explain the user-visible behavior. Include meaningful tests for processing, persistence, or recovery changes. Do not include API keys, vault contents, recordings, generated build files, or personal data.

By contributing, you agree that your contribution is licensed under the MIT License.
