'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

interface DecryptedTextProps {
  text: string;
  speed?: number;
  maxIterations?: number;
  characters?: string;
  className?: string;
  parentClassName?: string;
  animateOn?: 'view' | 'hover';
}

export function DecryptedText({
  text,
  speed = 40,
  maxIterations = 14,
  characters = '0123456789ABCDEFλ§□▦◇▤0101',
  className = '',
  parentClassName = '',
  animateOn = 'hover',
}: DecryptedTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const isScramblingRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const startScramble = useCallback(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayText(text);
      return;
    }
    if (isScramblingRef.current) return;
    isScramblingRef.current = true;

    let iteration = 0;
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setDisplayText(
        text
          .split('')
          .map((char, index) => {
            if (char === ' ') return ' ';
            if (
              index <
              iteration / (maxIterations / Math.max(1, text.length))
            ) {
              return text[index];
            }
            return characters[Math.floor(Math.random() * characters.length)];
          })
          .join(''),
      );

      iteration += 1;

      if (iteration > maxIterations) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setDisplayText(text);
        isScramblingRef.current = false;
      }
    }, speed);
  }, [characters, maxIterations, speed, text]);

  useEffect(() => {
    if (animateOn === 'view') {
      const timeoutId = setTimeout(() => {
        startScramble();
      }, 50);
      return () => {
        clearTimeout(timeoutId);
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [animateOn, startScramble]);

  const handleMouseEnter = () => {
    if (animateOn === 'hover') {
      startScramble();
    }
  };

  return (
    <span
      className={`decrypted-text-root ${parentClassName}`}
      onMouseEnter={handleMouseEnter}
    >
      <span className={className}>{displayText}</span>
    </span>
  );
}
