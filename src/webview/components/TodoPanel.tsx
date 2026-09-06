import type { ChatTodoItem } from '../../features/chat/protocol';
import { t } from '../i18n';

interface TodoPanelProps {
	todos: ChatTodoItem[];
}

function statusLabel(status: ChatTodoItem['status']): string {
	switch (status) {
		case 'in_progress':
			return t('chat.todos.in_progress');
		case 'completed':
			return t('chat.todos.completed');
		case 'cancelled':
			return t('chat.todos.cancelled');
		default:
			return t('chat.todos.pending');
	}
}

function statusIcon(status: ChatTodoItem['status']): string {
	switch (status) {
		case 'in_progress':
			return '◐';
		case 'completed':
			return '✓';
		case 'cancelled':
			return '✕';
		default:
			return '○';
	}
}

export function TodoPanel({ todos }: TodoPanelProps) {
	if (todos.length === 0) {
		return null;
	}

	return (
		<section className="todo-panel" aria-label={t('chat.todos.title')}>
			<div className="todo-panel__title">{t('chat.todos.title')}</div>
			<ul className="todo-panel__list">
				{todos.map((item) => (
					<li
						key={item.id}
						className={`todo-panel__item todo-panel__item--${item.status}`}
					>
						<span className="todo-panel__icon" aria-hidden="true">{statusIcon(item.status)}</span>
						<span className="todo-panel__content">{item.content}</span>
						<span className="todo-panel__status">{statusLabel(item.status)}</span>
					</li>
				))}
			</ul>
		</section>
	);
}
