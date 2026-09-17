import React from 'react';
import { useTrainStore } from '../../store/useTrainStore.js';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTrainStore();
  const isDark = theme === 'dark';

  return (
    <button
      onClick={toggleTheme}
      className={`
        relative inline-flex items-center h-6 w-11 rounded-full
        transition-colors duration-300 focus:outline-none focus:ring-2
        focus:ring-offset-2 focus:ring-offset-surface-900
        ${isDark
          ? 'bg-indigo-600 focus:ring-indigo-500'
          : 'bg-slate-300 focus:ring-slate-400'
        }
      `}
      aria-label={isDark ? 'Passer en mode clair' : 'Passer en mode sombre'}
      title={isDark ? 'Mode clair' : 'Mode sombre'}
    >
      <span className={`
        absolute inline-flex items-center justify-center
        w-5 h-5 rounded-full bg-white shadow-sm
        transform transition-transform duration-300
        ${isDark ? 'translate-x-5' : 'translate-x-0.5'}
        text-xs
      `}>
        {isDark ? '🌙' : '☀️'}
      </span>
    </button>
  );
}
