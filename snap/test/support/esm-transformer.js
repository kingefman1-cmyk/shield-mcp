// Test-only Jest transformer. Project TypeScript goes through ts-jest; a dependency file is compiled to CommonJS only
// when its nearest package.json declares "type": "module" (several MetaMask packages ship ES modules only).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ts = require('typescript');
const tsJest = require('ts-jest').default.createTransformer({
  tsconfig: path.join(__dirname, '..', '..', 'tsconfig.test.json'),
  diagnostics: { ignoreCodes: ['TS151001'] },
});

const typeCache = new Map();
function isEsm(file) {
  let dir = path.dirname(file);
  const seen = [];
  while (dir !== path.dirname(dir)) {
    if (typeCache.has(dir)) {
      const v = typeCache.get(dir);
      seen.forEach((d) => typeCache.set(d, v));
      return v;
    }
    seen.push(dir);
    const pj = path.join(dir, 'package.json');
    if (fs.existsSync(pj)) {
      let v = false;
      try {
        const pkg = JSON.parse(fs.readFileSync(pj, 'utf8'));
        if (pkg.name || pkg.type) v = pkg.type === 'module';
        else continue;
      } catch {
        // ignore
      }
      seen.forEach((d) => typeCache.set(d, v));
      return v;
    }
    dir = path.dirname(dir);
  }
  return false;
}

const inDeps = (file) => file.split(path.sep).includes('node_modules') || file.includes('/node_modules/');

module.exports = {
  canInstrument: false,
  getCacheKey(source, file, options) {
    return crypto.createHash('sha256').update('v1').update(file).update(source).update(String(options.configString)).digest('hex');
  },
  process(source, file, options) {
    if (!inDeps(file)) return tsJest.process(source, file, options);
    if (!/\.(m?js)$/.test(file) || !isEsm(file)) return { code: source };
    const out = ts.transpileModule(source, {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, allowJs: true, esModuleInterop: true, sourceMap: false },
    });
    return { code: out.outputText };
  },
};
