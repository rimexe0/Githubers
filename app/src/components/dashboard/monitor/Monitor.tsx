"use client";

import { useEffect, useState } from "react";
import type { Settings } from "../types";
import { MonitorMobileList } from "./MonitorMobileList";
import { MonitorProvider, useMonitorSnapshot } from "./MonitorProvider";
import { PermissionToasts } from "./PermissionToasts";
import { RunGrid } from "./RunGrid";
import { StatusBar } from "./StatusBar";

// Live multi-agent monitoring over the multiplexed WS channel (issue #3). Grid
// of run panes on desktop, status-first list on phones; both read one store fed
// by the HTTP roster + live WS overlay.
export function Monitor({ settings }: { settings: Settings }) {
  if (!settings.automatorEnabled) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
        <div className="max-w-md space-y-2">
          <p className="font-semibold text-foreground">AgentAutomator is not enabled.</p>
          <p>
            Turn it on in <span className="font-semibold">Settings → Agent automator</span> and set the daemon <span className="font-semibold">WS URL</span> (its
            Tailscale <span className="font-mono">ts.net</span> name, <span className="font-mono">wss://…</span>) to watch runs live.
          </p>
        </div>
      </div>
    );
  }

  return (
    <MonitorProvider wsUrl={settings.automatorWsUrl} token={settings.automatorToken}>
      <MonitorInner hasWsUrl={Boolean(settings.automatorWsUrl)} />
    </MonitorProvider>
  );
}

function MonitorInner({ hasWsUrl }: { hasWsUrl: boolean }) {
  const { runs } = useMonitorSnapshot();
  const isDesktop = useIsDesktop();
  const [focusId, setFocusId] = useState<string | null>(null);

  // Jump-to-pane from a permission toast: focus that run so its terminal opens.
  const expandRun = (runId?: string) => {
    if (runId) setFocusId(runId);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <StatusBar />
      {!hasWsUrl && (
        <div className="shrink-0 rounded-md bg-[var(--ctp-yellow)]/10 px-2 py-1 text-[0.7rem] text-[var(--ctp-yellow)]">
          No WS URL set — showing the run roster from polling only. Add the daemon WS URL in Settings for live output, terminals, and permission prompts.
        </div>
      )}
      {runs.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-center text-xs text-muted-foreground">
          No runs yet. Move an issue into a trigger column to start one.
        </div>
      ) : isDesktop ? (
        <>
          <RunGrid runs={runs} focusId={focusId} onFocus={setFocusId} />
          <PermissionToasts onExpand={expandRun} />
        </>
      ) : (
        <MonitorMobileList />
      )}
    </div>
  );
}

// Match the Tailwind `md` breakpoint. SSR-safe: assumes desktop until mounted.
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return isDesktop;
}
