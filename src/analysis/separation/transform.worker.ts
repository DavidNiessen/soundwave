/// <reference lib="webworker" />
import { serveHelper, type HelperPort } from './transform';

/** A helper of the stem separation (see transform.ts), on the port the page hands it. */
self.onmessage = (e: MessageEvent<HelperPort>) => {
  if (e.data?.type === 'port') serveHelper(e.data.port);
};
