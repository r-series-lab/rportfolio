import { useRef, type PointerEvent as ReactPointerEvent } from "react";

type DragScrollHandlers = {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
};

export function useDragScroll(): DragScrollHandlers {
  const state = useRef({
    active: false,
    pointerId: -1,
    startX: 0,
    scrollLeft: 0,
  });

  const stop = (event: ReactPointerEvent<HTMLElement>) => {
    const current = state.current;
    if (!current.active || current.pointerId !== event.pointerId) {
      return;
    }
    current.active = false;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Synthetic pointer events used by tests may not have an active pointer to release.
    }
    event.currentTarget.classList.remove("is-dragging");
  };

  return {
    onPointerDown(event) {
      if (event.button !== 0 || event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) {
        return;
      }
      state.current = {
        active: true,
        pointerId: event.pointerId,
        startX: event.clientX,
        scrollLeft: event.currentTarget.scrollLeft,
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer events used by tests may not have an active pointer to capture.
      }
      event.currentTarget.classList.add("is-dragging");
    },
    onPointerLeave: stop,
    onPointerMove(event) {
      const current = state.current;
      if (!current.active || current.pointerId !== event.pointerId) {
        return;
      }
      event.preventDefault();
      event.currentTarget.scrollLeft = current.scrollLeft - (event.clientX - current.startX);
    },
    onPointerUp: stop,
  };
}
