import { CheckCircle2 } from 'lucide-react';

export function AllClearEmpty({ label = 'All Clear!' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="h-4 w-4" />
      <span className="font-medium">{label}</span>
    </div>
  );
}

