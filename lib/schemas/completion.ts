import { z } from 'zod';

/**
 * Completion schema (03-01 Plan, D-01 + D-10 + Pitfall 13).
 *
 * Shared client + server. `via` defaults to 'tap' so one-tap completions
 * don't need to pass it explicitly; 'manual-date' is reserved for a
 * future "back-date" UX.
 *
 * Security posture (threat_model T-03-01-02): completed_by_id is NEVER
 * accepted from client formData in the server action — it's always set
 * server-side from pb.authStore.record.id. The PB createRule additionally
 * enforces `@request.body.completed_by_id = @request.auth.id` as defense
 * in depth.
 */
export const viaEnum = z.enum(['tap', 'manual-date']);

export const completionSchema = z.object({
  task_id: z.string().min(1, 'task_id is required'),
  completed_by_id: z.string().min(1, 'completed_by_id is required'),
  completed_at: z.string().min(1, 'completed_at is required'), // ISO 8601 UTC
  notes: z.string().max(2000, 'Notes too long').optional().or(z.literal('')),
  via: viaEnum.default('tap'),
});

export type CompletionInput = z.infer<typeof completionSchema>;
export type ForceCompletionInput = { taskId: string; force?: boolean };
