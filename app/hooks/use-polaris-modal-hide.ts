import { useEffect, useRef } from "react";

/**
 * Subscribe to s-modal dismiss without an `onHide` JSX prop.
 * Polaris web-component function props serialize as null during SSR and cause
 * React hydration mismatches; DOM listeners avoid that.
 */
export function usePolarisModalHide(
  modalId: string,
  onHide?: (() => void) | null,
): void {
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    const el = document.getElementById(modalId);
    if (!el) return;

    const handler = () => {
      onHideRef.current?.();
    };

    el.addEventListener("afterhide", handler);
    return () => {
      el.removeEventListener("afterhide", handler);
    };
  }, [modalId]);
}
