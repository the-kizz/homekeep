// @vitest-environment jsdom
/**
 * OnboardingWizard: seeds default to real (or to-be-created) areas, the
 * hemisphere note reflects the home timezone, and submit sends the
 * server-authoritative payload then lands on the dashboard with ?welcome=1.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { SEED_LIBRARY } from '@/lib/seed-library';

const push = vi.fn();
const batch = vi.fn();
const toastSuccess = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: () => {} }),
}));
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: () => {} },
}));
vi.mock('@/lib/actions/seed', () => ({
  batchCreateSeedTasks: (...args: unknown[]) => batch(...args),
}));
vi.mock('@/lib/actions/onboarding', () => ({
  skipOnboarding: async () => ({ ok: true }),
}));

const HOME = { id: 'home1234567890x', name: 'Test Home', timezone: 'Australia/Perth' };
const WHOLE = { id: 'wholehome12345x', name: 'Whole Home', is_whole_home_system: true };
const KITCHEN = { id: 'kitchen1234567x', name: 'Kitchen', is_whole_home_system: false };

beforeEach(() => {
  push.mockReset();
  batch.mockReset();
  toastSuccess.mockReset();
});
afterEach(() => cleanup());

describe('OnboardingWizard', () => {
  test('southern timezone → southern-hemisphere note', () => {
    render(<OnboardingWizard home={HOME} areas={[WHOLE]} seeds={SEED_LIBRARY} />);
    expect(
      screen.getByText(/southern-hemisphere seasons based on your home's timezone \(Australia\/Perth\)/),
    ).toBeTruthy();
  });

  test('northern timezone → northern-hemisphere note', () => {
    render(
      <OnboardingWizard
        home={{ ...HOME, timezone: 'Europe/London' }}
        areas={[WHOLE]}
        seeds={SEED_LIBRARY}
      />,
    );
    expect(screen.getByText(/northern-hemisphere seasons/)).toBeTruthy();
  });

  test('seeds default to an existing same-named area, else a to-be-created one', () => {
    const { container } = render(
      <OnboardingWizard home={HOME} areas={[WHOLE, KITCHEN]} seeds={SEED_LIBRARY} />,
    );
    const benches = container.querySelector('[data-seed-id="seed-wipe-benches"]')!;
    expect(benches.getAttribute('data-seed-area')).toBe(`existing:${KITCHEN.id}`);
    const toilet = container.querySelector('[data-seed-id="seed-clean-toilet"]')!;
    expect(toilet.getAttribute('data-seed-area')).toBe('suggested:bathroom');
    expect(toilet.textContent).toContain('in Bathroom (new)');
    const rcd = container.querySelector('[data-seed-id="seed-test-rcd"]')!;
    expect(rcd.getAttribute('data-seed-area')).toBe(`existing:${WHOLE.id}`);
  });

  test('area select lists existing areas plus missing suggested areas', () => {
    const { container } = render(
      <OnboardingWizard home={HOME} areas={[WHOLE, KITCHEN]} seeds={SEED_LIBRARY} />,
    );
    const card = container.querySelector('[data-seed-id="seed-clean-toilet"]')!;
    fireEvent.click(card.querySelector('[data-seed-edit]')!);
    const options = Array.from(
      card.querySelectorAll('[data-seed-area-select] option'),
    ).map((o) => o.textContent);
    expect(options).toEqual([
      'Whole Home',
      'Kitchen',
      'Bathroom (will be created)',
      'Living areas (will be created)',
      'Yard (will be created)',
    ]);
  });

  test('offers no link away from the wizard, so edits cannot be lost', () => {
    const { container } = render(
      <OnboardingWizard home={HOME} areas={[WHOLE]} seeds={SEED_LIBRARY} />,
    );
    expect(container.querySelector('[data-invite-nudge]')).toBeNull();
    expect(container.querySelector('a[href$="/settings"]')).toBeNull();
    const submit = container.querySelector('[data-submit-seeds]') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
  });

  test('submit sends area choices and routes to ?welcome=1 with an area-count toast', async () => {
    batch.mockResolvedValue({ ok: true, count: SEED_LIBRARY.length, areasCreated: 3 });
    const { container } = render(
      <OnboardingWizard home={HOME} areas={[WHOLE, KITCHEN]} seeds={SEED_LIBRARY} />,
    );
    fireEvent.click(container.querySelector('[data-submit-seeds]')!);
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/h/${HOME.id}?welcome=1`));

    const arg = batch.mock.calls[0][0] as {
      home_id: string;
      selections: Array<{ seed_id: string; area: unknown }>;
    };
    expect(arg.home_id).toBe(HOME.id);
    expect(arg.selections).toHaveLength(SEED_LIBRARY.length);
    const yard = arg.selections.find((s) => s.seed_id === 'seed-mow-lawn')!;
    expect(yard.area).toEqual({ kind: 'suggested', key: 'yard' });
    for (const s of arg.selections) expect(s).not.toHaveProperty('area_id');
    // Whole Home + Kitchen (existing) + 3 created.
    expect(toastSuccess).toHaveBeenCalledWith(
      `${SEED_LIBRARY.length} tasks added across 5 areas — welcome in.`,
    );
  });
});
