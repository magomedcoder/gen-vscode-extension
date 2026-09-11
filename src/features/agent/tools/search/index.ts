import { registerTool } from '../registry';
import { codebaseSearchTool } from './codebaseSearch';
import { fileSearchTool } from './fileSearchWeb';
import { findCodeTool } from './findCode';
import { findSymbolTool } from './findSymbol';
import { globTool, grepTool } from './globGrep';
import { listCodeDefinitionNamesTool } from './listCodeDefinitionNames';
import { packContextTool } from './packContext';
import { projectMapTool } from './projectMap';
import { searchDocsTool, semanticSearchTool } from './semanticSearch';
import { similarCodeTool } from './similarCode';

export function registerSearchTools(): void {
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
	registerTool(findCodeTool, {
		tags: ['search'],
		risk: 'read'
	});
	registerTool(findSymbolTool, {
		tags: ['search'],
		risk: 'read'
	});
	registerTool(listCodeDefinitionNamesTool, {
		tags: ['search'],
		risk: 'read',
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
	registerTool(projectMapTool, {
		tags: ['search'],
		risk: 'read',
	});
	registerTool(packContextTool, {
		tags: ['search'],
		risk: 'read',
	});
	registerTool(similarCodeTool, {
		tags: ['search'],
		risk: 'read',
	});
}
