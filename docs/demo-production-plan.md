# Voice Append demo production plan

## Goal

Produce one clean iPhone screen recording that demonstrates the complete core loop, then derive all public assets from that master. The demo should make the value clear without sound: speak a rough thought, show processing, and reveal a polished addition in the open note.

## Deliverables

1. **README and Obsidian plugin page GIF**
   - 18–22 seconds, silent loop
   - 720 × 1280, 10–12 fps
   - Display at approximately 360 px wide in the README
   - Aim for less than 8 MB
2. **Social video**
   - 25–35 seconds, 1080 × 1920
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
| 2–5 s | Open a prepared note; the centered microphone button is visible | Add to any note without typing |
| 5–10 s | Tap the button and dictate one short thought | Live recording state and timer remain visible |
| 10–14 s | Stop the recording; show the real processing state and spinner | Transcribing and cleaning up… |
| 14–18 s | Follow the insertion point as the cleaned text appears | Cleaned and appended in place |
| 18–22 s | Hold on the finished note and return to the opening frame | Voice Append for Obsidian |

For the longer social cut, use seconds 22–28 to show the mobile toolbar command and the compact provider preset setting. Do not show the API key field. End with the repository URL and: “OpenAI, OpenRouter, or custom providers.”

## Demo script

Prepare a note named **Launch checklist** containing:

```markdown
# Launch checklist

- Invite beta testers
```

Dictate:

> And remind me to ask the testers about mobile onboarding and collect their feedback by Friday.

Expected appended result:

```markdown
- Ask beta testers about mobile onboarding and collect feedback by Friday.
```

This example shows transcription, cleanup, and appending without relying on features that are still on the roadmap.

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
