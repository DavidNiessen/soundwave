/**
 * Smaller copies of a server's songs, for players on a slow connection (settings.streamQuality).
 *
 * The server has no audio encoder, so the game makes them: the game of whoever shared a song, or of
 * an admin or moderator, encodes its audio again at a lower bit rate (AAC in MP4, else Opus in
 * WebM, with WebCodecs through mediabunny) and sends the copy (`PUT /songs/:id/copies/:quality`).
 * A copy is a whole song file: the same details, cover, analysis and charts, with the smaller audio
 * and `copyOf` naming the song it is of.
 *
 * Its notes must land where the song's do, to the sample. An encoder starts with a little silence
 * of its own (AAC's priming), which a decoder may or may not take back out, so the copy is decoded
 * again and laid against the song to find how far it moved; the song is then encoded once more,
 * shifted back by that much, and checked again. A copy that does not line up is not sent.
 */
import type { AudioCodec } from 'mediabunny';
import { lagBetween } from '../audio/align';
import { readSoundwave, writeSoundwave, type SoundwaveContents } from '../storage/soundwaveFile';
import { QUALITY_BITRATE, type StreamQuality } from './protocol';

type Copy = Exclude<StreamQuality, 'high'>;

/** A copy is only worth keeping when it is at most this share of the song's audio. */
const WORTH = 0.75;
/** How far a copy may be off the song after lining up, in samples (well under a millisecond). */
const TOLERANCE = 2;
/**
 * The sample rate copies are made and lined up at, whatever the device plays at: every encoder
 * takes it (AAC refuses 96 kHz, say), and the copy is decoded back at it to measure it.
 */
const RATE = 48000;

/** Decodes audio at RATE, not at the rate of the device's output. */
const decode = (bytes: ArrayBuffer) => new OfflineAudioContext(2, 1, RATE).decodeAudioData(bytes);

interface Encoding {
  codec: AudioCodec;
  mime: string;
  bitrate: number;
}
const chosen = new Map<Copy, Promise<Encoding | null>>();
/**
 * How a copy is encoded here: AAC (which every browser decodes) at the copy's bit rate, else at the
 * nearest one the encoder takes (Windows' AAC encoder starts at 96 kbit/s), else Opus.
 */
function encodingFor(q: Copy): Promise<Encoding | null> {
  let p = chosen.get(q);
  if (!p) {
    p = (async () => {
      const mb = await import('mediabunny');
      const bitrate = QUALITY_BITRATE[q];
      const tries: Encoding[] = [
        { codec: 'aac', mime: 'audio/mp4', bitrate },
        ...(bitrate < 96_000 ? [{ codec: 'aac' as const, mime: 'audio/mp4', bitrate: 96_000 }] : []),
        { codec: 'opus', mime: 'audio/webm', bitrate },
      ];
      for (const t of tries)
        if (await mb.canEncodeAudio(t.codec, { numberOfChannels: 2, sampleRate: RATE, bitrate: t.bitrate }).catch(() => false)) return t;
      return null;
    })();
    chosen.set(q, p);
  }
  return p;
}

/** Whether this browser can make copies at all. */
export async function canMakeCopies(): Promise<boolean> {
  return typeof AudioEncoder !== 'undefined' && typeof OfflineAudioContext !== 'undefined' && !!(await encodingFor('medium'));
}

/** `buf` from sample `from` on (a negative `from`: that much silence first). */
function shifted(buf: AudioBuffer, from: number): AudioBuffer {
  const length = Math.max(1, buf.length - from);
  const out = new AudioBuffer({ length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    if (from >= 0) out.copyToChannel(src.subarray(from), c);
    else out.copyToChannel(src.subarray(0, length + from), c, -from);
  }
  return out;
}

async function encode(buf: AudioBuffer, how: Encoding): Promise<Blob> {
  const mb = await import('mediabunny');
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: how.codec === 'aac' ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target });
  const source = new mb.AudioBufferSource({ codec: how.codec, bitrate: how.bitrate });
  output.addAudioTrack(source);
  await output.start();
  await source.add(buf);
  source.close();
  await output.finalize();
  return new Blob([target.buffer!], { type: how.mime });
}

const channels = (buf: AudioBuffer) => Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
/** How many samples later the decoded copy plays the song's audio. */
const lagOf = (song: AudioBuffer, copy: AudioBuffer) => lagBetween(channels(song), channels(copy), song.sampleRate);

/**
 * Makes the smaller copies of a song file worth making (none where its audio is already small, or
 * this browser cannot encode). `id`: the song's id, which each copy names.
 */
export async function makeCopies(file: Blob, id: string, want: Copy[] = ['medium', 'low']): Promise<Partial<Record<Copy, Blob>>> {
  if (!(await canMakeCopies())) return {};
  const contents: SoundwaveContents = await readSoundwave(file);
  const song = await decode(await contents.audio.arrayBuffer());
  const made: Partial<Record<Copy, Blob>> = {};
  for (const q of want) {
    const how = await encodingFor(q);
    // Worth it only where the copy comes out well under the song's own audio.
    if (!how || (how.bitrate / 8) * song.duration > contents.audio.size * WORTH) continue;
    const first = await encode(song, how);
    const lag = lagOf(song, await decode(await first.arrayBuffer()));
    const audio = lag === 0 ? first : await encode(shifted(song, lag), how);
    if (lag !== 0 && Math.abs(lagOf(song, await decode(await audio.arrayBuffer()))) > TOLERANCE) continue;
    made[q] = await writeSoundwave({ ...contents, meta: { ...contents.meta, copyOf: id }, audio });
  }
  return made;
}
