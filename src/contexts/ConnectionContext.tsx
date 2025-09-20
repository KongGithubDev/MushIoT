import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

interface ConnectionState {
  online: boolean;
  checking: boolean;
  lastChecked?: Date;
  deviceOnline: boolean;
  canControl: boolean;
  reconnect: () => Promise<void>;
}

const ConnectionContext = createContext<ConnectionState | undefined>(undefined);

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [online, setOnline] = useState<boolean>(true);
  const [checking, setChecking] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<Date | undefined>(undefined);
  const [searchParams] = useSearchParams();
  const currentDeviceId = searchParams.get('deviceId') || '';

  const check = useCallback(async (minDurationMs: number = 0) => {
    setChecking(true);
    const start = Date.now();
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      setOnline(res.ok);
    } catch {
      setOnline(false);
    } finally {
      const elapsed = Date.now() - start;
      if (minDurationMs > 0 && elapsed < minDurationMs) {
        await new Promise((r) => setTimeout(r, minDurationMs - elapsed));
      }
      setLastChecked(new Date());
      setChecking(false);
    }
  }, []);

  const reconnect = useCallback(async () => {
    // enforce a small delay to make the UX feel responsive (avoid flicker)
    await check(1200);
  }, [check]);

  useEffect(() => {
    // Initial check
    check();
    // Background, low-frequency health check (e.g., every 20s)
    const t = setInterval(check, 20000);
    return () => clearInterval(t);
  }, [check]);

  // Device heartbeat based on latest reading
  type Reading = { _id: string; createdAt: string };
  const { data: latestReading } = useQuery<Reading[]>({
    queryKey: ["conn-latest-reading", currentDeviceId],
    queryFn: async () => {
      const res = await fetch(`/api/readings?deviceId=${encodeURIComponent(currentDeviceId)}&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch latest reading');
      return res.json();
    },
    enabled: !!currentDeviceId && online, // only when server is online and we know device id
    refetchInterval: 10000,
  });
  const deviceOnline = useMemo(() => {
    const r = latestReading && latestReading[0];
    if (!r) return false;
    const ageMs = Date.now() - new Date(r.createdAt).getTime();
    return ageMs < 30_000; // within 30s
  }, [latestReading]);

  const canControl = online && deviceOnline;

  const value = useMemo(() => ({ online, checking, lastChecked, deviceOnline, canControl, reconnect }), [online, checking, lastChecked, deviceOnline, canControl, reconnect]);

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
};

export const useConnection = () => {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error("useConnection must be used within ConnectionProvider");
  return ctx;
};
