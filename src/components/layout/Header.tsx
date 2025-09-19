import { Wifi, Clock, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useConnection } from "@/contexts/ConnectionContext";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams } from "react-router-dom";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { sidebarOpen } = useSidebar();
  const { online, checking, reconnect, lastChecked } = useConnection();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentDeviceId = searchParams.get('deviceId') || '';

  const { data: deviceIds } = useQuery<string[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch('/api/devices');
      if (!res.ok) throw new Error('Failed to fetch devices');
      return res.json();
    },
    refetchInterval: 15000,
  });

  // Device heartbeat via latest reading
  type Reading = { _id: string; createdAt: string };
  const { data: latestReading } = useQuery<Reading[]>({
    queryKey: ["header-latest-reading", currentDeviceId],
    queryFn: async () => {
      const res = await fetch(`/api/readings?deviceId=${encodeURIComponent(currentDeviceId)}&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch latest reading');
      return res.json();
    },
    enabled: !!currentDeviceId,
    refetchInterval: 10000,
  });
  const deviceOnline = (() => {
    const r = latestReading && latestReading[0];
    if (!r) return false;
    const ageMs = Date.now() - new Date(r.createdAt).getTime();
    return ageMs < 30_000; // consider device online if updated within 30s
  })();

  // Initialize deviceId in URL if missing
  useEffect(() => {
    if (!currentDeviceId && deviceIds && deviceIds.length > 0) {
      const id = deviceIds[0];
      const next = new URLSearchParams(searchParams);
      next.set('deviceId', id);
      setSearchParams(next, { replace: true });
    }
  }, [currentDeviceId, deviceIds, searchParams, setSearchParams]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="fixed top-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-sm border-b border-border h-header">
      <div className="flex items-center justify-between px-6 h-full">
        <div></div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            {currentTime.toLocaleTimeString()}
          </div>

          <div className="flex items-center gap-4">
            {/* Global Device Selector or read-only badge if single/unknown */}
            <div>
              {deviceIds && deviceIds.length > 1 ? (
                <Select
                  value={currentDeviceId || deviceIds[0]}
                  onValueChange={(val) => {
                    const next = new URLSearchParams(searchParams);
                    next.set('deviceId', val);
                    setSearchParams(next);
                  }}
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue placeholder="Select device" />
                  </SelectTrigger>
                  <SelectContent>
                    {deviceIds.map((id) => (
                      <SelectItem key={id} value={id}>{id}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Badge variant="secondary" className="bg-muted">{currentDeviceId || deviceIds?.[0] || 'esp32-001'}</Badge>
              )}
            </div>

            {(() => {
              const serverOk = online;
              const deviceOk = deviceOnline;
              let text = 'Online';
              let cls = 'bg-success/10 text-success';
              let variant: any = 'secondary';
              if (!serverOk) {
                text = 'Server Offline';
                cls = '';
                variant = 'destructive';
              } else if (!deviceOk) {
                text = 'Device Offline';
                cls = '';
                variant = 'destructive';
              }
              return (
                <>
                  <Wifi className={`h-4 w-4 ${(!serverOk || !deviceOk) ? 'text-destructive' : 'text-success'}`} />
                  <Badge variant={variant} className={cls}>{text}</Badge>
                </>
              );
            })()}
            <Button size="sm" variant="outline" onClick={reconnect} disabled={checking} className="ml-2">
              <RefreshCcw className="h-4 w-4 mr-2" />
              {checking ? 'Checking...' : 'Reconnect'}
            </Button>
          </div>

        </div>
      </div>
    </header>
  );
}