// Monorepo-aware Metro config for the Penny Rider app (Expo SDK 54).
// - watches the workspace root so symlinked @penny/* packages are transpiled
// - resolves modules from both app-local and root node_modules (pnpm)
// - shims the workspace packages' `.js`-in-source ESM imports to their real
//   `.ts` sources so Metro can bundle the raw-TypeScript shared packages.
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

// The @penny/* packages ship raw TypeScript whose barrels re-export sibling
// files with an explicit `.js` extension (NodeNext ESM style). Metro doesn't
// map `.js` -> `.ts` by default, so we do it here, only falling back to the
// original request when no TS sibling exists (i.e. genuine node_modules JS).
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
    const base = moduleName.replace(/\.js$/, '');
    for (const ext of ['.ts', '.tsx']) {
      const candidate = path.resolve(path.dirname(context.originModulePath), base + ext);
      if (fs.existsSync(candidate)) {
        return { type: 'sourceFile', filePath: candidate };
      }
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
