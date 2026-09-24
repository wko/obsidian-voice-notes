# Voice Append demo production plan

## Goal

Produce one clean iPhone screen recording that demonstrates the complete core loop, then derive all public assets from that master. The demo is self-referential: use Voice Append to dictate a short introduction to Voice Append, show processing, and reveal the polished product description in the open note. Captions must make the value clear without sound.

## Deliverables

1. **README and Obsidian plugin page GIF**
   - 25–30 seconds, silent loop
   - 720 × 1280, 8–10 fps
   - Display at approximately 360 px wide in the README
   - Aim for less than 8 MB
2. **Social video**
   - 35–45 seconds, 1080 × 1920
   - H.264 MP4 with `yuv420p` pixel format
   - Burned-in English captions so it works without sound
3. **Static cover image**
   - 1200 × 675 or 1280 × 720 PNG
   - Before-and-after note content plus the Voice Append name

The Obsidian plugin directory uses the repository README on the plugin detail page, so the README GIF also serves as the main directory demo. See the official [Obsidian plugin submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin) and [community plugin release instructions](https://github.com/obsidianmd/obsidian-releases/blob/master/README.md).

## Core storyboard

| Time | Scene | On-screen message |
| --- | --- | --- |
| 0–2 s | Short title card | Turn a quick voice thought into polished notes |
| 2–4 s | Open the prepared Voice Append note; the centered microphone button is visible | Add to any note without typing |
| 4–19 s | Tap the button and dictate the product introduction | Live recording state, captions, and timer remain visible |
| 19–23 s | Stop the recording; show the real processing state and spinner | Transcribing and cleaning up… |
| 23–28 s | Follow the insertion point as the product description appears | Cleaned and appended in place |
| 28–30 s | Hold on the finished note and return to the opening frame | Voice Append for Obsidian |

For the longer social cut, add a short close-up of the mobile toolbar command and the compact provider preset setting after the core flow. Do not show the API key field. End with the repository URL and: “OpenAI, OpenRouter, or custom providers.”

## Demo script

Prepare a note named **Voice Append** containing:

```markdown
# Voice Append

## What it does
```

Dictate:

> Today I’m introducing Voice Append, an Obsidian voice notes plugin. It lets you append any thought to the note you already have open, just by speaking. Record offline, transcribe when you’re back online, and choose your providers, models, cleanup prompt, and whether to include note context.

Expected appended result:

```markdown
Voice Append lets you add any thought to the note you already have open simply by speaking.

You can record offline and let the plugin transcribe and clean up the recording when you are back online. You choose the providers, models, cleanup prompt, and whether note context is included.
```

This makes the demonstration explain itself while visibly showing recording, offline-safe storage, transcription, cleanup, and appending. The wording stays within features implemented in version 1.0.0.

## Recording setup

- Use a dedicated demo vault with invented content and an English interface.
- Hide unrelated sidebars, status items, recent files, and the vault name where possible.
- Use a standard Obsidian theme and a larger mobile font size.
- Enable Focus mode and disable notifications before recording.
- Record two or three complete takes on the iPhone. A wired QuickTime capture is useful when a clean device feed is needed.
- Keep the real recording and processing states. Trim dead time, but add “A few seconds later” if processing time is compressed.
- Add a subtle tap indicator and captions within mobile safe areas.
- Export the MP4 master first, then create the GIF and static cover from the approved edit.
- Inspect the final files at their actual README size on both phone and desktop.

## Privacy checklist

- Use no personal notes, names, filenames, notifications, or account details.
- Never record API key inputs or provider dashboards.
- Use a temporary provider key with a low spending limit and revoke it after recording.
- Disable Sync for the demo vault and clear the clipboard before recording.
- Review every frame, including transitions and app switching.
- Strip metadata from the final MP4 and PNG before publishing.
- Keep the README privacy statement that audio and transcripts are sent to the configured providers.

## Distribution

- Place the optimized GIF near the top of the README after the short product description.
- Link the MP4 from the README and reuse it for the Obsidian Showcase forum, Discord updates, and social posts.
- Reuse the static cover as the link preview and as a fallback where animation is disabled.
- Create a German-caption social variant from the same timeline after the English master is approved.
