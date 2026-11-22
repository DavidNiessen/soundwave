//! The light bar around a PlayStation controller's touchpad (DualSense, DualSense Edge and
//! DualShock 4), set natively: the web view's Gamepad API has no way to reach it. The page says
//! which colour it wants; a thread of its own keeps the controllers open while there is one and
//! writes the newest colour, so a slow write or a device search never holds up a command.
//!
//! Only controllers on a USB cable are lit. By Bluetooth the light is set through the controller's
//! extended reports, and once it has been sent one it answers in those reports only, which the web
//! view's Gamepad API does not read: the game would stop seeing its buttons.

use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use hidapi::{BusType, HidApi, HidDevice};
use serde::{Deserialize, Serialize};

const SONY: u16 = 0x054C;
/// DualSense and DualSense Edge.
const DUALSENSE: [u16; 2] = [0x0CE6, 0x0DF2];
/// DualShock 4 (first and second model) and its USB wireless adapter.
const DUALSHOCK4: [u16; 3] = [0x05C4, 0x09CC, 0x0BA0];
/// The colour the controllers are given back when the game lets go: the dim blue they show
/// when no game sets one (the one other games use for player one too).
const RESTING: Rgb = Rgb {
    r: 0,
    g: 0,
    b: 0x40,
};
/// How often the controllers are looked for while a colour is wanted and none is open.
const LOOK_EVERY: Duration = Duration::from_secs(2);

#[derive(Deserialize, Serialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Rgb {
    r: u8,
    g: u8,
    b: u8,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub enum Model {
    DualSense,
    DualShock4,
}

/// A controller with a light bar, as the settings screen lists it.
#[derive(Serialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Pad {
    model: Model,
    /// On a USB cable: only then can its light be set (see the module's comment).
    usb: bool,
}

fn model(product: u16) -> Option<Model> {
    if DUALSENSE.contains(&product) {
        Some(Model::DualSense)
    } else if DUALSHOCK4.contains(&product) {
        Some(Model::DualShock4)
    } else {
        None
    }
}

/// The USB output report that sets the light bar to `c`, touching nothing else: the rumble,
/// the haptics and the player lights are left as they are.
pub fn report(model: Model, c: Rgb) -> Vec<u8> {
    match model {
        Model::DualSense => {
            // Report 0x02, 48 bytes. Byte 2 holds the second set of "this field is valid" flags
            // (0x04: the light bar); the colour is at 45..48.
            let mut r = vec![0u8; 48];
            r[0] = 0x02;
            r[2] = 0x04;
            r[45] = c.r;
            r[46] = c.g;
            r[47] = c.b;
            r
        }
        Model::DualShock4 => {
            // Report 0x05, 32 bytes. Byte 1 flags what is set (0x02: the light bar); the colour
            // is at 6..9, after the two motors.
            let mut r = vec![0u8; 32];
            r[0] = 0x05;
            r[1] = 0x02;
            r[6] = c.r;
            r[7] = c.g;
            r[8] = c.b;
            r
        }
    }
}

/// Every controller with a light bar that is connected now.
fn find(api: &HidApi) -> Vec<(Pad, &hidapi::DeviceInfo)> {
    let mut seen = Vec::new();
    api.device_list()
        .filter(|d| d.vendor_id() == SONY)
        .filter_map(|d| {
            let model = model(d.product_id())?;
            // A controller can be listed once per interface or collection: take each path once.
            if seen.contains(&d.path()) {
                return None;
            }
            seen.push(d.path());
            Some((
                Pad {
                    model,
                    usb: matches!(d.bus_type(), BusType::Usb),
                },
                d,
            ))
        })
        .collect()
}

struct Wanted {
    /// The colour to show; `None` gives the controllers back their own.
    color: Option<Rgb>,
    /// Bumped on every change, so the thread knows there is something new to write.
    turn: u64,
}

#[derive(Default)]
pub struct Lightbar {
    wanted: Arc<(Mutex<Option<Wanted>>, Condvar)>,
    started: Mutex<bool>,
}

impl Lightbar {
    fn want(&self, color: Option<Rgb>) {
        let (lock, cv) = &*self.wanted;
        if let Ok(mut w) = lock.lock() {
            let turn = w.as_ref().map_or(0, |w| w.turn) + 1;
            *w = Some(Wanted { color, turn });
            cv.notify_one();
        }
        self.start();
    }

    /// Starts the writing thread (once).
    fn start(&self) {
        let Ok(mut started) = self.started.lock() else {
            return;
        };
        if *started {
            return;
        }
        *started = true;
        let wanted = self.wanted.clone();
        thread::spawn(move || run(&wanted));
    }
}

fn run(wanted: &(Mutex<Option<Wanted>>, Condvar)) {
    let (lock, cv) = wanted;
    let mut open: Vec<(Model, HidDevice)> = Vec::new();
    let mut looked: Option<Instant> = None;
    let mut written = 0u64;
    loop {
        // Wait for a new colour, or, while one is wanted and no controller is open, for the next look.
        let (color, turn) = {
            let Ok(mut w) = lock.lock() else { return };
            loop {
                let (color, turn) = w.as_ref().map_or((None, 0), |w| (w.color, w.turn));
                let searching = color.is_some() && open.is_empty();
                if turn != written || searching {
                    break (color, turn);
                }
                w = match cv.wait(w) {
                    Ok(w) => w,
                    Err(_) => return,
                };
            }
        };
        if color.is_some() && open.is_empty() && looked.is_none_or(|t| t.elapsed() >= LOOK_EVERY) {
            looked = Some(Instant::now());
            if let Ok(api) = HidApi::new() {
                open = find(&api)
                    .into_iter()
                    .filter(|(pad, _)| pad.usb)
                    .filter_map(|(pad, d)| Some((pad.model, d.open_device(&api).ok()?)))
                    .collect();
            }
        }
        // Unplugged or switched off: it is dropped, and looked for again while a colour is wanted.
        open.retain(|(model, device)| {
            device
                .write(&report(*model, color.unwrap_or(RESTING)))
                .is_ok()
        });
        if color.is_none() {
            // Given back: nothing is held open until the next colour is wanted.
            open.clear();
            looked = None;
        }
        written = turn;
        if color.is_some() && open.is_empty() {
            thread::sleep(LOOK_EVERY);
        }
    }
}

/// Sets the light bar of every PlayStation controller on a USB cable to `color`, or with `null`
/// gives them back their resting blue. Returns at once; the colour is written in the background.
#[tauri::command]
pub fn lightbar_set(state: tauri::State<'_, Lightbar>, color: Option<Rgb>) {
    state.want(color);
}

/// The controllers with a light bar that are connected, for the settings screen. Async: looking
/// for devices takes a moment and must not hold up the window.
#[tauri::command]
pub async fn lightbar_pads() -> Result<Vec<Pad>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        HidApi::new()
            .map(|api| find(&api).into_iter().map(|(pad, _)| pad).collect())
            .unwrap_or_default()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOLD: Rgb = Rgb {
        r: 255,
        g: 140,
        b: 0,
    };

    #[test]
    fn dualsense_report_sets_only_the_light_bar() {
        let r = report(Model::DualSense, GOLD);
        assert_eq!(r.len(), 48);
        assert_eq!(r[0], 0x02);
        // Rumble and haptics flags untouched, light bar flag set.
        assert_eq!(r[1], 0);
        assert_eq!(r[2], 0x04);
        assert_eq!(&r[45..48], &[255, 140, 0]);
        assert!(r[3..45].iter().all(|&b| b == 0));
    }

    #[test]
    fn dualshock4_report_sets_only_the_light_bar() {
        let r = report(Model::DualShock4, GOLD);
        assert_eq!(r.len(), 32);
        assert_eq!(r[0], 0x05);
        assert_eq!(r[1], 0x02);
        // The motors (4, 5) are left alone.
        assert_eq!(&r[4..6], &[0, 0]);
        assert_eq!(&r[6..9], &[255, 140, 0]);
    }

    #[test]
    fn knows_the_controllers() {
        assert_eq!(model(0x0CE6), Some(Model::DualSense));
        assert_eq!(model(0x0DF2), Some(Model::DualSense));
        assert_eq!(model(0x09CC), Some(Model::DualShock4));
        assert_eq!(model(0x0BA0), Some(Model::DualShock4));
        assert_eq!(model(0x1234), None);
    }

    /// Cycles a connected controller's light bar through red, green, blue and back. Run by hand:
    /// `cargo test lightbar::tests::hardware -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn hardware() {
        let api = HidApi::new().expect("hid");
        let pads = find(&api);
        println!("{pads:?}");
        for (pad, d) in pads.into_iter().filter(|(p, _)| p.usb) {
            let device = d.open_device(&api).expect("open");
            for c in [
                Rgb { r: 255, g: 0, b: 0 },
                Rgb { r: 0, g: 255, b: 0 },
                Rgb { r: 0, g: 0, b: 255 },
                RESTING,
            ] {
                println!(
                    "{:?} {c:?}: {:?}",
                    pad.model,
                    device.write(&report(pad.model, c))
                );
                thread::sleep(Duration::from_millis(600));
            }
        }
    }
}
