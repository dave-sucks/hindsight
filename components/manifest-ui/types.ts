// Shared type definitions for Manifest UI components
// Adapted from https://github.com/mnfst/manifest-ui
//
// All components use a semantic prop structure with 4 categories:
// - data: Content to display (arrays, objects, content)
// - actions: User-triggerable callbacks (on* handlers)
// - appearance: Visual configuration (variants, sizes, labels)
// - control: State management (loading, selection, disabled)

import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Blogging
// ---------------------------------------------------------------------------

export interface Post {
  title?: string;
  excerpt?: string;
  coverImage?: string;
  author?: {
    name?: string;
    avatar?: string;
  };
  publishedAt?: string;
  readTime?: string;
  tags?: string[];
  category?: string;
  url?: string;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export interface Product {
  name?: string;
  description?: string;
  price?: number;
  originalPrice?: number;
  image?: string;
  rating?: number;
  badge?: string;
  inStock?: boolean;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface Option {
  label?: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

export interface OrderItem {
  id: string;
  name?: string;
  quantity?: number;
  price?: number;
  image?: string;
}
