export interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// Todos на один run агента (не глобальные)
export class TodoStore {
	private items: TodoItem[] = [];

	snapshot(): TodoItem[] {
		return this.items.map((item) => ({ ...item }));
	}

	write(items: TodoItem[]): TodoItem[] {
		this.items = items.map((item) => ({
			id: String(item.id || '').trim() || `todo_${Date.now()}`,
			content: String(item.content || '').trim(),
			status: item.status,
		})).filter((item) => item.content);
		return this.snapshot();
	}

	read(): TodoItem[] {
		return this.snapshot();
	}

	clear(): void {
		this.items = [];
	}
}
