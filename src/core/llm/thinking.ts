const THINKING_STRING_KEYS = ['reasoning_content', 'reasoning', 'thinking', 'reasoning_text'] as const;

function pieceFromObject(obj: Record<string, unknown>): string {
	for (const key of THINKING_STRING_KEYS) {
		const value = obj[key];
		if (typeof value === 'string' && value) {
			return value;
		}
	}

	const nested = obj.reasoning;
	if (nested && typeof nested === 'object') {
		const r = nested as Record<string, unknown>;
		if (typeof r.content === 'string' && r.content) {
			return r.content;
		}

		if (typeof r.text === 'string' && r.text) {
			return r.text;
		}
	}

	return '';
}

// Текстовые части из multimodal / Anthropic-like content[]
function splitContentParts(content: unknown): { text: string; thinking: string } {
	if (typeof content === 'string') {
		return { 
			text: content, 
			thinking: '' 
		};
	}

	if (!Array.isArray(content)) {
		return { 
			text: '', 
			thinking: '' 
		};
	}

	let text = '';
	let thinking = '';
	for (const part of content) {
		if (!part || typeof part !== 'object') {
			continue;
		}

		const p = part as Record<string, unknown>;
		const type = String(p.type ?? '');
		if (type === 'thinking' || type === 'reasoning') {
			const chunk = (typeof p.thinking === 'string' && p.thinking) || (typeof p.text === 'string' && p.text) || (typeof p.reasoning === 'string' && p.reasoning)	|| '';
			if (chunk) {
				thinking += chunk;
			}

			continue;
		}

		if (type === 'text' || type === 'output_text') {
			if (typeof p.text === 'string' && p.text) {
				text += p.text;
			}

			continue;
		}

		// Без type - как обычный текст, если есть text
		if (!type && typeof p.text === 'string' && p.text) {
			text += p.text;
		}
	}

	return { text, thinking };
}

// Кусок thinking из delta/message объекта стрима или non-stream message
export function extractThinkingDelta(delta: unknown): string {
	if (!delta || typeof delta !== 'object') {
		return '';
	}

	const obj = delta as Record<string, unknown>;
	const direct = pieceFromObject(obj);
	if (direct) {
		return direct;
	}

	const fromParts = splitContentParts(obj.content);
	return fromParts.thinking;
}

// Разбор message.content + отдельных reasoning-полей для non-stream ответа
export function splitAssistantPayload(message: unknown, fallbackText?: unknown): {
	content: string;
	thinking: string;
} {
	if (!message || typeof message !== 'object') {
		const text = typeof fallbackText === 'string' ? fallbackText : '';
		return { 
			content: text, 
			thinking: '' 
		};
	}

	const msg = message as Record<string, unknown>;
	const fromFields = pieceFromObject(msg);
	const parts = splitContentParts(msg.content);
	const content = parts.text || (typeof msg.content === 'string' ? msg.content : '') || (typeof fallbackText === 'string' ? fallbackText : '');
	const thinking = fromFields || parts.thinking;
	return { content, thinking };
}
