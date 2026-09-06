import type { ChangeEvent, ReactNode } from 'react';
import { t } from '../../i18n';

interface FieldShellProps {
	labelKey: string;
	hintKey?: string;
	children: ReactNode;
	htmlFor?: string;
}

export function Field({ labelKey, hintKey, children, htmlFor }: FieldShellProps) {
	return (
		<label className="field" htmlFor={htmlFor}>
			<span className="field__label">{t(labelKey)}</span>
			{children}
			{hintKey ? <span className="field__hint">{t(hintKey)}</span> : null}
		</label>
	);
}

interface FieldTextProps {
	labelKey: string;
	hintKey?: string;
	value: string;
	onChange: (value: string) => void;
	type?: 'text' | 'password';
	placeholder?: string;
	disabled?: boolean;
	spellCheck?: boolean;
	onBlur?: () => void;
	autoComplete?: string;
}

export function FieldText({
	labelKey,
	hintKey,
	value,
	onChange,
	type = 'text',
	placeholder,
	disabled,
	spellCheck,
	onBlur,
	autoComplete,
}: FieldTextProps) {
	return (
		<Field labelKey={labelKey} hintKey={hintKey}>
			<input
				className="field__input"
				type={type}
				value={value}
				placeholder={placeholder}
				disabled={disabled}
				spellCheck={spellCheck}
				autoComplete={autoComplete}
				onBlur={onBlur}
				onChange={(e) => onChange(e.target.value)}
			/>
		</Field>
	);
}

interface FieldNumberProps {
	labelKey: string;
	hintKey?: string;
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	disabled?: boolean;
	parse: (raw: string, fallback: number) => number;
}

export function FieldNumber({
	labelKey,
	hintKey,
	value,
	onChange,
	min,
	max,
	step,
	disabled,
	parse,
}: FieldNumberProps) {
	return (
		<Field labelKey={labelKey} hintKey={hintKey}>
			<input
				className="field__input"
				type="number"
				min={min}
				max={max}
				step={step}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(parse(e.target.value, value))}
			/>
		</Field>
	);
}

interface FieldSelectProps {
	labelKey: string;
	hintKey?: string;
	value: string;
	onChange: (value: string) => void;
	disabled?: boolean;
	children: ReactNode;
}

export function FieldSelect({ labelKey, hintKey, value, onChange, disabled, children }: FieldSelectProps) {
	return (
		<Field labelKey={labelKey} hintKey={hintKey}>
			<select
				className="field__input"
				value={value}
				disabled={disabled}
				onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
			>
				{children}
			</select>
		</Field>
	);
}

interface FieldTextareaProps {
	labelKey: string;
	hintKey?: string;
	value: string;
	onChange: (value: string) => void;
	rows?: number;
	placeholder?: string;
	code?: boolean;
	spellCheck?: boolean;
}

export function FieldTextarea({
	labelKey,
	hintKey,
	value,
	onChange,
	rows = 4,
	placeholder,
	code,
	spellCheck = false,
}: FieldTextareaProps) {
	return (
		<Field labelKey={labelKey} hintKey={hintKey}>
			<textarea
				className={code ? 'field__input field__input--code' : 'field__input field__input--multiline'}
				rows={rows}
				value={value}
				placeholder={placeholder}
				spellCheck={spellCheck}
				onChange={(e) => onChange(e.target.value)}
			/>
		</Field>
	);
}

interface FieldToggleProps {
	labelKey: string;
	hintKey?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}

export function FieldToggle({ labelKey, hintKey, checked, onChange, disabled }: FieldToggleProps) {
	return (
		<label className={`field-toggle${disabled ? ' field-toggle--disabled' : ''}`}>
			<input
				className="field-toggle__input"
				type="checkbox"
				checked={checked}
				disabled={disabled}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span className="field-toggle__text">
				<span className="field-toggle__label">{t(labelKey)}</span>
				{hintKey ? <span className="field-toggle__hint">{t(hintKey)}</span> : null}
			</span>
		</label>
	);
}
