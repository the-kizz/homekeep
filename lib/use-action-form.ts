'use client';

import { useCallback, useTransition, type FormEvent } from 'react';

/**
 * Submit a form to a `useActionState` dispatcher without React 19's
 * automatic form reset.
 *
 * React resets every uncontrolled field of a `<form action={fn}>` once the
 * action settles. Our edit forms (task, home, area, notification prefs) use
 * react-hook-form's uncontrolled `register`, so after "Save" the fields went
 * blank and the user was asked for a name again. Dispatching the same action
 * from a submit handler inside a transition keeps the values on screen.
 */
export function useActionFormSubmit(dispatch: (formData: FormData) => void) {
  const [pending, startTransition] = useTransition();
  const onSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => dispatch(formData));
    },
    [dispatch],
  );
  return { onSubmit, pending };
}
