// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-or-later
// HomeKeep (c) 2026 — github.com/conroyke56/homekeep

/**
 * Phase 17 Plan 17-02 Task 1 — RebalanceDialog tests.
 *
 * Covers the Dialog open → preview fetch → counts display → apply flow:
 *
 *   Test 1: Dialog closed by default (trigger visible, content absent).
 *   Test 2: Opening Dialog calls rebalancePreviewAction with homeId.
 *   Test 3: Loading state renders while preview is pending.
 *   Test 4: Preview success renders the 4 counts per D-09.
 *   Test 5: update_count=0 shows "Nothing to rebalance" + no Apply.
 *   Test 6: Preview error surfaces the formError + no Apply.
 *   Test 7: Apply success fires toast + closes Dialog + router.refresh.
 *   Test 8: Apply error fires toast.error + Dialog stays open.
 *
 * Mocking pattern mirrors tests/unit/components/task-detail-sheet-
 * schedule.test.tsx (Phase 16 Plan 01) + the window.matchMedia polyfill
 * shadcn Dialog requires in jsdom.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

// ─── Mocks ──────────────────────────────────────────────────────

const mockRouterRefresh = vi.fn();

vi.mock('@/lib/actions/rebalance', () => ({
  rebalancePreviewAction: vi.fn(),
  rebalanceApplyAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRouterRefresh,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── jsdom polyfill ──────────────────────────────────────────────

beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = (q: string): MediaQueryList =>
      ({
        matches: false,
        media: q,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList;
  }
  // Radix Dialog uses ResizeObserver + PointerEvent under the hood.
  if (typeof window !== 'undefined' && !window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // jsdom lacks hasPointerCapture / scrollIntoView — Radix uses both.
  if (typeof HTMLElement !== 'undefined') {
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
  }
});

// ─── Helpers ────────────────────────────────────────────────────

async function importMocks() {
  const actions = await import('@/lib/actions/rebalance');
  const sonner = await import('sonner');
  return {
    previewMock: vi.mocked(actions.rebalancePreviewAction),
    applyMock: vi.mocked(actions.rebalanceApplyAction),
    toastSuccess: vi.mocked(sonner.toast.success),
    toastError: vi.mocked(sonner.toast.error),
  };
}

async function renderDialog() {
  const { RebalanceDialog } = await import('@/components/rebalance-dialog');
  return render(<RebalanceDialog homeId="home-17" />);
}

// Radix portals DialogContent to document.body; we can't clean up via
// React tree unmount alone — explicit cleanup() between tests.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockRouterRefresh.mockClear();
});

describe('RebalanceDialog (Phase 17 Plan 17-02, REBAL-05/06)', () => {
  test('Test 1 — Dialog is closed by default (trigger visible, content absent)', async () => {
    const { previewMock } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 0,
        preserve_anchored: 0,
        preserve_override: 0,
        preserve_from_now_on: 0,
        preserve_total: 0,
      },
    });

    await renderDialog();

    // Trigger button is present.
    expect(screen.getByTestId('rebalance-trigger')).toBeTruthy();
    // DialogContent is NOT in the DOM until the Dialog opens.
    expect(
      document.body.querySelector('[data-testid="rebalance-dialog"]'),
    ).toBeNull();
    // Preview was not fetched.
    expect(previewMock).not.toHaveBeenCalled();
  });

  test('Test 2 — Clicking trigger opens Dialog and calls rebalancePreviewAction with homeId', async () => {
    const { previewMock } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 5,
        preserve_anchored: 3,
        preserve_override: 2,
        preserve_from_now_on: 1,
        preserve_total: 6,
      },
    });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-dialog"]'),
      ).toBeTruthy();
    });

    await waitFor(() => {
      expect(previewMock).toHaveBeenCalledWith('home-17');
    });
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  test('Test 3 — While preview is pending, a loading state is rendered', async () => {
    const { previewMock } = await importMocks();
    // Never resolves — preview stays pending.
    let resolvePreview: (v: {
      ok: true;
      preview: RebalancePreviewShape;
    }) => void = () => {};
    previewMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve as typeof resolvePreview;
        }),
    );

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-loading"]'),
      ).toBeTruthy();
    });

    // Clean up the dangling promise so afterEach cleanup doesn't warn.
    resolvePreview({
      ok: true,
      preview: {
        update_count: 0,
        preserve_anchored: 0,
        preserve_override: 0,
        preserve_from_now_on: 0,
        preserve_total: 0,
      },
    });
  });

  test('Test 4 — Preview success renders the 4 counts per D-09 template', async () => {
    const { previewMock } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 5,
        preserve_anchored: 3,
        preserve_override: 2,
        preserve_from_now_on: 1,
        preserve_total: 6,
      },
    });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-counts"]'),
      ).toBeTruthy();
    });

    const counts = document.body.querySelector(
      '[data-testid="rebalance-counts"]',
    );
    const text = counts!.textContent ?? '';

    // Per D-09 flexibility: assert on the 4 numeric values' presence,
    // not the exact sentence. Numbers MUST all appear in the rendered
    // copy.
    expect(text).toMatch(/Will update:\s*5/);
    expect(text).toMatch(/Will preserve:\s*6/);
    expect(text).toMatch(/3 anchored/);
    expect(text).toMatch(/2 active snoozes/);
    expect(text).toMatch(/1 from-now-on/);

    // Apply button visible (update_count > 0).
    expect(
      document.body.querySelector('[data-testid="rebalance-apply"]'),
    ).toBeTruthy();
  });

  test('Test 5 — update_count === 0 shows "Nothing to rebalance" copy + no Apply button', async () => {
    const { previewMock } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 0,
        preserve_anchored: 2,
        preserve_override: 0,
        preserve_from_now_on: 0,
        preserve_total: 2,
      },
    });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-empty"]'),
      ).toBeTruthy();
    });

    const empty = document.body.querySelector(
      '[data-testid="rebalance-empty"]',
    );
    expect(empty!.textContent).toMatch(/Nothing to rebalance/i);

    // Apply button ABSENT.
    expect(
      document.body.querySelector('[data-testid="rebalance-apply"]'),
    ).toBeNull();

    // Cancel button label is "Close" in the empty state.
    const cancel = document.body.querySelector(
      '[data-testid="rebalance-cancel"]',
    );
    expect(cancel!.textContent).toMatch(/close/i);
  });

  test('Test 6 — Preview error surfaces formError + no Apply button', async () => {
    const { previewMock } = await importMocks();
    previewMock.mockResolvedValue({
      ok: false,
      formError: 'Could not build rebalance preview',
    });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-error"]'),
      ).toBeTruthy();
    });

    const errEl = document.body.querySelector(
      '[data-testid="rebalance-error"]',
    );
    expect(errEl!.textContent).toMatch(/Could not build rebalance preview/);

    // Apply button ABSENT (preview never resolved successfully).
    expect(
      document.body.querySelector('[data-testid="rebalance-apply"]'),
    ).toBeNull();
  });

  test('Test 7 — Apply success fires toast + closes Dialog + calls router.refresh', async () => {
    const { previewMock, applyMock, toastSuccess } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 5,
        preserve_anchored: 3,
        preserve_override: 2,
        preserve_from_now_on: 1,
        preserve_total: 6,
      },
    });
    applyMock.mockResolvedValue({ ok: true, updated: 5 });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-apply"]'),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        document.body.querySelector(
          '[data-testid="rebalance-apply"]',
        ) as HTMLElement,
      );
    });

    await waitFor(() => {
      expect(applyMock).toHaveBeenCalledWith('home-17');
    });

    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Rebalanced 5 tasks');
    });

    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    });

    // Dialog closes — DialogContent removed from portaled body.
    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-dialog"]'),
      ).toBeNull();
    });
  });

  test('Test 8 — Apply error fires toast.error + Dialog stays open', async () => {
    const { previewMock, applyMock, toastError } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 5,
        preserve_anchored: 3,
        preserve_override: 2,
        preserve_from_now_on: 1,
        preserve_total: 6,
      },
    });
    applyMock.mockResolvedValue({
      ok: false,
      formError: 'Could not apply rebalance',
    });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-apply"]'),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        document.body.querySelector(
          '[data-testid="rebalance-apply"]',
        ) as HTMLElement,
      );
    });

    await waitFor(() => {
      expect(applyMock).toHaveBeenCalledWith('home-17');
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not apply rebalance');
    });

    // Dialog STAYS OPEN — user can retry or cancel.
    expect(
      document.body.querySelector('[data-testid="rebalance-dialog"]'),
    ).toBeTruthy();

    // router.refresh was NOT called (error path).
    expect(mockRouterRefresh).not.toHaveBeenCalled();
  });

  test('Test 9 — Singular task pluralization ("Rebalanced 1 task")', async () => {
    const { previewMock, applyMock, toastSuccess } = await importMocks();
    previewMock.mockResolvedValue({
      ok: true,
      preview: {
        update_count: 1,
        preserve_anchored: 0,
        preserve_override: 0,
        preserve_from_now_on: 0,
        preserve_total: 0,
      },
    });
    applyMock.mockResolvedValue({ ok: true, updated: 1 });

    await renderDialog();

    await act(async () => {
      fireEvent.click(screen.getByTestId('rebalance-trigger'));
    });

    await waitFor(() => {
      expect(
        document.body.querySelector('[data-testid="rebalance-apply"]'),
      ).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(
        document.body.querySelector(
          '[data-testid="rebalance-apply"]',
        ) as HTMLElement,
      );
    });

    await waitFor(() => {
      // Singular "task", not "tasks".
      expect(toastSuccess).toHaveBeenCalledWith('Rebalanced 1 task');
    });
  });
});

// Local shape alias — matches lib/actions/rebalance RebalancePreview but
// kept local so the test file doesn't import the action module (mocked).
type RebalancePreviewShape = {
  update_count: number;
  preserve_anchored: number;
  preserve_override: number;
  preserve_from_now_on: number;
  preserve_total: number;
};
