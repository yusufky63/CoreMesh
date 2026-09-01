'use client';

import type { ReactNode } from 'react';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
  onClick?: () => void;
}

export function SpotlightCard({
  children,
  className = '',
  onClick,
}: SpotlightCardProps) {
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`spotlight-card-root ${className}`}
      >
        <div className="spotlight-card-content">{children}</div>
      </button>
    );
  }

  return (
    <div className={`spotlight-card-root ${className}`}>
      <div className="spotlight-card-content">{children}</div>
    </div>
  );
}
