"use client"

// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/the-kizz/homekeep

/**
 * Shadcn-style Collapsible primitive (Phase 13 Plan 13-02 Task 1).
 *
 * Thin wrapper over `@radix-ui/react-collapsible` (re-exported via the
 * `radix-ui` meta package at runtime — see components/ui/dialog.tsx for
 * the established convention). Radix's Collapsible is headless; the
 * wrappers forward props + add `data-slot` attributes matching the
 * dialog/dropdown-menu styling hooks. Consumers (e.g. task-form.tsx)
 * apply their own Tailwind classes inline.
 *
 * Exports mirror the radix API surface used by the task form's
 * "Advanced" section (TCSEM-01 + D-15/D-16):
 *   - Collapsible       → Root (open/onOpenChange)
 *   - CollapsibleTrigger → the toggle button
 *   - CollapsibleContent → the collapsible body
 */

import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
