import { Wifi, Clock, RefreshCcw, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEffect, useState } from "react";
import { useSidebar } from "@/contexts/SidebarContext";
import { useConnection } from "@/contexts/ConnectionContext";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";

interface HeaderProps {
  onMenuClick: () => void;
}

export function Header({ onMenuClick }: HeaderProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const { sidebarOpen } = useSidebar();
  const { online, checking, reconnect, lastChecked } = useConnection();
  const [deviceId, setDeviceId] = useState<string>('');
  const { user, logout } = useAuth();

  type DeviceItem = { deviceId: string; name: string; online: boolean; location?: string };
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
  const selectedFromRegistry = (devices || []).find(d => d.deviceId === deviceId) || (devices && devices[0]);
  const effectiveDeviceId = deviceId || selectedFromRegistry?.deviceId || '';
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

  // Initialize/sync deviceId from localStorage and registry
  useEffect(() => {
    const list = devices || [];
    if (!list.length) return;
    const stored = localStorage.getItem('deviceId') || '';
    const validStored = stored && list.some(d => d.deviceId === stored);
    const next = validStored ? stored : (list[0]?.deviceId || '');
    if (next && next !== deviceId) {
      setDeviceId(next);
      localStorage.setItem('deviceId', next);
    }
  }, [devices]);

  // Sync across tabs/pages
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'deviceId') {
        const v = e.newValue || '';
        if (v && v !== deviceId) setDeviceId(v);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [deviceId]);

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
            <div className="flex items-center gap-2">
              {devicesError ? (
                <Badge variant="destructive">Devices unavailable</Badge>
              ) : devicesLoading ? (
                <Badge variant="secondary" className="bg-muted">Loading devices...</Badge>
              ) : devices && devices.length > 1 ? (
                <Select
                  value={effectiveDeviceId}
                  onValueChange={(val) => { setDeviceId(val); localStorage.setItem('deviceId', val); }}
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
              {(() => {
                const loc = selectedFromRegistry?.location || (devices && devices.length === 1 ? devices[0].location : undefined);
                if (!loc) return null;
                return (
                  <Badge variant="outline" title={loc} className="max-w-[220px] truncate">
                    <MapPin className="h-3 w-3 mr-1" /> {loc}
                  </Badge>
                );
              })()}
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