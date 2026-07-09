"use client";

import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useMonitor } from "./MonitorProvider";

const SCROLLBACK = 1500;

// An xterm.js pane bound to one channel. xterm is imported lazily inside the
// effect so its DOM access never runs during SSR. Output is written from the
// client's per-frame batch (client.onOutput), keystrokes go up as `stdin`, and
// container resizes are fit + reported as `resize`.
export function TerminalPane({ channel, className }: { channel: string; className?: string }) {
  const { client } = useMonitor();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        scrollback: SCROLLBACK,
        fontSize: 12,
        fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
        cursorBlink: true,
        theme: readTheme(),
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try {
        fit.fit();
      } catch {
        /* container not measured yet */
      }

      client.subscribe(channel);
      client.resize(channel, term.cols, term.rows);

      const offOutput = client.onOutput(channel, (text) => term.write(text));
      const onData = term.onData((data) => client.stdin(channel, data));

      const resizeObserver = new ResizeObserver(() => {
        try {
          fit.fit();
          client.resize(channel, term.cols, term.rows);
        } catch {
          /* ignore transient measure errors */
        }
      });
      resizeObserver.observe(hostRef.current);

      cleanup = () => {
        resizeObserver.disconnect();
        offOutput();
        onData.dispose();
        term.dispose();
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [client, channel]);

  return <div ref={hostRef} className={className ?? "h-full w-full min-h-0"} />;
}

// xterm paints to a canvas, so it needs concrete colours — resolve the current
// Catppuccin flavour (which follows the system theme via CSS vars) at mount.
function readTheme() {
  if (typeof window === "undefined") return undefined;
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: v("--ctp-crust", "#232634"),
    foreground: v("--ctp-text", "#c6d0f5"),
    cursor: v("--ctp-lavender", "#babbf1"),
    selectionBackground: v("--ctp-surface1", "#51576d"),
    black: v("--ctp-surface1", "#51576d"),
    red: v("--ctp-red", "#e78284"),
    green: v("--ctp-green", "#a6d189"),
    yellow: v("--ctp-yellow", "#e5c890"),
    blue: v("--ctp-blue", "#8caaee"),
    magenta: v("--ctp-mauve", "#ca9ee6"),
    cyan: v("--ctp-teal", "#81c8be"),
    white: v("--ctp-text", "#c6d0f5"),
    brightBlack: v("--ctp-overlay1", "#838ba7"),
    brightRed: v("--ctp-maroon", "#ea999c"),
    brightGreen: v("--ctp-green", "#a6d189"),
    brightYellow: v("--ctp-peach", "#ef9f76"),
    brightBlue: v("--ctp-sapphire", "#85c1dc"),
    brightMagenta: v("--ctp-pink", "#f4b8e4"),
    brightCyan: v("--ctp-sky", "#99d1db"),
    brightWhite: v("--ctp-subtext1", "#b5bfe2"),
  };
}
