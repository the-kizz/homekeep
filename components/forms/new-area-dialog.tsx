'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AreaForm } from '@/components/forms/area-form';

/**
 * NewAreaDialog — button + <Dialog> wrapper around <AreaForm mode="create">.
 *
 * Extracted from the Areas page so the server component can stay pure.
 * Closes the dialog when the form action returns ok:true via the onDone
 * callback the form invokes.
 */
export function NewAreaDialog({ homeId }: { homeId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1 size-4" /> Add area
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New area</DialogTitle>
          <DialogDescription>
            Pick a name, icon, and color. You can reorder areas after
            creating.
          </DialogDescription>
        </DialogHeader>
        <AreaForm
          mode="create"
          homeId={homeId}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
