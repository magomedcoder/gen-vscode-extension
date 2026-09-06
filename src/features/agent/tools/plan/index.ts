import { registerTool } from '../registry';
import { planEnterTool, planExitTool, switchModeTool } from './modeSwitch';
import { proposePlanTool, updatePlanTool } from './proposePlan';
import { listPlansTool, writePlanTool } from './writePlan';

export function registerPlanTools(): void {
	registerTool(proposePlanTool, { 
		tags: ['plan'], 
		risk: 'read' 
	});
	registerTool(updatePlanTool, { 
		tags: ['plan'], 
		risk: 'read' 
	});
	registerTool(writePlanTool, { 
		tags: ['plan'], 
		risk: 'write' 
	});
	registerTool(listPlansTool, { 
		tags: ['plan'], 
		risk: 'read' 
	});
	registerTool(planEnterTool, { 
		tags: ['plan'], 
		risk: 'read' 
	});
	registerTool(planExitTool, { 
		tags: ['plan'], 
		risk: 'read' 
	});
	registerTool(switchModeTool, { 
		tags: ['plan'], 
		risk: 'read' 
	});
}

