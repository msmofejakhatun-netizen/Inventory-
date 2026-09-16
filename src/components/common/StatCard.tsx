import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  id?: string;
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  colorClass?: string;
  onClick?: () => void;
}

export const StatCard: React.FC<StatCardProps> = ({
  id,
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  colorClass = 'bg-amber-500/10 text-amber-600 border-amber-200/50',
  onClick,
}) => {
  return (
    <div
      id={id}
      onClick={onClick}
      className={`bg-white rounded-xl border border-stone-200 p-5 shadow-xs transition-all duration-150 ${
        onClick ? 'cursor-pointer hover:border-stone-400 hover:shadow-sm' : ''
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-stone-500 tracking-wide uppercase">{title}</p>
          <h3 className="mt-2 text-2xl font-bold tracking-tight text-stone-900">{value}</h3>
          {subtitle && <p className="mt-1 text-xs text-stone-500">{subtitle}</p>}
          {trend && (
            <p
              className={`mt-2 text-xs font-semibold flex items-center gap-1 ${
                trend.isPositive ? 'text-emerald-600' : 'text-rose-600'
              }`}
            >
              <span>{trend.isPositive ? '↑' : '↓'}</span>
              <span>{trend.value}</span>
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg border ${colorClass}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
};
