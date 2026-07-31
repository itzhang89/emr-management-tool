import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";

export function EditableAccountName({
  name,
  disabled,
  onRename
}: {
  name: string;
  disabled?: boolean;
  onRename: (nextName: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurSubmit = useRef(false);

  useEffect(() => {
    if (!editing) {
      setValue(name);
    }
  }, [editing, name]);

  useEffect(() => {
    if (!editing) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [editing]);

  const cancel = () => {
    skipBlurSubmit.current = true;
    setEditing(false);
    setValue(name);
  };

  const commit = async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === name) {
      setEditing(false);
      setValue(name);
      return;
    }
    await onRename(trimmed);
    setEditing(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      skipBlurSubmit.current = true;
      void commit();
    }
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        aria-label="Rename account"
        className="h-8 max-w-xs font-medium"
        value={value}
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (skipBlurSubmit.current) {
            skipBlurSubmit.current = false;
            return;
          }
          void commit();
        }}
        onKeyDown={onKeyDown}
      />
    );
  }

  return (
    <button
      type="button"
      className="truncate rounded-sm px-0.5 text-left font-medium hover:bg-accent"
      title="Double-click to rename"
      onDoubleClick={() => {
        if (disabled) return;
        skipBlurSubmit.current = false;
        setEditing(true);
      }}
    >
      {name}
    </button>
  );
}
