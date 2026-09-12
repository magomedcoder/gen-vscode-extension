import * as assert from 'assert';
import { truncateMcpToolResult } from '../integrations/mcpClient.js';
import { DEFAULT_SETTINGS } from '../core/config/types.js';

suite('mcp tool result truncate', () => {
	test('короткий текст не режется', () => {
		assert.strictEqual(truncateMcpToolResult('hello', 100), 'hello');
	});

	test('длинный текст получает marker', () => {
		const raw = 'x'.repeat(2_000);
		const out = truncateMcpToolResult(raw, 500);
		assert.ok(out.length <= 520);
		assert.ok(out.includes('[truncated MCP result'));
		assert.ok(out.includes('2000'));
	});

	test('DEFAULT_SETTINGS.mcpToolResultMaxChars === 50000', () => {
		assert.strictEqual(DEFAULT_SETTINGS.mcpToolResultMaxChars, 50_000);
	});
});
