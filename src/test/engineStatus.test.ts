import * as assert from 'node:assert';
import { resolveIndexEngineMode } from '../features/index/engineStatus.js';

const baseSettings = {
	embeddingsBaseUrl: '',
	localEmbeddingsMode: 'off' as const,
};

suite('index engine status', () => {
	test('без embeddingsBaseUrl - CPU trigram', () => {
		assert.strictEqual(resolveIndexEngineMode(baseSettings), 'cpu-trigram');
		assert.strictEqual(resolveIndexEngineMode({ 
			...baseSettings, 
			embeddingsBaseUrl: '  ' 
		}), 'cpu-trigram');
	});

	test('с embeddingsBaseUrl - remote', () => {
		assert.strictEqual(
			resolveIndexEngineMode({ 
				...baseSettings, 
				embeddingsBaseUrl: 'https://api.example/v1' 
			}),
			'remote',
		);
	});
});
