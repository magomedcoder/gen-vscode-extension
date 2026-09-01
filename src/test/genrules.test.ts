import * as assert from 'node:assert/strict';
import { formatGenRulesForPrompt, MAX_GENRULES_CHARS, normalizeGenRulesText } from '../project/genrules';

suite('genrules', () => {
	test('normalizeGenRulesText trims and rejects empty', () => {
		assert.equal(normalizeGenRulesText('   '), undefined);
		assert.equal(normalizeGenRulesText('  hello  '), 'hello');
	});

	test('normalizeGenRulesText truncates long files', () => {
		const long = 'x'.repeat(MAX_GENRULES_CHARS + 50);
		const out = normalizeGenRulesText(long);
		assert.ok(out);
		assert.ok(out.length < long.length);
		assert.match(out, /обрезан/);
	});

	test('formatGenRulesForPrompt prefixes content', () => {
		const out = formatGenRulesForPrompt('Use tabs.');
		assert.match(out, /\.genrules/);
		assert.match(out, /Use tabs\./);
	});
});
