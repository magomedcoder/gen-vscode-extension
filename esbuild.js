const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @param {string} name
 * @returns {import('esbuild').Plugin}
 */
function createProblemMatcherPlugin(name) {
	return {
		name: 'esbuild-problem-matcher',
		setup(build) {
			build.onStart(() => {
				if (activeBuilds.size === 0) {
					console.log('[watch] build started');
				}
				activeBuilds.add(name);
			});

			build.onEnd((result) => {
				result.errors.forEach(({ text, location }) => {
					console.error(`✘ [ERROR] ${text}`);
					if (location) {
						console.error(`    ${location.file}:${location.line}:${location.column}:`);
					}
				});

				activeBuilds.delete(name);
				if (activeBuilds.size === 0) {
					console.log('[watch] build finished');
				}
			});
		},
	};
}

/** @type {Set<string>} */
const activeBuilds = new Set();

async function createExtensionContext() {
	return esbuild.context({
		entryPoints: ['src/extension.ts'],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [createProblemMatcherPlugin('extension')],
	});
}

async function createWebviewContext() {
	return esbuild.context({
		entryPoints: ['src/webview/index.tsx'],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outdir: 'dist/webview',
		logLevel: 'silent',
		loader: {
			'.css': 'css',
		},
		plugins: [createProblemMatcherPlugin('webview')],
	});
}

async function main() {
	const [extensionCtx, webviewCtx] = await Promise.all([
		createExtensionContext(),
		createWebviewContext(),
	]);

	if (watch) {
		await extensionCtx.watch();
		await webviewCtx.watch();
		return;
	}

	await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
	await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
