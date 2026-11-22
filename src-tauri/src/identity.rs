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
        std::fs::write(&tmp, value).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| e.to_string())?;
        }
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
