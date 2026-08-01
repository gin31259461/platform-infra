"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { startObservationRefresh } from "@/lib/observation-refresh";

const refreshIntervalMs = 10_000;

export function ObservationRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const stop = startObservationRefresh(refreshWhenVisible, refreshIntervalMs);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [router]);

  return null;
}
