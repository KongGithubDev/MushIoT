import { useEffect, useMemo } from "react";
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
import { useSearchParams } from "react-router-dom";

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
  const [searchParams, setSearchParams] = useSearchParams();
  // Device selection
  const { data: deviceIds } = useQuery<string[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch(`/api/devices`);
      if (!res.ok) throw new Error(`Failed to fetch devices: ${res.status}`);
      return res.json();
    },
    refetchInterval: 15000,
  });
  const deviceId = useMemo(() => {
    const fromUrl = searchParams.get('deviceId');
    if (fromUrl) return fromUrl;
    return deviceIds?.[0] ?? "esp32-001";
  }, [deviceIds, searchParams]);

  // If URL has no deviceId yet, set it so Header can pick it up immediately
  useEffect(() => {
    if (!searchParams.get('deviceId') && deviceId) {
      const next = new URLSearchParams(searchParams);
      next.set('deviceId', deviceId);
      setSearchParams(next, { replace: true });
    }
  }, [deviceId, searchParams, setSearchParams]);

  const { data: readings, isLoading, isError, error, refetch, isFetching } = useQuery<Reading[]>({
    queryKey: ["readings", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/readings?deviceId=${encodeURIComponent(deviceId)}&limit=200`);
      if (!res.ok) throw new Error(`Failed to fetch readings: ${res.status}`);
      return res.json();
    },
    refetchInterval: 5000,
    enabled: online && !!deviceId,
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
    enabled: online && !!deviceId,
  });

  // Latest ACK from device (what is actually applied)
  const { data: ack, isFetching: fetchingAck } = useQuery<Ack | null>({
    queryKey: ["device-ack", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/ack`);
      if (!res.ok) throw new Error(`Failed to fetch ack: ${res.status}`);
      return res.json();
    },
    refetchInterval: 3000,
    enabled: online && !!deviceId,
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

  const pumpMode: 'auto' | 'manual' = settings?.pumpMode ?? 'auto';

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
    }).then(() => refetchSettings());
  };

  const setMode = (mode: 'auto' | 'manual') => {
    if (!deviceId || settings?.pumpMode === mode) return;
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pumpMode: mode })
    }).then(() => refetchSettings());
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Monitor your mushroom growing environment</p>
        </div>
        
        <div className="flex items-center gap-2">
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
                <Badge variant="outline">{isFetching ? 'Refreshing...' : 'Real-time'}</Badge>
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
                      dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
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
                  >
                    Auto
                  </Button>
                  <Button
                    variant={pumpMode === 'manual' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMode('manual')}
                    className="flex-1"
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
                  disabled={pumpMode === 'auto'}
                  className="w-full"
                  variant={(settings?.overridePumpOn ?? false) ? 'destructive' : 'default'}
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
                <div className="mt-2 text-xs">
                  {fetchingAck ? (
                    <Badge variant="secondary">Checking device status...</Badge>
                  ) : ack ? (
                    settings?.pumpMode === 'manual' ? (
                      (ack.pumpMode === 'manual' && ack.pumpOn === (settings?.overridePumpOn ?? false)) ? (
                        <Badge variant="secondary" className="bg-success/10 text-success">Command applied on device</Badge>
                      ) : (
                        <Badge variant="outline">Waiting for device to apply...</Badge>
                      )
                    ) : (
                      // In auto mode, just show last ack time
                      <Badge variant="outline">Last ACK: {new Date(ack.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Badge>
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