//! What the player is doing, shown on their Discord profile ("Playing Soundwave", the song, the part
//! and how long is left). The page says what to show (src/app/discord.ts); a thread of its own talks
//! to the Discord app on this computer, so a Discord that is closed, slow or restarting never holds
//! the game up. While Discord is not running nothing happens, and the thread looks for it again now
//! and then.
//!
//! Discord shows the status of a registered application: its id comes from `SOUNDWAVE_DISCORD_CLIENT_ID`,
//! set when the app is built (or, for a development build, when it is started). Without one the
//! status is off.
//!
//! Join from Discord (docs/specs/online-play.md, 5.4): while the player is in a party they let friends
//! join, the status carries the party's size and a join secret (the server and the party's code).
//! A friend's Join button starts their game (Discord opens `discord-<id>://`, registered at start)
//! and Discord hands the secret to that game, which a second connection here listens for and
//! passes to the page as the `discord-join` event.

use discord_rich_presence::activity::{
    Activity, ActivityType, Assets, Button, Party, Secrets, Timestamps,
};
use discord_rich_presence::{DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// The Discord application whose name and picture the status shows.
const BUILT_CLIENT_ID: Option<&str> = option_env!("SOUNDWAVE_DISCORD_CLIENT_ID");
/// The picture beside the status: the game's icon.
///
/// Later, with a backend: show the song's own cover while it plays. Discord only takes pictures by a
/// public https address (or art uploaded to the application), and covers live on the player's
/// computer, so a backend would have to host them for the length of the song. The cover would be the
/// large picture and this icon the small one. Looking covers up by title and artist (the iTunes
/// Search API, say) was left out: it sends what is played to a third party and can find the wrong
/// release.
const ICON_URL: &str =
    "https://raw.githubusercontent.com/DavidNiessen/soundwave/main/src-tauri/icons/128x128@2x.png";
/// The part badges: the same pictures for each part, in the repository (src-tauri/icons/discord/).
const BADGE_URL: &str =
    "https://raw.githubusercontent.com/DavidNiessen/soundwave/main/src-tauri/icons/discord";
/// Where the button under the status leads: the game's site, to play it or download it.
const SITE_URL: &str = "https://soundwave.niessen.dev";
/// How often a closed Discord is looked for, and the status sent again (so a restarted Discord shows it).
const RETRY: Duration = Duration::from_secs(20);
/// Discord takes a few updates in a short time; changes closer together than this are sent as one.
const SPACING: Duration = Duration::from_secs(2);
/// Discord's limit for the two lines of text.
const MAX_TEXT: usize = 128;

/// What the page asks to show. `None` (from the page: null) clears the status.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    /// The first line (the song, or where in the game the player is).
    details: String,
    /// The second line.
    #[serde(default)]
    state: Option<String>,
    /// When it started, or when it ends, in ms since the epoch: Discord counts up from one, down to the other.
    #[serde(default)]
    start: Option<i64>,
    #[serde(default)]
    end: Option<i64>,
    /// The part being played (lead, bass, drums, vocals): a small badge on the icon, with its hover text.
    #[serde(default)]
    part: Option<String>,
    #[serde(default)]
    part_text: Option<String>,
    /// The song's cover, by a public https address (a Soundwave server's): the large picture.
    #[serde(default)]
    cover: Option<String>,
    /// The party friends can join from Discord (only when the player lets them, and it is not private).
    #[serde(default)]
    join: Option<Join>,
}

/// A party's Join button: Discord greys it out when the party is full.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Join {
    /// What the friend's game is handed: the server and the party's code.
    secret: String,
    /// Names the party, so Discord knows friends are in the same one.
    id: String,
    size: i32,
    max: i32,
}

/// Discord's limit for a party id and a join secret.
const MAX_SECRET: usize = 128;

/// The badge picture for a part (src-tauri/icons/discord/), for the parts there are.
fn part_badge(part: &str) -> Option<String> {
    ["lead", "bass", "drums", "vocals"]
        .contains(&part)
        .then(|| format!("{BADGE_URL}/{part}.png"))
}

#[derive(Default)]
struct Wanted {
    presence: Option<Presence>,
    /// Counts the page's changes, so the thread knows there is something new to send.
    version: u64,
    started: bool,
}

#[derive(Default)]
pub struct Discord {
    wanted: Arc<(Mutex<Wanted>, Condvar)>,
    /// The listener for friends joining from Discord has been started.
    listening: Mutex<bool>,
}

/// The application id: the one the build was given, or one set where a development build starts.
fn client_id() -> Option<String> {
    std::env::var("SOUNDWAVE_DISCORD_CLIENT_ID")
        .ok()
        .or_else(|| BUILT_CLIENT_ID.map(str::to_owned))
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

/// Text Discord takes: two to 128 characters (a shorter one is padded, a longer one cut with an ellipsis).
fn fit(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() > MAX_TEXT {
        let cut: String = text.chars().take(MAX_TEXT - 1).collect();
        return format!("{}…", cut.trim_end());
    }
    if text.chars().count() < 2 {
        return format!("{text:<2}");
    }
    text.to_owned()
}

/// The status Discord shows for `p`.
fn activity(p: &Presence) -> Activity<'_> {
    let details = fit(&p.details);
    let state = p.state.as_deref().map(fit);
    let badge = p.part.as_deref().and_then(part_badge);
    let badge_text = p.part_text.as_deref().map(fit);
    // With a cover (from a server), it is the large picture and the game's icon the small one,
    // unless the part's badge takes that place.
    let cover = p
        .cover
        .as_deref()
        .filter(|c| c.starts_with("https://") && c.len() < 256);
    let mut assets = Assets::new()
        .large_image(cover.unwrap_or(ICON_URL))
        .large_text("Soundwave");
    if let Some(badge) = badge {
        assets = assets.small_image(badge);
        if let Some(text) = badge_text {
            assets = assets.small_text(text);
        }
    } else if cover.is_some() {
        assets = assets.small_image(ICON_URL).small_text("Soundwave");
    }
    let mut activity = Activity::new()
        .activity_type(ActivityType::Playing)
        .details(details)
        .assets(assets);
    // A party friends can join: its size and the secret. The site's button gives way to Join.
    match p
        .join
        .as_ref()
        .filter(|j| j.secret.len() <= MAX_SECRET && j.id.len() <= MAX_SECRET && j.max > 0)
    {
        Some(j) => {
            activity = activity
                .party(
                    Party::new()
                        .id(j.id.as_str())
                        .size([j.size.clamp(1, j.max), j.max]),
                )
                .secrets(Secrets::new().join(j.secret.as_str()));
        }
        None => activity = activity.buttons(vec![Button::new("Play now", SITE_URL)]),
    }
    if let Some(state) = state {
        activity = activity.state(state);
    }
    if p.start.is_some() || p.end.is_some() {
        let mut t = Timestamps::new();
        if let Some(start) = p.start {
            t = t.start(start);
        }
        if let Some(end) = p.end {
            t = t.end(end);
        }
        activity = activity.timestamps(t);
    }
    activity
}

fn send(
    client: &mut DiscordIpcClient,
    presence: Option<&Presence>,
) -> Result<(), Box<dyn std::error::Error>> {
    match presence {
        None => client.clear_activity()?,
        Some(p) => client.set_activity(activity(p))?,
    }
    // Discord answers every command; reading the answer keeps the pipe from filling up and shows
    // straight away when Discord has gone.
    client.recv()?;
    Ok(())
}

/// The secret of a Join a friend pressed, from one of Discord's messages, if it is one.
fn join_secret(message: &serde_json::Value) -> Option<String> {
    (message["evt"] == "ACTIVITY_JOIN")
        .then(|| message["data"]["secret"].as_str())
        .flatten()
        .filter(|s| !s.is_empty() && s.len() <= MAX_SECRET)
        .map(str::to_owned)
}

/// Listens, on a connection of its own, for a friend's Join pressed on Discord, and hands its secret
/// to the page. Discord sends it to a game it started for the purpose, or to one already running.
fn listen(app: AppHandle, id: String) {
    loop {
        let mut client = DiscordIpcClient::new(&id);
        if client.connect().is_ok() {
            let subscribe = serde_json::json!({
                "cmd": "SUBSCRIBE",
                "evt": "ACTIVITY_JOIN",
                "nonce": format!("join-{}", std::process::id()),
            });
            if client.send(subscribe, 1).is_ok() {
                while let Ok((_, message)) = client.recv() {
                    if let Some(secret) = join_secret(&message) {
                        log::info!("discord: a friend joins");
                        let _ = app.emit("discord-join", secret);
                    }
                }
            }
            let _ = client.close();
        }
        std::thread::sleep(RETRY);
    }
}

fn run(wanted: Arc<(Mutex<Wanted>, Condvar)>, id: String) {
    let (lock, changed) = &*wanted;
    let mut client: Option<DiscordIpcClient> = None;
    let mut sent_version = 0;
    let mut sent_at = Instant::now()
        .checked_sub(SPACING)
        .unwrap_or_else(Instant::now);
    let mut tried_at: Option<Instant> = None;
    loop {
        let (presence, version) = {
            let mut w = lock.lock().unwrap();
            // Wait for a change, or until it is time to look for Discord or send the status again.
            // With nothing to show and no connection there is nothing to do until a change.
            while w.version == sent_version
                && ((client.is_none() && w.presence.is_none())
                    || tried_at.is_some_and(|t| t.elapsed() < RETRY))
            {
                let left = RETRY.saturating_sub(tried_at.map_or(Duration::ZERO, |t| t.elapsed()));
                let left = if left.is_zero() { RETRY } else { left };
                w = changed.wait_timeout(w, left).unwrap().0;
            }
            (w.presence.clone(), w.version)
        };
        // A burst of changes (a song starting, a pause and its resume) goes out as its last one.
        let since = sent_at.elapsed();
        if since < SPACING {
            std::thread::sleep(SPACING - since);
            continue;
        }
        // Nothing to show (switched off in the settings): the status is cleared and Discord let go.
        let Some(presence) = presence else {
            sent_version = version;
            if let Some(mut c) = client.take() {
                let _ = send(&mut c, None);
                let _ = c.close();
                log::info!("discord: status off, disconnected");
                sent_at = Instant::now();
            }
            continue;
        };
        tried_at = Some(Instant::now());
        if client.is_none() {
            let mut c = DiscordIpcClient::new(&id);
            if c.connect().is_err() {
                // Discord is not running: the next look is a while away, or at the next change.
                sent_version = version;
                continue;
            }
            log::info!("discord: connected");
            client = Some(c);
        }
        let c = client.as_mut().unwrap();
        sent_at = Instant::now();
        sent_version = version;
        if let Err(e) = send(c, Some(&presence)) {
            log::info!("discord: lost the connection ({e})");
            let _ = c.close();
            client = None;
            // Try again soon: Discord may only have restarted.
            tried_at = None;
            sent_at = Instant::now();
        }
    }
}

impl Discord {
    /// Starts listening for friends joining from Discord, once, as soon as Discord is used at all
    /// (a game Discord started for a Join has nothing to show yet, but must hear the secret).
    fn listen(&self, app: &AppHandle) {
        let mut listening = self.listening.lock().unwrap();
        let Some(id) = client_id() else { return };
        if *listening {
            return;
        }
        *listening = true;
        let app = app.clone();
        let _ = std::thread::Builder::new()
            .name("discord-join".into())
            .spawn(move || listen(app, id));
    }

    fn show(&self, presence: Option<Presence>) {
        let (lock, changed) = &*self.wanted;
        let mut w = lock.lock().unwrap();
        if w.presence == presence {
            return;
        }
        w.presence = presence;
        w.version += 1;
        // Discord is first looked for once there is something to show (not while it is switched off).
        if !w.started && w.presence.is_some() {
            w.started = true;
            let Some(id) = client_id() else {
                log::info!(
                    "discord: no application id (SOUNDWAVE_DISCORD_CLIENT_ID), the status is off"
                );
                return;
            };
            let wanted = self.wanted.clone();
            let _ = std::thread::Builder::new()
                .name("discord".into())
                .spawn(move || run(wanted, id));
        }
        changed.notify_one();
    }
}

/// Shows what the player is doing on their Discord profile; `null` clears it.
#[tauri::command]
pub fn discord_presence(
    app: AppHandle,
    discord: tauri::State<'_, Discord>,
    presence: Option<Presence>,
) {
    if presence.is_some() {
        discord.listen(&app);
    }
    discord.show(presence);
}

/// The URL scheme Discord opens to start the game for a Join (`discord-<application id>`), if there is an id.
pub fn launch_scheme() -> Option<String> {
    client_id().map(|id| format!("discord-{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_fits_discords_limits() {
        assert_eq!(fit("a"), "a ");
        assert_eq!(fit("  ok  "), "ok");
        let long = "x".repeat(200);
        let f = fit(&long);
        assert_eq!(f.chars().count(), MAX_TEXT);
        assert!(f.ends_with('…'));
    }

    #[test]
    fn presence_reads_the_pages_shape() {
        let p: Presence = serde_json::from_str(
            r#"{"details":"Song — Artist","state":"Lead · Hard","end":1700000000000}"#,
        )
        .unwrap();
        assert_eq!(p.details, "Song — Artist");
        assert_eq!(p.state.as_deref(), Some("Lead · Hard"));
        assert_eq!(p.start, None);
        assert_eq!(p.end, Some(1_700_000_000_000));
        assert_eq!(p.part, None);
    }

    #[test]
    fn a_joinable_party_carries_its_size_and_secret_instead_of_the_button() {
        let p: Presence = serde_json::from_str(
            r#"{"details":"Playing together","join":{"secret":"WAVE-60 https://play.example.com","id":"abc","size":3,"max":16}}"#,
        )
        .unwrap();
        let a = serde_json::to_value(activity(&p)).unwrap();
        assert_eq!(a["party"]["id"], "abc");
        assert_eq!(a["party"]["size"], serde_json::json!([3, 16]));
        assert_eq!(a["secrets"]["join"], "WAVE-60 https://play.example.com");
        assert!(a.get("buttons").is_none());
        let plain: Presence = serde_json::from_str(r#"{"details":"In the main menu"}"#).unwrap();
        let a = serde_json::to_value(activity(&plain)).unwrap();
        assert!(a.get("secrets").is_none());
        assert_eq!(a["buttons"][0]["label"], "Play now");
    }

    #[test]
    fn a_join_secret_is_read_only_from_a_join() {
        let join = serde_json::json!({"cmd":"DISPATCH","evt":"ACTIVITY_JOIN","data":{"secret":"WAVE-60 https://play.example.com"}});
        assert_eq!(
            join_secret(&join).as_deref(),
            Some("WAVE-60 https://play.example.com")
        );
        let other = serde_json::json!({"cmd":"DISPATCH","evt":"READY","data":{}});
        assert_eq!(join_secret(&other), None);
    }

    #[test]
    fn only_known_parts_have_a_badge() {
        assert!(
            part_badge("drums")
                .unwrap()
                .ends_with("/icons/discord/drums.png")
        );
        assert_eq!(part_badge("../evil"), None);
    }
}
