import * as assert from 'node:assert';
import { resolveIndexEngineMode, isOnnxGpuAvailable } from '../index/engineStatus.js';

suite('index engine status', () => {
	test('без embeddingsBaseUrl - CPU trigram', () => {
		assert.strictEqual(resolveIndexEngineMode({ embeddingsBaseUrl: '' }), 'cpu-trigram');
		assert.strictEqual(resolveIndexEngineMode({ embeddingsBaseUrl: '  ' }), 'cpu-trigram');
	});

	test('с embeddingsBaseUrl - remote', () => {
		assert.strictEqual(
			resolveIndexEngineMode({ embeddingsBaseUrl: 'https://api.example/v1' }),
			'remote',
		);
	});

	test('ONNX GPU пока недоступен', () => {
		assert.strictEqual(isOnnxGpuAvailable(), false);
	});
});
