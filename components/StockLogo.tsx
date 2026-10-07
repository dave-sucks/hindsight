'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

interface StockLogoProps {
  ticker: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLS = {
  // xs is the inline size the agent's tool rows use, where the logo sits in a
  // line of text rather than at the head of a row.
  xs: 'h-4 w-4',
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
};

const LABEL_CLS = {
  // At 16px two letters do not fit legibly; one initial still says which name
  // the row is about, which is all the slot has to do.
  xs: 'text-[7px]',
  sm: 'text-[9px]',
  md: 'text-[10px]',
  lg: 'text-xs',
};

export function StockLogo({ ticker, size = 'md', className }: StockLogoProps) {
  const [err, setErr] = useState(false);
  const base = cn('rounded-md shrink-0 object-cover', SIZE_CLS[size], className);

  if (err) {
    return (
      <div className={cn(base, 'bg-muted flex items-center justify-center')}>
        <span className={cn('font-bold text-muted-foreground', LABEL_CLS[size])}>
          {ticker.slice(0, size === 'xs' ? 1 : 2)}
        </span>
      </div>
    );
  }

  return (
    <img
      src={`https://assets.parqet.com/logos/symbol/${ticker}?format=svg`}
      alt={ticker}
      className={cn(base, 'bg-muted')}
      loading="lazy"
      onError={() => setErr(true)}
    />
  );
}
