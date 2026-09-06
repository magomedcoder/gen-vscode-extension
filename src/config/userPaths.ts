import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Каталог пользовательского конфига Gen.
 *
 * - `GEN_CONFIG_DIR` - явный override
 * - Linux: `$XDG_CONFIG_HOME/gen` или `~/.config/gen`
 * - macOS: `~/.config/gen` (как у `AGENTS.md` в projectRules)
 * - Windows: `%APPDATA%/gen` или `~/AppData/Roaming/gen`
 */
export function getGenUserConfigDir(): string {
	const override = process.env.GEN_CONFIG_DIR?.trim();
	if (override) {
		return path.resolve(override);
	}

	if (process.platform === 'win32') {
		const base = process.env.APPDATA?.trim() || path.join(os.homedir(), 'AppData', 'Roaming');
		return path.join(base, 'gen');
	}

	if (process.platform === 'darwin') {
		return path.join(os.homedir(), '.config', 'gen');
	}

	const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), '.config');
	return path.join(xdg, 'gen');
}

// `.../config.json` пользователя
export function getGenUserConfigPath(): string {
	return path.join(getGenUserConfigDir(), 'config.json');
}
