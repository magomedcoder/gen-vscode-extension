import { registerTool } from '../registry';
import { getActiveEditorTool, getOpenEditorsTool } from './editors';
import { findReferencesTool } from './findReferences';
import { getDiagnosticsTool } from './getDiagnostics';
import { gitStatusTool } from './gitStatus';
import { lspTool } from './lsp';
import { closeFileTool, openFileTool, revealLineTool } from './navigation';

export function registerIdeTools(): void {
	registerTool(getActiveEditorTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(getOpenEditorsTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(openFileTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(closeFileTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(revealLineTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(gitStatusTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(getDiagnosticsTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(lspTool, { 
		tags: ['ide'], 
		risk: 'read' 
	});
	registerTool(findReferencesTool, {
		tags: ['ide'],
		risk: 'read',
	});
}
