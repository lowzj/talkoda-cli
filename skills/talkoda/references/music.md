# Writing music from a conversation

Map specific changes in the conversation to musical decisions. Repeating the same question might become a returning motif; increased scope might add competing voices; a simplification can remove layers; agreement may resolve a suspended harmony. These are examples, not a mandatory structure. Explain the actual mapping in the public story.

Compose a complete piece with contrast and a deliberate ending. A common starting point is 32–64 cycles, 90–120 BPM, with a small motif, complementary harmony, bass and percussion. Adapt this to the user's story and preferences. Strudel primarily produces instrumental music; do not promise synthesized singing from this renderer.

## Portable renderer contract

- Use Strudel `@strudel/web@1.3.0` syntax and a constant tempo. End the file with a pattern expression such as `arrange(...)` or `stack(...)`; do not use an ES module export.
- One cycle represents one 4/4 bar here. Set `setcps(BPM / 60 / 4)` or `setcpm(BPM / 4)`. The CLI `--bpm` must match. Total duration is `cycles * 240 / BPM` seconds, at most 300 seconds.
- Supported sounds: `sine`, `triangle`, `sawtooth`, `square`, `pink`, `white`, `brown`, `crackle`. Build percussion from oscillators/noise. External samples, banks, soundfonts, network imports, MIDI and device input are outside this offline renderer.
- Use `note(...)`, `s(...)`, `stack(...)`, `arrange([cycles, pattern], ...)`, envelopes, filters, panning, FM, delay and room for variety. `arrange` counts add up to the planned cycle count.
- Keep gain conservative across layers. The renderer rejects near-silence and renders a short ending fade; reduce gain if the output reaches full scale. Do not rely on normalization to repair distorted source audio.
- Avoid `.play()`, browser/DOM code and asynchronous side effects. The renderer controls playback and export. Only render code you have authored or inspected as part of the user's request.
- The final exported MP3 is 48 kHz stereo, 192 kbps. Audio and code must describe the same final revision. Source is at most 128 KB, audio at most 16 MB and 5 minutes.

The [starter](../assets/starter.strudel.js) demonstrates compatible patterns. Rewrite its notes, rhythm, layers and form for the actual conversation.

Useful primary references: [Strudel getting started](https://strudel.cc/workshop/getting-started/), [pattern factories and arrange](https://strudel.cc/learn/factories/), [synths](https://strudel.cc/learn/synths/), [effects](https://strudel.cc/learn/effects/).
