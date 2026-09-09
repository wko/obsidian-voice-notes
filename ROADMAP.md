# Roadmap

This roadmap records product directions rather than committed release dates. New automation and external data sharing should remain optional, transparent, and configurable.

## Quick capture into a new note

Add a command that starts recording immediately without requiring an existing note. After recording, Voice Append creates a uniquely named note and inserts the cleaned content.

Configuration should cover the destination folder, filename pattern, collision handling, note template, frontmatter, generated title, date and time format, headings, transcript inclusion, whether to open the note, and whether processing settings inherit the normal append configuration.

The command should work from the command palette, ribbon, and mobile toolbar. Offline and failed jobs must retain the intended note configuration together with the locally saved audio.

Tracked in [issue #3](https://github.com/wko/obsidian-voice-notes/issues/3).

## Title generation for regular notes

Extend title generation beyond an empty note receiving a voice append. A separate command or opt-in automation could title notes that were created or populated through other workflows.

Configuration should cover manual and automatic triggers, eligibility rules, included and excluded folders or tags, provider and prompt, and whether the result becomes an H1, filename, frontmatter value, or a selected combination. Filename changes should support preview or confirmation, and automatic processing must disclose API use and cost.

Tracked in [issue #1](https://github.com/wko/obsidian-voice-notes/issues/1).

## Dynamic context from the vault

Select relevant notes, concepts, names, and terminology automatically instead of relying only on the active note and a manually maintained vocabulary field.

Potential local relevance signals include links, backlinks, aliases, headings, shared tags, a configurable tag hierarchy, recent notes, frequently used notes, LRU-style decay, and manually pinned sources. Users should be able to configure enabled signals and weights, context limits, folders and tags, hierarchy rules, and whether context is used for transcription, cleanup, or both.

An initial implementation should use Obsidian's existing metadata index and deterministic ranking. It should avoid embeddings or a separate vector database unless simpler signals prove insufficient. Selection happens locally; only bounded selected excerpts are sent to the configured provider. The selected sources should be inspectable before or after processing.

Tracked in [issue #2](https://github.com/wko/obsidian-voice-notes/issues/2).
