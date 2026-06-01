/**
 * InspectFlow SourceMapper
 *
 * Drop this file anywhere in your React / Next.js project and wrap the
 * components you want to track with the <SourceMapped> component (or use
 * the `withSourceMap` higher-order component).
 *
 * The helper adds `data-source-file` to the root DOM element of every wrapped
 * component. InspectFlow's Chrome extension reads this attribute when the
 * developer selects an element in DevTools and associates CSS changes with
 * the correct source file.
 *
 * Usage:
 *
 *   import { SourceMapped } from "@/helpers/SourceMapper";
 *
 *   export function Card() {
 *     return (
 *       <SourceMapped file="src/components/Card.tsx">
 *         <div className="p-4 rounded-lg bg-white">…</div>
 *       </SourceMapped>
 *     );
 *   }
 *
 * Or use the HOC to avoid wrapping every JSX tree:
 *
 *   export const Card = withSourceMap("src/components/Card.tsx", function Card() {
 *     return <div className="p-4 rounded-lg bg-white">…</div>;
 *   });
 *
 * Production builds:
 *   Set the NEXT_PUBLIC_INSPECTFLOW (or REACT_APP_INSPECTFLOW) env variable to
 *   "true" during development. The helper becomes a no-op when the variable is
 *   absent or "false", so production bundles carry zero overhead.
 */

import React from "react";

/** Returns true when InspectFlow instrumentation is active. */
const isActive =
  typeof process !== "undefined" &&
  (process.env["NEXT_PUBLIC_INSPECTFLOW"] === "true" ||
    process.env["REACT_APP_INSPECTFLOW"] === "true");

// ---------------------------------------------------------------------------
// <SourceMapped> component
// ---------------------------------------------------------------------------

interface SourceMappedProps {
  /** Relative path to the source file that owns the wrapped component. */
  file: string;
  children: React.ReactElement;
}

/**
 * Wraps a single JSX element and stamps it with `data-source-file`.
 * The wrapped element must accept a `data-*` prop (i.e. it must render a DOM
 * element, not another React component). Use the HOC variant for class/function
 * components whose root you do not own.
 *
 * In production (NEXT_PUBLIC_INSPECTFLOW !== "true") this renders `children`
 * unmodified with zero overhead.
 */
export function SourceMapped({ file, children }: SourceMappedProps): React.ReactElement {
  if (!isActive) return children;
  return React.cloneElement(children, { "data-source-file": file });
}

// ---------------------------------------------------------------------------
// withSourceMap HOC
// ---------------------------------------------------------------------------

/**
 * Higher-order component that stamps `data-source-file` onto the outermost DOM
 * element returned by `WrappedComponent`.
 *
 * Unlike `<SourceMapped>`, this works even when you cannot modify the JSX
 * return value directly — the HOC intercepts the render output.
 *
 * Example:
 *
 *   const Button = withSourceMap("src/components/Button.tsx", function Button(props) {
 *     return <button {...props} />;
 *   });
 */
export function withSourceMap<P extends object>(
  file: string,
  WrappedComponent: React.ComponentType<P>,
): React.FC<P> {
  if (!isActive) return WrappedComponent as React.FC<P>;

  const displayName =
    WrappedComponent.displayName ?? WrappedComponent.name ?? "Component";

  const WithSourceMap: React.FC<P> = (props) => {
    const element = React.createElement(WrappedComponent, props);
    if (!React.isValidElement(element)) return element;
    return React.cloneElement(element as React.ReactElement, {
      "data-source-file": file,
    });
  };

  WithSourceMap.displayName = `SourceMapped(${displayName})`;
  return WithSourceMap;
}

// ---------------------------------------------------------------------------
// useSourceFile hook  (alternative for function components)
// ---------------------------------------------------------------------------

/**
 * Returns a `ref` callback that stamps the `data-source-file` attribute
 * directly on the DOM node. Use this when `cloneElement` is not suitable
 * (e.g. inside `forwardRef` components).
 *
 * Example:
 *
 *   const Card = React.forwardRef<HTMLDivElement, CardProps>((props, forwardedRef) => {
 *     const sourceRef = useSourceFile("src/components/Card.tsx");
 *     return (
 *       <div
 *         {...props}
 *         ref={(el) => {
 *           sourceRef(el);
 *           if (typeof forwardedRef === "function") forwardedRef(el);
 *           else if (forwardedRef) forwardedRef.current = el;
 *         }}
 *       />
 *     );
 *   });
 */
export function useSourceFile(file: string): (el: Element | null) => void {
  return React.useCallback(
    (el: Element | null) => {
      if (!isActive || !el) return;
      el.setAttribute("data-source-file", file);
    },
    [file],
  );
}
