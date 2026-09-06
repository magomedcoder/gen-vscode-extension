import * as vscode from 'vscode';
import { getSettings } from '../config/settings';
import type { GenSettings } from '../config/types';
import { getIndexManagerInstance } from './IndexManager';
import { loadManifest } from './store';
import type { IndexProgress } from './types';

/**
 * Режим движка индекса / семантического поиска.
 * GPU не фейкаем: onnx-gpu только когда реально будет ONNX runtime.
 */
export type IndexEngineMode = 'cpu-trigram' | 'remote' | 'onnx-gpu';

export interface IndexEngineStatus {
	mode: IndexEngineMode;
	// Есть ли GPU-ускорение индексации (сегодня всегда false)
	gpu: boolean;
	// indexingEnabled из настроек
	indexingEnabled: boolean;
	progressState?: IndexProgress['state'];
	fileCount?: number;
	chunkCount?: number;
	// ISO из manifest.updatedAt, если индекс уже строился
	updatedAt?: string;
	lastError?: string;
}

// Локальный ONNX / GPU runtime пока не подключён - честно false
export function isOnnxGpuAvailable(): boolean {
	return false;
}

/**
 * Определить режим по настройкам (без фейкового GPU).
 * Приоритет: onnx-gpu * remote (embeddingsBaseUrl) * CPU trigram.
 */
export function resolveIndexEngineMode(
	settings: Pick<GenSettings, 'embeddingsBaseUrl'>,
): IndexEngineMode {
	if (isOnnxGpuAvailable()) {
		return 'onnx-gpu';
	}

	if (String(settings.embeddingsBaseUrl ?? '').trim()) {
		return 'remote';
	}

	return 'cpu-trigram';
}

// Собрать статус для Settings webview (engine + прогресс / manifest)
export async function collectIndexEngineStatus(): Promise<IndexEngineStatus> {
	const settings = getSettings();
	const mode = resolveIndexEngineMode(settings);
	const progress = getIndexManagerInstance()?.getProgress();

	let fileCount = progress?.fileCount;
	let chunkCount = progress?.chunkCount;
	let updatedAt = progress?.updatedAt;
	let lastError = progress?.lastError;
	let progressState = progress?.state;

	const folderFs = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	// Подтянуть счётчики из manifest, если в памяти ещё idle / пусто
	if (folderFs && (!updatedAt || !fileCount)) {
		try {
			const manifest = await loadManifest(folderFs);
			const epoch = new Date(manifest.updatedAt).getTime();
			if (Number.isFinite(epoch) && epoch > 0) {
				fileCount = fileCount || Object.keys(manifest.files).length;
				chunkCount = chunkCount || Object.keys(manifest.chunks).length;
				updatedAt = updatedAt || manifest.updatedAt;
				if (!progressState || progressState === 'idle') {
					progressState = 'ready';
				}
			}
		} catch {}
	}

	return {
		mode,
		gpu: mode === 'onnx-gpu',
		indexingEnabled: settings.indexingEnabled !== false,
		progressState,
		fileCount,
		chunkCount,
		updatedAt,
		lastError,
	};
}
