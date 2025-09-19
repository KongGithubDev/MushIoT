import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { 
  AlertTriangle, 
  Bell, 
  CheckCircle,
  XCircle,
  Plus,
  Trash2,
  Settings
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConnection } from "@/contexts/ConnectionContext";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

interface Alert {
  id: number;
  type: 'moisture' | 'pump' | 'system';
  severity: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  time: string;
  isRead: boolean;
  isActive: boolean;
}

// Real alerts are loaded from API

export default function Alerts() {
  const { toast } = useToast();
  const { online, canControl } = useConnection();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get('deviceId') || undefined;
  const { data: alerts, refetch } = useQuery<Alert[]>({
    queryKey: ["alerts", deviceId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      const res = await fetch(`/api/alerts?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch alerts: ${res.status}`);
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 15000,
  });
  const [alertSettings, setAlertSettings] = useState({
    moistureAlerts: true,
    pumpAlerts: true,
    systemAlerts: true,
    emailNotifications: false,
    lowMoistureThreshold: 30,
    highMoistureThreshold: 80
  });

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return 'destructive';
      case 'medium': return 'default';
      case 'low': return 'secondary';
      default: return 'secondary';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'moisture': return <AlertTriangle className="h-4 w-4" />;
      case 'pump': return <Settings className="h-4 w-4" />;
      case 'system': return <Bell className="h-4 w-4" />;
      default: return <Bell className="h-4 w-4" />;
    }
  };

  const markAsRead = async (id: number) => {
    await fetch(`/api/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isRead: true }) });
    refetch();
  };

  const dismissAlert = async (id: number) => {
    await fetch(`/api/alerts/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: false }) });
    toast({ title: "Alert Dismissed", description: "The alert has been removed from your list." });
    refetch();
  };

  const markAllAsRead = async () => {
    if (!deviceId) return;
    await fetch(`/api/alerts/mark-all-read`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId }) });
    toast({ title: "All Alerts Read", description: "All alerts have been marked as read." });
    refetch();
  };

  const unreadCount = (alerts ?? []).filter(alert => !alert.isRead).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Alerts</h1>
          <p className="text-muted-foreground">
            Monitor system alerts and notifications
            {unreadCount > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unreadCount} unread
              </Badge>
            )}
          </p>
        </div>
        
        {unreadCount > 0 && (
          <Button onClick={markAllAsRead} disabled={!canControl}>
            <CheckCircle className="h-4 w-4 mr-2" />
            Mark All Read
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Alert List */}
        <div className="lg:col-span-2 space-y-4">
          {!alerts || alerts.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <CheckCircle className="h-12 w-12 mx-auto text-success mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Active Alerts</h3>
                <p className="text-muted-foreground">
                  Your mushroom system is running smoothly!
                </p>
              </CardContent>
            </Card>
          ) : (
            alerts.map((alert: any) => (
              <Card key={alert._id} className={`transition-all duration-200 ${!alert.isRead ? 'ring-2 ring-primary/20' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-lg ${
                        alert.severity === 'high' ? 'bg-destructive/10 text-destructive' :
                        alert.severity === 'medium' ? 'bg-warning/10 text-warning' :
                        'bg-muted'
                      }`}>
                        {getTypeIcon(alert.type)}
                      </div>
                      
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-semibold">{alert.title}</h4>
                          <Badge variant={getSeverityColor(alert.severity) as any}>
                            {alert.severity}
                          </Badge>
                          {!alert.isRead && (
                            <div className="w-2 h-2 bg-primary rounded-full" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mb-2">
                          {alert.description}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {alert.time ? new Date(alert.time).toLocaleString() : new Date(alert.createdAt).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-4">
                      {!alert.isRead && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => markAsRead(alert._id)}
                          disabled={!canControl}
                        >
                          <CheckCircle className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismissAlert(alert._id)}
                        disabled={!canControl}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        {/* Alert Settings */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-primary" />
                Alert Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Moisture Alerts</Label>
                  <Switch
                    checked={alertSettings.moistureAlerts}
                    onCheckedChange={(checked) => 
                      setAlertSettings(prev => ({ ...prev, moistureAlerts: checked }))
                    }
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <Label>Pump Alerts</Label>
                  <Switch
                    checked={alertSettings.pumpAlerts}
                    onCheckedChange={(checked) => 
                      setAlertSettings(prev => ({ ...prev, pumpAlerts: checked }))
                    }
                  />
                </div>
                
                <div className="flex items-center justify-between">
                  <Label>System Alerts</Label>
                  <Switch
                    checked={alertSettings.systemAlerts}
                    onCheckedChange={(checked) => 
                      setAlertSettings(prev => ({ ...prev, systemAlerts: checked }))
                    }
                  />
                </div>

                <Separator />
                
                <div className="flex items-center justify-between">
                  <Label>Email Notifications</Label>
                  <Switch
                    checked={alertSettings.emailNotifications}
                    onCheckedChange={(checked) => 
                      setAlertSettings(prev => ({ ...prev, emailNotifications: checked }))
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Low Moisture Alert (%)</Label>
                <Input
                  type="number"
                  value={alertSettings.lowMoistureThreshold}
                  onChange={(e) => 
                    setAlertSettings(prev => ({ 
                      ...prev, 
                      lowMoistureThreshold: parseInt(e.target.value) 
                    }))
                  }
                  min="0"
                  max="100"
                />
              </div>
              
              <div className="space-y-2">
                <Label>High Moisture Alert (%)</Label>
                <Input
                  type="number"
                  value={alertSettings.highMoistureThreshold}
                  onChange={(e) => 
                    setAlertSettings(prev => ({ 
                      ...prev, 
                      highMoistureThreshold: parseInt(e.target.value) 
                    }))
                  }
                  min="0"
                  max="100"
                />
              </div>

              <Button className="w-full" onClick={() => {
                toast({
                  title: "Settings Saved",
                  description: "Alert settings have been updated.",
                });
              }}>
                Save Settings
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}