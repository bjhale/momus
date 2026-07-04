// src/capture/stabilize.ts

/** CSS that neutralizes animations/transitions to avoid mid-animation captures. */
export function disableAnimationsCss(): string {
  return `*, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }`;
}

/** CSS that hides masked selectors (dynamic content) before capture. */
export function maskCss(selectors: string[]): string {
  if (selectors.length === 0) return "";
  return `${selectors.join(", ")} { visibility: hidden !important; }`;
}
