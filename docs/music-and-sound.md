# Music and sound

The menu theme and every interface sound are the project's own. `tools/audio` holds a small offline orchestra (a sampler, a concert hall and a mastering chain in `orchestra.py`), the score of the theme (`theme.py`), a few synthesized instruments that sit under the orchestra (`synth.py`), the recipes for the interface sounds (`sfx.py`) and a synthesized festival crowd (`crowd.py`). Two commands regenerate everything in `public/audio`:

```
python tools/audio/theme.py
python tools/audio/sfx.py
```

They need Python 3 with `numpy`, `scipy` and `soundfile`, and the instrument samples, which are not part of this repository:

1. Check out the strings, brass and percussion folders of the [Versilian Studios Chamber Orchestra 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) (CC0) into `local-audio/samples/vsco2ce/`. The folders used are listed at the top of `tools/audio/orchestra.py`; about 1.3 GB.
2. Optional: save the public-domain recording [Festival concert people crowd](https://commons.wikimedia.org/wiki/File:Festival_concert_people_crowd.ogg) as `local-audio/samples/crowd/crowd.wav`. It is layered under the synthesized crowd for texture; without it the crowd is synthesized alone.
3. Optional, for the finale's crowd: save the recording "Crowd cheering" by voicebosch from [Pixabay](https://pixabay.com/sound-effects/) (file `voicebosch-crowd-cheering-198411.mp3`) as a 48 kHz WAV at `local-audio/samples/crowd/crowd-cheering.wav`. The finale is a 4.9-second cut of it (from 28.55 s, where its third cheer erupts) over a quiet bed of the applause recordings below. Without it, the finale is mixed from the recordings in step 4 alone.
4. Optional, for the finale's applause (and its crowd when the recording above is missing): save these four recordings from Wikimedia Commons as 48 kHz WAV files in `local-audio/samples/crowd/commons/`. For the applause: [Applause i](https://commons.wikimedia.org/wiki/File:Applause_i.ogg) by thore (public domain) as `Applause-i.wav` and [applause-2](https://commons.wikimedia.org/wiki/File:277021_sandermotions_applause-2.wav) by Sandermotions (CC0) as `277021-sandermotions-applause-2.wav`. For the cheering: [Hurray](https://commons.wikimedia.org/wiki/File:Hurray.ogg) by starlite (public domain) as `Hurray.wav` and [Clapping hurray](https://commons.wikimedia.org/wiki/File:Clapping_hurray.ogg) by starlite (public domain) as `Clapping-hurray.wav`. The finale's crowd is mixed from them: the applause as the bed and, well above it, the cheering takes laid over each other several times at different pitches to make a crowd of voices (a synthesized crowd of that size has no distinct hands or voices in it and comes out as wind). Without the recordings it is synthesized.

The first run measures the pitch of every sample (file names disagree about octaves) and caches the result next to the library. `theme.py --stems` prints how loud each instrument group is in each section. The theme is one seamless loop plus a short intro that is played once before it; each sound is levelled to its place in `LEVELS` in `sfx.py`, so the game plays them all at the same gain.
