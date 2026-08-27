import { forwardRef, useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

const inputBase =
  'w-full rounded-[var(--radius-md)] border bg-[var(--panel2)] px-3.5 py-2.5 text-[14px] text-[var(--text)] outline-none transition-colors duration-[var(--dur-fast)] placeholder:text-[var(--text-faint)] disabled:cursor-not-allowed disabled:opacity-60';

function borderStyle(hasError: boolean): React.CSSProperties {
  return { borderColor: hasError ? 'var(--red)' : 'var(--border-strong)' };
}

interface FieldWrapperProps {
  label: string;
  id: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}

export function FieldWrapper({ label, id, error, hint, required, children }: FieldWrapperProps) {
  const errorId = error ? `${id}-error` : undefined;
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-semibold" style={{ color: 'var(--text-dim)' }}>
        {label}
        {required && (
          <span aria-hidden="true" style={{ color: 'var(--red)' }}>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && (
        <p id={hintId} className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[12px] font-medium" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  id?: string;
  error?: string;
  hint?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, id, error, hint, required, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <FieldWrapper label={label} id={fieldId} error={error} hint={hint} required={required}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={errorId ?? hintId}
        className={`${inputBase} focus-visible:shadow-[0_0_0_3px_rgba(235,100,10,0.18)] ${className}`}
        style={borderStyle(!!error)}
        {...rest}
      />
    </FieldWrapper>
  );
});

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  id?: string;
  error?: string;
  hint?: string;
  placeholder?: string;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, id, error, hint, required, placeholder, className = '', children, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId = error ? `${fieldId}-error` : undefined;
  const hintId = hint ? `${fieldId}-hint` : undefined;

  return (
    <FieldWrapper label={label} id={fieldId} error={error} hint={hint} required={required}>
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={errorId ?? hintId}
        defaultValue={rest.defaultValue ?? (placeholder ? '' : undefined)}
        className={`${inputBase} ${className}`}
        style={borderStyle(!!error)}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
    </FieldWrapper>
  );
});

export function Checkbox({
  label,
  id,
  className = '',
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; id?: string }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <label
      htmlFor={fieldId}
      className={`flex cursor-pointer items-center gap-2 text-[12.5px] ${className}`}
      style={{ color: 'var(--text-dim)' }}
    >
      <input
        id={fieldId}
        type="checkbox"
        className="h-4 w-4 rounded accent-[var(--orange)]"
        {...rest}
      />
      {label}
    </label>
  );
}
