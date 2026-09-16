import React from 'react';
import { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  id?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  id,
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}) => {
  return (
    <div
      id={id}
      className="flex flex-col items-center justify-center py-12 px-4 text-center rounded-xl border border-dashed border-stone-200 bg-stone-50/50"
    >
      <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center text-stone-400 mb-3">
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      <p className="mt-1 text-sm text-stone-500 max-w-sm">{description}</p>
      {actionLabel && onAction && (
        <button
          id={`${id}-action-btn`}
          onClick={onAction}
          className="mt-4 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors shadow-xs"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
};
