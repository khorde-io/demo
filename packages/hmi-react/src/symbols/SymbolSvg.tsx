import type { ReactNode } from "react";

/** Draws symbols outside a diagram: an `<svg>` whose origin is its centre. */
export function SymbolSvg({ width, height, children, className }: { width: number; height: number; children: ReactNode; className?: string }) {
  return (
    <svg className={`kh-symbol-svg${className ? ` ${className}` : ""}`} width={width} height={height} viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`}>
      {children}
    </svg>
  );
}
