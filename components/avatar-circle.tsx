import clsx from 'clsx';

/**
 * AvatarCircle — minimal initials-in-circle primitive (04-03, D-10).
 *
 * No @radix-ui/react-avatar dependency (RESEARCH Don't Hand-Roll #3):
 * all three display variants are pure CSS. Used by AvatarStack,
 * AssigneeDisplay, and the /members page row.
 *
 * Variants:
 *   - solid:     warm primary bg — task-level override assignee
 *   - wireframe: outlined, transparent bg — area-default assignee
 *   - dashed:    dashed outline, transparent bg — "Anyone" placeholder
 *
 * Sizes: sm (24px), md (32px, default), lg (40px). All use a single
 * size class (size-X) so rounded-full renders as a perfect circle.
 *
 * Accessibility:
 *   - Rendered as a <span role="img"> with aria-label from title or
 *     initials. No text content leaks to screen readers beyond the
 *     label (avoids "Alice Alice" double-announcement).
 */
export function AvatarCircle({
  initials,
  variant = 'solid',
  size = 'md',
  title,
}: {
  initials?: string;
  variant?: 'solid' | 'wireframe' | 'dashed';
  size?: 'sm' | 'md' | 'lg';
  title?: string;
}) {
  const sizeCls =
    size === 'sm'
      ? 'size-6 text-[10px]'
      : size === 'lg'
        ? 'size-10 text-base'
        : 'size-8 text-xs';
  const variantCls =
    variant === 'solid'
      ? 'bg-primary text-primary-foreground border border-primary'
      : variant === 'wireframe'
        ? 'border-2 border-muted-foreground/70 text-muted-foreground bg-background'
        : 'border-2 border-dashed border-muted-foreground/70 text-muted-foreground bg-background';
  return (
    <span
      role="img"
      aria-label={title ?? initials ?? 'Unassigned'}
      title={title}
      className={clsx(
        'inline-flex items-center justify-center rounded-full font-medium tabular-nums select-none',
        sizeCls,
        variantCls,
      )}
    >
      {initials ?? '?'}
    </span>
  );
}

/**
 * Compute a 1-2 character initials token from a display name.
 * Edge cases:
 *   - Empty/whitespace-only → '?'
 *   - Single name "Alice" → "AL" (first two letters uppercased)
 *   - Multi-word "Alice Jane Smith" → "AS" (first + last)
 *   - Email-shape fallback ("alice@x.com") → "AL" from the first
 *     alphanumeric chunk; caller should prefer a real name when
 *     available.
 */
export function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
