import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export default function Admin() {
  const { token, user } = useAuth();
  const isAdmin = user?.role === "admin";

  type DeviceItem = { deviceId: string; name?: string; online?: boolean };
  const { data: registry, refetch } = useQuery<DeviceItem[]>({
    queryKey: ["devices", "registry"],
    queryFn: async () => {
      const res = await fetch("/api/devices/registry");
      if (!res.ok) throw new Error("Failed to fetch device registry");
      return res.json();
    },
  });

  const [selectedId, setSelectedId] = useState<string>("");
  useEffect(() => {
    if (!selectedId && registry && registry.length > 0) setSelectedId(registry[0].deviceId);
  }, [registry, selectedId]);

  const authHeader = useMemo(() => (token ? { Authorization: `Bearer ${token}` } : {}), [token]);

  async function revokeKey() {
    if (!selectedId) return;
    const res = await fetch(`/api/admin/devices/${encodeURIComponent(selectedId)}/revoke-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`New key issued for ${data.deviceId}`);
    } else {
      toast.error(`Failed to revoke key (${res.status})`);
    }
  }

  async function nudgeDevice() {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/admin/devices/${encodeURIComponent(selectedId)}/nudge-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Nudged ${selectedId} (delivered=${data.delivered ?? 0})`);
      } else {
        toast.error(`Failed to nudge device (${res.status})`);
      }
    } catch (e) {
      toast.error('Failed to nudge device');
    }
  }

  async function applyThresholdsAll() {
    try {
      if (!confirm('Apply thresholds from Settings to ALL devices?')) return;
      const res = await fetch(`/api/admin/devices/apply-thresholds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Applied thresholds to all devices (modified=${data.modified ?? '-'}) low=${data.pumpOnBelow} high=${data.pumpOffAbove}`);
      } else {
        toast.error(`Failed to apply thresholds (${res.status})`);
      }
    } catch (e) {
      toast.error('Failed to apply thresholds');
    }
  }

  async function applySendIntervalAll() {
    try {
      const res = await fetch(`/api/admin/devices/apply-send-interval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Applied to all devices (modified=${data.modified ?? '-'}) sendIntervalSec=${data.sendIntervalSec}s`);
      } else {
        toast.error(`Failed to apply send interval (${res.status})`);
      }
    } catch (e) {
      toast.error('Failed to apply send interval');
    }
  }

  // ===== Device metadata editing =====
  const [name, setName] = useState("");
  const [devLocation, setDevLocation] = useState("");

  useEffect(() => {
    // reset fields when device changes
    setName("");
    setDevLocation("");
    // no tags
  }, [selectedId]);

  async function loadMeta() {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/devices/registry`);
      if (!res.ok) return;
      const list = await res.json();
      const item = list.find((x: any) => x.deviceId === selectedId);
      if (item) {
        setName(item.name || "");
        setDevLocation(item.location || "");
      }
    } catch {}
  }

  useEffect(() => { loadMeta(); }, [selectedId]);

  async function saveMeta() {
    if (!selectedId) return;
    const body = {
      name: name || undefined,
      location: devLocation || undefined,
    };
    const res = await fetch(`/api/admin/devices/${encodeURIComponent(selectedId)}/meta`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast.success("Metadata saved");
      await refetch();
    } else {
      toast.error(`Failed to save metadata (${res.status})`);
    }
  }

  // rename disabled by policy

  const [otaVersion, setOtaVersion] = useState("");
  const [otaUrl, setOtaUrl] = useState("");
  async function updateOta() {
    const res = await fetch(`/api/admin/ota`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ version: otaVersion || undefined, url: otaUrl || undefined }),
    });
    if (res.ok) {
      const data = await res.json();
      toast.success(`OTA saved (version=${data.version || "-"})`);
    } else {
      toast.error(`Failed to save OTA (${res.status})`);
    }
  }

  if (!isAdmin) {
    return (
      <div className="p-6">You must be an admin to access this page.</div>
    );
  }

  return (
    <div className="p-6 grid gap-6 grid-cols-1 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Device Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Device</Label>
            <Select value={selectedId} onValueChange={setSelectedId}>
              <SelectTrigger>
                <SelectValue placeholder="Select device" />
              </SelectTrigger>
              <SelectContent>
                {(registry || []).map((d) => (
                  <SelectItem key={d.deviceId} value={d.deviceId}>{d.name || d.deviceId}{d.online ? ' • Online' : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={revokeKey} disabled={!selectedId}>Revoke/Rotate Key</Button>
            <Button variant="outline" onClick={nudgeDevice} disabled={!selectedId}>Nudge Settings</Button>
          </div>
          {/* rename disabled */}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Bulk Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={applySendIntervalAll}>Apply Device Send Interval to All</Button>
          <div className="text-sm text-muted-foreground">Uses System &rarr; Device Send Interval to update all devices' settings.</div>
          <Button variant="outline" onClick={applyThresholdsAll}>Apply Thresholds to All</Button>
          <div className="text-sm text-muted-foreground">Uses Sensors &rarr; Low/High Moisture Threshold from Settings.</div>
          <Button variant="secondary" onClick={async () => {
            try {
              const res = await fetch('/api/admin/devices/nudge-all', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader } });
              if (res.ok) {
                const data = await res.json();
                toast.success(`Nudged all devices (delivered=${data.delivered ?? 0})`);
              } else {
                toast.error(`Failed to nudge all (${res.status})`);
              }
            } catch {
              toast.error('Failed to nudge all');
            }
          }}>Nudge All Devices</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OTA Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="ver">Firmware Version</Label>
            <Input id="ver" value={otaVersion} onChange={(e) => setOtaVersion(e.target.value)} placeholder="1.0.1" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="url">Firmware URL (.bin)</Label>
            <Input id="url" value={otaUrl} onChange={(e) => setOtaUrl(e.target.value)} placeholder="https://.../firmware.bin" />
          </div>
          <div>
            <Button onClick={updateOta}>Save OTA</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Device Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="meta-name">Name</Label>
            <Input id="meta-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Friendly name" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="meta-loc">Location</Label>
            <Input id="meta-loc" value={devLocation} onChange={(e) => setDevLocation(e.target.value)} placeholder="Greenhouse A" />
          </div>
          {/* Tags removed by request */}
          <div>
            <Button onClick={saveMeta} disabled={!selectedId}>Save Metadata</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
