//! The analysis models (stems, notes, beats), run by the app itself instead of by the webview.
//!
//! The page analyzes songs with ONNX Runtime in the browser. In the macOS app WebKit's WebGPU keeps
//! about 160 MB for every few seconds of a song it separates and frees it only much later, and WebKit
//! closes a page above 8 GB (16 GB on a Mac with more than 16 GB), or 4 GB while its window is in the
//! background: a song of a few minutes did not survive. On Linux WebKitGTK has no WebGPU, and without
//! cross-origin isolation the browser runtime gets no threads. So where ONNX Runtime publishes a build
//! (Apple silicon with Core ML, and Linux) the app runs the models here, in its own process, and the
//! page sends it each model run (src/analysis/native.ts). The page still does the work around the
//! models: spectrograms, putting segments together, decoding notes.
//!
//! The page talks to it on the app's `swmodel` scheme:
//! - `GET /has?model=<key>&files=a,b` answers whether those files are stored;
//! - `POST /store?model=<key>&file=<name>` stores one file of a model (a model may have its weights
//!   in files beside its graph, which the runtime finds next to it);
//! - `POST /run?model=<key>&entry=<file>` runs the model on the tensors in the body and answers with
//!   its outputs (see `read_tensors` for the layout);
//! - `POST /release?model=<key>` lets go of a model that is done.
//!
//! The models are kept in the app's cache folder, under their key (the page makes the key from the
//! model's version), so a model is sent once.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Default)]
pub struct NativeModels {
    /// The open models, by key. Each runs one call at a time.
    sessions: Mutex<HashMap<String, Arc<Mutex<Model>>>>,
}

#[cfg(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(
        target_os = "linux",
        any(target_arch = "x86_64", target_arch = "aarch64")
    )
))]
mod runtime {
    use ort::environment::Environment;
    use ort::session::{Session, builder::GraphOptimizationLevel};
    use ort::value::{Tensor, ValueType};
    use std::path::Path;
    use std::sync::OnceLock;

    /// The runtime's environment, made once for the app's lifetime.
    fn environment() -> Result<&'static Environment, String> {
        static ENV: OnceLock<Result<Environment, String>> = OnceLock::new();
        ENV.get_or_init(|| {
            ort::init()
                .with_name("soundwave")
                .build()
                .map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
    }

    pub struct Model {
        session: Session,
        pub device: &'static str,
    }

    fn threads() -> usize {
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4)
            .clamp(1, 16)
    }

    impl Model {
        /// Opens a model: with Core ML on a Mac (the graphics card and the Neural Engine take what
        /// they can, the processor the rest), on the processor's cores elsewhere or when Core ML
        /// will not take it.
        pub fn open(path: &Path, cache: &Path) -> Result<Model, String> {
            let env = environment()?;
            #[cfg(target_os = "macos")]
            if std::env::var("SOUNDWAVE_MODELS_CPU").is_err() {
                use ort::ep::coreml::{ComputeUnits, CoreML, ModelFormat};
                let coreml = CoreML::default()
                    .with_model_format(ModelFormat::MLProgram)
                    .with_compute_units(ComputeUnits::All)
                    .with_static_input_shapes(true)
                    .with_model_cache_dir(cache.display())
                    .build()
                    .error_on_failure();
                let opened = Session::builder(env)
                    .and_then(|b| {
                        b.with_optimization_level(GraphOptimizationLevel::Level3)
                            .map_err(Into::into)
                    })
                    .and_then(|b| b.with_intra_threads(threads()).map_err(Into::into))
                    .and_then(|b| b.with_execution_providers([coreml]).map_err(Into::into))
                    .and_then(|mut b| b.commit_from_file(path));
                match opened {
                    Ok(session) => {
                        return Ok(Model {
                            session,
                            device: "coreml",
                        });
                    }
                    Err(e) => log::warn!(
                        "Core ML would not take {}: {e}; using the processor",
                        path.display()
                    ),
                }
            }
            let _ = cache;
            let session = Session::builder(env)
                .and_then(|b| {
                    b.with_optimization_level(GraphOptimizationLevel::Level3)
                        .map_err(Into::into)
                })
                .and_then(|b| b.with_intra_threads(threads()).map_err(Into::into))
                .and_then(|mut b| b.commit_from_file(path))
                .map_err(|e| e.to_string())?;
            Ok(Model {
                session,
                device: "cpu",
            })
        }

        /// Runs the model on named float tensors; answers with its outputs, in the model's order.
        pub fn run(
            &mut self,
            inputs: Vec<super::NamedTensor>,
        ) -> Result<Vec<super::NamedTensor>, String> {
            let mut feeds = Vec::with_capacity(inputs.len());
            for t in inputs {
                let tensor = Tensor::from_array((t.dims, t.data)).map_err(|e| e.to_string())?;
                feeds.push((t.name, tensor.into_dyn()));
            }
            let outputs = self.session.run(feeds).map_err(|e| e.to_string())?;
            let mut answer = Vec::new();
            for (name, value) in outputs.iter() {
                if !matches!(value.dtype(), ValueType::Tensor { .. }) {
                    return Err(format!("output {name} is not a tensor"));
                }
                let (shape, data) = value
                    .try_extract_tensor::<f32>()
                    .map_err(|e| e.to_string())?;
                answer.push(super::NamedTensor {
                    name: name.to_string(),
                    dims: shape.iter().copied().collect(),
                    data: data.to_vec(),
                });
            }
            Ok(answer)
        }
    }

    pub const AVAILABLE: bool = true;
}

#[cfg(not(any(
    all(target_os = "macos", target_arch = "aarch64"),
    all(
        target_os = "linux",
        any(target_arch = "x86_64", target_arch = "aarch64")
    )
)))]
mod runtime {
    use std::path::Path;

    pub struct Model {
        pub device: &'static str,
    }

    impl Model {
        pub fn open(_path: &Path, _cache: &Path) -> Result<Model, String> {
            Err("this build runs no models itself".into())
        }
        pub fn run(
            &mut self,
            _inputs: Vec<super::NamedTensor>,
        ) -> Result<Vec<super::NamedTensor>, String> {
            Err("this build runs no models itself".into())
        }
    }

    pub const AVAILABLE: bool = false;
}

use runtime::Model;

/// A float tensor with its name and shape.
#[derive(Debug, PartialEq)]
pub struct NamedTensor {
    pub name: String,
    pub dims: Vec<i64>,
    pub data: Vec<f32>,
}

/// Whether this build runs the models itself (see the module comment).
#[tauri::command]
pub fn models_available() -> bool {
    runtime::AVAILABLE
}

fn take<const N: usize>(bytes: &[u8], at: &mut usize) -> Result<[u8; N], String> {
    let chunk = bytes
        .get(*at..*at + N)
        .ok_or("the tensors end early")?
        .try_into()
        .map_err(|_| "the tensors end early")?;
    *at += N;
    Ok(chunk)
}

/// Tensors in a body: a u32 count, then for each a u32 name length, the name (UTF-8), a u32 number
/// of dimensions, the dimensions (i64 each) and the values (f32), all little-endian.
pub fn read_tensors(bytes: &[u8]) -> Result<Vec<NamedTensor>, String> {
    let mut at = 0;
    let count = u32::from_le_bytes(take(bytes, &mut at)?) as usize;
    let mut tensors = Vec::with_capacity(count.min(64));
    for _ in 0..count {
        let len = u32::from_le_bytes(take(bytes, &mut at)?) as usize;
        let name = bytes.get(at..at + len).ok_or("the tensors end early")?;
        let name = String::from_utf8(name.to_vec()).map_err(|_| "a tensor name is not UTF-8")?;
        at += len;
        let ndims = u32::from_le_bytes(take(bytes, &mut at)?) as usize;
        if ndims > 16 {
            return Err("a tensor has too many dimensions".into());
        }
        let mut dims = Vec::with_capacity(ndims);
        for _ in 0..ndims {
            dims.push(i64::from_le_bytes(take(bytes, &mut at)?));
        }
        let size = dims
            .iter()
            .try_fold(1usize, |n, &d| n.checked_mul(usize::try_from(d).ok()?))
            .ok_or("a tensor's shape is not valid")?;
        let raw = bytes
            .get(at..at + size * 4)
            .ok_or("the tensors end early")?;
        at += size * 4;
        let (values, _) = raw.as_chunks::<4>();
        let data = values.iter().map(|&b| f32::from_le_bytes(b)).collect();
        tensors.push(NamedTensor { name, dims, data });
    }
    Ok(tensors)
}

pub fn write_tensors(tensors: &[NamedTensor]) -> Vec<u8> {
    let size: usize = tensors
        .iter()
        .map(|t| 12 + t.name.len() + t.dims.len() * 8 + t.data.len() * 4)
        .sum();
    let mut out = Vec::with_capacity(4 + size);
    out.extend_from_slice(&(tensors.len() as u32).to_le_bytes());
    for t in tensors {
        out.extend_from_slice(&(t.name.len() as u32).to_le_bytes());
        out.extend_from_slice(t.name.as_bytes());
        out.extend_from_slice(&(t.dims.len() as u32).to_le_bytes());
        for d in &t.dims {
            out.extend_from_slice(&d.to_le_bytes());
        }
        for v in &t.data {
            out.extend_from_slice(&v.to_le_bytes());
        }
    }
    out
}

/// A key or file name the page may use: letters, digits and `._-`, never a path.
fn plain(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 128
        && !name.starts_with('.')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn query(request: &tauri::http::Request<Vec<u8>>) -> HashMap<String, String> {
    request
        .uri()
        .query()
        .unwrap_or("")
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn reply(status: u16, content_type: &str, body: Vec<u8>) -> tauri::http::Response<Vec<u8>> {
    tauri::http::Response::builder()
        .status(status)
        .header("Content-Type", content_type)
        .header("Access-Control-Allow-Origin", "*")
        // The page is cross-origin isolated where it can be: its requests need this to be let through.
        .header("Cross-Origin-Resource-Policy", "cross-origin")
        .body(body)
        .unwrap_or_default()
}

fn fail(status: u16, message: &str) -> tauri::http::Response<Vec<u8>> {
    reply(
        status,
        "application/json",
        serde_json::json!({ "error": message })
            .to_string()
            .into_bytes(),
    )
}

impl NativeModels {
    fn open(&self, dir: &Path, key: &str, entry: &str) -> Result<Arc<Mutex<Model>>, String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "the models are unavailable")?;
        if let Some(model) = sessions.get(key) {
            return Ok(model.clone());
        }
        let path = dir.join(key).join(entry);
        if !path.is_file() {
            return Err(format!("the model {key}/{entry} is not stored"));
        }
        let started = std::time::Instant::now();
        let model = Model::open(&path, &dir.join(key).join("compiled"))?;
        log::info!(
            "model {key} opened on {} in {} ms",
            model.device,
            started.elapsed().as_millis()
        );
        let model = Arc::new(Mutex::new(model));
        sessions.insert(key.to_string(), model.clone());
        Ok(model)
    }

    /// Answers one request on the `swmodel` scheme. Slow work (opening and running a model) is done
    /// on a thread of its own, so the app's other requests and its window never wait for it.
    pub fn handle(
        self: &Arc<Self>,
        dir: PathBuf,
        request: tauri::http::Request<Vec<u8>>,
        responder: tauri::UriSchemeResponder,
    ) {
        let q = query(&request);
        let key = q.get("model").cloned().unwrap_or_default();
        if !plain(&key) {
            return responder.respond(fail(400, "no model named"));
        }
        let models = self.clone();
        match request.uri().path() {
            "/has" => {
                let files = q.get("files").cloned().unwrap_or_default();
                let has = files
                    .split(',')
                    .all(|f| plain(f) && dir.join(&key).join(f).is_file());
                responder.respond(reply(
                    200,
                    "application/json",
                    serde_json::json!({ "has": has }).to_string().into_bytes(),
                ));
            }
            "/store" => {
                let file = q.get("file").cloned().unwrap_or_default();
                if !plain(&file) {
                    return responder.respond(fail(400, "no file named"));
                }
                std::thread::spawn(move || {
                    let folder = dir.join(&key);
                    // Written beside and moved in place, so a file cut off halfway is never taken for a stored one.
                    let part = folder.join(format!("{file}.part"));
                    let stored = std::fs::create_dir_all(&folder)
                        .and_then(|_| std::fs::write(&part, request.body()))
                        .and_then(|_| std::fs::rename(&part, folder.join(&file)));
                    responder.respond(match stored {
                        Ok(()) => reply(200, "application/json", b"{}".to_vec()),
                        Err(e) => fail(500, &format!("the model could not be stored: {e}")),
                    });
                });
            }
            "/run" => {
                let entry = q.get("entry").cloned().unwrap_or_default();
                if !plain(&entry) {
                    return responder.respond(fail(400, "no model file named"));
                }
                std::thread::spawn(move || {
                    let answer = read_tensors(request.body()).and_then(|inputs| {
                        let model = models.open(&dir, &key, &entry)?;
                        let mut model = model.lock().map_err(|_| "the model is unavailable")?;
                        let device = model.device;
                        model.run(inputs).map(|out| (write_tensors(&out), device))
                    });
                    responder.respond(match answer {
                        Ok((body, device)) => tauri::http::Response::builder()
                            .status(200)
                            .header("Content-Type", "application/octet-stream")
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Access-Control-Expose-Headers", "X-Model-Device")
                            .header("Cross-Origin-Resource-Policy", "cross-origin")
                            .header("X-Model-Device", device)
                            .body(body)
                            .unwrap_or_default(),
                        Err(e) => fail(500, &e),
                    });
                });
            }
            "/release" => {
                if let Ok(mut sessions) = models.sessions.lock() {
                    sessions.remove(&key);
                }
                responder.respond(reply(200, "application/json", b"{}".to_vec()));
            }
            _ => responder.respond(fail(404, "unknown request")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tensors_go_through_the_body_unchanged() {
        let tensors = vec![
            NamedTensor {
                name: "x".into(),
                dims: vec![1, 2, 3],
                data: (0..6).map(|i| i as f32 * 0.5).collect(),
            },
            NamedTensor {
                name: "xt_out".into(),
                dims: vec![2],
                data: vec![-1.0, 3.25],
            },
        ];
        assert_eq!(read_tensors(&write_tensors(&tensors)).unwrap(), tensors);
    }

    #[test]
    fn a_short_or_bad_body_is_refused() {
        let body = write_tensors(&[NamedTensor {
            name: "x".into(),
            dims: vec![4],
            data: vec![1.0; 4],
        }]);
        assert!(read_tensors(&body[..body.len() - 1]).is_err());
        assert!(read_tensors(&[1, 0, 0, 0, 255, 255, 255, 255]).is_err());
    }

    #[test]
    fn only_plain_names_are_taken() {
        assert!(plain("htdemucs-1.onnx"));
        assert!(plain("model.onnx.data"));
        assert!(!plain("../escape"));
        assert!(!plain("a/b"));
        assert!(!plain(".hidden"));
        assert!(!plain(""));
    }
}
