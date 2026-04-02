import { Github, Globe, MessageCircle, Star } from 'lucide-react';

const FEEDBACK_FORM_URL = 'https://forms.gle/qX3qLo6vbb7Yswec7';
const CHROME_WEB_STORE_REVIEWS_URL = 'https://chromewebstore.google.com/detail/elasticsearch-performance/eoigdegnoepbfnlijibjhdhmepednmdi/reviews';

export function Footer() {
  return (
    <footer className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 min-w-0">
        {/* Left: 2 rows — Powered by + links, then Feedback · Rate + version */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 dark:text-gray-400">Powered by</span>
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
              <img src="/icons/linkedin-icon.png" alt="LinkedIn" className="h-4 w-4 dark:invert" />
            </a>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={FEEDBACK_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors"
              title="Send feedback"
            >
              Feedback
            </a>
            <span className="text-gray-300 dark:text-gray-600">·</span>
            <a
              href={CHROME_WEB_STORE_REVIEWS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 text-[10px] text-gray-500 hover:text-amber-500 dark:text-gray-400 dark:hover:text-amber-400 transition-colors"
              title="Rate us on Chrome Web Store"
            >
              <Star className="h-3 w-3 fill-current" />
              Rate us on Chrome Web Store
            </a>
            <span className="text-[10px] text-gray-400 dark:text-gray-500" title="App version">
              v{__APP_VERSION__}
            </span>
          </div>
        </div>

        {/* Center: CTA — always centered */}
        <div className="flex items-center justify-center">
          <a
            href="https://www.linkedin.com/company/searchali-com/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-lg transition-all duration-200 whitespace-nowrap"
          >
            <MessageCircle className="h-3.5 w-3.5 shrink-0" />
            <span>Need an Elasticsearch expert? Get professional support</span>
          </a>
        </div>

        {/* Right: 2 rows — GitHub, website */}
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

