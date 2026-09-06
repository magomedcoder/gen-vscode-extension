import { registerTool } from '../registry';
import { codebaseSearchTool } from './codebaseSearch';
import { fileSearchTool } from './fileSearchWeb';
import { globTool, grepTool } from './globGrep';
import { searchFilesTool } from './searchFiles';
import { searchDocsTool, semanticSearchTool } from './semanticSearch';

export function registerSearchTools(): void {
	registerTool(searchFilesTool, { 
		tags: ['search'], 
		risk: 'read'
	});
	registerTool(globTool, { 
		tags: ['search'], 
		risk: 'read'
	});
	registerTool(grepTool, { 
		tags: ['search'], 
		risk: 'read'
	});
	registerTool(fileSearchTool, { 
		tags: ['search'], 
		risk: 'read'
	});
	registerTool(codebaseSearchTool, { 
		tags: ['search'], 
		risk: 'read'
	});
	registerTool(semanticSearchTool, { 
		tags: ['search'], 
		risk: 'read'
	});
	registerTool(searchDocsTool, { 
		tags: ['search'], 
		risk: 'read'
	});
}

