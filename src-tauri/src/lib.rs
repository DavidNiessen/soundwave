mod audio_out;
mod browser;
mod discord;
mod haptics;
mod identity;
mod song_files;
mod touchpad;

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

/// Quits the game: every window closes and the process ends.
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // One game at a time: opening a song file or a link (a soundwave:// link, a browser sign-in
    // coming back, Discord's Join) while it runs hands it to the running game instead of starting
    // another. A development build can be run beside one on purpose, to play two players on one
    // computer, with SOUNDWAVE_SECOND_INSTANCE=1.
    let second = cfg!(debug_assertions)
        && std::env::var("SOUNDWAVE_SECOND_INSTANCE").is_ok_and(|v| v == "1");
    if !second {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            song_files::open(
                app,
                song_files::song_files(argv, std::path::Path::new(&cwd)),
            );
            song_files::focus(app);
        }));
    }
    // soundwave:// links (the invite links a Soundwave server makes) open the game. Registered after
    // the single-instance plugin, which hands a link clicked while the game runs to the running game.
    builder = builder.plugin(tauri_plugin_deep_link::init());
    // Updates: the app asks GitHub for the newest full release, checks its signature against the
    // public key in tauri.conf.json, installs it and restarts (src/app/updates.ts).
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
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
        .manage(song_files::Opened::default())
        .manage(song_files::Saving::default())
        .invoke_handler(tauri::generate_handler![
            exit_app,
            audio_out::audio_devices,
            audio_out::audio_set_device,
            discord::discord_presence,
            discord::discord_take_join,
            discord::discord_answer,
            browser::open_in_browser,
            identity::identity_load,
            identity::identity_save,
            haptics::haptics_available,
            haptics::haptics_play,
            haptics::haptics_update,
            haptics::haptics_release,
            touchpad::touchpad_watch,
            touchpad::touchpad_finger,
            song_files::take_opened_files,
            song_files::read_opened_file,
            song_files::save_file_begin,
            song_files::save_file_write,
            song_files::save_file_end
        ])
        .setup(|app| {
            // Friends joining from Discord are listened for from the start (see discord.rs).
            app.state::<discord::Discord>().listen(app.handle());
            // A song file double-clicked in Explorer starts the game with its path.
            let cwd = std::env::current_dir().unwrap_or_default();
            song_files::open(app.handle(), song_files::song_files(std::env::args(), &cwd));
            // The installers register the scheme; a development build or an AppImage registers it here.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register_all() {
                    log::warn!("soundwave:// links could not be registered: {e}");
                }
                // Discord starts the game for a friend's Join through its own scheme.
                if let Some(scheme) = discord::launch_scheme()
                    && let Err(e) = app.deep_link().register(&scheme)
                {
                    log::warn!("{scheme}:// could not be registered: {e}");
                }
            }
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
