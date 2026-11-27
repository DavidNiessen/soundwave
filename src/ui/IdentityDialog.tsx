/**
 * Backing up the player's identity and bringing it back (src/net/identity.ts): a small file locked
 * with a passphrase, saved anywhere, and read back on another device or a new installation.
 */
import { Download, LoaderCircle, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { identity } from '../net/identity';
import { online } from '../net/client';
import { chooseSaveTarget } from '../storage/share';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';

const MIN = 8;

export function IdentityDialog({ kind, onClose, onDone }: { kind: 'export' | 'import'; onClose(): void; onDone(message: string): void }) {
  const [pass, setPass] = useState('');
  const [again, setAgain] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const exporting = kind === 'export';
  const ready = exporting ? pass.length >= MIN && pass === again : !!file && pass.length > 0;

  const go = async (close: () => void) => {
    setBusy(true);
    setProblem(null);
    try {
      if (exporting) {
        // Asked where first: a browser shows its save dialog only straight after a press.
        const target = await chooseSaveTarget('my.soundwave-id', 'identity');
        if (!target) return;
        await target.write(await identity.export(pass));
        await target.close();
        // Only a file that was written counts as a backup.
        await identity.backedUp();
        close();
        onDone('Your identity is backed up. Keep the file and the passphrase: both are needed to bring it back.');
      } else {
        const me = await identity.import(file!, pass);
        // Signed in on a server now with another identity: sign in again with this one.
        online.signOut();
        online.letIdentitySignIn();
        online.resume();
        close();
        onDone(`Welcome back${me.name ? `, ${me.name}` : ''}. Your accounts sign in with this identity now.`);
      }
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={exporting ? 'Back up your identity' : 'Bring back an identity'} variant="card" closeLabel="Cancel" onClose={onClose}>
      {(close) => (
        <form
          className="window-body identity-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready && !busy) void go(close);
          }}
        >
          <h2 className="display">{exporting ? 'Back up your identity' : 'Bring back an identity'}</h2>
          <p className="hint">
            {exporting
              ? 'It signs you in on every server. The file is locked with a passphrase you pick: keep both somewhere safe, apart from this computer. Anyone with both is you.'
              : 'Pick the file you backed up and type its passphrase. It replaces the identity here, if there is one: back that one up first if you still need it.'}
          </p>
          {!exporting && (
            <>
              <input
                ref={picker}
                type="file"
                accept=".soundwave-id,application/json"
                hidden
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button type="button" className="btn wide" data-autofocus onClick={() => picker.current?.click()}>
                <Upload strokeWidth={ICON_STROKE} aria-hidden />
                {file ? file.name : 'Pick the file'}
              </button>
            </>
          )}
          <label className="meta-field">
            <span className="dim">Passphrase</span>
            <input
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete={exporting ? 'new-password' : 'current-password'}
              data-autofocus={exporting ? '' : undefined}
            />
            {exporting && <span className={pass && pass.length < MIN ? 'warn' : 'dim'}>At least {MIN} characters</span>}
          </label>
          {exporting && (
            <label className="meta-field">
              <span className="dim">The passphrase again</span>
              <input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
              {again && again !== pass && <span className="warn">They differ</span>}
            </label>
          )}
          {problem && (
            <p className="party-error" role="alert">
              {problem}
            </p>
          )}
          <button type="submit" className="btn primary wide" disabled={!ready || busy}>
            {busy ? (
              <LoaderCircle className="spin" strokeWidth={ICON_STROKE} aria-hidden />
            ) : exporting ? (
              <Download strokeWidth={ICON_STROKE} aria-hidden />
            ) : (
              <Upload strokeWidth={ICON_STROKE} aria-hidden />
            )}
            {busy ? 'One moment…' : exporting ? 'Save the backup' : 'Bring it back'}
          </button>
        </form>
      )}
    </Dialog>
  );
}
