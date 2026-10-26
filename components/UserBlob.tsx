import { cn } from '@/lib/utils';

/**
 * The user's avatar: a round blob with two tilted capsule eyes looking up
 * and to the right (after bloub.vercel.app's "Neutral" face). One shape,
 * one colour for now.
 *
 * Sized by inline style, not a class: menu buttons (SidebarMenuButton)
 * force every svg inside them to size-4.
 */
export function UserBlob({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn('shrink-0', className)}
    >
      <circle cx="50" cy="50" r="50" className="fill-brand-blue" />
      <rect x="54.5" y="19" width="11" height="24" rx="5.5" transform="rotate(-30 60 31)" className="fill-brand-blue-foreground" />
      <rect x="72.5" y="13" width="11" height="24" rx="5.5" transform="rotate(-30 78 25)" className="fill-brand-blue-foreground" />
    </svg>
  );
}
