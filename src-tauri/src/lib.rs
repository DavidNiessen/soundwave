mod audio_out;
mod discord;
mod haptics;
mod lightbar;
mod song_files;
mod touchpad;

use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;
use tauri::Manager;

/// In a release build the webview is the game and nothing else: the browser's own shortcuts
/// (reload with Ctrl+R or F5, print, find, the developer tools) do nothing, so a stray key press
/// cannot reload the game in the middle of a song. Development builds keep them.
#[cfg(all(windows, not(debug_assertions)))]
fn lock_webview(app: &tauri::App) {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
    use windows_core::Interface;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(settings) = core.Settings() else {
            return;
        };
        if let Ok(settings) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings.SetAreBrowserAcceleratorKeysEnabled(false);
        }
    });
}

/// How often the page was opened again because the system closed it (see `on_web_content_process_terminate`
/// below), since the page last asked.
#[derive(Default)]
struct PageRestarts(AtomicU32);

/// Hands the page the number of restarts since it last asked, so it can say why it started again.
#[tauri::command]
fn take_page_restarts(restarts: tauri::State<PageRestarts>) -> u32 {
    restarts.0.swap(0, Ordering::Relaxed)
}

/// The menu item and event that switch between a window and filling the screen on macOS.
#[cfg(target_os = "macos")]
const TOGGLE_FULLSCREEN: &str = "toggle-fullscreen";

/// The standard macOS menu, except that View's full screen item (Control-Command-F) asks the page to
/// switch, as F11 and Alt+Enter do, instead of putting the window into the system's full screen
/// behind the game's back: the page then keeps its Window mode setting and the window in step.
#[cfg(target_os = "macos")]
fn mac_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind};
    let menu = Menu::default(app)?;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(sub) = item
            && sub.text()? == "View"
        {
            while sub.remove_at(0)?.is_some() {}
            sub.append(&MenuItem::with_id(
                app,
                TOGGLE_FULLSCREEN,
                "Toggle Full Screen",
                true,
                Some("Ctrl+Cmd+F"),
            )?)?;
        }
    }
    Ok(menu)
}

/// Quits the game: every window closes and the process ends.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // One game at a time: opening a song file while it runs hands the file to the running game
    // instead of starting another. Not in development builds, so a second dev build can run beside one.
    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            song_files::open(
                app,
                song_files::song_files(argv, std::path::Path::new(&cwd)),
            );
            song_files::focus(app);
        }));
    }
    // Updates: the app asks GitHub for the newest full release, checks its signature against the
    // public key in tauri.conf.json, installs it and restarts (src/app/updates.ts).
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }
    #[cfg(target_os = "macos")]
    {
        use tauri::Emitter;
        builder = builder
            .menu(mac_menu)
            .on_menu_event(|app, event| {
                if event.id().as_ref() == TOGGLE_FULLSCREEN {
                    let _ = app.emit(TOGGLE_FULLSCREEN, ());
                }
            })
            // WebKit runs the page in a process of its own, which macOS may end (for its memory,
            // most often while the app is in the background). The page is opened again, as Tauri
            // does by default, and told so when it asks (take_page_restarts).
            .on_web_content_process_terminate(|webview| {
                log::warn!("the web content process ended; opening the page again");
                webview
                    .app_handle()
                    .state::<PageRestarts>()
                    .0
                    .fetch_add(1, Ordering::Relaxed);
                if let Err(err) = webview.reload() {
                    log::error!("could not open the page again: {err}");
                }
            });
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        // The game's sound, streamed from the page and played by this process (audio_out.rs).
        .register_asynchronous_uri_scheme_protocol("swaudio", |ctx, request, responder| {
            let audio = ctx.app_handle().state::<audio_out::NativeAudio>();
            responder.respond(audio_out::handle(&audio, &request));
        })
        .manage(audio_out::NativeAudio::default())
        .manage(discord::Discord::default())
        .manage(haptics::Haptics::default())
        .manage(touchpad::Touchpad::default())
        .manage(lightbar::Lightbar::default())
        .manage(song_files::Opened::default())
        .manage(song_files::Saving::default())
        .manage(PageRestarts::default())
        .invoke_handler(tauri::generate_handler![
            exit_app,
            take_page_restarts,
            audio_out::audio_devices,
            audio_out::audio_set_device,
            discord::discord_presence,
            haptics::haptics_available,
            haptics::haptics_play,
            haptics::haptics_update,
            haptics::haptics_release,
            lightbar::lightbar_set,
            lightbar::lightbar_pads,
            touchpad::touchpad_watch,
            touchpad::touchpad_finger,
            song_files::take_opened_files,
            song_files::read_opened_file,
            song_files::save_file_begin,
            song_files::save_file_write,
            song_files::save_file_end
        ])
        .setup(|app| {
            // A song file double-clicked in Explorer starts the game with its path.
            let cwd = std::env::current_dir().unwrap_or_default();
            song_files::open(app.handle(), song_files::song_files(std::env::args(), &cwd));
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(all(windows, not(debug_assertions)))]
            lock_webview(app);
            // The window starts hidden and the page shows it once it is in the stored display mode
            // (src/game/displayMode.ts). Should the page never get that far, show the window anyway.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(5));
                if let Some(window) = handle.get_webview_window("main")
                    && !window.is_visible().unwrap_or(true)
                {
                    let _ = window.show();
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
