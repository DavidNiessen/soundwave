# 3D venues

The 3D stage behind the highway and the menus stands in a **venue**. The game ships with one, Moonrise. A
player's stage (Stage tab) names the venue it stands in, then sets its colours, light, sky and show on top.

Every venue follows one **schema** ([`src/render/stage/venueSchema.ts`](../src/render/stage/venueSchema.ts)).
A venue only says _where_ things are: its lights, camera spots, band, screen and pyro. _What_ they do is the
game's, the same in every venue. So the light show, the camera director, the band and the fireworks work in a new
venue without any code of its own.

## Adding a venue

1. Put its files in a folder of their own under `public/`, for example `public/stage/club/` (see
   [The venue folder](#the-venue-folder)).
2. Add an entry to `VENUES` in [`src/render/stage/venues.ts`](../src/render/stage/venues.ts):

   ```ts
   { id: 'club', name: 'Club', description: 'A low room with a mirror ball.', folder: 'stage/club/' }
   ```

3. Run `pnpm test`: `tests/venueSchema.test.ts` checks every listed venue against the schema and names
   anything missing or wrong.

Once there's more than one venue, the stage editor's **Venue** row becomes a choice. Changing a stage's venue
rebuilds the 3D stage with that venue's files. Stages saved with a venue that no longer exists fall back to the
first one. A venue that breaks the schema fails to load with a message that lists every problem.

## The schema (`venue.json`, version 2)

Coordinates are three.js: metres, y up, the crowd towards +z.

### Light fixtures

`fixtures` is a list of `{ role, pos, dir }`, with optional `length` (metres) and `spread` (beam width as a
share of its length). `dir` is where the fixture points at rest. A venue places as many of each role as it
likes, and needs at least one `main`.

| Role     | What the light show does with it                                               | Beam (length, spread) |
| -------- | ------------------------------------------------------------------------------ | --------------------- |
| `main`   | Moving heads over the stage: the main show. They sweep, fan out and chase.     | 50 m, 0.034           |
| `sky`    | Searchlights into the sky: slow drifts high above, every other one lit.        | 90 m, 0.02            |
| `halo`   | A ring over the band: each head stays on its player and breathes with the bar. | 17 m, 0.075           |
| `truss`  | Washes on the truss: a steady glow that swells with the bar and the bass.      | 34 m, 0.045           |
| `floor`  | Lights on the stage floor: they swing slowly and pulse on the beat.            | 26 m, 0.04            |
| `ribbon` | Lenses along decoration: glints rather than beams.                             | 40 m, 0.03            |
| `house`  | Front of house and delay towers: a low, steady light over the crowd.           | 50 m, 0.02            |

The player's stage colours them all: the key colour on most, the accent on every third and on the sky lights.

### Camera spots

`cameras` holds named spots `{ pos, target, hfov }` (hfov in degrees). The director builds its shots from them,
plus close-ups around the band.

| Spot     | Needed | The shot                                          |
| -------- | ------ | ------------------------------------------------- |
| `front`  | yes    | From the crowd straight at the stage, pushing in. |
| `hero`   | yes    | The whole stage from the side, orbiting slowly.   |
| `crowd`  | no     | Down among the audience, trucking along.          |
| `close`  | no     | Close to the band, pulling back.                  |
| `aerial` | no     | High above, orbiting.                             |

### Everything else

| Field       | Needed | What it is                                                                                     |
| ----------- | ------ | ---------------------------------------------------------------------------------------------- |
| `version`   | yes    | `2` (version `1`, Moonrise as first built, is read too: see below).                            |
| `band`      | yes    | Where each part stands: `lead`, `vox`, `bass`, `drums`, as `[x, y, z]`.                        |
| `moon`      | yes    | The main screen: `center`, `radius` of the round picture, optional `arch` outline.             |
| `deck`      | yes    | The stage floor's outline: `center`, half axes `a`, `b`, `power`, `height`, `barrier`.         |
| `fireworks` | yes    | Fans of sparks `{ origin, n, spread, length: [min, max], lean }`; may be empty.                |
| `co2`       | yes    | CO2 nozzle positions; may be empty.                                                            |
| `island`    | no     | The platform the band plays on: `center`, half axes `a`, `b`.                                  |
| `podiums`   | no     | Per player `{ rx, ry, travel }`: their podium and how far it rises (meshes `Podium_<part>_*`). |
| `clear`     | no     | Spots in the audience kept free (`{ pos, radius }`): the mix position, towers.                 |

**Version 1** named fixtures by where they hang (`group`: `Shell0`, `Shell2`, `Sky`, `Halo`, `Truss`, `Floor`,
`Ribbon`, `Delay`, `Foh`). These are read as their roles, with the beam sizes Moonrise was made with, so it looks
as it always did. New venues write `role`.

## The venue folder

The renderer ([`src/render/aurora/`](../src/render/aurora/)) loads these files from the folder:

| File                                     | What it is                                                                                                                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venue.json`                             | The schema above.                                                                                                                                                                                  |
| `venue.glb`                              | The stage itself: shape, baked contact shading, and a material role in each mesh's extras (`kind`: `paint`, `screen`, `deck`, `podium`, `lamp`, …; see `materials.ts`). Draco compression is fine. |
| `band.glb` / `band.json` / `band.bin`    | The band: skinned characters, their clips, and the baked animation. Can be copied from Moonrise.                                                                                                   |
| `crowd.glb` / `crowd.json` / `crowd.bin` | The audience, the same way. Can be copied from Moonrise.                                                                                                                                           |
| `scenery.glb` / `scenery.json`           | The land around the stage (optional): terrain, water, the far shore's lights, the moon's direction.                                                                                                |

Moonrise is made by the Blender scripts in [`tools/stage/aurora/`](../tools/stage/aurora/):

```
blender -b --factory-startup -P tools/stage/aurora/build_venue.py -- --out public/stage/aurora
```

A new venue's own build script writes the same files.

## Later

- A venue that needs a renderer of its own (not the Moonrise kind) would get an `engine` field in `VenueInfo`,
  and the stage host would build that engine's stage for it.
- Venues brought in by the player (a folder or a zip of the files above) could be kept like stage videos are
  ([`src/storage/stageMedia.ts`](../src/storage/stageMedia.ts)), checked with `readVenue`, and listed after the
  built-in ones.
