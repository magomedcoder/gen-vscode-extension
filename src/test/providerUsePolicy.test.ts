import * as assert from 'assert';
import { extractProviderHost, matchesProviderUsePattern, providerUseRefusalMessage } from '../llm/providerUsePolicy.js';
import { DEFAULT_SETTINGS } from '../config/types.js';

suite('providerUsePolicy', () => {
	test('extractProviderHost: URL и host без схемы', () => {
		assert.strictEqual(extractProviderHost('https://api.openai.com/v1'), 'api.openai.com');
		assert.strictEqual(extractProviderHost('http://127.0.0.1:8080'), '127.0.0.1');
		assert.strictEqual(extractProviderHost('localhost:8080'), 'localhost');
	});

	test('matchesProviderUsePattern: host или model', () => {
		assert.ok(matchesProviderUsePattern('api.openai.com', 'api.openai.com', 'gpt-4o'));
		assert.ok(matchesProviderUsePattern('gpt-*', 'localhost', 'gpt-4o'));
		assert.ok(!matchesProviderUsePattern('claude-*', 'localhost', 'gpt-4o'));
	});

	test('deny: отказ при match', () => {
		const msg = providerUseRefusalMessage(
			{
				...DEFAULT_SETTINGS,
				baseUrl: 'https://api.openai.com/v1',
				providerUsePolicy: 'deny',
				providerUsePatterns: ['api.openai.com'],
			},
			'gpt-4o',
		);
		assert.ok(msg);
	});

	test('deny: пустые паттерны - разрешено', () => {
		const msg = providerUseRefusalMessage(
			{
				...DEFAULT_SETTINGS,
				baseUrl: 'https://api.openai.com/v1',
				providerUsePolicy: 'deny',
				providerUsePatterns: [],
			},
			'gpt-4o',
		);
		assert.strictEqual(msg, undefined);
	});

	test('allow: отказ без match', () => {
		const msg = providerUseRefusalMessage(
			{
				...DEFAULT_SETTINGS,
				baseUrl: 'http://localhost:8080',
				providerUsePolicy: 'allow',
				providerUsePatterns: ['api.openai.com', 'gpt-*'],
			},
			'llama3',
		);
		assert.ok(msg);
	});

	test('allow: match model - разрешено', () => {
		const msg = providerUseRefusalMessage(
			{
				...DEFAULT_SETTINGS,
				baseUrl: 'http://localhost:8080',
				providerUsePolicy: 'allow',
				providerUsePatterns: ['local*', 'llama*'],
			},
			'llama3',
		);
		assert.strictEqual(msg, undefined);
	});
});
