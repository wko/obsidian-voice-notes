# Voice Append

Voice Append records a thought, transcribes it with OpenAI, cleans it up, and appends the result to the active Obsidian note. It is designed for quick capture on iPhone and also works on desktop.

## Features

- Record from the end of a note, the command palette, the ribbon, or Obsidian's mobile toolbar.
- Keep the screen awake while a recording is active where the platform permits it.
- Transcribe and clean up speech directly through the OpenAI API without a separate server.
- Show progress at the end of the target note without writing technical markers into Markdown.
- Resume saved jobs after a restart or temporary network failure.
- Optionally include note context and familiar names or terminology during cleanup.
- Optionally generate a filename when the note contains only frontmatter.
- Optionally add the original transcript below the cleaned text. This is disabled by default.
- Use the interface in English or German, following Obsidian's language setting.

## Requirements

- Obsidian 1.11.4 or later
- An API key accepted by the configured OpenAI-compatible transcription and cleanup endpoints
- Internet access while processing a recording

The defaults use `https://api.openai.com/v1`, `gpt-transcribe` for transcription, and `gpt-5.6-luna` for cleanup. Model availability depends on your provider account and may change over time.

## Installation

Voice Append is not yet listed in Obsidian's Community Plugins directory.

For a manual installation, run `npm ci && npm run release`, then copy these files from `dist/` into `<vault>/.obsidian/plugins/voice-append/`:

- `main.js`
- `manifest.json`
- `styles.css`

Reload Obsidian, open **Settings → Community plugins**, and enable **Voice Append**.

## Setup and use

1. Open **Settings → Voice Append**.
2. Enter one API key and select **Save** on each device. The plugin stores the key locally through Obsidian Secret Storage; it is not synced with the vault.
3. Configure independent OpenAI-compatible base URLs and models for transcription and cleanup, plus the cleanup prompt, if needed. Enter the complete API base (for example `https://api.openai.com/v1`), not a request path. The same stored key is used for both endpoints.
4. Open a Markdown note and select **Append via voice** at the end of the note. You can also run the command from the command palette, ribbon, or mobile toolbar.
5. Select **Stop & append** when finished. The recording is saved locally before network processing starts, and the note scrolls to the processing indicator.

Open **Recordings and status** from the plugin settings or command palette to retry a failed job, download its audio, reassign its target note, or delete it.

## Settings

- **Show recording button in notes** controls the inline button. Commands and toolbar actions remain available.
- **Generate titles for empty notes** requests a concise title in the same cleanup call. If the note has no body content both when recording starts and when the result is appended, the plugin renames the file through Obsidian so links stay current. Frontmatter is ignored. The default **Append to existing filename** mode preserves Unique Notes timestamps (for example, `20260924 083000 - Morning idea.md`); **Replace existing filename** uses only the generated title. Generated titles are not inserted into the note body.
- **Include original transcript** adds a collapsed transcript section below the cleaned text.
- **Dated heading** adds a timestamped heading to each append.
- **Use note context for cleanup** sends up to 16,000 characters from the target note, excluding frontmatter and HTML comments. The note is reference material; only the new transcript is rewritten.
- **Familiar names and concepts** supplies up to 2,000 characters of preferred spellings and terminology to transcription and cleanup.
- **Transcription base URL** and **Cleanup base URL** may point to different OpenAI-compatible API roots. URLs must be plain `http` or `https` API bases and cannot contain credentials, query strings, or fragments. Keep API keys in Secret Storage, never in a URL.

Each job keeps a snapshot of its processing settings, so changing settings does not alter recordings that are already queued.

## Privacy and data handling

Voice Append sends new audio to the configured transcription endpoint and its transcript to the configured cleanup endpoint. Note context is sent only when **Use note context for cleanup** is enabled. Familiar names and concepts are sent when that field is populated. Cleanup requests use `store: false`.

The API key is stored using Obsidian Secret Storage under a stable, plugin-owned name. Existing keys stored under an earlier vault-ID-based name are migrated when unambiguous. Endpoint URLs and models are ordinary plugin settings; no raw key is written there. Recordings, transcripts, cleanup results, and the local append journal are stored in IndexedDB on the device where they were created. New audio is read and stored as bytes before the plugin reports it saved. They are not synced through the vault. Audio from completed jobs is removed after seven days; pending and failed jobs remain until completed or deleted.

Review [OpenAI's data controls](https://platform.openai.com/docs/guides/your-data) before using the plugin with sensitive material.

## Platform behavior and limitations

- A recording can be up to 10 minutes and 24 MiB.
- Keep Obsidian open while recording. Mobile operating systems can still stop the app when it moves to the background.
- The Screen Wake Lock API is requested only while recording. Device support and power-saving rules can override it.
- Audio chunks remain in memory until recording stops. An abrupt app termination can lose the active, unsaved segment.
- Older recordings stored as browser Blobs are migrated to byte storage when readable. If an older Blob has lost its underlying data, retrying cannot recover the missing audio; try exporting it from **Recordings and status**.
- Network requests have a 120-second wait budget. Retrying after a timeout may incur another API charge, but the append journal prevents the same result from being written twice when recovery is unambiguous.
- The queue is local to one device. Concurrent edits or sync conflicts can require manual review.

## Development

```sh
npm ci
npm test
npm run build
npm run dev
```

`npm run build` type-checks the project and writes a development build to `main.js`. `npm run dev` watches the source files. Set `OBSIDIAN_PLUGIN_DIR` to install successful development builds into a test vault automatically:

```sh
OBSIDIAN_PLUGIN_DIR="/path/to/Test Vault/.obsidian/plugins/voice-append" npm run dev
```

Development builds include two local test commands. Release builds omit them and source maps. Run `npm run release` to create the distributable files in `dist/`.

The processing path is:

```text
recorder.ts → IndexedDB → resumable job processor → OpenAI → Obsidian editor or vault
```

The test suite covers storage recovery, append idempotency, localization, microphone permissions, wake lock behavior, note context, title generation, OpenAI request contracts, and error handling.

## Releasing

1. Update `minAppVersion` in `manifest.json` if necessary.
2. Run `npm version patch`, `npm version minor`, or `npm version major`. The version script updates `manifest.json` and `versions.json`.
3. Push the commit and the generated tag.
4. The release workflow verifies the tag, runs the test suite, builds the plugin, and creates a draft GitHub release with the required assets.
5. Review and publish the draft release.

Release tags must match the version exactly, without a `v` prefix.

## Roadmap

Planned and exploratory feature ideas are tracked in [ROADMAP.md](ROADMAP.md) and as GitHub issues. Current themes include quick capture into a new note, configurable title generation outside the voice append flow, and locally selected context from related notes, concepts, and tag hierarchies.

## Contributing and security

Bug reports and focused pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidance. Please report security issues according to [SECURITY.md](SECURITY.md), rather than opening a public issue.

## License

[MIT](LICENSE)
