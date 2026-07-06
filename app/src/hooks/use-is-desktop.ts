"use client";

import { useEffect, useState } from "react";

// Match the Tailwind `md` breakpoint (>=768px). SSR-safe: assumes desktop until
// mounted so server render and first client paint agree, then corrects.
export function useIsDesktop(): boolean {
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
