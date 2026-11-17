// Module hook for tests: replaces the game's script modules with the mock.
const MOCKS = {
  "@minecraft/server": new URL("./mock/server.mjs", import.meta.url).href,
  "@minecraft/server-ui": new URL("./mock/server-ui.mjs", import.meta.url).href,
};
export async function resolve(specifier, context, next) {
  if (MOCKS[specifier]) return { url: MOCKS[specifier], shortCircuit: true };
  return next(specifier, context);
}
