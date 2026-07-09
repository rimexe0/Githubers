"use client";

import { useState } from "react";
import { ResizeHandle } from "../tiling";
import { RunPane } from "./RunPane";
import type { RunView } from "./store";

// Desktop layout for the run roster. Default: an auto-flowing grid, already
// attention-sorted by the store (needs-human first, then active, then idle).
// Focus mode promotes one run to a large live pane with the rest as a
// resizable thumbnail strip below — the "expand" affordance from #3.
export function RunGrid({ runs, focusId, onFocus }: { runs: RunView[]; focusId: string | null; onFocus: (id: string | null) => void }) {
  const [bigHeight, setBigHeight] = useState(420);
  const focused = focusId ? runs.find((run) => run.id === focusId) ?? null : null;

  if (!focused) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2 pb-1" style={{ gridAutoRows: "190px" }}>
          {runs.map((run) => (
            <RunPane key={run.id} run={run} expanded={false} onToggleExpand={() => onFocus(run.id)} />
          ))}
        </div>
      </div>
    );
  }

  const others = runs.filter((run) => run.id !== focused.id);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {/* Fixed-height so the ResizeHandle (which grows its previous sibling)
          drags this pane against the flexing strip below in the natural sense. */}
      <div className="min-h-0 shrink-0" style={others.length ? { height: bigHeight } : { flex: "1 1 0" }}>
        <RunPane run={focused} expanded onToggleExpand={() => onFocus(null)} />
      </div>
      {others.length > 0 && (
        <>
          <ResizeHandle axis="y" onResize={(value) => setBigHeight(Math.max(200, value))} />
          <div className="min-h-0 flex-1 overflow-x-auto">
            <div className="flex h-full gap-2 pb-1">
              {others.map((run) => (
                <div key={run.id} className="h-full w-[240px] shrink-0">
                  <RunPane run={run} expanded={false} onToggleExpand={() => onFocus(run.id)} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
