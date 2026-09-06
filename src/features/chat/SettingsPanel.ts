import * as path from 'node:path';
import * as vscode from 'vscode';
import { getEffectiveHooksPath } from '../../core/config/layers';
import { getAdminPolicySnapshot, getSettings, hasApiKey, isAdminPolicyActive, setApiKey, setSessionModel, updateSettings } from '../../core/config/settings';
import { collectIndexEngineStatus } from '../index/engineStatus';
import { getIndexManagerInstance } from '../index/IndexManager';
import { getMcpManager } from '../../integrations/mcpClient';
import { HttpLlmClient } from '../../core/llm/client';
import { loadWebviewL10n } from '../../l10n/loadBundle';
import { revealLogsFolder } from '../../core/log/logger';
import { discoverPersonas } from '../project/personas';
import { BUILTIN_PRESETS, cloneBuiltinPreset, discoverCustomAgents } from '../project/customAgents';
import { discoverExternalHookFiles, getWorkspaceRootFsPath, mergeGenHooksLists, parseExternalHooksFile } from '../project/externalHooks';
import type { ExternalHookKind, GenHooksLists } from '../project/externalHooks';
import { listRulesCandidates } from '../project/projectRules';
import { discoverSkills } from '../project/skills';
import { discoverLocalPlugins } from '../project/plugins';
import { clearActivity, readActivity } from '../../core/stores/activityStore';
import { clearMcpOAuthTokens, getMcpOAuthDebugInfo, setMcpOAuthLastError, setMcpOAuthTokens } from '../../core/stores/mcpOAuthStore';
import { readUsage, resetUsage } from '../../core/stores/usageStore';
import { createNonce, renderChatHtml } from './chatHtml';
import type { AdminPolicyInfo, FromWebviewMessage, PersonaOption, ToWebviewMessage } from './protocol';
const VIEW_TYPE = 'gen.settings';

function emptyHookLists(): GenHooksLists {
	return {
		beforeSubmit: [],
		beforeShell: [],
		sessionDiff: [],
		sessionCompacting: [],
		shellEnv: [],
		fileWatcher: [],
	};
}
function isAbortError(err: unknown): boolean {
	return err instanceof Error && err.name === 'AbortError';
}

export class SettingsPanel {
	private static current?: SettingsPanel;
	private modelsAbort?: AbortController;
	private readonly client = new HttpLlmClient();
	private indexChangeSub?: vscode.Disposable;

	static show(context: vscode.ExtensionContext): void {
		if (SettingsPanel.current) {
			SettingsPanel.current.panel.reveal();
			return;
		}

		const assetsRoot = vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview');
		const codiconsRoot = vscode.Uri.joinPath(context.extensionUri, 'media', 'codicons');
		const panel = vscode.window.createWebviewPanel(VIEW_TYPE, vscode.l10n.t('settings.panelTitle'), vscode.ViewColumn.Active, {
			enableScripts: true,
			enableFindWidget: true,
			retainContextWhenHidden: true,
			localResourceRoots: [assetsRoot, codiconsRoot],
		});
		panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'logo.svg');
		SettingsPanel.current = new SettingsPanel(panel, assetsRoot, context.extensionUri, codiconsRoot);
	}

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		assetsRoot: vscode.Uri,
		extensionUri: vscode.Uri,
		codiconsRoot: vscode.Uri,
	) {
		const l10n = loadWebviewL10n(extensionUri);
		this.panel.webview.html = renderChatHtml({
			cspSource: this.panel.webview.cspSource,
			nonce: createNonce(),
			scriptUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.js')),
			styleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, 'index.css')),
			codiconsStyleUri: this.panel.webview.asWebviewUri(vscode.Uri.joinPath(codiconsRoot, 'codicon.css')),
			title: l10n.strings['settings.webviewTitle'],
			screen: 'settings',
			l10n,
		});

		const messageSub = this.panel.webview.onDidReceiveMessage((msg: FromWebviewMessage) => {
			void this.onMessage(msg);
		});

		// Живой статус индексации, пока открыты Settings
		this.indexChangeSub = getIndexManagerInstance()?.onDidChange(() => {
			void this.postIndexStatus();
		});

		this.panel.onDidDispose(() => {
			messageSub.dispose();
			this.indexChangeSub?.dispose();
			this.indexChangeSub = undefined;
			this.modelsAbort?.abort();
			if (SettingsPanel.current === this) {
				SettingsPanel.current = undefined;
			}
		});
	}

	private post(message: ToWebviewMessage): void {
		void this.panel.webview.postMessage(message);
	}

	private async listPersonaOptions(): Promise<PersonaOption[]> {
		try {
			const list = await discoverPersonas();
			return list.map((p) => ({
				id: p.id,
				name: p.name,
				description: p.description,
				path: p.path || undefined,
				source: p.source,
			}));
		} catch {
			return [];
		}
	}

	// Отправить актуальный список персон в webview (Reload на странице Personas)
	private async postPersonasData(): Promise<void> {
		this.post({
			type: 'personasData',
			personas: await this.listPersonaOptions(),
		});
	}

	private adminPolicyInfo(): AdminPolicyInfo {
		const snap = getAdminPolicySnapshot();
		return {
			active: isAdminPolicyActive(),
			path: snap.path,
			lockedKeys: [...snap.lockedKeys],
		};
	}

	private async postSettings(): Promise<void> {
		this.post({
			type: 'settings',
			settings: getSettings(),
			apiKeySet: await hasApiKey(),
			personas: await this.listPersonaOptions(),
			adminPolicy: this.adminPolicyInfo(),
		});
		await this.postIndexStatus();
	}

	// Статус движка индекса (CPU/remote/...) для секции Indexing
	private async postIndexStatus(): Promise<void> {
		this.post({
			type: 'indexStatus',
			status: await collectIndexEngineStatus(),
		});
	}

	private async onMessage(msg: FromWebviewMessage): Promise<void> {
		switch (msg.type) {
			case 'ready':
				await this.postSettings();
				return;
			case 'openExternal': {
				try {
					const uri = vscode.Uri.parse(msg.url);
					if (uri.scheme === 'http' || uri.scheme === 'https') {
						await vscode.env.openExternal(uri);
					}
				} catch {}
				return;
			}
			case 'loadModels':
				await this.handleLoadModels(msg.baseUrl, msg.requestId);
				return;
			case 'openLogsFolder':
				await revealLogsFolder();
				return;
			case 'loadUsage':
				this.post({
					type: 'usageLedger',
					ledger: readUsage(),
				});
				return;
			case 'resetUsage':
				resetUsage();
				this.post({
					type: 'usageLedger',
					ledger: readUsage(),
				});
				return;
			case 'loadActivity':
				this.post({
					type: 'activityLedger',
					entries: readActivity(),
				});
				return;
			case 'clearActivity':
				clearActivity();
				this.post({
					type: 'activityLedger',
					entries: readActivity(),
				});
				return;
			case 'refreshMcp':
				await this.postMcpStatus();
				return;
			case 'mcpOAuthAuth':
				await this.handleMcpOAuthAuth(msg.serverName);
				return;
			case 'mcpOAuthLogout':
				await this.handleMcpOAuthLogout(msg.serverName);
				return;
			case 'mcpOAuthDebug':
				await this.handleMcpOAuthDebug(msg.serverName);
				return;
			case 'loadIndexStatus':
				await this.postIndexStatus();
				return;
			case 'loadHooks':
				await this.postHooksData();
				return;
			case 'saveHooks':
				await this.handleSaveHooks(
					msg.beforeSubmit,
					msg.beforeShell,
					msg.sessionDiff,
					msg.sessionCompacting,
					msg.shellEnv,
					msg.fileWatcher,
				);
				return;
			case 'openHooksFile':
				await this.handleOpenHooksFile();
				return;
			case 'loadExternalHooks':
				await this.postExternalHooksData();
				return;
			case 'openExternalHookFile':
				await this.handleOpenExternalHookFile(msg.path);
				return;
			case 'importExternalHooks':
				await this.handleImportExternalHooks(msg.path, msg.mode, msg.kind);
				return;
			case 'loadAgents':
				await this.postAgentsData();
				return;
			case 'cloneAgentPreset':
				await this.handleCloneAgentPreset(msg.id);
				return;
			case 'loadRulesSkills':
				await this.postRulesSkillsData();
				return;
			case 'loadPersonas':
				await this.postPersonasData();
				return;
			case 'openProjectPath':
				await this.handleOpenProjectPath(msg.path);
				return;
			case 'saveSettings':
				try {
					if (typeof msg.apiKey === 'string' && msg.apiKey.trim()) {
						await setApiKey(msg.apiKey);
					}

					const saved = await updateSettings(msg.settings);
					this.post({
						type: 'settingsSaved',
						settings: saved,
						apiKeySet: await hasApiKey(),
						personas: await this.listPersonaOptions(),
						adminPolicy: this.adminPolicyInfo(),
					});
					// После сохранения - обновить MCP и статус индекса в фоне
					void this.postMcpStatus();
					void this.postIndexStatus();
				} catch (err) {
					this.post({
						type: 'settingsError',
						message: err instanceof Error ? err.message : String(err),
					});
				}
				return;
		}
	}

	// Переподключить MCP и отправить статус в webview
	private async postMcpStatus(): Promise<void> {
		const mcp = getMcpManager();
		await mcp.refresh();
		this.post({
			type: 'mcpStatus',
			servers: await mcp.status(),
		});
	}

	private hooksFileUri(): vscode.Uri | undefined {
		const folder = vscode.workspace.workspaceFolders?.[0];
		if (!folder) {
			return undefined;
		}

		const configured = getEffectiveHooksPath();
		if (configured) {
			if (path.isAbsolute(configured)) {
				return vscode.Uri.file(configured);
			}
			
			return vscode.Uri.joinPath(folder.uri, configured);
		}

		return vscode.Uri.joinPath(folder.uri, '.gen', 'hooks.json');
	}

	// Разобрать список команд из hooks.json (строки или { command })
	private asHookCommands(raw: unknown): string[] {
		if (!Array.isArray(raw)) {
			return [];
		}

		const out: string[] = [];
		for (const item of raw) {
			if (typeof item === 'string' && item.trim()) {
				out.push(item.trim());
				continue;
			}

			if (item && typeof item === 'object' && typeof (item as { command?: unknown }).command === 'string') {
				const command = String((item as { command: string }).command).trim();
				if (command) {
					out.push(command);
				}
			}
		}

		return out;
	}

	// Первый непустой список из альтернативных ключей JSON
	private pickHookCommands(hooks: Record<string, unknown>, ...keys: string[]): string[] {
		for (const key of keys) {
			if (key in hooks) {
				return this.asHookCommands(hooks[key]);
			}
		}
		return [];
	}

	private async postHooksData(): Promise<void> {
		const uri = this.hooksFileUri();
		if (!uri) {
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		const path = uri.fsPath;
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const raw = JSON.parse(new TextDecoder().decode(bytes)) as {
				hooks?: Record<string, unknown>;
				beforeSubmit?: unknown;
				beforeShell?: unknown;
			};
			const hooks = (raw.hooks ?? raw) as Record<string, unknown>;
			this.post({
				type: 'hooksData',
				beforeSubmit: this.asHookCommands(hooks.beforeSubmit),
				beforeShell: this.asHookCommands(hooks.beforeShell),
				sessionDiff: this.pickHookCommands(hooks, 'sessionDiff', 'session.diff'),
				sessionCompacting: this.pickHookCommands(
					hooks,
					'sessionCompacting',
					'session.compacting',
				),
				shellEnv: this.pickHookCommands(hooks, 'shellEnv', 'shell.env'),
				fileWatcher: this.pickHookCommands(hooks, 'fileWatcher', 'file.watcher'),
				path,
			});
		} catch (err) {
			const code = (err as { code?: string | number }).code;
			const name = (err as { name?: string }).name;
			// Файл отсутствует - пустые хуки, не ошибка
			if (code === 'FileNotFound' || code === 'ENOENT' || name === 'EntryNotFound') {
				this.post({
					type: 'hooksData',
					beforeSubmit: [],
					beforeShell: [],
					sessionDiff: [],
					sessionCompacting: [],
					shellEnv: [],
					fileWatcher: [],
					path,
				});
				return;
			}
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				path,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async handleSaveHooks(
		beforeSubmit: string[],
		beforeShell: string[],
		sessionDiff: string[],
		sessionCompacting: string[],
		shellEnv: string[],
		fileWatcher: string[],
	): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const uri = this.hooksFileUri();
		if (!folder || !uri) {
			this.post({
				type: 'hooksSaved',
				ok: false,
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		try {
			const genDir = vscode.Uri.joinPath(folder.uri, '.gen');
			try {
				await vscode.workspace.fs.createDirectory(genDir);
			} catch {}

			const toCommands = (list: string[]) => list.map((c) => c.trim())
				.filter(Boolean)
				.map((command) => ({ command }));

			const payload = {
				beforeSubmit: toCommands(beforeSubmit),
				beforeShell: toCommands(beforeShell),
				sessionDiff: toCommands(sessionDiff),
				sessionCompacting: toCommands(sessionCompacting),
				'shell.env': toCommands(shellEnv),
				'file.watcher': toCommands(fileWatcher),
			};
			const text = `${JSON.stringify(payload, null, 2)}\n`;
			await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
			this.post({ type: 'hooksSaved', ok: true });
			await this.postHooksData();
		} catch (err) {
			this.post({
				type: 'hooksSaved',
				ok: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async handleOpenHooksFile(): Promise<void> {
		const folder = vscode.workspace.workspaceFolders?.[0];
		const uri = this.hooksFileUri();
		if (!folder || !uri) {
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				error: vscode.l10n.t('policy.noWorkspace'),
			});
			return;
		}

		try {
			const genDir = vscode.Uri.joinPath(folder.uri, '.gen');
			try {
				await vscode.workspace.fs.createDirectory(genDir);
			} catch {}

			try {
				await vscode.workspace.fs.stat(uri);
			} catch {
				const empty = `${JSON.stringify({
					beforeSubmit: [],
					beforeShell: [],
					sessionDiff: [],
					sessionCompacting: [],
					'shell.env': [],
					'file.watcher': [],
				}, null, 2)}\n`;
				await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(empty));
			}

			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: false });
		} catch (err) {
			this.post({
				type: 'hooksData',
				beforeSubmit: [],
				beforeShell: [],
				sessionDiff: [],
				sessionCompacting: [],
				shellEnv: [],
				fileWatcher: [],
				path: uri.fsPath,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Discover внешних hook-файлов (без автозапуска)
	private async postExternalHooksData(): Promise<void> {
		try {
			const files = await discoverExternalHookFiles(getWorkspaceRootFsPath());
			this.post({
				type: 'externalHooksData',
				files: files.map((f) => ({
					kind: f.kind,
					path: f.path,
					mappedCommandCount: f.mappedCommandCount,
					skippedEvents: f.skippedEvents,
					error: f.error,
				})),
			});
		} catch {
			this.post({ 
				type: 'externalHooksData', 
				files: [] 
			});
		}
	}

	private async handleOpenExternalHookFile(rawPath: string): Promise<void> {
		const filePath = String(rawPath ?? '').trim();
		if (!filePath) {
			return;
		}
		
		try {
			const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
			await vscode.window.showTextDocument(doc, { preview: false });
		} catch (err) {
			this.post({
				type: 'externalHooksImported',
				ok: false,
				mode: 'merge',
				mappedCommandCount: 0,
				skippedEvents: [],
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Импорт внешних хуков в `.gen/hooks.json` (merge | replace).
	 * Не запускает внешние команды - только копирует в Gen-формат.
	 */
	private async handleImportExternalHooks(
		rawPath: string,
		mode: 'merge' | 'replace',
		kind: ExternalHookKind,
	): Promise<void> {
		const filePath = String(rawPath ?? '').trim();
		const uri = this.hooksFileUri();
		if (!filePath || !uri) {
			this.post({
				type: 'externalHooksImported',
				ok: false,
				mode,
				mappedCommandCount: 0,
				skippedEvents: [],
				error: !uri ? vscode.l10n.t('policy.noWorkspace') : 'Missing path',
			});
			return;
		}

		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
			const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
			const parsed = parseExternalHooksFile(kind, raw);

			let next: GenHooksLists = {
				...emptyHookLists(),
				...parsed.mapped,
			};
			if (mode === 'merge') {
				let base = emptyHookLists();
				try {
					const existing = await vscode.workspace.fs.readFile(uri);
					const existingRaw = JSON.parse(new TextDecoder().decode(existing)) as {
						hooks?: Record<string, unknown>;
					};
					const hooks = (existingRaw.hooks ?? existingRaw) as Record<string, unknown>;
					base = {
						beforeSubmit: this.asHookCommands(hooks.beforeSubmit),
						beforeShell: this.asHookCommands(hooks.beforeShell),
						sessionDiff: this.pickHookCommands(hooks, 'sessionDiff', 'session.diff'),
						sessionCompacting: this.pickHookCommands(
							hooks,
							'sessionCompacting',
							'session.compacting',
						),
						shellEnv: this.pickHookCommands(hooks, 'shellEnv', 'shell.env'),
						fileWatcher: this.pickHookCommands(hooks, 'fileWatcher', 'file.watcher'),
					};
				} catch (err) {
					const code = (err as { code?: string | number }).code;
					const name = (err as { name?: string }).name;
					if (!(code === 'FileNotFound' || code === 'ENOENT' || name === 'EntryNotFound')) {
						throw err;
					}
				}
				next = mergeGenHooksLists(base, parsed.mapped);
			}

			await this.handleSaveHooks(
				next.beforeSubmit,
				next.beforeShell,
				next.sessionDiff,
				next.sessionCompacting,
				next.shellEnv,
				next.fileWatcher,
			);
			this.post({
				type: 'externalHooksImported',
				ok: true,
				mode,
				mappedCommandCount: parsed.mappedCommandCount,
				skippedEvents: parsed.skippedEvents,
			});
			await this.postExternalHooksData();
		} catch (err) {
			this.post({
				type: 'externalHooksImported',
				ok: false,
				mode,
				mappedCommandCount: 0,
				skippedEvents: [],
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Кандидаты rules + discovered skills/plugins для read-only UI
	private async postRulesSkillsData(): Promise<void> {
		try {
			const [rules, skillsRaw, pluginsRaw] = await Promise.all([
				listRulesCandidates(),
				discoverSkills(),
				discoverLocalPlugins(),
			]);
			this.post({
				type: 'rulesSkillsData',
				rules,
				skills: skillsRaw.map((s) => ({
					name: s.name,
					description: s.description,
					path: s.path,
				})),
				plugins: pluginsRaw.map((p) => ({
					kind: p.kind,
					name: p.name,
					description: p.description,
					path: p.path,
				})),
			});
		} catch {
			this.post({
				type: 'rulesSkillsData',
				rules: [],
				skills: [],
				plugins: [],
			});
		}
	}

	// Открыть файл в редакторе (workspace-relative или абсолютный) / http(s) во внешнем браузере
	private async handleOpenProjectPath(rawPath: string): Promise<void> {
		const input = String(rawPath ?? '').trim();
		if (!input) {
			return;
		}

		if (/^https?:\/\//i.test(input)) {
			try {
				await vscode.env.openExternal(vscode.Uri.parse(input));
			} catch {}
			return;
		}

		try {
			const isAbsolute = input.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(input);
			let uri: vscode.Uri;
			if (isAbsolute) {
				uri = vscode.Uri.file(input);
			} else {
				const folder = vscode.workspace.workspaceFolders?.[0];
				if (!folder) {
					return;
				}
				uri = vscode.Uri.joinPath(folder.uri, ...input.split(/[/\\]+/).filter(Boolean));
			}

			const doc = await vscode.workspace.openTextDocument(uri);
			await vscode.window.showTextDocument(doc, { preview: true });
		} catch {}
	}

	// Отправить список builtin presets и кастомных агентов из `.gen/agents/`
	private async postAgentsData(): Promise<void> {
		try {
			const custom = await discoverCustomAgents();
			this.post({
				type: 'agentsData',
				presets: BUILTIN_PRESETS.map((p) => ({
					id: p.id,
					name: p.name,
					description: p.description,
					readonly: p.readonly,
					mode: p.mode,
				})),
				custom: custom.map((a) => ({
					id: a.id,
					name: a.name,
					description: a.description,
					readonly: a.readonly,
				})),
			});
		} catch (err) {
			this.post({
				type: 'agentsData',
				presets: BUILTIN_PRESETS.map((p) => ({
					id: p.id,
					name: p.name,
					description: p.description,
					readonly: p.readonly,
					mode: p.mode,
				})),
				custom: [],
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	// Клонировать builtin preset в `.gen/agents/` и открыть файл
	private async handleCloneAgentPreset(id: string): Promise<void> {
		try {
			const { relativePath, created } = await cloneBuiltinPreset(id);
			this.post({
				type: 'agentsCloned',
				relativePath,
				created,
			});
			const folder = vscode.workspace.workspaceFolders?.[0];
			if (folder) {
				const uri = vscode.Uri.joinPath(folder.uri, relativePath);
				const doc = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(doc, { preview: false });
			}
			await this.postAgentsData();
		} catch (err) {
			this.post({
				type: 'agentsCloned',
				relativePath: '',
				created: false,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	private async handleLoadModels(baseUrl: string, requestId: number): Promise<void> {
		this.modelsAbort?.abort();
		const controller = new AbortController();
		this.modelsAbort = controller;

		try {
			const models = await this.client.listModelOptions({
				baseUrl,
				signal: controller.signal,
			});
			if (controller.signal.aborted) {
				return;
			}

			if (models.length > 0) {
				const current = getSettings().model;
				if (!current || !models.some((item) => item.id === current)) {
					setSessionModel(models[0].id);
				}
			}

			this.post({
				type: 'models',
				models,
				requestId,
			});
		} catch (err) {
			if (isAbortError(err) || controller.signal.aborted) {
				return;
			}
			
			this.post({
				type: 'modelsError',
				message: err instanceof Error ? err.message : String(err),
				requestId,
			});
		} finally {
			if (this.modelsAbort === controller) {
				this.modelsAbort = undefined;
			}
		}
	}

	// Auth MVP: опционально openExternal authorize URL, затем paste access token в SecretStorage
	private async handleMcpOAuthAuth(serverName: string): Promise<void> {
		const name = serverName.trim();
		if (!name) {
			void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.invalidServer'));
			return;
		}

		const cfg = getSettings().mcpServers.find((s) => s.name === name);
		if (!cfg || cfg.oauth !== true) {
			void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.notEnabled', name));
			return;
		}

		const authUrl = (cfg.mcpOAuthAuthorizeUrl ?? '').trim();
		if (authUrl) {
			try {
				const uri = vscode.Uri.parse(authUrl);
				if (uri.scheme !== 'http' && uri.scheme !== 'https') {
					void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.invalidAuthorizeUrl'));
					return;
				}
				await vscode.env.openExternal(uri);
				void vscode.window.showInformationMessage(vscode.l10n.t('mcp.oauth.browserOpenedWip'));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setMcpOAuthLastError(name, message);
				void vscode.window.showErrorMessage(message);
				await this.postMcpStatus();
				return;
			}
		}

		const token = await vscode.window.showInputBox({
			title: vscode.l10n.t('mcp.oauth.pasteTitle', name),
			prompt: vscode.l10n.t('mcp.oauth.pastePrompt'),
			placeHolder: vscode.l10n.t('mcp.oauth.pastePlaceholder'),
			password: true,
			ignoreFocusOut: true,
		});
		if (token === undefined) {
			return;
		}

		const accessToken = token.trim();
		if (!accessToken) {
			void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.emptyToken'));
			return;
		}

		try {
			await setMcpOAuthTokens(name, { accessToken });
			setMcpOAuthLastError(name, undefined);
			void vscode.window.showInformationMessage(vscode.l10n.t('mcp.oauth.tokenSaved', name));
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			setMcpOAuthLastError(name, message);
			void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.saveFailed', message));
		}
		await this.postMcpStatus();
	}

	private async handleMcpOAuthLogout(serverName: string): Promise<void> {
		const name = serverName.trim();
		if (!name) {
			void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.invalidServer'));
			return;
		}

		await clearMcpOAuthTokens(name);
		setMcpOAuthLastError(name, undefined);
		void vscode.window.showInformationMessage(vscode.l10n.t('mcp.oauth.loggedOut', name));
		await this.postMcpStatus();
	}

	private async handleMcpOAuthDebug(serverName: string): Promise<void> {
		const name = serverName.trim();
		if (!name) {
			void vscode.window.showErrorMessage(vscode.l10n.t('mcp.oauth.invalidServer'));
			return;
		}
		
		const info = await getMcpOAuthDebugInfo(name);
		const tokenLine = info.hasToken
			? vscode.l10n.t('mcp.oauth.debug.token', info.maskedPreview ?? '****')
			: vscode.l10n.t('mcp.oauth.debug.token', vscode.l10n.t('mcp.oauth.debug.none'));
		const expires =
			typeof info.expiresAt === 'number' && Number.isFinite(info.expiresAt)
				? new Date(info.expiresAt).toLocaleString()
				: vscode.l10n.t('mcp.oauth.debug.noExpiry');
		const lines = [
			vscode.l10n.t('mcp.oauth.debug.server', info.serverName || name),
			tokenLine,
			vscode.l10n.t('mcp.oauth.debug.expires', expires),
			vscode.l10n.t(
				'mcp.oauth.debug.lastError',
				info.lastError?.trim() || vscode.l10n.t('mcp.oauth.debug.none'),
			),
		];
		void vscode.window.showInformationMessage(lines.join('\n'), { modal: true });
	}
}
