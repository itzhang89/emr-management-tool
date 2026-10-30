import type { SVGProps } from "react";

/** Minimal outline update icon: green circle with an open upward arrow. */
export function UpdateAvailableIcon({
  className,
  ...props
}: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className={className}
      {...props}
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="#16C765"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 16V8M8.5 11.5 12 8l3.5 3.5"
        stroke="#16C765"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
