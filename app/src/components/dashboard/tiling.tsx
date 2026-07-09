"use client";

// Shared tiling primitives: lanes (horizontal) of panes (vertical stacks), each
// draggable to reorder/restack and resizable. Used by the project board and the
// chat workspace so both tile identically.

import { useState } from "react";

export type LaneLayout = string[][];

// --- persistence -------------------------------------------------------------

export function loadSizeMap(key: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function persist(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota/availability errors */
  }
}

// --- pure layout ops ---------------------------------------------------------

export function locate(lanes: LaneLayout, id: string): [number, number] {
  for (let i = 0; i < lanes.length; i += 1) {
    const j = lanes[i].indexOf(id);
    if (j >= 0) return [i, j];
  }
  return [-1, -1];
}

// Move an existing pane to (toLane, toIndex), collapsing any lane it empties.
export function moveInLayout(lanes: LaneLayout, id: string, toLane: number, toIndex: number): LaneLayout {
  const copy = lanes.map((lane) => [...lane]);
  const [fromLane, fromIdx] = locate(copy, id);
  if (fromLane < 0) return lanes;
  copy[fromLane].splice(fromIdx, 1);
  let idx = toIndex;
  if (fromLane === toLane && fromIdx < toIndex) idx -= 1;
  copy[toLane].splice(idx, 0, id);
  return copy.filter((lane) => lane.length);
}

// Move an existing pane into a brand-new lane at laneIndex.
export function moveToNewLane(lanes: LaneLayout, id: string, laneIndex: number): LaneLayout {
  const copy = lanes.map((lane) => [...lane]);
  const [fromLane, fromIdx] = locate(copy, id);
  if (fromLane < 0) return lanes;
  copy[fromLane].splice(fromIdx, 1);
  copy.splice(laneIndex, 0, [id]);
  return copy.filter((lane) => lane.length);
}

// Insert a pane that isn't in the layout yet (e.g. dropped from a list).
export function insertInLane(lanes: LaneLayout, id: string, toLane: number, toIndex: number): LaneLayout {
  const copy = lanes.map((lane) => [...lane]);
  if (toLane < 0 || toLane >= copy.length) return [...copy, [id]];
  copy[toLane].splice(toIndex, 0, id);
  return copy;
}

export function insertAsNewLane(lanes: LaneLayout, id: string, laneIndex: number): LaneLayout {
  const copy = lanes.map((lane) => [...lane]);
  copy.splice(laneIndex, 0, [id]);
  return copy;
}

export function removeFromLayout(lanes: LaneLayout, id: string): LaneLayout {
  return lanes.map((lane) => lane.filter((paneId) => paneId !== id)).filter((lane) => lane.length);
}

// --- drop / resize components ------------------------------------------------

// Drop slot between/around panes inside a lane (reorder / restack).
export function PaneDrop({ onDrop, trailing }: { onDrop: () => void; trailing?: boolean }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`shrink-0 rounded ${trailing ? "min-h-3 flex-1" : "h-3"} ${over ? "bg-[var(--ctp-blue)]/60" : "bg-[var(--ctp-surface0)]/40"}`}
    />
  );
}

// Drop slot between/around lanes (move pane into its own new lane).
export function LaneGap({ onDrop }: { onDrop: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`h-full w-2 shrink-0 self-stretch rounded ${over ? "bg-[var(--ctp-blue)]/60" : "bg-[var(--ctp-surface0)]/40"}`}
    />
  );
}

// Pointer-driven resize reporting the new absolute size. For axis y it measures
// the previous sibling (pane wrapper). For axis x it can't measure (lanes grow
// to fill, so rendered width != basis), so the caller supplies the start basis
// via getStart.
export function ResizeHandle({ axis, getStart, onResize }: { axis: "x" | "y"; getStart?: () => number; onResize: (value: number) => void }) {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startPos = axis === "x" ? event.clientX : event.clientY;
    let start: number;
    if (getStart) {
      start = getStart();
    } else {
      const prev = event.currentTarget.previousElementSibling as HTMLElement | null;
      if (!prev) return;
      const rect = prev.getBoundingClientRect();
      start = axis === "x" ? rect.width : rect.height;
    }
    const move = (moveEvent: PointerEvent) => onResize(start + ((axis === "x" ? moveEvent.clientX : moveEvent.clientY) - startPos));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={onPointerDown}
      className={
        axis === "x"
          ? "w-1 shrink-0 cursor-col-resize self-stretch rounded bg-[var(--ctp-surface0)]/40 hover:bg-[var(--ctp-blue)]"
          : "h-1 shrink-0 cursor-row-resize rounded bg-[var(--ctp-surface0)]/40 hover:bg-[var(--ctp-blue)]"
      }
    />
  );
}
