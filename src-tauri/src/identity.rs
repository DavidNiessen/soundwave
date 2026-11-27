//! Where the player's identity (src/net/identity.ts) is kept in the desktop app: the system's own
//! store for secrets on Windows (Credential Manager) and macOS (the keychain), so it is not lying
//! in the game's files; on Linux a file in the app's data folder that only its user can read.

#[cfg(any(windows, target_os = "macos"))]
mod store {
    const SERVICE: &str = "io.github.davidniessen.soundwave";
    const ACCOUNT: &str = "identity";

    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())
    }

    pub fn load(_app: &tauri::AppHandle) -> Result<Option<String>, String> {
        match entry()?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn save(_app: &tauri::AppHandle, value: &str) -> Result<(), String> {
        entry()?.set_password(value).map_err(|e| e.to_string())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod store {
    use std::path::PathBuf;
    use tauri::Manager;

    fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("identity.json"))
    }

    pub fn load(app: &tauri::AppHandle) -> Result<Option<String>, String> {
        match std::fs::read_to_string(path(app)?) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn save(app: &tauri::AppHandle, value: &str) -> Result<(), String> {
        let path = path(app)?;
        let tmp = path.with_extension("tmp");
        // Made readable by its user alone from the start (not changed after it is written, when
        // another user could have opened it meanwhile), and on the disk before it takes the
        // place of the one kept: a crash in between leaves the old identity, never half a new one.
        let mut options = std::fs::OpenOptions::new();
        options.create(true).write(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let write = || -> std::io::Result<()> {
            use std::io::Write;
            let mut file = options.open(&tmp)?;
            #[cfg(unix)]
            {
                // A file left from before keeps its old mode when it is opened again.
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
            file.write_all(value.as_bytes())?;
            file.sync_all()
        };
        write().map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
    }
}

/// The identity kept here (its JSON), or none yet.
#[tauri::command]
pub fn identity_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    store::load(&app)
}

/// Keeps the identity (its JSON), replacing the one kept before.
#[tauri::command]
pub fn identity_save(app: tauri::AppHandle, value: String) -> Result<(), String> {
    if value.len() > 2000 {
        return Err("That identity is too big.".into());
    }
    store::save(&app, &value)
}
