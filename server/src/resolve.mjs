/**
 * Lets Node load the game's own TypeScript (the judging in src/game/), whose imports leave out the
 * `.ts` the way a bundler allows: a relative import that is not found is tried again with `.ts`.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../');
    if (!relative || /\.[cm]?[jt]s$/.test(specifier) || e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return next(`${specifier}.ts`, context);
  }
}
