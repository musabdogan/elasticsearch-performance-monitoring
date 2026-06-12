const SEARCHALI_HOME_URL = 'https://www.searchali.com';

interface SearchAliWordmarkProps {
  className?: string;
  /** Height utility applied to both light/dark images (e.g. h-6). */
  heightClass?: string;
  /** External link target. Defaults to searchali.com. Set to undefined for a static logo. */
  href?: string;
}

export function SearchAliWordmark({
  className = '',
  heightClass = 'h-6',
  href = SEARCHALI_HOME_URL
}: SearchAliWordmarkProps) {
  const content = (
    <>
      <img
        src="/icons/searchali_logo_light.png"
        alt="searchali.com"
        width={1024}
        height={283}
        draggable={false}
        decoding="async"
        className={`${heightClass} w-auto select-none dark:hidden`}
      />
      <img
        src="/icons/searchali_logo_dark.png"
        alt="searchali.com"
        width={1024}
        height={283}
        draggable={false}
        decoding="async"
        className={`${heightClass} hidden w-auto select-none dark:block`}
      />
    </>
  );

  if (!href) {
    return <span className={`inline-flex shrink-0 items-center ${className}`}>{content}</span>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex shrink-0 items-center rounded-md transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800 ${className}`}
      title="searchali.com"
    >
      {content}
    </a>
  );
}
