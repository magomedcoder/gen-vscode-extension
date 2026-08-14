import type { FromWebviewMessage } from '../chat/protocol';

interface VsCodeApi {
	postMessage(message: FromWebviewMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscodeApi = acquireVsCodeApi();
