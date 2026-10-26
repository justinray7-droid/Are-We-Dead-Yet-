"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";

export type ActionState = { errors: Record<string, string>; done?: boolean } | null;
type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Form for a server action that keeps what was typed when the action returns
 * errors (React resets forms submitted through the action prop), and clears
 * itself once the action reports done.
 */
export function ActionForm({
  action,
  children,
  buttons,
  className = "stack",
}: {
  action: Action;
  children: React.ReactNode;
  /** Submit buttons; give several a name/value to tell them apart. */
  buttons: { label: string; name?: string; value?: string; secondary?: boolean }[];
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.done) ref.current?.reset();
  }, [state]);

  const errors = state ? Object.values(state.errors) : [];
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => formAction(data));
      }}
    >
      {children}
      {errors.length > 0 && (
        <ul className="errors" role="alert">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {state?.done && errors.length === 0 && (
        <p className="ok" role="status">
          Saved.
        </p>
      )}
      <div className="row">
        {buttons.map((b) => (
          <button
            key={b.label}
            type="submit"
            name={b.name}
            value={b.value}
            disabled={pending}
            className={b.secondary ? "secondary" : undefined}
          >
            {b.label}
          </button>
        ))}
      </div>
    </form>
  );
}
