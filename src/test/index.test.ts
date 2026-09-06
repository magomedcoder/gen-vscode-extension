import * as assert from 'assert';
import { chunkFileContent } from '../index/chunk.js';
import { contentHash } from '../index/hash.js';
import { buildTrigramIndex, searchTrigrams, tokenize } from '../index/trigram.js';
import type { IndexManifest } from '../index/types.js';

suite('contentHash', () => {
	test('стабильный sha256', () => {
		const a = contentHash('hello');
		const b = contentHash('hello');
		assert.notStrictEqual(a, 'hello');
		assert.strictEqual(a, b);
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
