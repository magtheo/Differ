const { build } = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const sharedConfig = {
    bundle: true,
    minify: !isWatch,
    sourcemap: !isWatch,
    // REMOVE 'web-tree-sitter' from external array - only keep 'vscode'
    external: ['vscode'], // Only VS Code API should be external
    platform: 'node',
    target: 'node16',
    logLevel: 'info',
};

async function buildExtension() {
    await build({
        ...sharedConfig,
        entryPoints: ['src/extension.ts'],
        outfile: 'out/extension.js',
        format: 'cjs', // CommonJS format
    }).catch(() => process.exit(1));
}

buildExtension();

if (isWatch) {
    console.log('Watching for changes...');
}