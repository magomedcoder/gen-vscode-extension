import { registerFsTools } from './fs/index';
import { registerIdeTools } from './ide/index';
import { registerMcpTools } from './mcp/index';
import { registerMetaTools } from './meta/index';
import { registerPlanTools } from './plan/index';
import { registerSearchTools } from './search/index';
import { registerShellTools } from './shell/index';

export function registerBuiltins(): void {
	registerFsTools();
	registerSearchTools();
	registerShellTools();
	registerIdeTools();
	registerMcpTools();
	registerPlanTools();
	registerMetaTools();
}

registerBuiltins();
