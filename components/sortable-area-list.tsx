'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import * as Icons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Pencil, Trash2, Lock } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { reorderAreas, deleteArea } from '@/lib/actions/areas';

/**
 * SortableAreaList — drag-to-reorder area management (AREA-05).
 *
 * Derived from RESEARCH §Pattern: Drag-to-Reorder (lines 1032-1104) with
 * extensions for edit + delete + Whole Home guard per plan Task 2.6.
 *
 * Pitfall compliance:
 *   - #8 (stable dnd-kit IDs): useSortable({ id: area.id }) uses the PB
 *     record id, NEVER the array index.
 *   - #10 (CSS.Transform.toString): applied to the row style for drag
 *     transform.
 *
 * Optimistic + rollback: setItems(next) first, then the reorderAreas
 * server action inside startTransition. On failure, rollback to the
 * server-provided initial order.
 *
 * Whole Home guard (AREA-02):
 *   - Row for is_whole_home_system === true renders a disabled Lock
 *     indicator in place of the Delete button with a tooltip (aria-label)
 *     explaining why.
 *   - Delete confirmation dialog only attaches to user-created areas.
 *   - Server-side: PB deleteRule rejects the same case + deleteArea
 *     action double-guards.
 */

export type SortableArea = {
  id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_whole_home_system: boolean;
};

function kebabToPascal(s: string): string {
  return s
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
    .join('');
}

const IconModule = Icons as unknown as Record<string, LucideIcon | undefined>;

function AreaGlyph({ icon }: { icon: string }) {
  const Icon = IconModule[kebabToPascal(icon)] ?? Icons.HelpCircle;
  return <Icon className="size-4" />;
}

function SortableRow({
  area,
  homeId,
  onDelete,
  isDeleting,
}: {
  area: SortableArea;
  homeId: string;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: area.id });

  const [dialogOpen, setDialogOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-area-name={area.name}
      data-area-id={area.id}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card p-3',
        isDragging && 'shadow-md',
      )}
    >
      {/* Drag handle (only listeners on this element so the Edit/Delete
          buttons remain clickable without dragging). */}
      <button
        type="button"
        aria-label={`Reorder ${area.name}`}
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <span
        className="inline-flex size-6 items-center justify-center rounded"
        style={{ background: area.color, color: 'white' }}
        aria-hidden
      >
        <AreaGlyph icon={area.icon} />
      </span>

      <Link
        href={`/h/${homeId}/areas/${area.id}`}
        className="flex-1 truncate font-medium hover:underline"
      >
        {area.name}
      </Link>

      <Button asChild variant="ghost" size="icon" aria-label="Edit">
        <Link href={`/h/${homeId}/areas/${area.id}`}>
          <Pencil className="size-4" />
        </Link>
      </Button>

      {area.is_whole_home_system ? (
        <Button
          variant="ghost"
          size="icon"
          disabled
          aria-label="Cannot delete Whole Home"
          title="The Whole Home area cannot be deleted"
        >
          <Lock className="size-4 text-muted-foreground" />
        </Button>
      ) : (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Delete">
              <Trash2 className="size-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete {area.name}?</DialogTitle>
              <DialogDescription>
                This removes the area and any tasks inside it. This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onDelete(area.id);
                  setDialogOpen(false);
                }}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}

export function SortableAreaList({
  homeId,
  initial,
}: {
  homeId: string;
  initial: SortableArea[];
}) {
  const [items, setItems] = useState<SortableArea[]>(initial);
  const [reorderPending, startReorder] = useTransition();
  const [deletePending, startDelete] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);

    startReorder(async () => {
      const result = await reorderAreas(
        homeId,
        next.map((i) => i.id),
      );
      if (!result.ok) {
        setItems(initial);
      }
    });
  }

  function handleDelete(areaId: string) {
    startDelete(async () => {
      const result = await deleteArea(areaId);
      if (result.ok) {
        setItems((prev) => prev.filter((i) => i.id !== areaId));
      }
      // On failure (e.g. Whole Home guard), leave state intact — the PB
      // deleteRule or action formError will show on next page refresh;
      // for now the row stays.
    });
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map((i) => i.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul
          className={cn(
            'space-y-2',
            reorderPending && 'opacity-70',
          )}
        >
          {items.map((a) => (
            <SortableRow
              key={a.id}
              area={a}
              homeId={homeId}
              onDelete={handleDelete}
              isDeleting={deletePending}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
