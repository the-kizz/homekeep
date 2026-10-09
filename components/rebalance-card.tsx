import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { RebalanceDialog } from '@/components/rebalance-dialog';

/**
 * Phase 17 Plan 17-02 Rebalance card (REBAL-05).
 *
 * Server-renders the descriptive copy; RebalanceDialog is the Client
 * Component island that handles open state + preview fetch + apply
 * flow + toast.
 *
 * Copy explains which tasks are preserved (anchored / active snooze /
 * from-now-on) per REBAL-06 + D-08. User reads BEFORE clicking the
 * button, setting expectations for the preview modal that follows.
 *
 * Why a separate card file (vs. inlining the Dialog trigger in the
 * Scheduling page):
 *   - Keeps the page a pure route shell that's easy to extend with
 *     future scheduling sections (auto-rebalance triggers, default
 *     tolerance, etc. — v1.2+).
 *   - The descriptive copy is card-surface content, not page-surface
 *     content — belongs in the card component.
 */
export function RebalanceCard({ homeId }: { homeId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rebalance schedule</CardTitle>
        <CardDescription>
          Evenly redistribute your cycle-mode tasks across the next few
          months. We&apos;ll keep: anchored tasks (like fixed-date
          services), tasks with an active snooze, and tasks you&apos;ve
          manually shifted with &ldquo;From now on.&rdquo; Everything else
          gets re-placed using the current household load.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RebalanceDialog homeId={homeId} />
      </CardContent>
    </Card>
  );
}
