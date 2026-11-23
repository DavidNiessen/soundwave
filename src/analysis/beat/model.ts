import type * as Ort from 'onnxruntime-web/webgpu';
import { BEAT_MODEL, nativeSession } from '../native';
import { nudgeCollector, openOnDevice } from '../runtime';
import { MELS } from './spectrogram';
import { WINDOW, type BeatModel } from './track';

export interface OpenBeatModel extends BeatModel {
  /** What it ended up running on. */
  device: 'gpu' | 'cpu' | 'native';
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
  const opened = await openOnDevice(
    device,
    (provider) => ort.InferenceSession.create(bytes, { executionProviders: [provider], logSeverityLevel: 3 }),
    (err) => log(`the graphics card could not load the beat model (${err.message}); using the processor`),
  );
  return beatModel(ort, opened.value, opened.device);
}

/** The beat model the desktop app runs (see analysis/native.ts); the app must have been handed it. */
export function appBeatModel(ort: typeof Ort): OpenBeatModel {
  return beatModel(ort, nativeSession(BEAT_MODEL.key, BEAT_MODEL.entry).session, 'native');
}

function beatModel(ort: typeof Ort, session: Ort.InferenceSession, device: OpenBeatModel['device']): OpenBeatModel {
  return {
    device,
    async run(spect) {
      const out = await session.run({ spect: new ort.Tensor('float32', spect, [1, WINDOW, MELS]) });
      const result = { beat: (await out.beat.getData()) as Float32Array, downbeat: (await out.downbeat.getData()) as Float32Array };
      out.beat.dispose();
      out.downbeat.dispose();
      nudgeCollector();
      return result;
    },
    release: () => session.release(),
  };
}
