import { Github, Globe, MessageCircle } from 'lucide-react';

export function Footer() {
  return (
    <footer className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-600 dark:text-gray-400">
            Powered by
          </span>
          <a
            href="https://www.searchali.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-gray-900 hover:text-blue-600 dark:text-gray-100 dark:hover:text-blue-400 transition-colors"
          >
            searchali.com
          </a>
          <a
            href="https://www.linkedin.com/company/searchali-com/"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-opacity hover:opacity-80"
            title="LinkedIn"
          >
            <img 
              src="/icons/linkedin-icon.png" 
              alt="LinkedIn" 
              className="h-4 w-4 dark:invert"
            />
          </a>
        </div>
        
        {/* Center CTA */}
        <div className="flex items-center">
          <a
            href="https://www.linkedin.com/company/searchali-com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-lg transition-all duration-200"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            <span>Need Elasticsearch expertise? Get professional support</span>
          </a>
        </div>

        <div className="flex flex-col items-end gap-0.5">
          <a
            href="https://github.com/musabdogan/elasticsearch-performance-monitoring"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
          >
            <Github className="h-3.5 w-3.5" />
            <span>GitHub</span>
          </a>
          <a
            href="https://www.searchali.com"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>www.searchali.com</span>
          </a>
        </div>
      </div>
    </footer>
  );
}

