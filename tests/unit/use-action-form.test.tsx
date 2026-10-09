import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useActionFormSubmit } from '@/lib/use-action-form';

function Harness({ dispatch }: { dispatch: (fd: FormData) => void }) {
  const { onSubmit } = useActionFormSubmit(dispatch);
  return (
    <form onSubmit={onSubmit}>
      <input name="name" defaultValue="Wipe benches" />
      <button type="submit">Save</button>
    </form>
  );
}

describe('useActionFormSubmit', () => {
  test('dispatches the form data and leaves the fields untouched', async () => {
    const dispatch = vi.fn();
    render(<Harness dispatch={dispatch} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const fd = dispatch.mock.calls[0][0] as FormData;
    expect(fd.get('name')).toBe('Wipe benches');
    // The value survives the submit: no React form reset.
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Wipe benches');
  });
});
