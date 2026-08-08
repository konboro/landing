// Monorepo-aware Metro config for @penny/ops.
// - watchFolders: repo root so workspace packages (@penny/*) hot-reload.
// - nodeModulesPaths: resolve deps from app + root node_modules.
// - `@/*` alias -> ./src (mirrors tsconfig paths) via resolveRequest.
// - `.js` specifiers inside @penny/* source resolve to their `.ts` twin
//   (the shared packages ship TS source and import each other with `.js`).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

const srcRoot = path.resolve(projectRoot, 'src');
const packagesRoot = path.resolve(workspaceRoot, 'packages');

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // `@/...` -> app src
  if (moduleName === '@' || moduleName.startsWith('@/')) {
    const rest = moduleName === '@' ? '' : moduleName.slice(2);
    return context.resolveRequest(context, path.join(srcRoot, rest), platform);
  }

  // Rewrite `./foo.js` -> `./foo.ts(x)` when resolving *inside* the shared
  // TS-source packages (packages/*/src). Keeps their `.js` import style working
  // under Metro without touching those packages.
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    context.originModulePath &&
    context.originModulePath.startsWith(packagesRoot)
  ) {
    const base = path.resolve(path.dirname(context.originModulePath), moduleName.slice(0, -3));
    for (const ext of ['.ts', '.tsx']) {
      if (fs.existsSync(base + ext)) {
        return context.resolveRequest(context, base + ext, platform);
      }
    }
  }

  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
