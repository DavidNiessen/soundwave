/**
 * Reading the `.soundwave` files players send (src/storage/soundwaveFile.ts) without holding more
 * copies of them than needed: a shared song can be 100 MB, and several may arrive at once.
 */
import { createHash } from 'node:crypto';
import { readSoundwave, soundwaveAudio, type SoundwaveContents } from '../../src/storage/soundwaveFile.ts';
import { Refusal } from './accounts.ts';

/** A request's body as a Blob, which the file format reads (one copy, which a Blob always makes). */
export const blobOf = (body: Buffer) => new Blob([body as Uint8Array<ArrayBuffer>]);

/** The SHA-256 of a Blob, read in pieces. */
export async function hashOf(blob: Blob): Promise<string> {
  const h = createHash('sha256');
  for await (const piece of blob.stream()) h.update(piece);
  return h.digest('hex');
}

const refused = (e: unknown) => new Refusal(400, (e as Error).message || 'That is not a Soundwave song file.');

/** The id of the song in a file: the hash of its audio, sliced out without reading the rest. */
export async function songIdOf(body: Buffer): Promise<string> {
  let audio: Blob;
  try {
    audio = await soundwaveAudio(blobOf(body));
  } catch (e) {
    throw refused(e);
  }
  if (!audio.size) throw new Refusal(400, 'This song file has no song in it.');
  return hashOf(audio);
}

/** A whole file, checked; `analysis: false` leaves the analysis and edits uninflated. */
export async function contentsOf(body: Buffer, analysis = true): Promise<SoundwaveContents> {
  try {
    return await readSoundwave(blobOf(body), { analysis });
  } catch (e) {
    throw refused(e);
  }
}
