import { useState } from "react";
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
import { useSearchParams } from "react-router-dom";

export default function ControlPanel() {
  const { toast } = useToast();
  const { online, canControl } = useConnection();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get('deviceId') || undefined;
  const [pumpMode, setPumpMode] = useState<'auto' | 'manual'>('auto');
  const [pumpStatus, setPumpStatus] = useState(false);
  const [moistureThreshold, setMoistureThreshold] = useState([40]);
  const [autoMode, setAutoMode] = useState(true);
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
    setPumpStatus(!pumpStatus);
    toast({
      title: pumpStatus ? "Pump Stopped" : "Pump Started",
      description: `Water pump has been ${pumpStatus ? 'stopped' : 'started'} manually.`,
    });
  };

  const saveSettings = () => {
    toast({
      title: "Settings Saved",
      description: "Your control panel settings have been saved successfully.",
    });
  };

  const resetSettings = () => {
    setMoistureThreshold([40]);
    setAutoMode(true);
    setPumpMode('auto');
    toast({
      title: "Settings Reset",
      description: "All settings have been reset to default values.",
    });
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
        <div className="flex gap-2">
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
                onClick={() => setPumpMode('auto')}
                disabled={!canControl}
                className="flex-1"
              >
                Auto Mode
              </Button>
              <Button
                variant={pumpMode === 'manual' ? 'default' : 'outline'}
                onClick={() => setPumpMode('manual')}
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
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Moisture Threshold</Label>
                  <span className="text-sm font-medium">{moistureThreshold[0]}%</span>
                </div>
                <Slider
                  value={moistureThreshold}
                  onValueChange={setMoistureThreshold}
                  max={100}
                  min={10}
                  step={5}
                  className="w-full"
                  disabled={!online}
                />
                <p className="text-xs text-muted-foreground">
                  Pump will activate when moisture drops below this level
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="text-center p-3 rounded-lg bg-success/10">
                  <div className="text-2xl font-bold text-success">60-100%</div>
                  <div className="text-xs text-muted-foreground">Optimal Range</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-warning/10">
                  <div className="text-2xl font-bold text-warning">&lt;{moistureThreshold[0]}%</div>
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