'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  notificationPrefsSchema,
  type NotificationPrefs,
} from '@/lib/schemas/notification-prefs';
import { updateNotificationPrefsAction } from '@/lib/actions/notification-prefs';
import type { ActionState } from '@/lib/schemas/auth';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useActionFormSubmit } from '@/lib/use-action-form';

/**
 * NotificationPrefsForm (06-03 Task 1, D-15, NOTF-01 / 05 / 06).
 *
 * Real replacement for the Phase 5 placeholder. Wires react-hook-form
 * (client-side zod validation + pattern parity with Phase 2/5 forms)
 * onto the `updateNotificationPrefsAction` Server Action via the
 * Next.js 16 `useActionState` + `<form action>` pattern.
 *
 * Fields:
 *   1. ntfy_topic       — text input (4-64 URL-safe chars, empty = disabled).
 *   2. notify_overdue   — checkbox.
 *   3. notify_assigned  — checkbox.
 *   4. notify_partner_completed — checkbox.
 *   5. notify_weekly_summary    — checkbox (toggles reveal of #6).
 *   6. weekly_summary_day       — native <select> sunday|monday (hidden when #5 off).
 *
 * Root attrs (E2E anchors):
 *   data-notification-prefs-form — replaces the old placeholder attr.
 *   data-notifications-ready="true" — flipped post-mount so E2E can poll.
 *
 * RHF errors merge with server-side `state.fieldErrors` (client wins on
 * display). Toast success/error driven by the action's `ActionState`
 * return (same contract as every other form in the app).
 */

const INITIAL: ActionState = { ok: false };

export function NotificationPrefsForm({
  initialPrefs,
}: {
  initialPrefs: NotificationPrefs;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    updateNotificationPrefsAction,
    INITIAL,
  );
  const { onSubmit, pending } = useActionFormSubmit(formAction);

  // Phase 39 (TESTFIX-07): post-hydration signal. SSR ships
  // data-notifications-ready="false"; the effect flips it to "true"
  // only AFTER React commits the post-mount cycle, by which point
  // RHF's register() refs are attached and onChange handlers are
  // wired. E2E waits on this attribute before clicking checkboxes,
  // closing the SSR→hydration→ref-attach race that survived three
  // v1.3 test-plumbing fix attempts.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Deliberate post-commit setState: the flag must flip only after the
    // client has mounted, which is exactly what an effect guarantees.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  const {
    register,
    control,
    formState: { errors },
  } = useForm<NotificationPrefs>({
    resolver: zodResolver(notificationPrefsSchema),
    mode: 'onBlur',
    defaultValues: initialPrefs,
  });

  // Toast the most recent server response. We key on the state object
  // identity so each dispatch fires exactly one toast.
  const lastStateRef = useRef<ActionState | null>(null);
  useEffect(() => {
    if (state === lastStateRef.current) return;
    lastStateRef.current = state;
    if (state.ok === true) {
      toast.success('Notification preferences saved');
    } else if (state.ok === false && state.formError) {
      toast.error(state.formError);
    }
  }, [state]);

  // useWatch rather than watch(): watch() defeats React Compiler memoisation.
  const weeklyOn = useWatch({ control, name: 'notify_weekly_summary' });

  const serverFieldErrors =
    state.ok === false ? state.fieldErrors : undefined;
  const serverFormError = state.ok === false ? state.formError : undefined;

  const topicError =
    errors.ntfy_topic?.message ?? serverFieldErrors?.ntfy_topic?.[0];
  const dayError =
    errors.weekly_summary_day?.message ??
    serverFieldErrors?.weekly_summary_day?.[0];

  return (
    <Card
      data-notification-prefs-form
      data-notifications-ready={hydrated ? 'true' : 'false'}
      data-state-ok={state.ok === true ? 'true' : 'false'}
    >
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Set up a personal ntfy topic and choose which pushes you want.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <div className="space-y-1.5" data-field="ntfy-topic">
            <Label htmlFor="ntfy-topic">Your ntfy topic</Label>
            <Input
              id="ntfy-topic"
              type="text"
              placeholder="homekeep-alice-a7b3c9"
              aria-invalid={!!topicError}
              {...register('ntfy_topic')}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, dashes, underscores. 4-64
              characters. Leave blank to disable all push notifications.
              Test with:{' '}
              <code className="rounded bg-muted px-1">
                curl -d &quot;hi&quot; https://ntfy.sh/your-topic
              </code>
              .
            </p>
            {topicError && (
              <p
                className="text-sm text-destructive"
                data-error-ntfy-topic
              >
                {topicError}
              </p>
            )}
          </div>

          {/*
            Phase 39 (TESTFIX-07) fallback: Controller-wrapped checkboxes
            so React (via RHF state) is the single source of truth for
            `checked`, not the uncontrolled DOM input. Removes the
            React 19 reconciliation race that snapped post-click DOM
            state back to defaultValues under CI's headless Chromium
            even with the hydration signal in place.
          */}
          <div
            className="flex items-start gap-3"
            data-field="notify-overdue"
          >
            <Controller
              name="notify_overdue"
              control={control}
              render={({ field }) => (
                <input
                  id="notify-overdue"
                  name={field.name}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={!!field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              )}
            />
            <div className="flex-1">
              <Label htmlFor="notify-overdue" className="font-normal">
                Notify me when a task becomes overdue
              </Label>
            </div>
          </div>

          <div
            className="flex items-start gap-3"
            data-field="notify-assigned"
          >
            <Controller
              name="notify_assigned"
              control={control}
              render={({ field }) => (
                <input
                  id="notify-assigned"
                  name={field.name}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={!!field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              )}
            />
            <div className="flex-1">
              <Label htmlFor="notify-assigned" className="font-normal">
                Notify me when a task is assigned to me
              </Label>
            </div>
          </div>

          <div
            className="flex items-start gap-3"
            data-field="notify-partner-completed"
          >
            <Controller
              name="notify_partner_completed"
              control={control}
              render={({ field }) => (
                <input
                  id="notify-partner-completed"
                  name={field.name}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={!!field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              )}
            />
            <div className="flex-1">
              <Label
                htmlFor="notify-partner-completed"
                className="font-normal"
              >
                Notify me when a household member completes a task
              </Label>
            </div>
          </div>

          <div
            className="flex items-start gap-3"
            data-field="notify-weekly-summary"
          >
            <Controller
              name="notify_weekly_summary"
              control={control}
              render={({ field }) => (
                <input
                  id="notify-weekly-summary"
                  name={field.name}
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={!!field.value}
                  onBlur={field.onBlur}
                  ref={field.ref}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
              )}
            />
            <div className="flex-1">
              <Label
                htmlFor="notify-weekly-summary"
                className="font-normal"
              >
                Send me a weekly summary
              </Label>
            </div>
          </div>

          {weeklyOn && (
            <div
              className="space-y-1.5 pl-7"
              data-field="weekly-summary-day"
            >
              <Label htmlFor="weekly-summary-day">Weekly summary day</Label>
              <select
                id="weekly-summary-day"
                aria-invalid={!!dayError}
                {...register('weekly_summary_day')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="sunday">Sunday</option>
                <option value="monday">Monday</option>
              </select>
              {dayError && (
                <p
                  className="text-sm text-destructive"
                  data-error-weekly-summary-day
                >
                  {dayError}
                </p>
              )}
            </div>
          )}

          {serverFormError && (
            <p
              className="text-sm text-destructive"
              role="alert"
              data-error-form
            >
              {serverFormError}
            </p>
          )}

          <SaveButton pending={pending} />
        </form>
      </CardContent>
    </Card>
  );
}

function SaveButton({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save'}
    </Button>
  );
}
