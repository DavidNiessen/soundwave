/// <reference lib="webworker" />
import type { FromStage, ToStage } from './protocol';
import { proxyWorkerFetch } from '../../app/workerFetch';
import { createStageHost } from './stageHost';

/** The 3D stage's own thread: it draws on canvases the page hands over (see StageView). */
const scope = self as unknown as DedicatedWorkerGlobalScope;
// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m, transfer) => scope.postMessage(m, transfer));
const host = createStageHost(
  (m: FromStage) => scope.postMessage(m),
  (m: FromStage, list: Transferable[]) => scope.postMessage(m, list),
);
self.onmessage = (e: MessageEvent<ToStage>) => {
  if (!fetched(e.data)) host.handle(e.data);
};
