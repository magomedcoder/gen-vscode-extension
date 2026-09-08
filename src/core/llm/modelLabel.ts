import * as path from 'node:path';

export interface LlmModelOption {
	id: string;
	label: string;
}

const MODEL_FILE_EXT = /\.(gguf|bin|model|mlmodel|pt|pth|safetensors)$/i;

export function modelBasename(id: string): string {
	const base = path.basename(id.replace(/\\/g, path.sep));
	return base.replace(MODEL_FILE_EXT, '');
}

export function modelLabelFromApi(id: string, name?: string): string {
	const trimmedName = name?.trim();
	if (trimmedName && !trimmedName.includes('/') && !trimmedName.includes('\\')) {
		return modelBasename(trimmedName);
	}

	return modelBasename(id);
}

export function finalizeModelLabels(options: LlmModelOption[]): LlmModelOption[] {
	const counts = new Map<string, number>();
	for (const item of options) {
		counts.set(item.label, (counts.get(item.label) ?? 0) + 1);
	}

	return options.map((item) => {
		if ((counts.get(item.label) ?? 0) <= 1) {
			return item;
		}

		const parts = item.id.replace(/\\/g, '/').split('/').filter(Boolean);
		const hint = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
		return {
			id: item.id,
			label: `${item.label} (${hint})`,
		};
	});
}

export function parseModelsListResponse(data: {
	data?: Array<{
		id?: string;
		name?: string
	}>;
	models?: Array<string | {
		id?: string;
		name?: string
	}>;
}): LlmModelOption[] {
	const byId = new Map<string, LlmModelOption>();

	const add = (id: string, name?: string) => {
		const trimmed = id.trim();
		if (!trimmed || byId.has(trimmed)) {
			return;
		}

		byId.set(trimmed, {
			id: trimmed,
			label: modelLabelFromApi(trimmed, name),
		});
	};

	for (const item of data.data ?? []) {
		if (item.id?.trim()) {
			add(item.id, item.name);
		}
	}

	for (const item of data.models ?? []) {
		if (typeof item === 'string') {
			add(item);
			continue;
		}

		if (item && typeof item === 'object') {
			const id = item.id?.trim() || item.name?.trim();
			if (id) {
				add(id, item.name);
			}
		}
	}

	return finalizeModelLabels([...byId.values()].sort((a, b) => a.label.localeCompare(b.label)));
}
