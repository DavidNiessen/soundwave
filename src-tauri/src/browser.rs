//! Opens a web page in the player's own browser (not in the game's window): a server's sign-in
//! page, where the browser's password manager works (src/net/client.ts, `signInWithBrowser`).
//! Only http and https addresses are opened, handed to the system as they are, never through a
//! shell that would read them.

use std::process::Command;

/// Whether `url` is a web address the game may open.
fn openable(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() <= 4096
        && !url.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// Opens `url` in the player's default browser.
#[tauri::command]
pub fn open_in_browser(url: String) -> Result<(), String> {
    if !openable(&url) {
        return Err("That is not a web address.".into());
    }
    #[cfg(windows)]
    let mut cmd = {
        // rundll32 hands the address to the default browser without cmd.exe reading it.
        let mut c = Command::new("rundll32");
        c.args(["url.dll,FileProtocolHandler", &url]);
        c
    };
    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(&url);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(&url);
        c
    };
    cmd.spawn()
        .map(|_| ())
        .map_err(|e| format!("The browser could not be opened: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_web_addresses_open() {
        assert!(openable("https://play.example.com/login?state=abc"));
        assert!(openable("http://localhost:7421/login"));
        assert!(!openable("file:///C:/Windows/System32/calc.exe"));
        assert!(!openable("javascript:alert(1)"));
        assert!(!openable("https://a.example/ & calc"));
    }
}
