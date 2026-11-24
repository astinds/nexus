'use client';

/**
 * Inline nav icons.
 *
 * The bottom bar used to draw ◧ ▤ ⌕ ⚙ — six different fonts' idea of a glyph,
 * at six different optical sizes. These are one set: 20px box, 1.75 stroke,
 * round caps and joins, `currentColor` so the active state is inherited.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </Base>
  );
}

export function LibraryIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H9v16H5.5A1.5 1.5 0 0 1 4 18.5z" />
      <path d="M9 4h3.5v16H9z" />
      <path d="m15.2 5.1 3.3 13.6" />
    </Base>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="m15.2 15.2 4.3 4.3" />
    </Base>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v2.2M12 18.6v2.2M4.8 7.8l1.9 1.1M17.3 15.1l1.9 1.1M4.8 16.2l1.9-1.1M17.3 8.9l1.9-1.1" />
    </Base>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Base strokeWidth={2.1} {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Base>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Base width={16} height={16} {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </Base>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Base width={16} height={16} {...props}>
      <path d="m5.5 9 6.5 6.5L18.5 9" />
    </Base>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Base width={16} height={16} {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="1.8" />
      <circle cx="10" cy="17" r="1.8" />
    </Base>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 16.5V4.8M7.8 9 12 4.8 16.2 9" />
      <path d="M4.5 15.5v2.7A1.8 1.8 0 0 0 6.3 20h11.4a1.8 1.8 0 0 0 1.8-1.8v-2.7" />
    </Base>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Base width={16} height={16} {...props}>
      <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
    </Base>
  );
}
