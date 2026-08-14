const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log(`[watch] ${build.initialOptions.outfile ?? build.initialOptions.outdir} build started`);
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				if (location) {
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				}
			});
			console.log(`[watch] ${build.initialOptions.outfile ?? build.initialOptions.outdir} build finished`);
		});
	},
};

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
		plugins: [esbuildProblemMatcherPlugin],
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
		plugins: [esbuildProblemMatcherPlugin],
	});
}

async function main() {
	const [extensionCtx, webviewCtx] = await Promise.all([
		createExtensionContext(),
		createWebviewContext(),
	]);

	if (watch) {
		await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
		return;
	}

	await Promise.all([extensionCtx.rebuild(), webviewCtx.rebuild()]);
	await Promise.all([extensionCtx.dispose(), webviewCtx.dispose()]);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
