import type { Components } from 'react-markdown';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { vscodeApi } from '../vscodeApi';

function isSafeHttpUrl(href: string | undefined): href is string {
	if (!href) {
		return false;
	}

	try {
		const url = new URL(href);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function openExternal(href: string): void {
	vscodeApi.postMessage({ type: 'openExternal', url: href });
}

const components: Components = {
	a({ href, children }) {
		if (!isSafeHttpUrl(href)) {
			return <span>{children}</span>;
		}
		return (
			<a
				href={href}
				title={href}
				onClick={(event) => {
					event.preventDefault();
					openExternal(href);
				}}
			>
				{children}
			</a>
		);
	},
	img({ src, alt }) {
		if (!isSafeHttpUrl(src)) {
			return alt ? <span className="md__img-fallback">{alt}</span> : null;
		}

		return <img src={src} alt={alt ?? ''} loading="lazy" />;
	},
};

interface MarkdownMessageProps {
	content: string;
}

export function MarkdownMessage({ content }: MarkdownMessageProps) {
	return (
		<div className="md">
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
		</div>
	);
}
