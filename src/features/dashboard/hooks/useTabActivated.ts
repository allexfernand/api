"use client";

// Liga fetch pesado só depois da primeira visita à aba.
// Contrato: DashboardShell/core.js disparam `sanus:tabchange` e
// gravam `document.body.dataset.activeTab`.

import { useEffect, useState } from "react";

export function useTabActivated(tabId: string): boolean {
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    if (activated) return;
    const match = (tab: string | undefined) => {
      if (tab === tabId) setActivated(true);
    };
    match(document.body.dataset.activeTab);
    const onTabChange = (event: Event) => match((event as CustomEvent<string>).detail);
    document.addEventListener("sanus:tabchange", onTabChange);
    return () => document.removeEventListener("sanus:tabchange", onTabChange);
  }, [activated, tabId]);

  return activated;
}
