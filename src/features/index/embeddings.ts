import * as vscode from 'vscode';
import { getSettings } from '../../core/config/settings';
import { getApiKey, buildAuthHeaders } from '../../core/config/apiKey';

export interface EmbeddingHit {
	path: string;
	score: number;
	snippet?: string;
}

// Remote OpenAI-compatible POST /embeddings
export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][]> {
	const settings = getSettings();
	const base = (settings.embeddingsBaseUrl || settings.baseUrl).replace(/\/$/, '');
	const model = settings.embeddingsModel || 'text-embedding-3-small';
	if (!base) {
		throw new Error('embeddings: не задан baseUrl / embeddingsBaseUrl');
	}

	const apiKey = await getApiKey();
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
		...buildAuthHeaders(apiKey, settings.authHeader, settings.authScheme),
	};
	const res = await fetch(`${base}/embeddings`, {
		method: 'POST',
		headers,
		body: JSON.stringify({ 
			model,
			input: texts
		}),
		signal,
	});
	if (!res.ok) {
		throw new Error(`embeddings HTTP ${res.status}`);
	}

	const json = await res.json() as {
		data?: Array<{ 
			embedding?: number[] 
		}>;
		error?: { 
			message?: string 
		};
	};
	if (json.error?.message) {
		throw new Error(json.error.message);
	}

	const vectors = (json.data ?? []).map((d) => d.embedding ?? []);
	if (vectors.length !== texts.length) {
		throw new Error('embeddings: неожиданная длина ответа');
	}

	return vectors;
}

function cosine(a: number[], b: number[]): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i += 1) {
		dot += a[i]! * b[i]!;
		na += a[i]! * a[i]!;
		nb += b[i]! * b[i]!;
	}

	if (na === 0 || nb === 0) {
		return 0;
	}

	return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// MVP semantic search: эмбеддинг запроса + сравнение с эмбеддингами коротких сниппетов из findFiles (без локального ONNX индекса)
export async function semanticSearchWorkspace(
	query: string,
	opts?: { maxFiles?: number; maxResults?: number; signal?: AbortSignal },
): Promise<EmbeddingHit[]> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		return [];
	}

	const maxFiles = opts?.maxFiles ?? 40;
	const maxResults = opts?.maxResults ?? 8;
	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*.{ts,tsx,js,jsx,py,go,rs,md}'),
		'**/{node_modules,.git,.gen,dist,out}/**',
		maxFiles,
	);

	const snippets: Array<{ path: string; text: string }> = [];
	for (const uri of uris) {
		opts?.signal?.throwIfAborted();
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			const text = new TextDecoder().decode(bytes).slice(0, 1200);
			if (text.trim()) {
				snippets.push({
					path: vscode.workspace.asRelativePath(uri),
					text,
				});
			}
		} catch {
			continue;
		}
	}

	if (snippets.length === 0) {
		return [];
	}

	const [qVec, ...docVecs] = await embedTexts([query, ...snippets.map((s) => s.text)], opts?.signal);
	const scored = snippets.map((s, i) => ({
		path: s.path,
		score: cosine(qVec!, docVecs[i] ?? []),
		snippet: s.text.slice(0, 240),
	}));
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, maxResults);
}
