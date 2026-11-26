# Song files (`.soundwave`)

Every song in the library is stored as a `.soundwave` file: one file holding the song's details, its cover, the analysis its charts are made from, the charts edited by hand in the track editor, and the original audio byte for byte. **Export** on a song's page saves that file, to keep or to send to a friend; dropping it on the game, or picking it with **Add songs**, adds the song with its charts ready, without analyzing it again. The song's id is the hash of its audio, so the same song arrives as the same song, with the same charts. Scores and separated stems stay on the device that made them.

The installers register the extension: double-clicking a song file opens it in the game, or hands it to the game already running. The layout of the file is described at the top of `src/storage/soundwaveFile.ts`; songs stored before the format existed are converted the first time the game starts.

**Settings › Advanced** exports the whole library as one `.soundwave-backup` file: every song file, the best scores and the settings, to move the game to another computer or keep a copy. Importing one adds the songs that are not there yet, keeps the better of each score, takes over the backup's settings and restarts the game. Separated stems are left out; they are made again when a song is analyzed. The layout is described at the top of `src/storage/backup.ts`.

Song files have their own icon, a page with the note highway on it. A script draws it and writes every size into `src-tauri/icons/soundwave-file.ico`, which the installers set on the file type (`src-tauri/windows/`):

```
node tools/icon/build_file_icon.mjs
```
