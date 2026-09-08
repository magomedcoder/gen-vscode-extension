import * as assert from 'assert';
import { chunkFileContent } from '../features/index/chunk.js';
import { canSkipDirRewalk, recomputeDirDigests } from '../features/index/dirDigests.js';
import { contentHash } from '../features/index/hash.js';
import { buildTrigramIndex, searchTrigrams, tokenize } from '../features/index/trigram.js';
import type { IndexManifest } from '../features/index/types.js';
import { parseSymbolIndexJson } from '../features/index/symbolIndexParse.js';

suite('contentHash', () => {
	test('стабильный sha256', () => {
		const a = contentHash('hello');
		const b = contentHash('hello');
		assert.notStrictEqual(a, 'hello');
		assert.strictEqual(a, b);
	});
});

suite('dirDigests', () => {
	test('пересчитывает Merkle digests по file hashes', () => {
		const digests = recomputeDirDigests({
			'src/a.ts': { 
				hash: 'h1'
			 },
			'src/b.ts': { 
				hash: 'h2'
			 },
			'README.md': { 
				hash: 'h3'
			 },
		});
		assert.ok(digests['']);
		assert.ok(digests['src']);
		assert.notStrictEqual(digests[''], digests['src']);

		const again = recomputeDirDigests({
			'src/a.ts': { 
				hash: 'h1' 
			},
			'src/b.ts': { 
				hash: 'h2' 
			},
			'README.md': { 
				hash: 'h3' 
			},
		});
		assert.strictEqual(digests['src'], again['src']);

		const changed = recomputeDirDigests({
			'src/a.ts': { 
				hash: 'h1-changed' 
			},
			'src/b.ts': { 
				hash: 'h2' 
			},
			'README.md': { 
				hash: 'h3' 
			},
		});
		assert.notStrictEqual(digests['src'], changed['src']);
	});

	test('canSkipDirRewalk при совпадении paths+sizes', () => {
		const files = {
			'src/a.ts': { 
				hash: 'h1', 
				size: 10, 
				chunkIds: [] as string[] 
			},
			'src/b.ts': { 
				hash: 'h2', 
				size: 20, 
				chunkIds: [] as string[] 
			},
		};
		const digests = recomputeDirDigests(files);
		const manifest: IndexManifest = {
			version: 1,
			updatedAt: '',
			files,
			chunks: {},
			trigrams: {},
			dirDigests: digests,
		};
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{ 
					relative: 'src/a.ts', 
					size: 10 
				},
				{ 
					relative: 'src/b.ts', 
					size: 20 
				},
			]),
			true,
		);
		assert.strictEqual(
			canSkipDirRewalk(manifest, 'src', [
				{ 
					relative: 'src/a.ts', 
					size: 11 
				},
				{ 
					relative: 'src/b.ts', 
					size: 20 
				},
			]),
			false,
		);
	});
});

suite('symbolIndex parse', () => {
	test('parseSymbolIndexJson читает валидный кэш', () => {
		const raw = JSON.stringify({
			updatedAt: '2026-01-01T00:00:00.000Z',
			fileCount: 1,
			symbols: [
				{ 
					name: 'Foo', 
					kind: 'class', 
					path: 'src/foo.ts', 
					startLine: 1, 
					endLine: 10 
				},
				{ 
					name: 1, 
					kind: 'bad', 
					path: 'x' 
				},
			],
		});
		const doc = parseSymbolIndexJson(raw);
		assert.ok(doc);
		assert.strictEqual(doc!.symbols.length, 1);
		assert.strictEqual(doc!.symbols[0]!.name, 'Foo');
	});

	test('parseSymbolIndexJson на мусоре -> undefined', () => {
		assert.strictEqual(parseSymbolIndexJson('{'), undefined);
		assert.strictEqual(parseSymbolIndexJson('{"symbols":null}'), undefined);
	});
});

suite('chunkFileContent', () => {
	test('режет по function', () => {
		const src = [
			'function a() {',
			'  const x = 1;',
			'  const y = 2;',
			'  const z = 3;',
			'  return x + y + z;',
			'}',
			'',
			'function b() {',
			'  return 2;',
			'}',
		].join('\n');
		const chunks = chunkFileContent('src/a.ts', src);
		assert.ok(chunks.length >= 2);
		assert.strictEqual(chunks[0].path, 'src/a.ts');
		assert.ok(chunks.some((c) => c.text.includes('function a')));
		assert.ok(chunks.some((c) => c.text.includes('function b')));
	});

	test('пустой файл - без chunks', () => {
		assert.deepStrictEqual(chunkFileContent('empty.ts', '   \n  '), []);
	});
});

suite('trigram search', () => {
	test('находит chunk по токенам', () => {
		const chunks = chunkFileContent('lib/math.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
		const trigrams = buildTrigramIndex(chunks);
		const manifest: IndexManifest = {
			version: 1,
			updatedAt: '',
			files: {},
			chunks: Object.fromEntries(chunks.map((c) => [c.id, c])),
			trigrams,
			dirDigests: {},
		};

		const hits = searchTrigrams(manifest, 'add number', 5);
		assert.ok(hits.length >= 1);
		assert.ok(hits[0].score > 0);
	});

	test('tokenize отбрасывает короткие слова', () => {
		assert.ok(tokenize('a bb ccc').includes('ccc'));
		assert.ok(!tokenize('a bb').includes('bb'));
	});
});
