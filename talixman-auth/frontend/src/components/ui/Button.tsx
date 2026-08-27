import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-3 text-[12.5px] gap-1.5',
  md: 'h-10 px-4 text-[13.5px] gap-2',
};

function variantStyle(variant: Variant): { className: string; style?: React.CSSProperties } {
  switch (variant) {
    case 'primary':
      return {
        className: 'text-white shadow-[var(--shadow-sm)] hover:shadow-[var(--shadow-md)] hover:-translate-y-px active:translate-y-0',
        style: { background: 'linear-gradient(135deg,#EB640A,#BF2D31)' },
      };
    case 'danger':
      return {
        className: 'border hover:-translate-y-px active:translate-y-0',
        style: { borderColor: 'var(--red)', color: 'var(--red)', background: 'var(--danger-bg)' },
      };
    case 'ghost':
      return {
        className: 'hover:bg-[var(--panel2)]',
        style: { color: 'var(--text-dim)' },
      };
    case 'secondary':
    default:
      return {
        className: 'border hover:bg-[var(--panel2)]',
        style: { borderColor: 'var(--border-strong)', color: 'var(--text)', background: 'var(--panel)' },
      };
  }
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, disabled, leftIcon, rightIcon, className = '', children, ...rest },
  ref,
) {
  const v = variantStyle(variant);
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`inline-flex select-none items-center justify-center rounded-[var(--radius-md)] font-bold tracking-tight transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-none ${SIZE_CLASSES[size]} ${v.className} ${className}`}
      style={v.style}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'sm' ? 14 : 16} />
      ) : (
        leftIcon && <span className="-ml-0.5 flex shrink-0 items-center">{leftIcon}</span>
      )}
      {children && <span>{children}</span>}
      {!loading && rightIcon && <span className="-mr-0.5 flex shrink-0 items-center">{rightIcon}</span>}
    </button>
  );
});

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonProps & { 'aria-label': string }
>(function IconButton({ variant = 'ghost', size = 'md', className = '', children, ...rest }, ref) {
  const v = variantStyle(variant);
  const dim = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  return (
    <button
      ref={ref}
      className={`inline-flex shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-all duration-[var(--dur-fast)] ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-55 ${dim} ${v.className} ${className}`}
      style={v.style}
      {...rest}
    >
      {children}
    </button>
  );
});
