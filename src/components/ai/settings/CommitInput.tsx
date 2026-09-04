import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A text field that saves what it holds when focus leaves it or Enter is pressed,
 * rather than waiting for a Save button.
 *
 * Escape reverts to the stored value, which is the only way out of a half-typed
 * edit once there is no Cancel. A commit that the backend rejects also reverts,
 * so the field never keeps showing a value that was not stored.
 */
export function CommitInput({
  value,
  onCommit,
  className,
  ...rest
}: {
  value: string;
  /** Rejecting (throwing) reverts the field to `value`. */
  onCommit: (next: string) => Promise<unknown>;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "onKeyDown">) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const committing = useRef(false);
  const reverted = useRef(false);

  // Follow the stored value while the field is idle, so a change made elsewhere
  // (a duplicate, a protocol switch filling in the address) shows up here.
  useEffect(() => {
    if (!committing.current) setDraft(value);
  }, [value]);

  const commit = async () => {
    // Escape blurs the field to get out of the edit, and that blur must not then
    // save what Escape just discarded.
    if (reverted.current) {
      reverted.current = false;
      return;
    }
    const next = draft.trim();
    if (next === value.trim()) {
      setDraft(value);
      return;
    }
    committing.current = true;
    setSaving(true);
    try {
      await onCommit(next);
    } catch (error) {
      setDraft(value);
      toast.error(error instanceof Error && error.message ? error.message : "Failed to save");
    } finally {
      setSaving(false);
      committing.current = false;
    }
  };

  return (
    <Input
      {...rest}
      value={draft}
      disabled={rest.disabled || saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          reverted.current = true;
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      className={cn(saving && "opacity-70", className)}
    />
  );
}
