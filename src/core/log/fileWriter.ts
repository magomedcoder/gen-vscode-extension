import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface LogFs {
	mkdir(dir: string): Promise<void>;
	appendFile(file: string, data: string): Promise<void>;
	statSize(file: string): Promise<number>;
	rename(from: string, to: string): Promise<void>;
}

export const nodeLogFs: LogFs = {
	mkdir: async (dir) => {
		await mkdir(dir, {
			recursive: true
		});
	},
	appendFile: async (file, data) => {
		await appendFile(file, data, 'utf8');
	},
	statSize: async (file) => {
		try {
			return (await stat(file)).size;
		} catch {
			return 0;
		}
	},
	rename: async (from, to) => {
		await rename(from, to);
	},
};

const DEFAULT_MAX_QUEUE = 500;
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

export class LogFileWriter {
	private readonly queues = new Map<string, string[]>();
	private readonly flushing = new Set<string>();
	private readonly createdDirs = new Set<string>();

	constructor(
		private readonly fs: LogFs,
		private readonly maxQueue = DEFAULT_MAX_QUEUE,
		private readonly maxFileBytes = DEFAULT_MAX_FILE_BYTES,
	) {}

	enqueue(filePath: string, line: string): void {
		let queue = this.queues.get(filePath);
		if (!queue) {
			queue = [];
			this.queues.set(filePath, queue);
		}

		queue.push(line);
		if (queue.length > this.maxQueue) {
			queue.splice(0, queue.length - this.maxQueue);
		}

		void this.flush(filePath);
	}

	async idle(): Promise<void> {
		while (this.flushing.size > 0 || [...this.queues.values()].some((queue) => queue.length > 0)) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}

	private async flush(filePath: string): Promise<void> {
		if (this.flushing.has(filePath)) {
			return;
		}

		this.flushing.add(filePath);
		try {
			const dir = dirname(filePath);
			if (!this.createdDirs.has(dir)) {
				await this.fs.mkdir(dir);
				this.createdDirs.add(dir);
			}

			await this.rotateIfNeeded(filePath);

			while (true) {
				const queue = this.queues.get(filePath);
				if (!queue?.length) {
					break;
				}

				const batch = queue.splice(0, queue.length);
				await this.fs.appendFile(filePath, `${batch.join('\n')}\n`);
			}
		} catch {
			this.queues.delete(filePath);
		} finally {
			this.flushing.delete(filePath);
			if ((this.queues.get(filePath)?.length ?? 0) > 0) {
				void this.flush(filePath);
			}
		}
	}

	private async rotateIfNeeded(filePath: string): Promise<void> {
		const size = await this.fs.statSize(filePath);
		if (size < this.maxFileBytes) {
			return;
		}

		try {
			await this.fs.rename(filePath, `${filePath}.1`);
		} catch {}
	}
}
