# The 3D stage

The stage is built in Blender and drawn by the game's own renderer (`src/render/aurora`). Three scripts regenerate everything the repository ships in `public/stage/aurora`:

```
blender -b --factory-startup -P tools/stage/aurora/build_venue.py -- --out public/stage/aurora
blender -b --factory-startup -P tools/stage/aurora/build_scenery.py -- --out public/stage/aurora
blender -b --factory-startup -P tools/stage/aurora/build_cast.py -- --out public/stage/aurora
```

`build_venue.py` makes the stage geometry, its baked contact shading and the positions the game needs (cameras, fixtures, band marks, pyro); add `--save some.blend` to open the result in Blender. `build_scenery.py` makes the land, the lake and the festival grounds around it.

`build_cast.py` makes the band and the crowd. The people are public-domain (CC0) characters by [Quaternius](https://quaternius.com/), brought onto one small skeleton, reduced for the crowd and baked together with their animation loops. One crowd loop, the dance, comes from Quaternius's animation library; the other crowd loops and the band's playing are written as motion in the script, timed to the beat, and the instruments (a drum kit with its hardware, a guitar, a bass and a microphone) are modelled in `instruments.py` next to it and fitted to each player. The script reads the packs from `local-audio/open-characters/`, which is not part of the repository; to rebuild the cast, download these three from quaternius.com and unpack each into a folder of its own there:

- Ultimate Modular Men, as `modular-men`
- Ultimate Modular Women, as `modular-women`
- Universal Animation Library (the free standard version), as `ual1`

The game draws the stage in a worker of its own (`src/render/stage/StageView.ts`): the page hands the canvas over (`OffscreenCanvas`) and only tells the stage what the music is doing, so however long a stage frame takes, the menus, the highway and the input never wait for it. Where a worker cannot draw with WebGL, the same code runs on the page instead. Its shaders are compiled in parallel before its first frame, and only the few people close to the camera are drawn with the detailed figure.

During development, `/#stage?preset=high&shot=hero&level=0.9` shows the stage alone with a simulated song (drawn on the page, so `window.__stage` can be reached from the console).

## Optional: downloaded characters

The game can use other rigged characters with motion-captured animation in place of its own cast. They are not part of this repository, because their licence allows shipping them inside a game but not passing them on. To use them on your machine:

1. Download the files named at the top of `tools/stage/aurora/build_people.py` from [Mixamo](https://www.mixamo.com/) as FBX into `local-audio/mixamo/`: the band members with their animation and skin, the crowd characters in T-pose, the crowd animations without skin.
2. Run `blender -b --factory-startup -P tools/stage/aurora/build_people.py`.

The script reduces the crowd characters to a few hundred triangles, bakes their textures into vertex colours, retargets the crowd animations onto each of them and writes the result to `public/stage/aurora/local/`, which git ignores. When that folder exists the game loads it instead of the default cast, in development and in builds made from that checkout. Check the characters' current terms before you distribute such a build.

Both scripts write the same format: plain meshes whose vertices carry up to four joints and weights, and a small texture of joint matrices per animation frame, which the game uses to animate thousands of instances in a vertex shader.
