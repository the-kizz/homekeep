import Link from 'next/link';
import { AvatarCircle, initialsOf } from './avatar-circle';

/**
 * AvatarStack — overlapping row of up to N member avatars with a "+X"
 * overflow pill (04-03, D-17). Used in the home dashboard header
 * linking to /members.
 *
 * If `href` is provided, the entire stack wraps in a <Link> so the
 * whole cluster is tappable. Non-link callers can omit href.
 *
 * Members beyond `max` (default 3) are collapsed into a wireframe
 * avatar showing "+N" — matches the D-10 variant vocabulary so the
 * visual grammar stays consistent.
 */
export function AvatarStack({
  members,
  href,
  max = 3,
  title,
}: {
  members: Array<{ id: string; name: string }>;
  href?: string;
  max?: number;
  title?: string;
}) {
  if (members.length === 0) return null;

  const shown = members.slice(0, max);
  const overflow = Math.max(0, members.length - shown.length);

  const inner = (
    <div
      className="flex -space-x-2"
      title={title ?? `${members.length} member${members.length === 1 ? '' : 's'}`}
      data-testid="avatar-stack"
      data-member-count={members.length}
    >
      {shown.map((m) => (
        <AvatarCircle
          key={m.id}
          initials={initialsOf(m.name)}
          variant="solid"
          size="sm"
          title={m.name}
        />
      ))}
      {overflow > 0 && (
        <AvatarCircle
          initials={`+${overflow}`}
          variant="wireframe"
          size="sm"
          title={`${overflow} more`}
        />
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex items-center">
        {inner}
      </Link>
    );
  }
  return inner;
}
