import { t } from '../i18n';
import { vscodeApi } from '../vscodeApi';
import type { ChatProjectStatus } from '../../chat/protocol';

interface ProjectSetupBannerProps {
	project?: ChatProjectStatus;
}

export function ProjectSetupBanner({ project }: ProjectSetupBannerProps) {
	if (!project) {
		return null;
	}

	if (!project.hasWorkspace) {
		return (
			<div className="project-banner" role="status">
				<div className="project-banner__text">
					<strong className="project-banner__title">{t('project.noWorkspaceTitle')}</strong>
					<span className="project-banner__hint">{t('project.noWorkspaceHint')}</span>
				</div>
			</div>
		);
	}

	if (project.enabled) {
		if (project.indexing) {
			return (
				<div className="project-banner project-banner--busy" role="status">
					<div className="project-banner__text">
						<strong className="project-banner__title">{t('project.indexingTitle')}</strong>
						<span className="project-banner__hint">{t('project.indexingHint')}</span>
					</div>
				</div>
			);
		}

		if (project.error) {
			return (
				<div className="project-banner project-banner--error" role="status">
					<div className="project-banner__text">
						<strong className="project-banner__title">{t('project.indexErrorTitle')}</strong>
						<span className="project-banner__hint">{project.error}</span>
					</div>
					<button
						className="btn btn--secondary"
						type="button"
						onClick={() => vscodeApi.postMessage({ type: 'enableProject' })}
					>
						{t('project.retryIndex')}
					</button>
				</div>
			);
		}

		return null;
	}

	return (
		<div className="project-banner" role="status">
			<div className="project-banner__text">
				<strong className="project-banner__title">{t('project.setupTitle')}</strong>
				<span className="project-banner__hint">{t('project.setupHint')}</span>
			</div>
			<button
				className="btn"
				type="button"
				onClick={() => vscodeApi.postMessage({ type: 'enableProject' })}
			>
				{t('project.setupAction')}
			</button>
		</div>
	);
}
