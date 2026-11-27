# How analysis works

Analysis runs in Web Workers in both the browser and the desktop app. Every song is first separated into stems, and each part is charted from its own stem:

- **Stem separation** – [Demucs](https://github.com/adefossez/demucs) (`htdemucs`) splits the song into drums, bass, vocals and the other instruments. It runs on [ONNX Runtime Web](https://onnxruntime.ai/): on the graphics card through WebGPU where the browser has it (about 6 seconds for a four-minute song on a fast card), otherwise on the processor through WebAssembly (one to several minutes). On a graphics card the model is recorded once and replayed for every segment (ONNX Runtime's graph capture), and the work around it runs in three helper workers of its own (`src/analysis/separation/transform.ts`): one prepares the next segment and two rebuild the stems of the last one while the model works on the current one, so the worker that runs the model is free to keep the card busy. (Not in WebKit, and not on a processor, where the helpers would gain little for the 0.5 GB they keep.) The game does the model's short-time Fourier transform itself (`src/analysis/separation/`). The same song always gives the same stems.
- **Transcription** – [Basic Pitch](https://github.com/spotify/basic-pitch) transcribes the bass, vocal and instrument stems, on the same runtime and device as the separation (its ONNX file, `public/models/basic-pitch/nmp.onnx`). Its notes are decoded by a port of Basic Pitch's own post-processing (`src/analysis/pitch/noteEvents.ts`) that gives the same notes far faster; a test checks the two agree. All three stems of a four-minute song take under two seconds on a graphics card.
- **Beats and bars** – [Beat This](https://github.com/CPJKU/beat_this) finds the beats and where the bars start, from the mix, on the same runtime (its small model, `public/models/beat-this/small0.onnx`, 10 MB, served with the game and loaded when an analysis starts). The game computes the model's spectrogram itself and picks the beats the way Beat This does (`src/analysis/beat/`); a test checks the spectrogram against Beat This's own. If the model cannot be loaded, the game's own beat tracker finds the grid.

A four-minute song takes about 15 seconds in all on a fast graphics card, and about 2 minutes on a 16-thread processor, most of it the separation.

- The stems are kept: in the track editor, **Play** in the menu plays any one of them on its own (instruments, bass, drums, vocals), to hear a part clearly while charting it.

The stem model is not part of the game's files. It is downloaded once (93 MB), the first time the game opens, from this repository (`models/htdemucs/htdemucs-v2.onnx`, an export of the model with its weights as float16 and its graph optimized ahead of time, its attention computed a slice of queries at a time, made by `tools/analysis/export_stem_model.py --prepared`), checked against a known hash and kept in the browser's storage; Settings → Analysis shows its state. `src/analysis/separation/model.ts` has the address and the hash.

Separating a four-minute song takes about 1.7 GB of the page's memory at its height on a graphics card (and about 2.8 GB of the card's own), and about 3.7 GB on a processor, most of it what ONNX Runtime keeps for the model. Analyzing waits while a song is played, edited or made into a video (`src/analysis/hold.ts`): a song under way pauses between two segments and goes on afterwards. Phones and tablets are let try like any other device, but their browsers often give a page less than that, and may then close the game partway through an analysis; such a song is best analyzed on a computer and brought over as a Soundwave song file or in a library backup. On a phone or tablet the stem model is downloaded when the first song is analyzed, not as soon as the game opens. The runtime's WebAssembly file (27 MiB) is shipped gzip-compressed (`public/ort/…wasm.gz`, about 7 MiB) and unpacked by the worker, so no file in the build is over the 25 MiB some hosts allow per file; `pnpm build` fails if one is (`scripts/check-dist.mjs`). On the processor the model wants threads, which a browser only allows on pages served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; the dev and preview servers and the desktop app send both, and a host for the built game should too. The desktop app on Apple silicon Macs runs the models itself instead (`src-tauri/src/models.rs`, ONNX Runtime with Core ML on a Mac; `src/analysis/native.ts` on the page): WebKit's WebGPU keeps about 160 MB for every few seconds of a song it separates, and WebKit closes a page whose memory passes 8 GB (16 GB on a Mac with more than 16 GB), or 4 GB while it is in the background, so a song of a few minutes did not survive there. ONNX Runtime's prebuilt library is fetched when the app is built. (Not on Linux yet: ONNX Runtime's prebuilt Linux library needs a newer glibc than the Ubuntu 22.04 the Linux app is built on.) In Safari, and in the app on an Intel Mac, an analysis on the graphics card pauses while the game is in the background and carries on when it is back.

The pipeline then works on the mix and the stems:

1. **Spectrum** – STFT (2048/512 at 22.05 kHz).
2. **Harmonic/percussive separation** – median-filter HPSS.
3. **Rhythm** – beats and bar starts from the beat model (without it: a band-balanced onset envelope, tempo by an autocorrelation comb, dynamic-programming beat tracking, and bars from the accents). The grid is then calibrated against the detected drum attacks.
4. **Drums** – kick/snare/hat onsets from band-limited flux of the drum stem, refined to the attack in the time domain.
5. **Harmony** – chroma, chord changes, key.
6. **Melody** – each part's line is built from its stem's audible attacks and the notes transcribed in it (`src/analysis/pitch/stemLines.ts`):
   - **Bass**: the bass stem, with octave doublings folded onto one octave.
   - **Lead**: the instrument stem. Chords (three or more steady pitches struck together) stay chords; single-note riffs are followed as one melodic path.
   - **Vocals**: the vocal stem, one sung line, with wavering pitches settled onto the note that was meant.
7. **Structure** – sections and energy drive overdrive placement.

## Charting

Charts follow common five-lane authoring practice (`src/chart/generator.ts`, `src/chart/profiles.ts`):

- **Expert** is a literal transcription: sixteenths, plus triplets where the timing clearly is triplet.
- **Lanes follow the pitch** within each phrase (two bars, or up to a rest). The lowest note goes left and the highest right, the same pitch keeps its lane, and leaps move further than steps. Long runs wrap, and a repeated phrase is charted identically.
- **Chord shapes** come from the interval: adjacent lanes for close voicings, one lane apart for fifths, wider for octaves.
- **Each lower difficulty reduces the one above it:**
  - Hard drops three-note chords and thins very fast notes.
  - Medium keeps eighths and close chords.
  - Easy keeps quarter notes, playing the root of each chord.
- **Drums** use a fixed kit layout (kick left, snare middle, hi-hats right). Hi-hats thin out first on lower difficulties.
- **Overdrive phrases** cover the same musical passages on every difficulty.

To tune analysis or charts on your own files without the UI, see `scripts/dev/analyze.dev.ts` (`pnpm dev:analyze`).

## The Python reference (`ml-service/`)

`ml-service/` is the Python service the stem analysis started in (Demucs and Basic Pitch behind a small HTTP API). The game no longer talks to it. It stays as the reference the in-app separation is checked against and as the environment `tools/analysis/export_stem_model.py` and the offline tooling in `scripts/dev/` run in. See [ml-service/README.md](../ml-service/README.md).
