'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

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
  const updateTilt = (event: MouseEvent<HTMLElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty(
      '--spotlight-rotate-x',
      `${y * -2.4}deg`,
    );
    event.currentTarget.style.setProperty(
      '--spotlight-rotate-y',
      `${x * 2.4}deg`,
    );
  };

  const resetTilt = (event: MouseEvent<HTMLElement>) => {
    event.currentTarget.style.setProperty('--spotlight-rotate-x', '0deg');
    event.currentTarget.style.setProperty('--spotlight-rotate-y', '0deg');
  };

  const motionStyle = {
    '--spotlight-rotate-x': '0deg',
    '--spotlight-rotate-y': '0deg',
  } as CSSProperties;

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        onMouseMove={updateTilt}
        onMouseLeave={resetTilt}
        style={motionStyle}
        className={`spotlight-card-root ${className}`}
      >
        <div className="spotlight-card-content">{children}</div>
      </button>
    );
  }

  return (
    <div
      className={`spotlight-card-root ${className}`}
      onMouseMove={updateTilt}
      onMouseLeave={resetTilt}
      style={motionStyle}
    >
      <div className="spotlight-card-content">{children}</div>
    </div>
  );
}
