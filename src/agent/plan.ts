import { AGENT_LIMITS } from './policy';
import { asObjectArray, asString, type ToolResult } from './types';

export interface PlanStep {
	title: string;
	path?: string;
	action?: string;
}

export interface AgentPlan {
	title: string;
	steps: PlanStep[];
}

const MULTI_FILE_PLAN_HINT = 'Правки в нескольких файлах требуют плана. Вызовите propose_plan (заголовок и шаги с путями) и дождитесь подтверждения.';

export function parsePlanArgs(args: Record<string, unknown>): AgentPlan {
	const title = asString(args, 'title').trim() || 'План правок';
	const steps = asObjectArray(args, 'steps').map((item) => {
		const stepTitle = asString(item, 'title').trim() || asString(item, 'summary').trim();
		const path = asString(item, 'path').trim();
		const action = asString(item, 'action').trim();
		return {
			title: stepTitle || path || action || 'шаг',
			...(path ? { path } : {}),
			...(action ? { action } : {}),
		};
	});

	if (steps.length === 0) {
		throw new Error('Нужен непустой массив steps');
	}

	if (steps.length > AGENT_LIMITS.maxPlanSteps) {
		throw new Error(`Слишком много шагов (${steps.length}, лимит ${AGENT_LIMITS.maxPlanSteps})`);
	}

	return { title, steps };
}

export function formatPlan(plan: AgentPlan): string {
	const lines = [plan.title];
	plan.steps.forEach((step, i) => {
		const bits = [step.title];
		if (step.path) {
			bits.push(step.path);
		}

		if (step.action) {
			bits.push(step.action);
		}

		lines.push(`${i + 1}. ${[...new Set(bits)].join(' - ')}`);
	});
	
	return lines.join('\n');
}

export function mutationPathsFromArgs(name: string, args: Record<string, unknown>): string[] {
	if (name === 'apply_workspace_edit') {
		return [...new Set(asObjectArray(args, 'edits').map((item) => asString(item, 'path').trim()).filter(Boolean))];
	}

	const path = asString(args, 'path').trim();
	return path ? [path] : [];
}

export class TurnPlan {
	approved = false;
	private readonly files = new Set<string>();

	approve(): void {
		this.approved = true;
	}

	guard(paths: string[]): ToolResult | undefined {
		const incoming = [...new Set(paths.map((p) => p.trim()).filter(Boolean))];
		if (this.approved) {
			for (const path of incoming) {
				this.files.add(path);
			}

			return undefined;
		}

		const next = new Set(this.files);
		for (const path of incoming) {
			next.add(path);
		}

		if (incoming.length > 1 || next.size > 1) {
			return {
				ok: false,
				denied: true,
				content: MULTI_FILE_PLAN_HINT,
			};
		}

		for (const path of incoming) {
			this.files.add(path);
		}

		return undefined;
	}
}
