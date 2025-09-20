import { useEffect, useMemo, useRef, useState } from "react";
import { StatusCard } from "@/components/dashboard/StatusCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Droplets, 
  Power, 
  Zap,
  TrendingUp,
  Play,
  Pause
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useQuery } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConnection } from "@/contexts/ConnectionContext";
// URL param no longer used for device selection; we store selection in localStorage

type Reading = {
  _id: string;
  deviceId: string;
  moisture?: number;
  payload?: { raw?: number; pumpOn?: boolean };
  createdAt: string;
};

type DeviceSettings = {
  deviceId: string;
  pumpMode: "auto" | "manual";
  overridePumpOn: boolean;
  pumpOnBelow: number;
  pumpOffAbove: number;
};

type Ack = {
  _id: string;
  deviceId: string;
  pumpOn: boolean;
  pumpMode: "auto" | "manual";
  note?: string;
  createdAt: string;
};

export default function Dashboard() {
  const { online } = useConnection();
  const [deviceId, setDeviceId] = useState<string>("");
  // Device selection
  type DeviceItem = { deviceId: string; name?: string; online?: boolean; location?: string };
  const { data: registry } = useQuery<DeviceItem[]>({
    queryKey: ["devices", "registry"],
    queryFn: async () => {
      const res = await fetch(`/api/devices/registry`);
      if (!res.ok) throw new Error(`Failed to fetch device registry: ${res.status}`);
      return res.json();
    },
    refetchInterval: 15000,
  });
  // choose deviceId from localStorage or first registry item
  useEffect(() => {
    const list = registry || [];
    if (!list.length) return;
    const stored = localStorage.getItem('deviceId') || '';
    const validStored = stored && list.some(d => d.deviceId === stored);
    const next = validStored ? stored : (list[0]?.deviceId || '');
    if (next && next !== deviceId) {
      setDeviceId(next);
      localStorage.setItem('deviceId', next);
    }
  }, [registry]);

  // Sync with localStorage changes from other tabs/pages
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

  const currentDevice = useMemo(() => (registry || []).find(d => d.deviceId === deviceId), [registry, deviceId]);

  const hasDevice = !!deviceId;

  // App Settings for dynamic dashboard refresh interval
  const { data: appSettings } = useQuery<any>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch('/api/app-settings');
      if (!res.ok) throw new Error(`Failed to load app settings: ${res.status}`);
      return res.json();
    },
    enabled: online,
    refetchInterval: 60_000,
  });
  const refreshSec = Math.max(10, Number(appSettings?.system?.dashboardRefreshSec || 60));

  const { data: readings, isLoading, isError, error, refetch, isFetching } = useQuery<Reading[]>({
    queryKey: ["readings", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/readings?deviceId=${encodeURIComponent(deviceId)}&limit=200`);
      if (!res.ok) throw new Error(`Failed to fetch readings: ${res.status}`);
      return res.json();
    },
    refetchInterval: refreshSec * 1000,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    enabled: online && hasDevice,
  });

  // Device settings
  const { data: settings, refetch: refetchSettings, isFetching: fetchingSettings } = useQuery<DeviceSettings>({
    queryKey: ["device-settings", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`);
      if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
      return res.json();
    },
    refetchInterval: 10000,
    enabled: online && hasDevice,
  });

  // Latest ACK from device (what is actually applied)
  const { data: ack, isFetching: fetchingAck, refetch: refetchAck } = useQuery<Ack | null>({
    queryKey: ["device-ack", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/ack`);
      if (!res.ok) throw new Error(`Failed to fetch ack: ${res.status}`);
      return res.json();
    },
    // Do not poll frequently; we'll refetch manually when there's a meaningful update
    enabled: online && hasDevice,
  });

  // Latest reading (array is sorted desc by createdAt on the server)
  const latest = readings && readings.length > 0 ? readings[0] : undefined;
  const currentMoisture = latest?.moisture ?? 0;
  const pumpStatus = latest?.payload?.pumpOn ?? false;

  // Transform readings to chart points (reverse to chronological order)
  const moistureData = useMemo(() => {
    if (!readings) return [] as Array<{ time: string; moisture: number; timestamp: number }>;
    const byAsc = [...readings].reverse();
    return byAsc.map(r => {
      const ts = new Date(r.createdAt);
      return {
        time: ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        moisture: Math.round(r.moisture ?? 0),
        timestamp: ts.getTime(),
      };
    });
  }, [readings]);

  // Animate chart only on first mount to avoid restart on unrelated re-renders (e.g., ACK polling)
  const chartAnimatedRef = useRef(true);
  useEffect(() => { chartAnimatedRef.current = false; }, []);

  const pumpMode: 'auto' | 'manual' = settings?.pumpMode ?? 'auto';
  // When in manual mode, if ACK state doesn't yet match desired settings, we are waiting for device to apply
  const waitingApply = useMemo(() => {
    if (!settings || !ack) return false;
    if (pumpMode !== 'manual') return false;
    const desiredOn = !!(settings.overridePumpOn ?? false);
    return !(ack.pumpMode === 'manual' && ack.pumpOn === desiredOn);
  }, [settings, ack, pumpMode]);

  const commandDelivered = useMemo(() => {
    if (!ack) return false;
    if (pumpMode === 'manual') {
      const desiredOn = !!(settings?.overridePumpOn ?? false);
      return ack.pumpMode === 'manual' && ack.pumpOn === desiredOn;
    }
    return ack.pumpMode === 'auto';
  }, [ack, settings, pumpMode]);

  // While waiting for device to apply, temporarily poll ACK faster to reflect the change sooner
  const waitingPollStartRef = useRef<number | null>(null);
  useEffect(() => {
    let timer: any;
    if (waitingApply && online && hasDevice) {
      if (!waitingPollStartRef.current) waitingPollStartRef.current = Date.now();
      timer = setInterval(() => {
        // Stop fast polling after 15s to avoid spamming
        const started = waitingPollStartRef.current || Date.now();
        if (Date.now() - started > 15_000) {
          clearInterval(timer);
          return;
        }
        // refetch ACK
        refetchAck();
      }, 1000);
    } else {
      waitingPollStartRef.current = null;
    }
    return () => { if (timer) clearInterval(timer); };
  }, [waitingApply, online, hasDevice, refetchAck]);

  // UI SSE: listen for ack/reading/settings events to update UI realtime
  useEffect(() => {
    if (!hasDevice) return;
    const es = new EventSource('/api/stream');
    const onAck = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.deviceId === deviceId) {
          refetchAck();
        }
      } catch {}
    };
    const onReading = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.deviceId === deviceId) {
          // Lightly refetch ack to keep status fresh; charts (if any) can also react
          refetchAck();
        }
      } catch {}
    };
    const onSettings = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data?.deviceId === deviceId) {
          refetchSettings();
          refetchAck();
        }
      } catch {}
    };
    es.addEventListener('ack', onAck as any);
    es.addEventListener('reading', onReading as any);
    es.addEventListener('settings', onSettings as any);
    return () => {
      try {
        es.removeEventListener('ack', onAck as any);
        es.removeEventListener('reading', onReading as any);
        es.removeEventListener('settings', onSettings as any);
        es.close();
      } catch {}
    };
  }, [deviceId, hasDevice, refetchAck, refetchSettings]);

  const getMoistureStatus = (level: number) => {
    if (level > 60) return "success";
    if (level > 30) return "warning"; 
    return "destructive";
  };

  const togglePump = () => {
    if (!deviceId) return;
    if (pumpMode !== 'manual') return;
    const next = !(settings?.overridePumpOn ?? false);
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overridePumpOn: next })
    }).then(() => { refetchSettings(); refetchAck(); });
  };

  const setMode = (mode: 'auto' | 'manual') => {
    if (!deviceId || settings?.pumpMode === mode) return;
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pumpMode: mode })
    }).then(() => { refetchSettings(); refetchAck(); });
  };

  // When a new reading arrives (timestamp changes), refresh ACK once to reflect device-applied state/time
  const lastTriggeredAckTsRef = useRef<string | null>(null);
  useEffect(() => {
    const ts = latest?.createdAt || null;
    if (!ts) return;
    if (lastTriggeredAckTsRef.current !== ts) {
      lastTriggeredAckTsRef.current = ts;
      refetchAck();
    }
  }, [latest?.createdAt, refetchAck]);

  // Empty state when no devices
  if (!hasDevice) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground">Monitor your mushroom growing environment</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>No device selected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">Connect an ESP32 or run a simulator to get started.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => window.location.reload()}>Refresh</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Monitor your mushroom growing environment</p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="min-w-[220px]">
            <Select value={deviceId} onValueChange={(v) => { setDeviceId(v); localStorage.setItem('deviceId', v); }}>
              <SelectTrigger>
                <SelectValue placeholder="Select device" />
              </SelectTrigger>
              <SelectContent>
                {(registry || []).map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>
                    {d.name || d.deviceId}{d.online ? ' • Online' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isLoading ? (
            <Badge variant="secondary">Loading...</Badge>
          ) : isError ? (
            <Badge variant="destructive">Not connected</Badge>
          ) : latest ? (
            <Badge variant="secondary" className="bg-success/10 text-success">
              Last sync: {new Date(latest.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </Badge>
          ) : (
            <Badge variant="outline">No data</Badge>
          )}
          <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>Refresh</Button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        <StatusCard
          title="Soil Moisture"
          value={Math.round(currentMoisture)}
          unit="%"
          icon={<Droplets className="h-4 w-4" />}
          status={getMoistureStatus(currentMoisture)}
          change={latest ? `raw: ${latest.payload?.raw ?? '-'} ` : '-'}
          changeType="neutral"
          description="latest reading"
        />
        
        <StatusCard
          title="Water Pump"
          value={pumpStatus ? "ON" : "OFF"}
          icon={<Power className="h-4 w-4" />}
          status={pumpStatus ? "success" : "default"}
          change={pumpMode.toUpperCase()}
          changeType="neutral"
          description="mode"
        />
        
        <StatusCard
          title="System Status"
          value={isError ? "Not connected" : isLoading ? "Loading" : "Online"}
          icon={<Zap className="h-4 w-4" />}
          status={isError ? "destructive" : "success"}
          change={deviceId}
          changeType="neutral"
          description="device"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Moisture Chart */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Soil Moisture Trend (24h)
                </CardTitle>
                <Badge variant="outline">{isFetching ? 'Refreshing...' : `Auto refresh: ${refreshSec}s`}</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={moistureData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="time" 
                      className="text-muted-foreground"
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis 
                      className="text-muted-foreground"
                      tick={{ fontSize: 12 }}
                      domain={[0, 100]}
                    />
                    <Tooltip 
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="moisture" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={3}
                      strokeLinecap="round"
                      isAnimationActive={chartAnimatedRef.current}
                      animationDuration={700}
                      animationEasing="ease-in-out"
                      dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 3 }}
                      activeDot={{ r: 6, fill: 'hsl(var(--primary-glow))' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Quick Controls */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Quick Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Pump Mode</span>
                  <Badge variant={pumpMode === 'auto' ? 'default' : 'secondary'}>
                    {pumpMode}
                  </Badge>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={pumpMode === 'auto' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMode('auto')}
                    className="flex-1"
                    disabled={waitingApply}
                  >
                    Auto
                  </Button>
                  <Button
                    variant={pumpMode === 'manual' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMode('manual')}
                    className="flex-1"
                    disabled={waitingApply}
                  >
                    Manual
                  </Button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Water Pump</span>
                  <Badge variant={pumpStatus ? 'default' : 'secondary'}>
                    {pumpStatus ? 'Running' : 'Stopped'}
                  </Badge>
                </div>
                <Button
                  onClick={togglePump}
                  disabled={pumpMode === 'auto' || waitingApply}
                  className="w-full"
                  variant={(settings?.overridePumpOn ?? false) ? 'destructive' : 'default'}
                  title={waitingApply ? 'Waiting for device to apply previous command' : undefined}
                >
                  {(settings?.overridePumpOn ?? false) ? (
                    <>
                      <Pause className="h-4 w-4 mr-2" />
                      Stop Pump
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Start Pump
                    </>
                  )}
                </Button>
                {/* ACK status */}
                <div className="mt-2 text-xs space-y-1">
                  {fetchingAck ? (
                    <Badge variant="secondary">Checking device status...</Badge>
                  ) : ack ? (
                    settings?.pumpMode === 'manual' ? (
                      (ack.pumpMode === 'manual' && ack.pumpOn === (settings?.overridePumpOn ?? false)) ? (
                        <>
                          <Badge variant="secondary" className="bg-success/10 text-success">Command delivered</Badge>
                          <div className="text-muted-foreground">Last ACK: {new Date(ack.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                        </>
                      ) : (
                        <>
                          <Badge variant="outline">Waiting for device to apply...</Badge>
                          <div className="text-muted-foreground">Last ACK: {new Date(ack.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                        </>
                      )
                    ) : (
                      // In auto mode, show delivered and last ack time
                      <>
                        {commandDelivered && <Badge variant="secondary" className="bg-success/10 text-success">Command delivered</Badge>}
                        <div className="text-muted-foreground">Last ACK: {new Date(ack.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                      </>
                    )
                  ) : (
                    <Badge variant="outline">No device confirmation yet</Badge>
                  )}
                </div>
                {pumpMode === 'auto' && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Pump is controlled automatically based on moisture levels
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card>
            <CardHeader>
              <CardTitle>System Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ESP32 Device</span>
                <span className="font-medium">{isError ? 'Unknown' : 'Connected'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Location</span>
                <span className="font-medium">{currentDevice?.location || '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">WiFi Signal</span>
                <span className="font-medium">—</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Battery Level</span>
                <span className="font-medium">—</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Last Watering</span>
                <span className="font-medium">—</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}