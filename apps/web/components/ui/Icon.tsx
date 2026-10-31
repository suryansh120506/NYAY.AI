import type { SVGProps } from "react";

const PATHS = {
  "arrow-up": "M12 19V5m0 0-6 6m6-6 6 6",
  "arrow-down": "M12 5v14m0 0 6-6m-6 6-6-6",
  paperclip:
    "m20.5 11.5-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.33 3.33 0 0 1 4.7 4.7l-8.6 8.6a1.67 1.67 0 0 1-2.36-2.36l7.9-7.9",
  check: "M5 12.5 10 17.5 19 7",
  "chevron-left": "M15 5 8 12l7 7",
  "chevron-right": "m9 5 7 7-7 7",
  "chevron-down": "m5 9 7 7 7-7",
  close: "M6 6l12 12M18 6 6 18",
  camera:
    "M4 8.5A1.5 1.5 0 0 1 5.5 7h2.1l1.4-2h6l1.4 2h2.1A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-9ZM12 16a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z",
  document:
    "M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7l-4-4Zm0 0v4h4M9 12h6M9 16h6",
  upload: "M12 16V4m0 0-5 5m5-5 5 5M5 20h14",
  warning:
    "M12 9v4m0 3.5h.01M10.3 4.2 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z",
  clock: "M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  wallet:
    "M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3M4 7.5V17a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 7.5ZM16.5 13.5h.01",
  star: "m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z",
  seal: "M12 2.75 14.2 4.4l2.73-.2.85 2.6 2.3 1.5-.85 2.6.85 2.6-2.3 1.5-.85 2.6-2.73-.2L12 19.05l-2.2-1.65-2.73.2-.85-2.6-2.3-1.5.85-2.6-.85-2.6 2.3-1.5.85-2.6 2.73.2L12 2.75ZM8.75 11l2.25 2.25 4.25-4.5",
  info: "M12 16v-4.5m0-3h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  phone:
    "M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z",
  "external-link":
    "M14 4h6v6m0-6-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11Z",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm0 0v4m-6-7a6 6 0 0 0 12 0",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  filled?: boolean;
}

/** Decorative by default (aria-hidden). Give the control around it an accessible name. */
export function Icon({ name, size = 20, filled = false, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
