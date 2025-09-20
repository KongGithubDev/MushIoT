import { Wifi, Clock, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useConnection } from "@/contexts/ConnectionContext";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { sidebarOpen } = useSidebar();
  const { online, checking, reconnect, lastChecked } = useConnection();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentDeviceId = searchParams.get('deviceId') || '';
  const { user, logout } = useAuth();

  type DeviceItem = { deviceId: string; name: string; online: boolean };
  const { data: devices, error: devicesError, isLoading: devicesLoading } = useQuery<DeviceItem[]>({
    queryKey: ["devices", "registry"],
    queryFn: async () => {
      const res = await fetch('/api/devices/registry');
      if (!res.ok) throw new Error('Failed to fetch device registry');
      return res.json();
    },
    refetchInterval: 15000,
  });

  // Device heartbeat via latest reading (fallback when registry info unavailable)
  type Reading = { _id: string; createdAt: string };
  const selectedFromRegistry = (devices || []).find(d => d.deviceId === currentDeviceId) || (devices && devices[0]);
  const effectiveDeviceId = currentDeviceId || selectedFromRegistry?.deviceId || '';
  const selectedLabel = (() => {
    const d = (devices || []).find(x => x.deviceId === effectiveDeviceId);
    if (d) return `${d.name || d.deviceId}${d.online ? ' • Online' : ''}`;
    return effectiveDeviceId || 'Select device';
  })();
  const { data: latestReading } = useQuery<Reading[]>({
    queryKey: ["header-latest-reading", effectiveDeviceId],
    queryFn: async () => {
      const res = await fetch(`/api/readings?deviceId=${encodeURIComponent(effectiveDeviceId)}&limit=1`);
      if (!res.ok) throw new Error('Failed to fetch latest reading');
      return res.json();
    },
    enabled: !!effectiveDeviceId,
    refetchInterval: 10000,
  });
  const deviceOnline = (() => {
    // Prefer registry online flag for the selected device; fallback to latest reading
    if (selectedFromRegistry && typeof selectedFromRegistry.online === 'boolean') {
      return selectedFromRegistry.online;
    }
    const r = latestReading && latestReading[0];
    if (!r) return false;
    const ageMs = Date.now() - new Date(r.createdAt).getTime();
    return ageMs < 30_000;
  })();

  // Initialize/sync deviceId in URL if missing
  useEffect(() => {
    if (!currentDeviceId && devices && devices.length > 0) {
      const id = devices[0].deviceId;
      const next = new URLSearchParams(searchParams);
      next.set('deviceId', id);
      setSearchParams(next, { replace: true });
    }
  }, [currentDeviceId, devices, searchParams, setSearchParams]);

  // Validate: if current deviceId is not in registry, reset to first or remove
  useEffect(() => {
    if (currentDeviceId && devices) {
      const exists = devices.some(d => d.deviceId === currentDeviceId);
      if (!exists) {
        const next = new URLSearchParams(searchParams);
        if (devices.length > 0) next.set('deviceId', devices[0].deviceId);
        else next.delete('deviceId');
        setSearchParams(next, { replace: true });
      }
    }
  }, [currentDeviceId, devices, searchParams, setSearchParams]);

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
              {devicesError ? (
                <Badge variant="destructive">Devices unavailable</Badge>
              ) : devicesLoading ? (
                <Badge variant="secondary" className="bg-muted">Loading devices...</Badge>
              ) : devices && devices.length > 1 ? (
                <Select
                  value={effectiveDeviceId}
                  onValueChange={(val) => {
                    const next = new URLSearchParams(searchParams);
                    next.set('deviceId', val);
                    setSearchParams(next);
                  }}
                >
                  <SelectTrigger className="w-[260px]">
                    <div className="truncate text-left w-full">{selectedLabel}</div>
                  </SelectTrigger>
                  <SelectContent>
                    {(devices || []).map((d) => (
                      <SelectItem key={d.deviceId} value={d.deviceId}>{`${d.name || d.deviceId}${d.online ? ' • Online' : ''}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : devices && devices.length === 1 ? (
                <Badge variant="secondary" className="bg-muted">{devices[0].name || devices[0].deviceId}</Badge>
              ) : null}
            </div>

            {(() => {
              const serverOk = online;
              const hasDevices = !!devices && devices.length > 0 && !devicesError;
              const deviceOk = hasDevices && deviceOnline;
              let text = 'Online';
              let cls = 'bg-success/10 text-success';
              let variant: any = 'secondary';
              if (!serverOk) {
                text = 'Server Offline';
                cls = '';
                variant = 'destructive';
              } else if (!hasDevices) {
                text = 'No devices connected';
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
            <div className="flex items-center gap-2 ml-4">
              {user?.email && (
                <Badge variant="secondary" className="bg-muted">{user.email}</Badge>
              )}
              <Button size="sm" variant="outline" onClick={logout}>Logout</Button>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}