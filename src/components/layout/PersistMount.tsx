import { useEffect, useState } from "react";

/**
 * Flips `mounted` to true the first time `visible` is true and never flips
 * back, so children mount lazily (no work until the view is first opened) and
 * then keep their React state — editor text, result tabs, tree selection, an
 * open find bar — while the user moves between views that stay in the DOM.
 *
 * The wrapper is also the layout box the child fills: a `hidden` sibling (a
 * force-mounted tab, say) needs its child to re-apply `flex` when it becomes
 * visible again, so callers pass a className that does exactly that.
 */
export function PersistMount({
  visible,
  className,
  children
}: {
  visible: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  if (!mounted) return null;
  return <div className={className}>{children}</div>;
}
