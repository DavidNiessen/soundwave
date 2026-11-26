# The app icon

The icon is a render of the note highway, built from the same measurements the game draws it with. One script makes the picture, and Tauri's tool cuts every size from it:

```
blender -b --factory-startup -P tools/icon/build_icon.py -- --out src-tauri/icons/icon.png
pnpm tauri icon src-tauri/icons/icon.png
```

The second command also writes `android` and `ios` folders into `src-tauri/icons`; the desktop app does not use them.

The website uses the same icon, from `public/`: `favicon.ico` and `favicon-32.png` (copies of `icon.ico` and `32x32.png`), `icon-192.png` for Android home screens, and `apple-touch-icon.png` (180 px, on the game's night colour, because iOS fills transparent corners with black). After a new icon, make them again:

```
cp src-tauri/icons/icon.ico public/favicon.ico
cp src-tauri/icons/32x32.png public/favicon-32.png
ffmpeg -i src-tauri/icons/icon.png -vf scale=192:192:flags=lanczos public/icon-192.png
ffmpeg -f lavfi -i color=c=0x0e0828:s=180x180 -i src-tauri/icons/icon.png -filter_complex "[1]scale=180:180:flags=lanczos[i];[0][i]overlay=0:0:format=auto,format=rgb24" -frames:v 1 public/apple-touch-icon.png
```
