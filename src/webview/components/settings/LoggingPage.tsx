import type { SettingsPageProps } from './pages';

interface LoggingPageProps extends SettingsPageProps {
	onOpenLogsFolder: () => void;
}

export function LoggingPage({ draft, setField, onOpenLogsFolder }: LoggingPageProps) {
	return (
		<>
			<label className="field field--row">
				<input
					type="checkbox"
					checked={draft.loggingEnabled}
					onChange={(e) => setField('loggingEnabled', e.target.checked)}
				/>
				<span className="field__label">Писать логи</span>
			</label>
			<span className="field__hint">
				По умолчанию выключено. 
				Output-каналы Gen LLM и Gen Agent, плюс файлы llm.log и agent.log.
				Запись на диск идёт в фоне и не ждёт сохранения - запросы из-за логов не блокируются.
			</span>
			<button className="btn btn--secondary" type="button" onClick={onOpenLogsFolder}>Открыть папку логов</button>
		</>
	);
}
