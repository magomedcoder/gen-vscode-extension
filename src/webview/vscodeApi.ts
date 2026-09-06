import type { FromWebviewMessage } from '../features/chat/protocol';

interface VsCodeApi {
	postMessage(message: FromWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscodeApi = acquireVsCodeApi();
