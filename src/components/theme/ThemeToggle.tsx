import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/context/ThemeProvider';

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  
  const isDark = resolvedTheme === 'dark';
  const isSystem = theme === 'system';
  
  // Cycle through: system -> light -> dark -> system
  const handleClick = () => {
    if (isSystem) {
      setTheme('light');
    } else if (isDark) {
      setTheme('system');
    } else {
      setTheme('dark');
    }
  };
  
  return (
    <button
      type="button"
      aria-label={
        isSystem 
          ? 'System theme (click to switch to light)' 
          : isDark 
            ? 'Dark mode (click to switch to system)' 
            : 'Light mode (click to switch to dark)'
      }
      className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-300 bg-gray-100 text-gray-700 shadow-sm transition-all duration-200 hover:bg-gray-200 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white dark:focus:ring-offset-gray-900"
      onClick={handleClick}
      title={
        isSystem 
          ? 'System theme (auto)' 
          : isDark 
            ? 'Dark mode' 
            : 'Light mode'
      }
    >
      {isSystem ? (
        <Monitor className="h-3 w-3" />
      ) : isDark ? (
        <Sun className="h-3 w-3" />
      ) : (
        <Moon className="h-3 w-3" />
      )}
    </button>
  );
}

