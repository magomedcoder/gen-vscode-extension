export interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// Todos на один run агента (не глобальные)
export class TodoStore {
	private items: TodoItem[] = [];

	constructor(private readonly onChange?: (items: TodoItem[]) => void) {}

	snapshot(): TodoItem[] {
		return this.items.map((item) => ({ ...item }));
	}

	write(items: TodoItem[]): TodoItem[] {
		this.items = items.map((item) => ({
			id: String(item.id || '').trim() || `todo_${Date.now()}`,
			content: String(item.content || '').trim(),
			status: item.status,
		})).filter((item) => item.content);
		const snap = this.snapshot();
		this.onChange?.(snap);
		return snap;
	}

	read(): TodoItem[] {
		return this.snapshot();
	}

	clear(): void {
		this.items = [];
		this.onChange?.(this.snapshot());
	}
}
