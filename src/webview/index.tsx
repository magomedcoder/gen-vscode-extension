import { createRoot } from 'react-dom/client';
import { App } from './App';
import { t } from './i18n';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
	throw new Error(t('webview.rootMissing'));
}

createRoot(root).render(<App />);
