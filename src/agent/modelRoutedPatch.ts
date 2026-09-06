/**
 * Model-routed patch (паритет OpenCode): GPT-семейство * в tool list есть `apply_patch`;
 * остальные модели * `apply_patch` скрыт, остаются write_file / apply_workspace_edit.
 */

// GPT / OpenAI reasoning ids: gpt-*, o1*, o3*, o4*, chatgpt*, или id содержит "gpt"
export function isGptFamilyModel(modelId: string): boolean {
	const id = modelId.trim().toLowerCase();
	if (!id) {
		return false;
	}

	// chatgpt*, gpt-4o, openai/gpt-... и т.п.
	if (id.includes('gpt')) {
		return true;
	}

	// o1* / o3* / o4* (в т.ч. openai/o1-mini)
	const segments = id.split(/[/_\-.]/);
	if (segments.some((part) => /^o[134]/.test(part))) {
		return true;
	}

	return false;
}

/**
 * Включать ли `apply_patch` в список tools для LLM.
 * `modelRoutedPatch === false` - routing выкл., tool всегда доступен
 */
export function includeApplyPatchForModel(modelId: string, modelRoutedPatch: boolean): boolean {
	if (!modelRoutedPatch) {
		return true;
	}

	return isGptFamilyModel(modelId);
}
