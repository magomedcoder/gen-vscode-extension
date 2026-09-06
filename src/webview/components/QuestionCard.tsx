import { useState } from 'react';
import type { PendingQuestion } from '../../chat/protocol';
import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';

interface QuestionCardProps {
	question: PendingQuestion;
}

export function QuestionCard({ question }: QuestionCardProps) {
	const [freeform, setFreeform] = useState('');
	const options = question.options ?? [];

	const answer = (value: string) => {
		vscodeApi.postMessage({
			type: 'answerQuestion',
			id: question.id,
			answer: value,
		});
	};

	return (
		<section className="confirm-card question-card" role="dialog" aria-labelledby="gen-question-title">
			<div className="confirm-card__header">
				<div className="confirm-card__heading">
					<span className="confirm-card__badge">{t('chat.question.badge')}</span>
					<strong id="gen-question-title" className="confirm-card__title">{question.title}</strong>
				</div>
			</div>
			{question.prompt ? <pre className="confirm-card__detail">{question.prompt}</pre> : null}
			{options.length > 0 ? (
				<div className="confirm-card__actions question-card__options">
					{options.map((opt) => (
						<button key={opt} className="btn" type="button" onClick={() => answer(opt)}>
							{opt}
						</button>
					))}
				</div>
			) : null}
			<div className="question-card__freeform">
				<input
					className="question-card__input"
					type="text"
					value={freeform}
					placeholder={t('chat.question.freeform')}
					aria-label={t('chat.question.freeform')}
					onChange={(e) => setFreeform(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && freeform.trim()) {
							e.preventDefault();
							answer(freeform.trim());
						}
					}}
				/>
				<button
					className="btn"
					type="button"
					disabled={!freeform.trim()}
					onClick={() => answer(freeform.trim())}
				>
					{t('chat.question.submit')}
				</button>
			</div>
			<div className="confirm-card__actions">
				<button className="btn btn--secondary" type="button" onClick={() => answer('')}>
					{t('chat.question.cancel')}
				</button>
			</div>
		</section>
	);
}
