//! .soundwave song files on disk: the ones the system opens the app with (double-clicked in
//! Explorer, or passed on by a second launch), and saving a song's file or a library backup where
//! the player chooses.
//!
//! The page only ever reads the files listed here, by the number given to each, so it cannot ask
//! for any other file on the computer.

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

const EXT: &str = "soundwave";
/// The event that tells the page there are opened files to take.
const OPENED: &str = "soundwave://opened";

#[derive(Default)]
pub struct Opened {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    next: u32,
    /// Opened and not yet listed to the page.
    waiting: Vec<PathBuf>,
    /// Listed to the page and not yet read, by the number the page asks for.
    listed: HashMap<u32, PathBuf>,
}

#[derive(Serialize)]
pub struct OpenedFile {
    id: u32,
    name: String,
}

/// The song files among a command line (the program's own path first, as in `std::env::args`).
pub fn song_files(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .map(PathBuf::from)
        .map(|p| if p.is_absolute() { p } else { cwd.join(p) })
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(EXT)) && p.is_file())
        .collect()
}

/// Queues files the app was asked to open and tells the page.
pub fn open(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    app.state::<Opened>()
        .inner
        .lock()
        .unwrap()
        .waiting
        .extend(files);
    let _ = app.emit(OPENED, ());
}

/// Brings the window to the front, for a file opened while the app runs.
pub fn focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The files waiting to be read, each with the number to read it by.
#[tauri::command]
pub fn take_opened_files(state: State<Opened>) -> Vec<OpenedFile> {
    let mut inner = state.inner.lock().unwrap();
    let waiting = std::mem::take(&mut inner.waiting);
    waiting
        .into_iter()
        .map(|path| {
            inner.next += 1;
            let id = inner.next;
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| format!("song.{EXT}"));
            inner.listed.insert(id, path);
            OpenedFile { id, name }
        })
        .collect()
}

/// The bytes of a file listed by `take_opened_files`. Each can be read once.
#[tauri::command]
pub fn read_opened_file(state: State<Opened>, id: u32) -> Result<Response, String> {
    let path = state
        .inner
        .lock()
        .unwrap()
        .listed
        .remove(&id)
        .ok_or("that file was not opened")?;
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("could not read {}: {e}", path.display()))
}

/// Files being written for the page, piece by piece, by the number `save_file_begin` gave them.
#[derive(Default)]
pub struct Saving {
    inner: Mutex<SavingInner>,
}

#[derive(Default)]
struct SavingInner {
    next: u32,
    open: HashMap<u32, (PathBuf, File)>,
}

/// What a saved file is, for the save dialog's file type: (description, extension).
fn file_kind(kind: &str) -> Result<(&'static str, &'static str), String> {
    match kind {
        "song" => Ok(("Soundwave song", EXT)),
        "backup" => Ok(("Soundwave library backup", "soundwave-backup")),
        "video-mp4" => Ok(("MP4 video", "mp4")),
        "video-webm" => Ok(("WebM video", "webm")),
        _ => Err(format!("unknown kind of file: {kind}")),
    }
}

/// Asks where to save a file (a song, a library backup or a replay's video) and creates it there. The number to
/// write it by with `save_file_write`, or none when the player cancelled. The page then sends the
/// file in pieces, so a library of several gigabytes never has to be held in memory at once.
#[tauri::command]
pub async fn save_file_begin(
    app: AppHandle,
    window: WebviewWindow,
    saving: State<'_, Saving>,
    name: String,
    kind: String,
) -> Result<Option<u32>, String> {
    let (description, ext) = file_kind(&kind)?;
    let title = match kind.as_str() {
        "backup" => "Export library",
        "video-mp4" | "video-webm" => "Export video",
        _ => "Export song",
    };
    let Some(chosen) = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title(title)
        .set_file_name(&name)
        .add_filter(description, &[ext])
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let mut path = chosen.into_path().map_err(|e| e.to_string())?;
    if !path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case(ext))
    {
        let mut s = path.into_os_string();
        s.push(format!(".{ext}"));
        path = s.into();
    }
    let file =
        File::create(&path).map_err(|e| format!("could not write {}: {e}", path.display()))?;
    let mut inner = saving.inner.lock().unwrap();
    inner.next += 1;
    let id = inner.next;
    inner.open.insert(id, (path, file));
    Ok(Some(id))
}

/// Appends a piece (the request body) to the file numbered in the `x-save-id` header.
#[tauri::command]
pub fn save_file_write(saving: State<Saving>, request: Request<'_>) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("nothing was sent to write".into());
    };
    let id: u32 = request
        .headers()
        .get("x-save-id")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .ok_or("no file to write to")?;
    let mut inner = saving.inner.lock().unwrap();
    let (path, file) = inner.open.get_mut(&id).ok_or("that file is not open")?;
    file.write_all(bytes)
        .map_err(|e| format!("could not write {}: {e}", path.display()))
}

/// Closes a file begun with `save_file_begin`. With `keep` false (the page failed part way), the
/// unfinished file is deleted. The path it was saved to, when kept.
#[tauri::command]
pub fn save_file_end(saving: State<Saving>, id: u32, keep: bool) -> Result<Option<String>, String> {
    let (path, mut file) = saving
        .inner
        .lock()
        .unwrap()
        .open
        .remove(&id)
        .ok_or("that file is not open")?;
    if !keep {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("could not finish {}: {e}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_song_files_on_a_command_line() {
        let dir = std::env::temp_dir().join("soundwave-song-files-test");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.soundwave"), b"x").unwrap();
        std::fs::write(dir.join("b.SOUNDWAVE"), b"x").unwrap();
        std::fs::write(dir.join("c.mp3"), b"x").unwrap();
        let args = [
            "soundwave.exe",
            "a.soundwave",
            "b.SOUNDWAVE",
            "c.mp3",
            "missing.soundwave",
            "--flag",
        ]
        .map(String::from);
        let found = song_files(args, &dir);
        assert_eq!(
            found,
            vec![dir.join("a.soundwave"), dir.join("b.SOUNDWAVE")]
        );
    }

    #[test]
    fn saves_videos_with_their_own_extension() {
        assert_eq!(file_kind("video-mp4"), Ok(("MP4 video", "mp4")));
        assert_eq!(file_kind("video-webm"), Ok(("WebM video", "webm")));
        assert!(file_kind("video-avi").is_err());
    }
}
