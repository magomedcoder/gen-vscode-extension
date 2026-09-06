export function isGptFamilyModel(modelId: string): boolean {
	const id = modelId.trim().toLowerCase();
	if (!id) {
		return false;
	}

	if (id.includes('gpt')) {
		return true;
	}

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
