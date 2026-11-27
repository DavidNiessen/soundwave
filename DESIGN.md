---
name: Soundwave
description: A rhythm game that charts your own music; its menus are the night sky over an open-air stage.
colors:
  night: '#0e0828'
  deep: '#1a0f4c'
  panel: 'rgb(8 6 18 / 0.52)'
  panel-solid: 'rgb(9 7 20 / 0.84)'
  raised: 'rgb(255 255 255 / 0.09)'
  row: 'rgb(255 255 255 / 0.055)'
  row-hi: 'rgb(255 255 255 / 0.13)'
  well: 'rgb(0 0 0 / 0.32)'
  line: 'rgb(255 255 255 / 0.12)'
  glass-edge: 'rgb(255 255 255 / 0.11)'
  violet: '#5b3ee0'
  ink: '#f6f3ff'
  ink-2: '#d2c9fa'
  ink-3: '#aba1e6'
  pink: '#ff4d9d'
  pink-2: '#ff7ab8'
  pink-ink: '#2c0421'
  mint: '#5df2d6'
  lit: '#efeaff'
  lit-ink: '#1d1263'
  gold: '#ffd23d'
  danger: '#ff5a72'
  danger-2: '#ff8597'
  ok: '#62e89a'
  lane-0: '#3ddc5a'
  lane-1: '#ff3b4e'
  lane-2: '#ffd23d'
  lane-3: '#3a8bff'
  lane-4: '#ff8a1f'
  overdrive: '#bfe6ff'
  showdown-1: '#3d6bff'
  showdown-2: '#8a4dff'
  showdown-3: '#c04dff'
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: 'clamp(1.7rem, 3.4vw, 3rem)'
    fontWeight: 900
    lineHeight: 1
    letterSpacing: '-0.01em'
    fontVariation: "'wdth' 112"
  page-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: 'clamp(1.6rem, 2.9vw, 2.7rem)'
    fontWeight: 900
    lineHeight: 1
    letterSpacing: '-0.01em'
    fontVariation: "'wdth' 112"
  wordmark:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: 'clamp(1.6rem, 2.6vw, 2.5rem)'
    fontWeight: 900
    lineHeight: 1
    letterSpacing: '-0.01em'
    fontVariation: "'wdth' 112"
  tile-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: 'clamp(1.15rem, 1.7vw, 1.6rem)'
    fontWeight: 900
    lineHeight: 1
    letterSpacing: '-0.01em'
    fontVariation: "'wdth' 112"
  panel-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '1.25rem'
    fontWeight: 900
    lineHeight: 1
    letterSpacing: '-0.01em'
    fontVariation: "'wdth' 112"
  score:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: 'clamp(3rem, 7.4vw, 5.6rem)'
    fontWeight: 900
    lineHeight: 1
    letterSpacing: '-0.01em'
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 112"
  stat:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '1.6rem'
    fontWeight: 900
    lineHeight: 1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 112"
  control:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 850
    letterSpacing: '0.01em'
    fontVariation: "'wdth' 100"
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '0.95rem'
    fontWeight: 800
    letterSpacing: '0.07em'
    fontVariation: "'wdth' 100"
  item-title:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '1.05rem'
    fontWeight: 800
    lineHeight: 1.2
    fontVariation: "'wdth' 100"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '1rem'
    fontWeight: 500
    lineHeight: 1.35
    fontVariation: "'wdth' 100"
  pill:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '0.85rem'
    fontWeight: 800
    letterSpacing: '0.04em'
    fontVariation: "'wdth' 100"
  caption:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: '0.82rem'
    fontWeight: 800
    letterSpacing: '0.05em'
    fontVariation: "'wdth' 100"
rounded:
  s: '0.45rem'
  m: '0.75rem'
  l: '1.1rem'
  well: '1.05rem'
  hud: '12px'
  round: '50%'
spacing:
  list-gap: '0.4rem'
  control-gap: '0.6rem'
  panel-pad: '0.9rem'
  panel-pad-lg: '1.1rem'
  column-gap: 'clamp(0.9rem, 2vw, 2rem)'
  gutter: 'clamp(0.9rem, 3.2vw, 3.5rem)'
  target: '2.75rem'
  target-touch: '3rem'
  bar: '4.1rem'
  bar-touch: '4.5rem'
components:
  button:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.ink}'
    typography: '{typography.control}'
    rounded: '{rounded.m}'
    padding: '0.4rem 1.15rem'
    height: '{spacing.target}'
  button-hover:
    backgroundColor: '#4a31c4'
    textColor: '{colors.ink}'
  button-disabled:
    backgroundColor: 'rgb(54 34 152 / 0.4)'
    textColor: 'rgb(171 161 230 / 0.75)'
  button-primary:
    backgroundColor: '{colors.pink}'
    textColor: '{colors.pink-ink}'
    typography: '{typography.control}'
    rounded: '{rounded.m}'
    padding: '0.4rem 1.6rem'
    height: '{spacing.target}'
  button-primary-hover:
    backgroundColor: '{colors.pink-2}'
    textColor: '{colors.pink-ink}'
  button-primary-disabled:
    backgroundColor: '#5a2a5c'
    textColor: '#d3a9c6'
  button-quiet:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.m}'
    padding: '0.4rem 1.15rem'
  button-quiet-hover:
    backgroundColor: 'rgb(255 255 255 / 0.1)'
    textColor: '{colors.ink}'
  button-small:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.m}'
    padding: '0.3rem 0.95rem'
    height: '2.4rem'
  button-live:
    backgroundColor: '{colors.pink}'
    textColor: '{colors.pink-ink}'
  button-danger:
    backgroundColor: '{colors.danger}'
    textColor: '#2a0410'
  button-danger-hover:
    backgroundColor: '{colors.danger-2}'
    textColor: '#2a0410'
  icon-button:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.round}'
    size: '{spacing.target}'
  icon-button-hover:
    backgroundColor: 'rgb(255 255 255 / 0.12)'
    textColor: '{colors.ink}'
  hold-button:
    backgroundColor: '{colors.pink}'
    textColor: '{colors.pink-ink}'
    rounded: '{rounded.m}'
    height: '4.6rem'
  hold-button-fill:
    backgroundColor: '#ffc4e0'
  keycap-hint:
    backgroundColor: '{colors.lit}'
    textColor: '{colors.lit-ink}'
    rounded: '0.35em'
    padding: '0 0.4em'
    height: '1.6em'
  keycap-hint-on-primary:
    backgroundColor: '{colors.pink-ink}'
    textColor: '#ffd3e8'
  selection:
    backgroundColor: '{colors.lit}'
    textColor: '{colors.lit-ink}'
    rounded: '{rounded.m}'
  choice-well:
    backgroundColor: '{colors.well}'
    rounded: '{rounded.well}'
    padding: '0.3rem'
  choice:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.m}'
    padding: '0.4rem 0.3rem'
    height: '{spacing.target}'
  choice-part:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.m}'
    height: '4.8rem'
  choice-difficulty:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.m}'
    height: '3.6rem'
  choice-selected:
    backgroundColor: '{colors.lit}'
    textColor: '{colors.lit-ink}'
  tab:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    typography: '{typography.control}'
    rounded: '{rounded.m}'
    padding: '0 0.85rem'
    height: '{spacing.target}'
  tab-selected:
    backgroundColor: '{colors.lit}'
    textColor: '{colors.lit-ink}'
  tile:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.l}'
  tile-focus:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.ink}'
  panel:
    backgroundColor: '{colors.panel}'
    textColor: '{colors.ink}'
    rounded: '{rounded.l}'
    padding: '{spacing.panel-pad}'
  dialog:
    backgroundColor: '{colors.panel-solid}'
    textColor: '{colors.ink}'
    rounded: '{rounded.l}'
  song-row:
    backgroundColor: '{colors.row}'
    textColor: '{colors.ink}'
    typography: '{typography.item-title}'
    rounded: '{rounded.m}'
    padding: '0.45rem calc(2.75rem + 0.35rem) 0.45rem 0.45rem'
    height: '4rem'
  song-row-focus:
    backgroundColor: '{colors.row-hi}'
    textColor: '{colors.ink}'
  song-row-picked:
    backgroundColor: 'rgb(96 70 226 / 0.78)'
    textColor: '{colors.ink}'
  slot:
    backgroundColor: '{colors.row}'
    textColor: '{colors.ink}'
    rounded: '{rounded.m}'
    padding: '0.35rem 0.7rem 0.35rem 0.5rem'
    height: '3.5rem'
  slot-empty:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-3}'
    rounded: '{rounded.m}'
  slot-badge:
    backgroundColor: '{colors.lit}'
    textColor: '{colors.lit-ink}'
    rounded: '{rounded.round}'
    size: '2rem'
  search-field:
    backgroundColor: '{colors.well}'
    textColor: '{colors.ink}'
    rounded: '{rounded.m}'
    padding: '0 0.5rem 0 0.9rem'
    height: '{spacing.target}'
  text-input:
    backgroundColor: '{colors.well}'
    textColor: '{colors.ink}'
    rounded: '{rounded.s}'
    padding: '0.4rem 0.7rem'
    height: '2.5rem'
  setting-row-active:
    backgroundColor: '{colors.row}'
    textColor: '{colors.ink}'
    rounded: '{rounded.m}'
    padding: '0.35rem 0.5rem 0.35rem 0.9rem'
    height: '3.5rem'
  setting-row-focus:
    backgroundColor: '{colors.row-hi}'
    textColor: '{colors.ink}'
  value-bar:
    backgroundColor: '{colors.well}'
    textColor: '{colors.ink}'
    rounded: '{rounded.s}'
    height: '2.3rem'
  value-bar-fill:
    backgroundColor: '{colors.violet}'
  stepper:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.round}'
    size: '2.4rem'
  option:
    backgroundColor: 'transparent'
    textColor: '{colors.ink-2}'
    rounded: '{rounded.s}'
    padding: '0.55rem 0.9rem'
  option-selected:
    backgroundColor: '{colors.lit}'
    textColor: '{colors.lit-ink}'
  keycap:
    backgroundColor: '{colors.raised}'
    textColor: '{colors.ink}'
    rounded: '{rounded.s}'
    padding: '0 0.8rem'
    height: '{spacing.target}'
    width: '3rem'
  keycap-listening:
    backgroundColor: '{colors.pink}'
    textColor: '{colors.pink-ink}'
  pill:
    backgroundColor: 'rgb(210 201 250 / 0.16)'
    textColor: '{colors.ink-2}'
    typography: '{typography.pill}'
    rounded: '{rounded.s}'
    padding: '0.2rem 0.6rem'
  pill-ready:
    backgroundColor: 'rgb(98 232 154 / 0.18)'
    textColor: '#a4f7c4'
  pill-error:
    backgroundColor: 'rgb(255 90 114 / 0.2)'
    textColor: '#ffb1bd'
  tag-new-best:
    backgroundColor: '{colors.pink}'
    textColor: '{colors.pink-ink}'
    rounded: '{rounded.s}'
    padding: '0.2rem 0.6rem'
  tag-full-combo:
    backgroundColor: '{colors.gold}'
    textColor: '#2a1d00'
    rounded: '{rounded.s}'
    padding: '0.2rem 0.6rem'
  stat-cell:
    backgroundColor: '{colors.well}'
    textColor: '{colors.ink}'
    typography: '{typography.stat}'
    rounded: '{rounded.m}'
    padding: '0.7rem 0.8rem'
  cover:
    backgroundColor: '{colors.deep}'
    rounded: '{rounded.s}'
  notification:
    backgroundColor: '{colors.panel-solid}'
    textColor: '{colors.ink}'
    rounded: '{rounded.m}'
    padding: '0.6rem 0.6rem 0.65rem 0.7rem'
  hud-panel:
    backgroundColor: 'rgb(16 9 50 / 0.76)'
    textColor: '{colors.ink}'
    rounded: '{rounded.hud}'
    padding: 'clamp(6px, 0.6vw, 12px) clamp(12px, 1vw, 20px)'
  hud-dial:
    backgroundColor: 'rgb(16 9 50 / 0.76)'
    textColor: '{colors.ink}'
    rounded: '{rounded.round}'
    size: 'clamp(62px, 5.4vw, 104px)'
  hud-star:
    backgroundColor: 'rgb(16 9 50 / 0.76)'
    rounded: '{rounded.round}'
    size: 'clamp(34px, 3vw, 58px)'
  hud-lane-key:
    backgroundColor: 'rgb(0 0 0 / 0.62)'
    textColor: '{colors.ink}'
    rounded: '5px'
    padding: '0 0.45em'
    height: '1.75em'
---

# Design System: Soundwave

## Overview

**Creative North Star: "The Night Sky Over the Stage"**

The menus are the night sky over an open-air stage. The live 3D stage idles behind every screen, a veil of deep indigo and violet lies over it with a faint band of aurora light across the top, and the interface floats in front as rounded panes of dark frosted glass: smoked black that blurs the stage behind it, with a fine light edge and a catch of light along the top. Only the large panes blur (panels, cards, dialogs and the long lists); rows and buttons on them are see-through white layers, lit brighter where the player is. One aurora-mint ring is the player's place on the screen: it travels from control to control as they move with the keyboard or a controller, taking each control's size and corner radius as it lands. What the player has chosen is a pale lavender sheet with dark ink on it, and when the choice changes that sheet slides to the new item. Hot pink is the single step forward on a screen. Gold is only ever something the player earned. The player's own cover art and the stage carry most of the colour; the glass stays colourless so the covers and the one pink action read first.

The type does the shouting. Archivo is set wide, black, leaning and uppercase for titles, tile names and numbers; at normal width, leaning and uppercase for control labels; and at normal width and upright for everything a player reads as a sentence. Everything is rounded: three radii for sheets and controls, full circles for icon buttons, badges and the HUD's dials. Sizes are in rem off a root that grows with the window and is multiplied by the player's own interface-size setting, so the same layout reads on a phone, at a desk and from across a room.

The interface is built for four inputs and shows the one in use. The root element carries `data-input` (mouse, keyboard, pad or touch), set from the last input the player used, and the interface changes variant with it: keycaps or controller symbols as hints, hover or the travelling ring, larger targets under a finger. During play the menu world steps back: the HUD is quiet chrome around the highway, and nothing in it moves for decoration.

**Key Characteristics:**

- Layered violet night: indigo ground, a violet glow rising from below, the live stage behind a veil, an aurora band across the top.
- Rounded violet sheets (0.45, 0.75 and 1.1rem radii) with no borders and no shadow at rest.
- Four light roles that never trade places: pink acts, mint is the focus ring, lavender with dark ink is the selection, gold is earned.
- One focus ring and one selection sheet per group, and both travel instead of blinking.
- Lane colours are data (lane, difficulty, multiplier level, key binding), not decoration.
- One family, three registers: wide black italic uppercase, normal-width italic uppercase for controls, normal-width upright for reading.
- Variants by last input: hints, hover, focus ring, target size and play layout all follow `data-input`.
- Every interaction has a sound; on a controller it also has a pulse. `data-motion='reduced'` keeps state changes and drops travel.

## Colors

A violet night with four lights that have fixed jobs, and five lane colours that carry game data.

### Primary

- **Hot Pink** (pink): the one forward action on a screen or dialog: Ready up in the library's action bar, the hold-to-start button, Add to setlist in the song sheet, Resume on pause, Next song and Done on results. Also anything that is sounding or listening right now: the mark on the song whose preview plays, a key binding while it waits for a press, the calibration dot on the beat. And progress through audio: the HUD's song progress bar and the played part of the editor's waveform. It glows behind the wordmark and the countdown numbers, fills the "New best" tag and is the first sheet of the launch wipe. Text on pink is **Pink Ink** (pink-ink), never white.
- **Pink Light** (pink-2): the hover state of a pink button, the set position in the HUD title ("2/4") and the dashed outline of the file-drop target.

### Secondary

- **Aurora Mint** (mint): focus. It is the 3px ring that travels between controls, with a soft mint glow beneath it: it follows focus for keyboard and controller players and the pointer for mouse players, so pointing at a control looks the same as moving onto it, and the text caret in the search and text fields. As atmosphere it appears once, faintly (20% alpha), as the aurora band in the sky behind the panels. Mint appears nowhere else: the HUD's break-countdown ring is pale lavender (lit) and turns gold on the final bar.

### Tertiary

- **Lavender Light** (lit) with **Lavender Ink** (lit-ink): the selection. The sheet that slides behind the chosen part, difficulty or settings tab; the chosen option in the settings detail pane; the numbered badge on a song that is in the setlist. The same pair makes the keycap hints, so a key reads as a printed cap.
- **Encore Gold** (gold): earned results. Gold stars, the tier beyond five: a score 13% over the song's par (par is a flawless run without overdrive, so gold takes overdrive; a chart with little overdrive to give asks for less, down to par itself) turns all five stars gold, in the HUD (gold discs that glow and breathe), on results (with a "Gold stars" tag) and in every list. On the way there, after the fifth star, gold rises inside the five HUD stars. Ordinary earned stars are not gold but **Star Violet** (star, #c4a6ff). Also the "Full combo" tag, the full-combo tick and underline in best-score tables, the star total on the set summary, the final-bar break ring. On the highway it is also the full streak: once the streak holds the top multiplier the rails and the deck's front lip turn a light, glowing gold (#ffd66b lit toward white) with a gold aura beside them and sparks of gold light rising along both rails, like dust in lantern light: each one small and solid, a white-hot core in a tight amber halo (#ffb52e), some with a four-point glint, swaying a little and sparkling as it fades. They stay close to the rail and are never large or see-through.
- **Warning Red** (danger): destructive confirmation only (the "Delete song and scores" button in the card that asks before a song is removed). Error text uses a softened pink-red (#ffa3b4) and warnings a soft amber (#ffc98a) so sentences stay readable.
- **Warning Red Light** (danger-2): the hover state of a Warning Red button.
- **Ready Green** (ok): the "Connected" status pill, as an 18% wash with pale green text.
- **Showdown Blue to Violet** (showdown-1, showdown-2, showdown-3): a Showdown player's pill over the stage, as one gradient from night blue into violet, so it reads over any stage without taking one of the four light roles. The host's crown and the owner's role are neutral marks, not gold: they are not earned.

### Neutral

- **Night** (night): the page ground behind everything, and the last sheet of the launch wipe.
- **Deep Night** (deep): the backing of covers and cover mosaics while art loads.
- **Panel Violet** (panel): every resting sheet: set tiles, the song card, the setlist, set cards, the ready panel, result panels, the settings detail card. 90% opaque, so the stage is just felt behind it.
- **Solid Panel** (panel-solid): dialogs and sheets that sit over a blurred screen.
- **Raised Violet** (raised): the resting fill of buttons and key-binding caps, and a set tile under focus or the pointer. Under the pointer a button goes one step brighter (#4a31c4).
- **Row** (row) and **Lit Row** (row-hi): list rows at rest and under focus or the pointer: songs, setlist slots, the highlighted settings row. A song that is in the setlist sits between the two (rgb(96 70 226 / 0.78)).
- **Well** (well): recessed places: the search and text fields, the troughs that hold part, difficulty and tab choices, the value bar track, result stat cells, empty best-score cells.
- **Hairline** (line): the only stroke. 1px dividers inside a panel and 2px dashed outlines for empty slots and "add" targets.
- **Signal Violet** (violet): the fill of a settings value bar, and the middle sheet of the launch wipe.
- **Ink** (ink): primary text, slider thumbs, lit tick marks, analysis progress fill.
- **Ink 2** (ink-2): secondary text: artists, captions, unselected choices and tabs, section labels, quiet buttons.
- **Ink 3** (ink-3): tertiary text: slot numbers, counts, stat captions, placeholders.

### Lane colours (data)

- **Lane 0 Green, Lane 1 Red, Lane 2 Yellow, Lane 3 Blue, Lane 4 Orange** (lane-0 to lane-4): the five note lanes left to right: tiles, strike targets, and the light a lane gives off along its length when it is played. They also colour the 3 to 4px underline on a bound key (settings caps, the lane keys under the highway), difficulty pips (Easy green, Medium yellow, Hard orange, Expert red) and multiplier levels on the HUD dial (x2 blue, x3 green, x4 yellow, x5 orange; the top step, x6, is gold). Lane 2 Yellow and Encore Gold are the same value; context tells them apart.
- **Overdrive Ice** (overdrive): the overdrive meter, its ready pulse, the dial while overdrive doubles the multiplier (up to x12), and the "Press … Overdrive" call-out that shows once there is charge to spend. The call-out is small and still: Overdrive Ice text with the key on a dark plate with a thin ice rim, the size of the label it replaces, so it is noticed at the edge of the eye without pulling it off the notes; the meter arc over the dial glows steadily beside it. Overdrive takes the rails, their aura and the motes over in this blue, whatever the streak.

### Named Rules

**The One Ring Rule.** Mint is focus. In a menu it never fills a control, marks a choice, labels a status or decorates; it is the travelling ring, the caret, and the one faint aurora band in the sky.

**The One Pink Rule.** A screen or dialog has at most one pink button at rest, and it is the step forward. Everything else is violet or quiet. A selected item is never pink.

**The Lavender Rule.** A choice is shown by a pale lavender sheet with dark ink, never by pink, mint or an outline. Focus and selection on the same item show both: the lavender sheet with the mint ring around it.

**The Lanes Are Data Rule.** A lane colour always means a lane, a difficulty level or a multiplier level. Never use one as a brand accent or a decorative stripe.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui, sans-serif), self-hosted with its width axis, upright and italic.
**Body Font:** the same family at normal width.

**Character:** one family, three registers. The stage voice (112% width, weight 900, italic, uppercase, -0.01em tracking, line-height 1) is for titles, tile names and numbers. Control labels (normal width, weight 850, italic, uppercase) are for buttons, tabs and option names. The reading voice (normal width, upright, weight 500 to 800, mixed case) is for song names, artists, setting names, help text and errors.

### Hierarchy

- **Display** (900, clamp(1.7rem, 3.4vw, 3rem), 112% width, balanced wrap): "Set complete", "Paused" (clamp(2.2rem, 5vw, 3rem)), "Calibrate", the song title on results (clamp(1.4rem, 2.6vw, 2.4rem)) and in the song sheet (clamp(1.4rem, 2.2vw, 2.1rem)).
- **Page title** (900, clamp(1.6rem, 2.9vw, 2.7rem)): one per screen: "Pick a set" and "Edit a track" on the main menu's two tabs, "Music library", "Track editor", "Ready up", "Settings".
- **Wordmark** (900, clamp(1.6rem, 2.6vw, 2.5rem), pink glow behind): the product name on Home only. The name is a working title; nothing depends on it.
- **Tile and panel titles** (900; tiles clamp(1.15rem, 1.7vw, 1.6rem), panels 1.25rem, settings section headings 1.15rem, the highlighted song 1.2rem).
- **Score** (900, clamp(3rem, 7.4vw, 5.6rem), tabular, not uppercased): the results score and the set total, which count up. Stat values are 1.6rem; the hold button's label is 1.3rem.
- **Control label** (850, 1rem, 0.01em tracking, italic, uppercase, normal width): every button, action, tab and option name.
- **Label** (800, 0.95rem, 0.07em tracking, uppercase, upright, Ink 2): names a group of controls inside a panel: Part, Difficulty, Best scores, Next up.
- **Item title** (800, 1.05rem, line-height 1.2, one line with ellipsis): song names in rows, slots and set cards. Setting names are 1.05rem/700.
- **Body** (500, 1rem, line-height 1.35; help and errors line-height 1.45, max 62ch): artists (0.95rem), help text, hints, errors.
- **Pill and caption** (800, uppercase; pills and tags 0.85rem with 0.04em tracking, stat captions and table heads 0.82rem with 0.05em): status and stat names. These are the smallest text in the interface.

Numbers that change (scores, times, counts, setting values) use tabular figures.

### Named Rules

**The Three Registers Rule.** A title or a number is wide, black, italic and uppercase. A control label is normal width, italic and uppercase. Anything read as a sentence, and every song and artist name, is normal width, upright and in its own case. Never set a sentence in the stage voice.

**The Root Scale Rule.** The root size is `clamp(16px, 0.62vw + 7px, 26px)` multiplied by the player's interface-size setting (`--ui-scale`, 85% to 130%). Every menu size is in rem, so the whole interface grows with the window and with the player's choice. Only the HUD is in px.

## Layout

Each menu screen is a page: a column capped at 104rem, with a horizontal gutter of clamp(0.9rem, 3.2vw, 3.5rem) plus the device's safe areas, a head line (title on the left, a count or status beside it), and a body that scrolls inside itself. The bottom 4.1rem (4.5rem on touch, 3.5rem on short screens) belongs to the action bar.

**Action bar.** What the current screen or dialog can do sits along the bottom edge over a fade to dark: Back on the left, the other actions and the one pink action on the right. Each action shows the hint for the input in use: a keycap for keyboard and mouse, the controller's own symbol for a controller (with a passive "Select" hint beside Back; the small middle buttons are drawn as the buttons themselves, a capsule or disc carrying their symbol such as three bars for Options and Menu, never their name spelled out), nothing for touch, where the icon shows instead. A dialog's actions replace its screen's while it is open. There is no bar during a song. The pause menu is a card of its own (Resume, Restart song, Settings, Skip to next song, Leave); Restart, Skip and Leave each open a second card that says what is lost and asks first, with Go back focused, and Settings opens the settings screen over the paused song with its bar, where Back returns to the pause menu and the song stays paused. The paused song shows through the settings, dimmed as the stage is behind the menus, and is held still while they are open (it is drawn twice a second instead of every frame), so the settings have the machine to themselves; the pause card steps out of the way meanwhile. Volume, audio offset and note speed apply to the paused song at once; tap calibration is switched off there. The bar's buttons stay out of directional navigation while the screen has controls of its own; on a screen that has none (Results, the set summary) they take the focus instead, starting on the pink one, so a controller or the arrow keys always have something to move between. The main menu is the other exception: there the bar's buttons (Add songs, Settings) and Exit can be moved onto like the tiles, so every button on it is reachable with the D-pad as well as by its shortcut. On the home screen, where the game can close itself (the desktop app, or a window installed from the browser), a quiet Exit button sits at the top right; it, Esc and the controller's back button open a small card that asks before closing, with Stay focused first. Restore defaults in the settings asks the same way before it resets the open tab, with Keep my settings focused first. The desktop window has no native title bar in any window mode; in Window mode a 12px strip along the top edge moves it.

- **Home:** the wordmark with two tabs beside it, Play and Edit, in a Well trough with the travelling Lavender sheet; both show their names. Q and E or the shoulder buttons switch between them (hinted at either end), the tab's content enters from the side moved toward, and focus follows into it. The two tabs do not share a shape, because they are not the same kind of place. **Play** is a shelf: "Pick a set" and a row of tiles, up to 30rem tall. **Edit** is a workbench: "Edit a track" with the count beside it, and under it the tracks themselves in the library's layout, filling the tab (see Track editor, the list). There is no screen in between: a press on a track opens it in the editor, and Back from the editor returns to this tab with that track focused. Its action bar offers New track (pink) in place of Add songs. At the right of the head, before Exit: on the website a **Get the app** button outlined and lit in Stage Pink (it opens a card with the download for the player's system first, the other systems under a disclosure, and a link to every release); in the desktop app, when a new release is out, an **Update to x.y** button outlined in gold, which opens a card with what is new and Install and restart. "Your setlist" is the feature: a wide card (flex 1.6) with its covers on the left and, beside them, its name large, its count and length, and its four slots as a numbered list (title and artist, or "Open slot"), sharing the card's height. The suggested sets are smaller cards stacked in a column to its right, each a square of covers beside a title, a caption and a count. An "Add your music" card with a dashed blank joins the column while the library is empty. Between 641px and 1100px the feature stands upright (covers on top, no list); on a phone everything is one column of rows, the feature the tall first one. The home screen appears when the loading screen (see Components) lets go, so the tiles arrive whole and the stage is already behind them; then each rises 2.4rem from 94% size over 0.9s on a soft ease while fading in over 0.5s, 90ms after the one before. A tile that turns up later also opens its own width so its neighbours glide aside. Cover art fades in over 0.35s.
- **Music library:** a toolbar (search field up to 34rem, Sort, Add songs), then two columns, `minmax(0, 1.55fr) minmax(19rem, 1fr)`. Left: the song list, 4rem rows of cover, title, artist, best stars, length and a slot badge. Right: a card for the highlighted song with its best result per part, and the setlist panel with four numbered slots.
- **Song details:** a sheet at the right edge, up to 36rem wide and full height: cover and title (with "Playing a preview" in Pink Light beside the status while the song's preview sounds), Add to or Remove from setlist, a best-scores table of parts by difficulties, and quiet management actions under a hairline (Analyze again, Edit charts, Export, Remove). Remove asks first in a card of its own over the sheet ("Remove this song?", what goes with it, Keep with the focus on it, and "Delete song and scores" in Warning Red); nothing is added to the row of actions.
- **Ready up:** two columns, `minmax(0, 1.25fr) minmax(21rem, 1fr)`. Left: the set as numbered cards with note counts and bests. Right: one panel with Part (four choices, icon over name), Difficulty (four choices, pips over name), the lane count with the bound keys, and the hold-to-start button.
- **Track editor, the list:** the main menu's Edit tab. The library's layout: a search field, then the tracks as rows (cover, title, artist, a pill for how many charts are the player's own, length, an arrow), tracks with charts of the player's own first, with a dashed **New track** row last, and beside them a card for the highlighted song with its sixteen charts as a table of parts by difficulties, each cell "Yours" (Lit Row) or "Game" (Well). Under 900px wide the card goes and the list has the whole width; on a short screen the title goes too. New track is the pink action. A song without charts opens a card that asks how to chart it: two tall buttons, Analyze (pink) and Start from scratch, each with a line that says what it does; while the analysis runs the card shows its progress and the song opens when it is done.
- **Track editor, the editor:** the head (title, the song, "Saved"), a toolbar, then three columns. The toolbar is one line and never breaks onto a second: when what is in it is wider than the bar (long names, a large interface size, a narrow window) it gives things away in steps, first the key marks beside undo and zoom, then the names beside the chosen part, difficulty and tool, then the two rows of choices for the one button that names the chart. The columns are `minmax(14rem, 17rem) minmax(0, 1fr) minmax(15rem, 19rem)`: what is in the chart on the left (the song, four stat cells, the tempo), the stage in the middle, the controls for the input in use on the right. The stage is the whole song on one line (2.4rem), the lanes, and under them the transport: bar and beat on the left, a bar back, play (3.2rem, round), a bar on and Record in the middle, the time on the right. The toolbar holds the part and the difficulty as icon tabs that show the chosen one's name, the grid with a step arrow either side, the Draw and Select tools (mouse and touch only), and undo, redo and zoom as icon buttons. At 1250px the controls column goes into the menu; at 900px the chart column goes too. On a phone one button names the chart and opens the menu, the toolbar is two lines and the song is the title; on a short screen the head goes, the toolbar is one line and the transport stands in a column beside the lanes.
- **Settings:** the title with a row of seven icon tabs at the right of the head; only the selected tab shows its name. Body in two columns, `minmax(0, 1.4fr) minmax(18rem, 1fr)`: sections of rows on the left (name, then a control up to 24rem wide), a detail card for the highlighted row on the right.
- **Results:** two panels side by side, capped at 78rem and centred: cover, title, stars, score and tags on the left; a three-column grid of stat cells and "Next up" on the right. **Set summary:** one column up to 56rem: "Set complete", the total score and star count, then the set as cards.
- **Pause, Calibration:** a centred card up to 24rem wide over the dimmed, blurred screen, with full-width buttons stacked under a display title.

Spacing is a small set of steps: 0.4rem between rows in a list, 0.6rem between controls, 0.9 to 1.1rem of padding inside a panel, clamp(0.9rem, 2vw, 2rem) between columns.

**Responsive.** At 900px wide the side panes fold: the library's setlist becomes a dock above the action bar (its name and count, then four square cover slots with their numbers), the highlighted-song card goes away, the settings detail pane goes away and the highlighted row shows its help text in place, and Ready up and Results become one column. At 640px Home's tiles stack as rows (cover left, words right), the toolbar buttons and the bar's secondary actions shrink to icons while the pink action keeps its words and stretches, dialogs become sheets that rise from the foot of the screen, setting rows stack name over control, and the hold button sticks to the foot of the ready panel. Below 560px of height (a phone on its side) the chrome tightens and, when the screen is wider than 640px, Ready up and Results stay side by side.

**On-screen keyboard.** Pressing a text field with a controller opens a panel of keys along the foot of the screen, above the action bar, while the screen behind stays in view (a search narrows as it is typed). At its top the field's name and its text with a mint caret; below, four rows of ten keys (digits, then letters ending in the commonest marks; a second page holds the symbols) and a bottom row: Shift, Symbols, a long Space, cursor left and right, Delete and a pink Done. Keys are Raised Violet squares that lift to the brighter violet in focus; the bottom row sits on the well colour, and a held Shift or the symbols page is lit. Each shortcut's controller symbol is drawn on its key. A touchpad's cursor is a white ring of light that fades a second after the finger lifts.

**Input variants.** Touch raises the target size from 2.75rem to 3rem and brings small buttons, step arrows and the search clear button up to 2.75rem; step arrows and the per-row details button are always visible. Hover styles apply only when `data-input` is mouse. The ring follows focus with the keyboard or a controller and the pointer with a mouse; touch players never see it. On a controller the mouse pointer is hidden; moving the mouse brings it back along with the mouse variant. On Ready up a controller also gets the button that steps through the parts and the one that steps through the difficulties, each to the left of its row.

### HUD

The HUD is sized in px (with vw clamps) because it sits over the highway's own geometry, which it reads from `--hw-x`, `--hw-y` (the strike line), `--hw-w`, `--lane-w` and `--hw-foot` (the row of lane labels). On a wide screen the strike line sits 80% down and the deck spans about 37% of the width there; it runs on past the foot of the screen, so everything below the strike line stands on the deck: the multiplier dial in the middle, the overdrive meter arching over it, the overdrive prompt (its name and key) beside it on the dial's centre line, and at the foot of the screen each lane's key or controller button under its lane. To the left of the deck, level with the strike line, a slanted tag says how the last note was hit, with the streak above it. The left edge holds one column, bottom up: the score, the stars, and the song (artist, title, timeline, time left). Nothing sits at the top of the screen but the pause button.

On touch the lanes themselves are the controls. The deck runs to the foot of the screen (strike line at 99.2%), the strike targets become finger-sized rounded squares outlined in the lane colour, and a tap anywhere along a lane plays it, following the deck's perspective. The chrome moves up and to the sides: score and stars top left, progress as a strip across the very top, feedback in the middle at 25% height, and one column down the right edge on a shared centre line: pause at the top, then from 30% height the 64px dial with the 64px round overdrive button under it, whose own ring is the overdrive meter (or that button alone on the left edge, level with the dial, if the player chose the left side).

## Elevation & Depth

Depth comes from layers of night, not from shadows. From back to front: the indigo ground with a violet glow rising from below, the live stage, a veil that darkens it (thinner on Ready up, Results and the summary so the stage shows more), then the panels. Panels are flat violet sheets with no border and no shadow at rest; they separate from the night by fill alone, and rows and wells separate from panels the same way. (The direction called for a lit top edge on panels; the build does not draw one.) The few shadows mark things that sit above a screen: the focus ring's glow, the selection sheet, dialogs and notifications. Overlays dim the screen to 74% and blur it 8px.

### Shadow Vocabulary

- **Ring glow** (`outline: 3px solid var(--mint); outline-offset: 3px; box-shadow: 0 12px 28px -4px rgb(93 242 214 / 0.42)`): the travelling focus ring.
- **Selection sheet** (`box-shadow: 0 8px 18px -8px rgb(0 0 0 / 0.6)`): under the lavender selection.
- **Dialog** (`box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.7)`): sheets and cards over the dimmed screen.
- **Notification** (`box-shadow: 0 18px 34px -16px rgb(0 0 0 / 0.85)`).
- **Lane underline** (`box-shadow: inset 0 -3px 0 var(--lane)`, 4px on settings caps): the lane colour of a bound key. The same inset in gold marks a full combo in the best-scores table.
- **Text glow** (wordmark `0 0.08em 0.5em rgb(255 77 157 / 0.55)`, countdown `0 0 40px var(--pink)`): the only glows in the menus.
- **Gameplay glow** (`0 0 14px` to `0 0 26px` in Overdrive Ice; `drop-shadow(0 0 8px)` on the break ring): the overdrive meter when ready or active, and the break ring.

### Named Rules

**The Flat Sheets Rule.** Nothing has a shadow at rest. A panel is a fill; a row is a lighter fill; a well is a darker one. Shadow is reserved for the ring, the selection, and things that float over a screen.

**The Lit State Rule.** Focus is the ring plus the control's own lit state: a row brightens to Lit Row, a set tile rises 0.4rem and brightens to Raised Violet. Under the mouse the control shows the same lit state without the ring.

## Shapes

Rounded and upright. Three radii do almost everything: 0.45rem for covers, pills, tags, caps, fields and option rows; 0.75rem for buttons, rows, slots, choices, tabs and stat cells; 1.1rem for panels, tiles, dialogs and set cards. A trough that holds choices is 0.3rem rounder than what it holds (1.05rem), so the selection sheet nests inside it. Icon buttons, step arrows, slot badges, pips, slider thumbs, the calibration pad and the HUD's star discs, dial, pause and touch overdrive buttons are full circles. A dialog sheet rounds only the corners that face the screen.

There are no borders on filled shapes. The only strokes are 1px hairline dividers and the 2px dashed outline that means "empty, something goes here" (empty slots, the add row, the add tile, the drop target). Icons are line icons at one stroke weight (2.25).

Cover mosaics tile up to four covers into one square (one fills it, two split it, three give the first a full column). A song without art gets a generated cover: two flat colour fields split on the 52% diagonal, with the song's initial set huge in the stage voice.

The lean of the italic type is the only slant; shapes themselves are never skewed.

## Components

### Buttons

Rounded violet blocks under a leaning uppercase label, with a line icon or an input hint in front.

- **Shape:** 0.75rem radius, at least 2.75rem tall (3rem on touch), padding 0.4rem 1.15rem. Small is 2.4rem (2.75rem on touch). Wide fills its row and aligns left.
- **Default:** Raised Violet with Ink.
- **Primary:** Hot Pink with Pink Ink; one per screen or dialog.
- **Quiet:** no fill, Ink 2 label; used for management actions in the song sheet.
- **Live:** a button for something that is sounding or listening is pink while it is: the editor's play button while the song plays, its Record button while it records.
- **Danger:** Warning Red with dark text, only after a first Remove press, beside a quiet "Keep".
- **Hover (mouse only):** one step brighter (#4a31c4; Pink Light on primary; a 10% white wash on quiet).
- **Pressed:** scales to 0.96.
- **Disabled:** 40% Raised Violet with dimmed Ink 3; a disabled primary is a dull plum (#5a2a5c).
- **Icon buttons:** round, 2.75rem, Ink 2, no fill at rest; a 12% white wash under the mouse; scale to 0.9 when pressed.

### Hints

A hint says how to reach a control from the input in use. Keyboard and mouse: a small Lavender keycap (0.8rem, weight 800, upright, 0.35em radius); on a pink button the cap is Pink Ink with pale pink text. Controller: the controller's own button symbol in the chosen style. Touch: none. In the action bar a hint replaces the action's icon.

### Focus ring

One element for the whole interface. Each frame it reads the focused control's box and corner radius and moves to it: a 3px mint outline 3px off the control with a mint glow beneath. Between controls it glides in 200ms; arriving from nowhere or onto a new screen it fades in on the spot (0.16s). It shows only when the last input was the keyboard or a controller. The focused control also carries `.is-focus` for its own lit state. A control can opt out with `data-ring="none"` (the dialog container, the calibration pad).

### Travelling selection

One Lavender sheet per group (0.75rem radius, soft drop) that slides to the chosen item over 0.36s, resizing as it goes; the first placement appears in place. The chosen item's label turns Lavender Ink. Used by the part choices, the difficulty choices and the settings tabs, each inside a Well trough with 0.3rem of padding. The settings detail pane shows its chosen option with the same fill, placed statically.

### Choices (part and difficulty)

Radio groups in a trough of four equal columns. Part: icon over name, 4.8rem tall, the icon growing to 1.12 when chosen, with a 1 to 4 keycap in the corner for keyboard and mouse, in the order Vocals, Lead, Bass, Drums. A part the set hardly has (no song in it has more than a trace of it) stays in its place, dimmed to 42% and without its keycap, and cannot be chosen or stepped onto; one line in Faint Ink under the row says why ("This song has almost no vocals, so that part is off") and that a chart written for it in the editor turns it on. The set then plays on the chosen part if it has it, else on the first one it has; the player's choice itself is kept. Difficulty: four round pips lit to the level in its lane colour over the name, 3.6rem tall. On a controller the top face button (Triangle, Y) steps round the parts and the left face button (Square, X) round the difficulties, each symbol shown beside its label; on a keyboard 1 to 4 pick the part and Q and E step the difficulty (the shoulder buttons do too). The hold button below carries the controller's confirm symbol, 3rem tall, at its left end while a controller is in use, with its words still centred. Unchosen labels are Ink 2.

### Hold to start

The pink button that starts a set asks to be held: a paler pink (#ffc4e0) fills it from the left over 650ms while a pointer, Enter, Space or the controller's confirm button is down, and it fires when full; letting go early drains it. It carries the part and difficulty as its label (1.3rem stage voice) and one line beneath that says what to do or why it cannot start. Activated without a press (assistive technology) it fires at once. If nothing starts, it empties after 2.6s and can be held again. On phones it sticks to the foot of the ready panel.

### Set tiles

Panel Violet sheets with a 1.1rem radius: a cover mosaic filling the top, then title, caption and count. They rise in one after another (55ms apart). Under focus or the mouse a tile lifts 0.4rem and brightens; pressed it scales to 0.98. On phones tiles are rows and do not lift.

### Song rows and setlist slots

- **Song row:** Row fill, 0.75rem radius, 4rem tall: a 3.1rem cover, title over artist, then best stars or analysis state, length and a 2rem round badge. The badge shows a plus when the song can be added and becomes a Lavender disc with the slot number, popping in, when it is in the set; the row itself brightens. Pressing a ready row adds or removes it; a row that is not ready opens its details. Analysis shows as a 3px Ink bar along the row's foot and a percentage, not a pill; only problems ("Not analyzed", "Analysis failed") get a pill. A round details button sits inside the row at its right end, shown under the mouse and always on touch.
- **Slot:** a numbered row (number, 2.7rem cover, title over artist, a small x) that slides in from the left when filled; pressing it removes the song. Empty slots are dashed outlines reading "Pick a song" or "Empty". In the phone dock a slot is a square cover with its number in the corner.
- **Add row:** a dashed row at the end of the list with a plus on a Raised Violet square.

### Settings rows

Every row is one focus stop: name on the left, control on the right. The highlighted row takes the Row fill (Lit Row under focus) and its name turns Ink.

- **Choice:** round step arrows either side of the value's name, with one tick per option beneath and the current tick lit in Ink. Left and right change the value; pressing the row cycles it. The arrows show only on the highlighted row (always on touch).
- **Value bar:** a Well track at least 2.3rem tall, filled from the left in Signal Violet with the value printed on top; drag it, use the arrows, or press left and right.
- **Bindings:** caps in Raised Violet with a 4px underline in the lane's colour; a cap that is listening turns pink and pulses. Fixed bindings are dimmed. Left and right move through a row's caps in order and stop at its ends; up and down go to the cap above or below, in the next row of bindings too, so every cap is reached with a controller or the arrow keys.
- **Action and text rows:** a small button, or a Well text field with a mint caret and a status pill beside it.
- **Detail pane (wide screens):** a panel naming the highlighted setting, explaining it, and listing a choice's options (each with its own help) to pick directly, or a slider's value and range. On narrow screens the same help text opens inside the highlighted row.

### Tabs

Seven icon tabs in a Well trough; only the selected tab shows its name, on the travelling Lavender sheet. Q and E on a keyboard or the shoulder buttons on a controller switch tabs, hinted at either end of the row; focus follows onto the new tab's first setting, and the list enters from the side the player moved toward. On phones the row scrolls and keeps the chosen tab in view.

### Fields

- **Search:** a Well field with a search icon, a "/" keycap hint for keyboard and mouse, and a round clear button once there is text; it darkens while focused. Esc clears it first, then leaves it.

### Pills, tags, stars and pips

Pills and tags are small uppercase labels (0.85rem, 0.45rem radius): a neutral lavender wash, a green wash for ready, a red wash for errors. Results tags are solid: pink "New best", gold "Full combo" with dark text. Stars are five drawn outlines, filled gold when earned. Pips are four 0.6rem dots lit to the difficulty's level in its lane colour.

### Dialogs

A dialog dims and blurs the screen, takes focus and directional navigation (a control that focus moves to keeps 1.2rem clear of the dialog's edge, and a move up or down with no control further that way scrolls the panel on, so what lies past the last control can be read), keeps Tab inside, and closes on Esc, the controller's back button, its round close button or a press outside; focus returns where it was. The **sheet** variant sits at the right edge on wide screens and rises from the foot on phones. The **card** variant is centred (pause, calibration). Calibration shows a 9rem round pad with a dot that turns pink on every other click, and a tap count.

### Notifications

Short news that comes and goes by itself (`ui/notify.ts` raises them, `ui/Notifications.tsx` shows them). Each is a Solid Panel card (0.75rem radius, the glass edge and blur, the notification shadow) with a round icon on a wash of its tone's colour, the message in body type, a close mark (the Dismiss a notification key on the newest one for a keyboard, Z by default) and a 2px line along its foot in the tone's colour that runs out with the time it has left. A faint wash of the tone lights the card from the left. The tone says what kind of news it is, and never trades places:

- **Error** (soft pink-red #ffa3b4, a circled cross): something the player asked for failed. The error sound and pulse. Stays 8s.
- **Warning** (soft amber #ffc98a, a triangle): the game did not do something, for a reason the player can act on (the setlist is full, no notes at this difficulty). The back sound and pulse. Stays 6s.
- **Done** (Ready Green, a circled tick): something that finishes out of sight is done (a file saved, a video made). The toggle-on sound and a select pulse. Stays 5s.
- **News** (Ink 2 on a lavender wash, a circled i): worth knowing, nothing went wrong. The move sound, no pulse. Stays 5s.

A longer message stays longer (about 55ms a character, at most 14s). The same message again is not a second card: the one on screen counts it (a small pill, "×2" in the tone's colour), bumps and starts its time over. At most three are kept, and they fold: only the newest is read, the older ones stand as edges behind it, each a little smaller and darker, so the stack never covers more than one card. The pointer resting on the stack unfolds it, newest nearest the edge, and stops every clock (as does the window going out of sight); unfolded, the gaps between the cards belong to the stack and it folds only 0.35s after the pointer leaves, so the pointer can travel up to the older cards. Pressing a card dismisses it; the key dismisses the newest and brings the next forward.

They stand centred, 30rem wide at most: above the action bar in the menus, along the top on a phone (where the foot holds the setlist and the thumbs), and along the top edge while a song or replay plays, where they make no sound or pulse. They rise in 0.8rem toward their edge over 0.38s and fade out in 0.2s; with calm motion they appear in place and the time line is hidden.

### Results

Two panels. The first holds the cover and title, five stars that spin and scale in one by one (140ms apart), the score counting up, and tags fading in at 1.2s. The second holds up to nine Well stat cells (value over caption, the miss count in soft red) rising in 45ms apart, and the next song under a hairline. The set summary lists every song as a card with its tags, stars and score; a skipped song is dimmed.

### Highway

A solid violet deck in perspective, a shade lighter toward the far end and fading out there, with hairlines between lanes, neighbouring lanes a breath apart in tone, lit violet rails along both edges and a lit lip across the front. Beat lines cross it faintly; bar lines are thicker.

- **Tiles:** rounded pills with a bright rim, a top face in the lane's colour and a short white gloss line. A missed tile dims to 28%. A tile never pops onto the deck: over the farthest sixth of the highway it grows from nothing to full size. It is solid all the way (a half see-through tile reads as a shadow against the bright stage behind) and has no glow of its own outside overdrive. Release markers grow in the same way and beat lines draw themselves in.
- **Sustain trails:** beams of light: a thin white-hot core in a tight glow of the lane's colour, drawn as light. The glow falls away quickly and stops well short of the neighbouring lanes, so it never smears over the deck. A held beam burns brighter, is a touch wider and breathes; a missed one is all but out. a release marker (a light tile with an upright pointer) stands at the end of a hold that has to be let go in time.
- **Strike targets:** a thin pill outline per lane in its colour, dark inside. On touch they are finger-sized rounded squares set a little toward the player.
- **Deck:** violet glass, lighter toward both rails and darkest down the middle, cut in large facets that travel with the notes and answer the beat. A lane that is played lights along its length in its colour, with dashes of light running up its middle.
- **Lane light:** a lane that is played, by key, button or touch, lights up along its length in its own colour, brightest at the player's end, and its target glows; a hit adds a flash and a burst of sparks.
- **Holds:** a glowing tail behind the tile, wider while held. A hold-and-release note ends in a release marker: a lighter tile with an upright, translucent five-sided pointer standing on it, gently breathing until judged; a release on time bursts white sparks and pops "<grade> RELEASE", a missed one dims the marker.
- **Overdrive:** phrase notes are ice white; while overdrive lasts every tile turns light blue and glows, the rails turn blue, and a soft glow lies along the outside of both edges.

### HUD

Quiet chrome on translucent indigo (rgb(16 9 50 / 0.76)), in stage-voice tabular numerals. **Song panel:** artist, title (with the position in the set in pink), a timeline and the time left. The timeline is a thick bar wherever there are notes and thins to a line through every longer stretch without any (the intro, a break, the fade-out; at least 4 seconds or 2% of the song), with a bright head at the current position. **Stars:** each is a cut star (a lit and a shaded facet) on a disc. Not yet earned, it is a dim star on a faint disc; the next one to earn stands on a dark disc with a violet ring filling toward it; earned, it is light on a violet disc and lands with a spin. After the fifth, gold rises inside all five, and at par they become gold stars: gold discs with a pale star, glowing. **Dial:** a dark plate with the multiplier, ringed by the streak toward the next step in that step's colour; the overdrive meter is an arc of four segments over its top, in Overdrive Ice, that glows when there is charge to spend. **Timing tag:** a slanted tag in the grade's colours (Perfect gold to orange with a spark, Great mint to blue, Good violet, Miss red) carrying the word and a small white target whose bar sits dead centre for a perfect hit, above the middle for an early press and below it for a late one; it pops in, holds about a second and fades. The streak stands above it from 5 on and burns orange at the top multiplier. During a long break a countdown ring shows the bars left.

### Track editor

The one screen where the player makes something, built from the same parts as the rest: violet sheets, the settings rows, and the four lights in their usual jobs.

- **The lanes:** drawn from above on a canvas, in a Well with a 1.1rem radius, fading out at the top as the highway does. A column per lane, a breath apart in tone, lighter toward both rails; a hairline for every grid step that has room, a brighter one per beat and a 2px line per bar with its number at the left. Later is higher. Sizes are in rem, so the lanes grow with the interface: a lane is up to 6.6rem wide and never narrower than a finger.
- **The now line:** one Ink line across the lanes, 72% down, with a strike target in every lane (a dark pill outlined in the lane's colour). It is the edit position and the playhead: the chart moves past it and it never moves. Moving a step glides the chart there in about a tenth of a second; with reduced motion it changes in place.
- **The cursor:** with the keyboard or a controller the focus is a place on the now line. It is drawn as the focus ring, mint with its glow, round the target of the lane the cursor is in, and that lane is a touch lighter all the way up. The track itself opts out of the travelling ring (`data-ring="none"`), so there is still exactly one mint ring on screen. Mouse and touch players see no cursor; a mouse sees a faint tile where a note would land.
- **Notes:** the highway's tiles seen from above: a pill in the lane's colour with a dark lower rim, a bright rim and a short gloss line. A long note has a beam in the lane's colour with a white core, and a white tile at its end when it must be let go on time. That tile is also how such a note is made: a tile set down on a long note, or a long note stretched into a tile, becomes its end. Notes of an overdrive phrase are Overdrive Ice with a rim in the lane's colour, the phrase is a 10% ice wash over the lanes, and a bar of ice runs along both rails beside it.
- **Selection:** lavender, as everywhere. A marked stretch is a 17% lavender wash with a 2px Lavender line at each end; a selected note carries a 3px Lavender ring with the selection's shadow; a box being dragged is the same wash with a hairline. With a mouse or a finger the selection's actions stand in a Solid Panel strip along the foot of the lanes; with a controller the confirm button opens them as a card.
- **Pink:** what is sounding or listening. The waveform beside the lanes and on the overview line is pink up to the now line and pale Ink 2 beyond it; the play button is pink while the song plays; while recording, the now line, the Record button and a "Recording" plate at the top of the lanes are pink. Test play is the screen's one pink action at rest.
- **Beside the lanes:** on the left the bar numbers and the waveform, on the right (for an analyzed song) the guide: what the game heard in this part as pale marks, pitch from left to right, or kick, snare and hi-hat in three columns. Both stand on a faint violet strip and the now line runs through them as a hairline.
- **The overview:** the whole song on one line in a Well: its waveform, a tick along the foot for every note, ice above for the phrases, a lavender wash for a marked stretch, an outlined window for what the lanes show and an Ink line for now. Pressing or dragging it moves through the song.
- **The menu and the tempo sheet:** side sheets (bottom sheets on a phone) made of the settings screen's rows, so left and right change a value on a controller as they do there, with full-width buttons for what is done once. The tempo sheet leaves the lanes in view (no blur, 28% dim) because it changes them. Clearing a chart and putting the game's chart back ask first, with Go back focused.
- **Marks:** every control on the editor's screen that has a key or a controller button carries it beside it: a Lavender keycap for the keyboard and the mouse, the controller's own symbol for a controller, nothing under a finger. The grid's arrows carry the shoulder buttons, the Snap button the left stick's click, loop the right stick's, the bar buttons the triggers, undo its button, zoom the right stick, and the chart choices and Record the menu button, which is where a controller finds them.
- **Snap:** a button in the grid's trough with a magnet, the word Snap and what notes snap to (Grid, Sounds, Off). It is a switch: lavender while anything is snapped to, quiet when snapping is off. The loop button beside play is lit the same way while looping is on, and a looped stretch has pink ends, because it is what is sounding.
- **Sounds:** where sounds start in the song shows as short Ink ticks on the lanes' side of the waveform; the beats of a bar are counted in small Ink 3 numerals beside the lanes once they are far enough apart.
- **The menu's words:** every row shows a line under it while it is lit that says what it does, and every button carries such a line under its name. Nothing in the menu is an icon alone.
- **The controls legend:** one line per thing that can be done, with the keys as Lavender keycaps or the controller's own symbols, for the input in use; on screens too narrow for it, it is the last section of the menu.
- **Action bar:** Back (Clear selection while there is one), Play, Menu and the pink Test play. On a controller the hint beside Back says what confirm does here ("Note", or "Selection"), Mark shows with its button, and Test play is the first, pink button of the menu instead. While recording the bar holds only Stop recording, and directions belong to the lanes.

### Loading screen

What is on screen while the game loads, drawn by the page itself (`index.html`, its own small stylesheet) so it is there before any script. On the night, lit from below: the game in small, a note highway seen from the player's seat (violet rails, five lanes that fade into the distance, a Lavender strike line with a ring in each lane's colour), on which tiles in the lane colours come down in a two-bar figure and leave a short light on the line as they land. Under it the wordmark, a 6px progress line in Stage Pink on a Well, and one line in Soft Ink that says what is loading ("Opening your library", "Loading the stage", "Building the stage", "Ready"). The words wait for the typeface, so they never show in a stand-in one. It stays until the library, the scores, the chart statuses and the 3D stage are there, the stage built and drawn (after a long wait, 8 seconds for the library and 30 for the stage, the game opens without what has not come), then fades out over 0.55 seconds while the home screen makes its entrance. With calm motion the tiles stand still on the highway and nothing flashes.

### Motion

- **Ease:** `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease`) for entrances and travel; `cubic-bezier(0.7, 0, 0.84, 0)` (`--ease-in`) for leaving.
- **Screen direction:** going deeper (Home, library, Ready up, results, summary) enters from the right (3rem, fading in over 0.45s); going back enters from the left. The stage behind stays put. Settings tabs do the same inside the list (0.35s).
- **Entrances:** tiles, set cards and song rows rise in 0.9rem with a short stagger (55ms, 60ms and 22ms apart); action-bar buttons rise in over 0.3s; a filled slot slides in from the left; a slot badge pops from 0.4 scale; a changed setting value rises in 0.3rem.
- **Dialogs:** the dim fades in over 0.22s; a side sheet slides in 3rem over 0.34s, a phone sheet rises 2.5rem, a card rises and scales from 0.96 over 0.3s; all leave in 0.18s.
- **Press:** everything pressable scales down briefly (buttons 0.96, tiles 0.98, rows 0.99, choices 0.95, icon buttons 0.9, step arrows 0.85).
- **Motes:** the light beside the rails on a full streak or in overdrive is soft discs of every size, small and bright with a few larger ones among them, keeping close to the rails as they drift up and fading in and out over one to three seconds, about 120 a second. They are gameplay feedback, not decoration: they appear only in those two states.
- **Launch wipe:** starting a song opens three sheets of light (pink, violet, night) as circles from the foot of the screen in 0.55s, 60ms apart; they hold at least 620ms while the song loads. Once the play screen has built its highway behind them they part like a stage curtain: a white flash with a pink glow runs down a seam in the middle of the screen that leans 10 degrees, as the stage voice does, and each sheet splits along it and slides off to both sides over 0.56s, night first, then violet, then pink, 70ms apart, so the opening is edged in bands of light and the highway in the middle is the first thing seen. The way out moves by transform and opacity only, so it stays smooth while the stage is still loading.
- **Reduced motion:** `data-motion='reduced'` on the root (the player's setting, or the system preference when the setting is left on System) cuts every animation and transition to nothing: screens, sheets, the ring and the selection change in place, tiles do not lift, and scores appear at their final value. Hit feedback and the break ring's draining stay; the ring's bounces go, and the countdown numbers fade without scaling.

### Sound and rumble

The menus have a cinematic theme: a 96-second loop in B minor at 100 BPM. It comes in from nothing, with no opening hit: the first time, two bars rise out of silence before the tune starts (a separate file, played once, that hands over to the loop). Big drums and low strings drive straight eighth notes, snares and short, high violins run in sixteenths over them, and above that the harmony and the melody move slowly in long held notes: the energy is in the rhythm, and the tune never hurries. The five eight-bar sections differ in how many players are in (horns as the orchestra arrives, then violins, a second theme with trumpets, an interlude that builds back, everyone), and the last bar ebbs so the loop returns to the quiet opening. It plays behind every menu at its own volume and fades out for a song preview, the calibration clicks, the launch and the song. A song previews by itself: the one whose row has the focus in the music library or on the Edit tab (with a mouse, the row under the pointer), or the one whose page is open, starts after 0.4 seconds of staying put (so moving down a list starts nothing), from a third of the way in, fades in over 0.7 seconds, goes round the same half minute, and fades across to the next song. It stops the moment the player is on no row: the search field, a toolbar button, the tabs, the pointer off the list. With Song previews switched off (Settings, Audio, Menus) nothing previews, no row is marked, and the theme keeps playing. A small speaker in Pink Light marks its row. It plays at the songs' volume, a little under a song that is played, and the stage behind the menus moves to it. After a short interruption it fades back in where it left off; after a song it starts again from the top. The menu backdrop moves with it.

Every interface sound is a short recording of the same orchestra in the theme's key (B minor / D major), so a press never clashes with the music underneath. The sounds have their own volume, separate from the music and the songs. Everything the game plays leaves through one master output: Settings → Audio can send it to a chosen output device (System default unless the player picks one; a device that is unplugged falls back to the default and is taken up again when it returns) and mutes it while the window is in the background (on by default). Pulses play only on the controller in use, scaled by the player's rumble setting; a keyboard, mouse or touch player feels nothing. In a song a hit's rumble tells its timing apart: great and good are short taps on the lane's side (50ms and 45ms, at 60% and 40%), a perfect hit is a punch at full strength for 130ms in both grips, with a low thump under the click on a DualSense.

The light bar of a PlayStation controller (desktop app, USB cable) lights up with the player during a song: off between flashes so that each one stands out, a flash in the lane's colour every time a lane is pressed, a note there or not (fading out over 360ms), gold while the streak holds the top multiplier, light blue in overdrive, each winning over the ones before. Gold and blue hold their colour: a press, and in overdrive each beat, only brighten them from about 60% to full. The LED's colours are its own, pushed apart from the screen's (its green and red outshine its blue), so yellow, gold and Overdrive Ice read as themselves and not as white. When the song ends the controller is given back its resting dim blue.

- **Move** (focus change or pointer entering a control): one soft damped harp note, in three takes that rotate; light centred pulse (22ms). Rate-limited so held directions do not pile up.
- **Select:** two harp notes rising a fifth with a glockenspiel on top and a plucked cello under them; medium pulse (45ms).
- **Back** (Back in the action bar, Esc, the controller's back button, Close, Cancel, Keep, taking a song out of a slot, leaving a set): the same fifth falling, darker; pulse leaning left.
- **Tab** (settings tabs by press, Q and E or the shoulder buttons; stepping the part or the difficulty on Ready up): four harp strings brushed upwards; pulse on the side moved toward.
- **Next / previous choice** (a settings row stepped right or left): two glockenspiel notes up or down.
- **Launch** (the Ready up button filling, Play again and Next song on results, Play the set again on the summary): a confirm, not a fanfare. One tight, bright slam the instant the button goes down (damped bass drum, a giant drum, a whip crack, an anvil and choked cymbals, brass and strings on a short open fifth), a run of bells out of it, and the crowd answering and settling within about four seconds; full-strength sweep (480ms).
- **Finale** (the four seconds between the last note and the result): the whole crowd clapping and cheering, up at once, held, and down quickly as the result comes up. On the stage every flame jet fires and burns at full height in one long burst until the result comes up, the fireworks go off in salvos (the middle, the sides, the lot) with smoke on every third, and the crowd applauds: most clap, each in a time of their own, the rest cheer with their arms up.
- **Results:** the crowd has had its say in the finale, so the screen opens on the stars. Each star rings a step higher up the D major chord (glockenspiel, harp, triangle; the fifth adds a bell tree), a wood tick counts the score, and a new best gets a brass fanfare. The set summary opens quietly: the crowd cheered each song already.
- **Hold** (the Ready up button filling): a charge-up: a plucked cello and bass under the finger, a timpani roll and tremolo violins swelling on the key note, a harp running up two octaves, quicker as it climbs, with bells on its top notes, air opening upward and a cymbal swelling into the end. It stops short of an arrival, because the launch is the arrival; letting go early fades it out where it is, and pressing again picks it up from where the fill stands. It is levelled with the select and add sounds, not under them.
- **Add / pause / resume / error:** a harp run up the chord with bells on import, two plucked steps down onto a soft drum on pause and back up on resume, two dull low knocks a tritone apart with a thud pulse for errors.
  During a song only the pause menu makes menu sounds. In the track editor a step of the cursor is a move, a note set down the rising choice sound and one taken away the falling one, undo is a back and a change of grid a tab, each with its pulse; while the song plays in the editor the sounds stay silent and only the pulses remain.

Sounds are wired in one place: a shared handler gives every button, tab and row its move and select sound, and a control picks another with `data-sfx` (back, tab, launch, or none when it makes its own). The theme and the sounds are rendered by `tools/audio` (see the README); new sounds belong there, levelled against the others, and not as synthesized tones in the app.

## Do's and Don'ts

### Do:

- **Do** build surfaces as flat rounded violet sheets: Panel Violet at 1.1rem for panels and tiles, Row at 0.75rem for list rows, Well for recessed troughs and fields.
- **Do** keep the four light roles: pink for the one forward action, mint for the focus ring, a lavender sheet with dark ink for the selection, gold for what was earned.
- **Do** let focus be the one travelling ring plus the control's own lit state, following focus for keyboard and controller players and the pointer for mouse players; never show it on touch.
- **Do** move selection with one travelling lavender sheet per group (0.36s, `--ease`) rather than toggling each item's fill.
- **Do** use lane colours only to mean lane, difficulty or multiplier level.
- **Do** put a screen's actions in the action bar with a key and, where it makes sense, a controller button, and let the hint follow `data-input`: keycap, controller symbol, or none on touch.
- **Do** gate hover styles behind `data-input='mouse'` and raise targets to at least 2.75rem under `data-input='touch'`.
- **Do** size menus in rem off the clamped root, and the HUD in px over the highway's geometry.
- **Do** set titles and numbers wide, black, italic and uppercase; control labels at normal width, italic and uppercase; sentences and song names at normal width and upright.
- **Do** give every new control a sound through the shared handler (`data-sfx` for back, tab, launch or none) and its matching controller pulse.
- **Do** make every new entrance, stagger or travel respect `data-motion='reduced'`, keeping the state change.
- **Do** keep the HUD still except for gameplay feedback.
- **Do** draw anything on a canvas (the highway, the editor's lanes) with the same tokens and the same light roles as the DOM around it.

### Don't:

- **Don't** use mint for anything in the menus except the focus ring and the caret: no mint fills, borders, badges, status or decoration.
- **Don't** put more than one pink button on a screen or dialog at rest, and don't mark a selected item in pink.
- **Don't** put borders or resting shadows on panels, rows or buttons; the only strokes are hairline dividers and dashed "empty" outlines.
- **Don't** skew or square off shapes; the italic type is the only slant.
- **Don't** use a lane colour as a brand accent or a decorative stripe.
- **Don't** set sentences or song names in the stage voice, or controls in the upright reading voice.
- **Don't** show hover effects, key hints or the focus ring to a touch player.
- **Don't** animate anything in the HUD for decoration, or let menu motion run during play.
- **Don't** let a layout depend on the product name: the wordmark "Soundwave" is set in type, not drawn into the design.
- **Don't** name, imitate or recreate any existing commercial rhythm game in look, copy, assets or layout.
