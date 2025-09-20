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

  const { data: deviceIds, refetch } = useQuery<string[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await fetch("/api/devices");
      if (!res.ok) throw new Error("Failed to fetch devices");
      return res.json();
    },
  });

  const [selectedId, setSelectedId] = useState<string>("");
  useEffect(() => {
    if (!selectedId && deviceIds && deviceIds.length > 0) setSelectedId(deviceIds[0]);
  }, [deviceIds, selectedId]);

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

  const [newId, setNewId] = useState("");
  async function renameDevice() {
    if (!selectedId || !newId) return;
    const res = await fetch(`/api/admin/devices/${encodeURIComponent(selectedId)}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader },
      body: JSON.stringify({ newId }),
    });
    if (res.ok) {
      toast.success(`Renamed ${selectedId} -> ${newId}`);
      setNewId("");
      await refetch();
      setSelectedId(newId);
    } else {
      toast.error(`Failed to rename (${res.status})`);
    }
  }

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
    <div className="p-6 grid gap-6 grid-cols-1 lg:grid-cols-2">
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
                {deviceIds?.map((id) => (
                  <SelectItem key={id} value={id}>{id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button onClick={revokeKey} disabled={!selectedId}>Revoke/Rotate Key</Button>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="newId">Rename to</Label>
            <div className="flex gap-2">
              <Input id="newId" value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="esp32-xyz" />
              <Button onClick={renameDevice} disabled={!selectedId || !newId}>Rename</Button>
            </div>
          </div>
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
    </div>
  );
}
