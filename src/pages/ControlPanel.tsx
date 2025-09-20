import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Settings, 
  Droplets, 
  Power, 
  Clock,
  Save,
  RotateCcw,
  Trash2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConnection } from "@/contexts/ConnectionContext";
import { useQuery } from "@tanstack/react-query";
// Device selection is now stored in localStorage, not URL
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function ControlPanel() {
  const { toast } = useToast();
  const { online, canControl } = useConnection();
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [pumpMode, setPumpMode] = useState<'auto' | 'manual'>('auto');
  const [pumpStatus, setPumpStatus] = useState(false);
  const [onBelow, setOnBelow] = useState(35);
  const [offAbove, setOffAbove] = useState(45);
  const [autoMode, setAutoMode] = useState(true);

  type DeviceSettings = { deviceId: string; pumpMode: 'auto'|'manual'; overridePumpOn: boolean; pumpOnBelow: number; pumpOffAbove: number };
  type Ack = { pumpOn: boolean; pumpMode: 'auto'|'manual'; createdAt: string };
  type DeviceItem = { deviceId: string; name?: string; online?: boolean };

  // Device registry for selector and validating stored deviceId
  const { data: registry } = useQuery<DeviceItem[]>({
    queryKey: ["devices", "registry"],
    queryFn: async () => {
      const res = await fetch(`/api/devices/registry`);
      if (!res.ok) throw new Error("Failed to fetch device registry");
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 15000,
  });

  const hasDevice = !!deviceId;
  const { data: settings, refetch: refetchSettings } = useQuery<DeviceSettings>({
    queryKey: ["device-settings", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId! )}/settings`);
      if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
      return res.json();
    },
    enabled: online && hasDevice,
    refetchInterval: 15000,
  });

  const { data: ack, refetch: refetchAck } = useQuery<Ack | null>({
    queryKey: ["device-ack", deviceId],
    queryFn: async () => {
      const res = await fetch(`/api/devices/${encodeURIComponent(deviceId! )}/ack`);
      if (!res.ok) throw new Error(`Failed to fetch ack: ${res.status}`);
      return res.json();
    },
    enabled: online && hasDevice,
  });

  useEffect(() => {
    if (!settings) return;
    setPumpMode(settings.pumpMode);
    setAutoMode(settings.pumpMode === 'auto');
    setOnBelow(Number.isFinite(settings.pumpOnBelow) ? settings.pumpOnBelow : 35);
    setOffAbove(Number.isFinite(settings.pumpOffAbove) ? settings.pumpOffAbove : 45);
  }, [settings]);

  useEffect(() => {
    if (ack && typeof ack.pumpOn === 'boolean') setPumpStatus(ack.pumpOn);
  }, [ack]);

  // Choose deviceId from localStorage or first registry item (on registry changes)
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

  // UI SSE: listen for realtime updates (ack/reading/settings) and refresh panel accordingly
  useEffect(() => {
    if (!deviceId) return;
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
          // Keep pump status fresh
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
  }, [deviceId, refetchAck, refetchSettings]);
  type Schedule = { _id: string; deviceId: string; time: string; enabled: boolean };
  const { data: schedules, refetch: refetchSchedules } = useQuery<Schedule[]>({
    queryKey: ["schedules", deviceId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      const res = await fetch(`/api/schedules?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch schedules: ${res.status}`);
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 20000,
  });

  const togglePump = () => {
    if (!deviceId || pumpMode !== 'manual') return;
    const next = !pumpStatus;
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overridePumpOn: next })
    }).then(async (r) => {
      if (r.ok) {
        setPumpStatus(next);
        toast({ title: next ? 'Pump Started' : 'Pump Stopped' });
        await refetchAck();
      } else {
        toast({ title: 'Failed to update pump', description: `${r.status}` });
      }
    });
  };

  const saveSettings = () => {
    if (!deviceId) return;
    const body: any = { pumpOnBelow: onBelow, pumpOffAbove: offAbove, pumpMode: autoMode ? 'auto' : 'manual' };
    fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(async (r) => {
      if (r.ok) {
        toast({ title: 'Settings Saved' });
        await refetchSettings();
        await refetchAck();
      } else {
        toast({ title: 'Failed to save settings', description: `${r.status}` });
      }
    });
  };

  const resetSettings = () => {
    if (settings) {
      setPumpMode(settings.pumpMode);
      setAutoMode(settings.pumpMode === 'auto');
      setOnBelow(settings.pumpOnBelow ?? 35);
      setOffAbove(settings.pumpOffAbove ?? 45);
    } else {
      setPumpMode('auto');
      setAutoMode(true);
      setOnBelow(35);
      setOffAbove(45);
    }
    toast({ title: 'Settings Reset' });
  };

  const deleteSchedule = async (id: string) => {
    await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    toast({ title: "Schedule Deleted", description: "Watering schedule has been removed." });
    refetchSchedules();
  };

  const addSchedule = async () => {
    if (!deviceId) return;
    await fetch(`/api/schedules`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId, time: "12:00", enabled: false }) });
    refetchSchedules();
  };

  const updateSchedule = async (id: string, patch: Partial<Schedule>) => {
    await fetch(`/api/schedules/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    refetchSchedules();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Control Panel</h1>
          <p className="text-muted-foreground">Manage your mushroom watering system</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="min-w-[220px]">
            <Select value={deviceId || ""} onValueChange={(v) => { setDeviceId(v); localStorage.setItem('deviceId', v); }}>
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
          <Button variant="outline" onClick={resetSettings} disabled={!canControl}>
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button onClick={saveSettings} disabled={!canControl}>
            <Save className="h-4 w-4 mr-2" />
            Save Settings
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pump Control */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Power className="h-5 w-5 text-primary" />
              Pump Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Pump Mode</Label>
                <p className="text-sm text-muted-foreground">
                  {pumpMode === 'auto' ? 'Automatic based on moisture levels' : 'Manual control only'}
                </p>
              </div>
              <Badge variant={pumpMode === 'auto' ? 'default' : 'secondary'}>
                {pumpMode.toUpperCase()}
              </Badge>
            </div>

            <div className="flex gap-2">
              <Button
                variant={pumpMode === 'auto' ? 'default' : 'outline'}
                onClick={() => {
                  setPumpMode('auto'); setAutoMode(true);
                  if (deviceId) fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pumpMode: 'auto' }) }).then(() => { refetchSettings(); refetchAck(); });
                }}
                disabled={!canControl}
                className="flex-1"
              >
                Auto Mode
              </Button>
              <Button
                variant={pumpMode === 'manual' ? 'default' : 'outline'}
                onClick={() => {
                  setPumpMode('manual'); setAutoMode(false);
                  if (deviceId) fetch(`/api/devices/${encodeURIComponent(deviceId)}/settings`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pumpMode: 'manual' }) }).then(() => { refetchSettings(); refetchAck(); });
                }}
                disabled={!canControl}
                className="flex-1"
              >
                Manual Mode
              </Button>
            </div>

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Water Pump Status</Label>
                <Badge variant={pumpStatus ? 'default' : 'secondary'}>
                  {pumpStatus ? 'Running' : 'Stopped'}
                </Badge>
              </div>
              
              <Button
                onClick={togglePump}
                disabled={!canControl || pumpMode === 'auto'}
                className="w-full"
                variant={pumpStatus ? 'destructive' : 'default'}
              >
                <Power className="h-4 w-4 mr-2" />
                {pumpStatus ? 'Stop Pump' : 'Start Pump'}
              </Button>
              
              {pumpMode === 'auto' && (
                <p className="text-xs text-muted-foreground">
                  Manual control is disabled in auto mode
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Moisture Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Droplets className="h-5 w-5 text-primary" />
              Moisture Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label>Auto Mode</Label>
                <Switch 
                  checked={autoMode} 
                  onCheckedChange={setAutoMode}
                  disabled={!canControl}
                />
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Turn ON Below</Label>
                    <span className="text-sm font-medium">{onBelow}%</span>
                  </div>
                  <Slider
                    value={[onBelow]}
                    onValueChange={(v) => setOnBelow(Math.min(v[0], offAbove - 1))}
                    max={90}
                    min={10}
                    step={1}
                    className="w-full"
                    disabled={!online}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Turn OFF Above</Label>
                    <span className="text-sm font-medium">{offAbove}%</span>
                  </div>
                  <Slider
                    value={[offAbove]}
                    onValueChange={(v) => setOffAbove(Math.max(v[0], onBelow + 1))}
                    max={100}
                    min={20}
                    step={1}
                    className="w-full"
                    disabled={!online}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Hysteresis: Pump turns ON below {onBelow}% and OFF above {offAbove}%.</p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="text-center p-3 rounded-lg bg-success/10">
                  <div className="text-2xl font-bold text-success">60-100%</div>
                  <div className="text-xs text-muted-foreground">Optimal Range</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-warning/10">
                  <div className="text-2xl font-bold text-warning">&lt;{onBelow}%</div>
                  <div className="text-xs text-muted-foreground">Watering Trigger</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Scheduled Watering */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              Scheduled Watering
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {(schedules ?? []).map((schedule) => (
                <div key={schedule._id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={schedule.enabled}
                      disabled={!canControl}
                      onCheckedChange={async (checked) => {
                        await updateSchedule(schedule._id, { enabled: checked });
                      }}
                    />
                    <div>
                      <div className="font-medium">{schedule.time}</div>
                      <div className="text-sm text-muted-foreground">
                        {schedule.enabled ? 'Active' : 'Disabled'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={schedule.time}
                      disabled={!canControl}
                      onChange={async (e) => {
                        await updateSchedule(schedule._id, { time: e.target.value });
                      }}
                      className="w-32"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => deleteSchedule(schedule._id)}
                      disabled={!canControl}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              
              <Button 
                variant="outline" 
                className="w-full"
                onClick={addSchedule}
                disabled={!canControl}
              >
                Add Schedule
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}