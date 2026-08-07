import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('Расширение должно активироваться', async () => {
		const extension = vscode.extensions.getExtension('gen');
		assert.ok(extension, 'Расширение gen не найдено');

		if (!extension.isActive) {
			await extension.activate();
		}
		
		assert.strictEqual(extension.isActive, true, 'Расширение должно быть активно');
	});
});
