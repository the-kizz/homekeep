import { AvatarCircle, initialsOf } from './avatar-circle';
import type { EffectiveAssignee } from '@/lib/assignment';

/**
 * AssigneeDisplay — renders an EffectiveAssignee as a small avatar +
 * label (04-03 D-10). Three display variants map 1:1 to the
 * resolveAssignee result shape:
 *
 *   kind:'task'   → solid AvatarCircle, initials, title "Assigned via task (override)"
 *   kind:'area'   → wireframe AvatarCircle, initials, title "Assigned via area default"
 *   kind:'anyone' → dashed AvatarCircle with "?", title "No specific assignee"
 *
 * Emits `data-assignee-kind` so Playwright E2E can assert the cascade
 * state without parsing the label text (brittle across i18n / copy).
 *
 * Size defaults to 'sm' for inline TaskRow use; pass 'md' for the
 * TaskDetailSheet "Assigned to" section.
 */
export function AssigneeDisplay({
  effective,
  size = 'sm',
  showLabel = true,
}: {
  effective: EffectiveAssignee;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}) {
  if (effective.kind === 'anyone') {
    return (
      <span
        className="inline-flex items-center gap-1.5"
        data-assignee-kind="anyone"
      >
        <AvatarCircle
          variant="dashed"
          size={size}
          initials="?"
          title="No specific assignee"
        />
        {showLabel && (
          <span className="text-xs text-muted-foreground">Anyone</span>
        )}
      </span>
    );
  }

  const title =
    effective.kind === 'task'
      ? `Assigned via task (override): ${effective.user.name}`
      : `Assigned via area default: ${effective.user.name}`;
  const variant = effective.kind === 'task' ? 'solid' : 'wireframe';

  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-assignee-kind={effective.kind}
    >
      <AvatarCircle
        variant={variant}
        size={size}
        initials={initialsOf(effective.user.name)}
        title={title}
      />
      {showLabel && (
        <span className="text-xs text-muted-foreground truncate max-w-[8rem]">
          {effective.user.name}
        </span>
      )}
    </span>
  );
}
