//! The menu bar on macOS. Tauri's default one has View › Enter Full Screen, which puts the window in
//! the system's full screen behind the game's back: the Display mode setting would no longer say what
//! the window is, and from windowed fullscreen (the system's simple fullscreen) it leaves the window
//! in a state neither mode can undo. Here Control+Command+F asks the page instead, which switches the
//! mode the same way Alt+Enter does (src/game/displayMode.ts). There is no Close Window item: with
//! one window, Command+W would quit the game in the middle of a song.

use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Runtime};

/// The menu item that toggles fullscreen, and the event the page hears when it is chosen.
pub const TOGGLE_FULLSCREEN: &str = "toggle-fullscreen";

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        ..Default::default()
    };
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(app, None, Some(about))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?,
            // Text fields (song names, search) take the usual editing shortcuts.
            &Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "View",
                true,
                &[&MenuItem::with_id(
                    app,
                    TOGGLE_FULLSCREEN,
                    "Toggle Full Screen",
                    true,
                    Some("Ctrl+Cmd+F"),
                )?],
            )?,
            &Submenu::with_items(
                app,
                "Window",
                true,
                &[
                    &PredefinedMenuItem::minimize(app, None)?,
                    &PredefinedMenuItem::maximize(app, None)?,
                ],
            )?,
        ],
    )
}

/// Hands the menu's full-screen item to the page.
pub fn on_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == TOGGLE_FULLSCREEN {
        let _ = app.emit_to("main", TOGGLE_FULLSCREEN, ());
    }
}
