# Track editor

The **Edit** tab of the main menu is the list of your tracks, with the highlighted track's sixteen charts beside it (which are yours, which are the game's). Pick a track to open it in the editor, or bring in a new one with **New track** and choose how it gets its first charts:

- **Analyze** – the game charts the song as usual and you change what you like.
- **Start from scratch** – no analysis. The game only listens for the tempo (a few seconds, on any device, phones included) and you get empty lanes with the bar lines in place.

A song has sixteen charts: four parts (vocals, lead, bass, drums) at four difficulties. Each is edited on its own; a chart you never touch stays the one the game wrote. The game plays your chart in place of its own, charts save as you change them, and **Put back the game's chart** in the menu drops your version again.

The editor shows the lanes from above, as they run in a song: later is higher, and one line across them is the edit position and the playhead. The chart moves past the line. Beside the lanes stand the song's waveform and, for an analyzed song, a guide to what the game heard in that part.

|                         | Keyboard                                      | Controller                                                             | Mouse or touch                                    |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| Move                    | arrow keys; `PgUp` `PgDn` a bar; `Home` `End` | D-pad or left stick; triggers a bar; right stick runs through the song | wheel or drag; pinch or `Ctrl`+wheel to zoom      |
| Note                    | `Enter`, or `1` to `5` for a lane             | confirm                                                                | click or tap a lane; again to take it away        |
| Long note               | hold `Enter`, move up                         | hold confirm, move up                                                  | drag up from the note (on touch: hold, then drag) |
| Mark a stretch          | `Shift` + arrows, then `Enter`                | left face button, move, then confirm                                   | Select tool, or `Shift`+drag                      |
| Grid                    | `Q` `E`                                       | shoulder buttons                                                       | the arrows beside Grid                            |
| What notes snap to      | `S`                                           | left stick click                                                       | the Snap button                                   |
| Loop the marked stretch | `L`                                           | right stick click                                                      | the loop button                                   |
| Next note, next sound   | `Ctrl` or `Alt` + arrows                      | Snap to sounds, then move                                              | Snap to sounds                                    |
| Play                    | `Space`                                       | top face button                                                        | the play button                                   |
| Undo, redo              | `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z`                | View / Create; redo in the menu                                        | the arrows in the toolbar                         |
| Everything else         | `M`                                           | Options / Menu                                                         | Menu                                              |

A marked stretch can be copied, cut, repeated after itself (the quick way to write a bar four times), mirrored, deleted, or made an overdrive phrase; long notes in it can be made hold-and-release notes.

**Hold-and-release notes** are made the way the game draws them, as a hold with a tile at its end: set a tile down on a long note and the note ends there and must be let go there; or stretch a long note until it reaches a tile in its lane and that tile becomes its end. A tile set on the end of such a note takes the release away again. (`H`, or **Let go on time** in the menu, switches it for the long note under the cursor without changing its length.) Notes played in while recording are always notes of their own. What is copied can be pasted into another part or difficulty (a fifth lane folds onto the fourth).

**Snapping.** Notes snap to the grid (quarters down to thirty-seconds, with triplets), to the sounds heard in the song, or to nothing:

- _The grid_ is the default: every note lands on a grid line, and a cursor step is one line.
- _Sounds_ puts a note on the nearest sound when one is within 90 ms, and the cursor steps from sound to sound. The sounds are what the analysis heard in that part or, for a song without one, every attack in the waveform; they show as ticks beside the lanes.
- _Nothing_ places notes exactly where they are put, and a recording keeps the timing it was played with.

**Tools** (in the menu, and under More tools on a selection): snap notes to the grid or to sounds, fill a marked stretch with a note on every grid line, move a lane left or right, play a stretch backwards, thin it out, make it twice or half as fast. **Quantize all notes** and **Clear all notes** are in the menu under This chart.

**Difficulties.** _Write the easier charts from this one_ writes every easier difficulty of the part as a simpler version of the chart above it (the rhythm that difficulty plays, fewer notes in a bar, smaller chords, four lanes); _Simplify from …_ does it for one chart. **Check the chart** lists what stands out on its difficulty (notes very close together, chords larger than usual, two notes under one thumb on a controller) and goes to each.

**On a controller** every control on screen carries the button that reaches it, the Controls panel lists them all, and everything else is in the menu (Options or Menu), where each row and button says in a line what it does.

- **Record** (`R`) plays the song from a bar before the cursor and turns every lane press into a note on the grid, with the keys, buttons and lanes you play the game with. A press that is held becomes a long note. It works at every speed down to a quarter, and can add to the notes that are there or replace the ones it passes.
- **Test play** (`T`) runs the chart in the game itself from the bar the cursor is in, and returns to the editor, undo history and all. It keeps no score.
- **Tempo and bars** sets the grid notes snap to: following the beats heard in the song, or one tempo with a first beat and a number of beats in a bar. Tap the beat, put a bar line at the cursor, or let the game listen again. Notes stay on their beats when the grid changes.
- **Listening**: a click on every note and a metronome, three slower speeds, looping the marked stretch, and any of the song's separated stems on its own.
- **Step entry**: with _After a note: Move on a step_, the cursor moves on after each note, so a run is written by pressing lanes one after another.

The code is in `src/editor` (the grid, the chart being edited, the canvas, the controller behind the screen) and `src/ui/Editor*.tsx`.
