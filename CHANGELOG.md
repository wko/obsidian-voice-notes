# Changelog

All notable changes to Voice Append are documented here.

## 1.0.1

- Make production builds deterministic so published assets match the repository build.
- Expose settings through Obsidian's searchable settings definitions while keeping compatibility with older supported releases.
- Remove the one-time full-vault migration scan.
- Use window-scoped timers for pop-out window compatibility.

## 1.0.0

- Record from a note, the command palette, the ribbon, or Obsidian's mobile toolbar.
- Save recordings locally before processing and retry them after restarts or network failures.
- Configure separate OpenAI-compatible transcription and LLM providers, including local endpoints.
- Test provider configuration with a bundled sample recording.
- Clean up transcripts with configurable instructions, optional note context, and familiar terminology.
- Generate filenames for empty notes while preserving Unique Notes timestamps when desired.
- Keep the screen awake while recording where the platform permits it.
- Use localized English and German controls on mobile and desktop.
