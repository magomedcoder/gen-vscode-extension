import * as assert from 'node:assert';
import { isLocalhostUrl } from '../core/config/localUrl.js';

suite('localUrl', () => {
	test('isLocalhostUrl', () => {
		assert.strictEqual(isLocalhostUrl(''), true);
		assert.strictEqual(isLocalhostUrl('http://127.0.0.1:8080/v1'), true);
		assert.strictEqual(isLocalhostUrl('http://localhost:11434'), true);
		assert.strictEqual(isLocalhostUrl('https://api.openai.com/v1'), false);
		assert.strictEqual(isLocalhostUrl('not a url!!!'), false);
	});
});
