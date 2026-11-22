import type * as Ort from 'onnxruntime-web/webgpu';
import { MELS } from './spectrogram';
import { WINDOW, type BeatModel } from './track';

export interface OpenBeatModel extends BeatModel {
  /** What it ended up running on. */
  device: 'gpu' | 'cpu';
  release(): Promise<void>;
}

/**
 * Opens the beat model (Beat This, the small one, 10 MB; tools/analysis/export_beat_model.py makes
 * the file) on the graphics card, or on the processor when there is none or it cannot load it. The
 * runtime must be ready (see ../runtime.ts).
 */
export async function openBeatModel(
  ort: typeof Ort,
  url: string,
  device: 'gpu' | 'cpu',
  log: (message: string) => void,
): Promise<OpenBeatModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the beat model could not be loaded (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let session: Ort.InferenceSession;
  try {
    session = await ort.InferenceSession.create(bytes, { executionProviders: [device === 'gpu' ? 'webgpu' : 'wasm'], logSeverityLevel: 3 });
  } catch (err) {
    if (device !== 'gpu') throw err;
    log(`the graphics card could not load the beat model (${(err as Error).message}); using the processor`);
    device = 'cpu';
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], logSeverityLevel: 3 });
  }
  return {
    device,
    async run(spect) {
      const out = await session.run({ spect: new ort.Tensor('float32', spect, [1, WINDOW, MELS]) });
      const result = { beat: (await out.beat.getData()) as Float32Array, downbeat: (await out.downbeat.getData()) as Float32Array };
      out.beat.dispose();
      out.downbeat.dispose();
      return result;
    },
    release: () => session.release(),
  };
}
