import { registerTool } from '../registry';
import { runCommandTool } from './runCommand';
import { runScratchTool } from './runScratch';
import { runTestsTool } from './runTests';
import { awaitShellTool } from './taskShell';

export function registerShellTools(): void {
	registerTool(runCommandTool, {
		tags: ['shell'],
		risk: 'shell'
	});
	registerTool(awaitShellTool, {
		tags: ['shell'],
		risk: 'shell'
	});
	registerTool(runTestsTool, {
		tags: ['shell'],
		risk: 'shell'
	});
	registerTool(runScratchTool, {
		tags: ['shell'],
		risk: 'shell',
	});
}
