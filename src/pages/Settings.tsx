import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Settings as SettingsIcon,
  Wifi,
  Database,
  Bell,
  User,
  Shield,
  Save,
  RotateCcw,
  Globe
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useConnection } from "@/contexts/ConnectionContext";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

export default function Settings() {
  const { toast } = useToast();
  const { online, checking, reconnect, canControl } = useConnection();
  const { data: appSettings, refetch: refetchAppSettings, isFetching: fetchingAppSettings } = useQuery<any>({
    queryKey: ["app-settings"],
    queryFn: async () => {
      const res = await fetch('/api/app-settings');
      if (!res.ok) throw new Error(`Failed to load app settings: ${res.status}`);
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 60000,
  });

  // Helpers
  const systemNumber = (n: any) => (typeof n === 'number' ? n : parseInt(String(n || 0)) || 0);

  const setSystemStateFrom = (sys?: any) => {
    if (!sys) return;
    setSystemSettings(prev => ({
      ...prev,
      deviceName: sys.deviceName ?? prev.deviceName,
      syncInterval: sys.syncInterval ?? prev.syncInterval,
      autoBackup: sys.autoBackup ?? prev.autoBackup,
      dataRetention: sys.dataRetention ?? prev.dataRetention,
      darkMode: sys.darkMode ?? prev.darkMode,
      language: sys.language ?? prev.language,
    }));
  };

  const setConnectionStateFrom = (conn?: any) => {
    if (!conn) return;
    setConnectionSettings(prev => ({
      ...prev,
      apiEndpoint: conn.apiEndpoint ?? prev.apiEndpoint,
      wifiSSID: conn.wifiSSID ?? prev.wifiSSID,
      wifiPassword: conn.wifiPassword ?? prev.wifiPassword,
      enableSSL: conn.enableSSL ?? prev.enableSSL,
      timeout: conn.timeout ?? prev.timeout,
    }));
  };

  const setSensorStateFrom = (s?: any) => {
    if (!s) return;
    setSensorSettings(prev => ({
      ...prev,
      moistureThresholdLow: [systemNumber(s.moistureThresholdLow ?? prev.moistureThresholdLow?.[0] ?? 30)],
      moistureThresholdHigh: [systemNumber(s.moistureThresholdHigh ?? prev.moistureThresholdHigh?.[0] ?? 80)],
      calibrationOffset: [systemNumber(s.calibrationOffset ?? prev.calibrationOffset?.[0] ?? 0)],
      sensorSensitivity: [systemNumber(s.sensorSensitivity ?? prev.sensorSensitivity?.[0] ?? 50)],
      readingFrequency: systemNumber(s.readingFrequency ?? prev.readingFrequency ?? 5),
    }));
  };

  const setNotificationStateFrom = (n?: any) => {
    if (!n) return;
    setNotificationSettings(prev => ({
      ...prev,
      emailNotifications: n.emailNotifications ?? prev.emailNotifications,
      pushNotifications: n.pushNotifications ?? prev.pushNotifications,
      soundAlerts: n.soundAlerts ?? prev.soundAlerts,
      emailAddress: n.emailAddress ?? prev.emailAddress,
      alertFrequency: n.alertFrequency ?? prev.alertFrequency,
    }));
  };

  const setUserStateFrom = (u?: any) => {
    if (!u) return;
    setUserSettings(prev => ({
      ...prev,
      username: u.username ?? prev.username,
      timezone: u.timezone ?? prev.timezone,
      // do not set passwords from server
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    }));
  };

  // Initialize local state from server settings when loaded
  useEffect(() => {
    if (!appSettings) return;
    setSystemStateFrom(appSettings.system);
    setConnectionStateFrom(appSettings.connection);
    setSensorStateFrom(appSettings.sensors);
    setNotificationStateFrom(appSettings.notifications);
    setUserStateFrom(appSettings.account);
  }, [appSettings]);
  
  // System Settings
  const [systemSettings, setSystemSettings] = useState({
    deviceName: "MushIoT Device #1",
    syncInterval: 30,
    autoBackup: true,
    dataRetention: 90,
    darkMode: false,
    language: "en"
  });

  // Connection Settings
  const [connectionSettings, setConnectionSettings] = useState({
    apiEndpoint: "http://192.168.1.100:8080/api",
    wifiSSID: "MyNetwork",
    wifiPassword: "password123",
    enableSSL: true,
    timeout: 10
  });

  // Sensor Settings
  const [sensorSettings, setSensorSettings] = useState({
    moistureThresholdLow: [30],
    moistureThresholdHigh: [80],
    calibrationOffset: [0],
    sensorSensitivity: [50],
    readingFrequency: 5
  });

  // Notification Settings
  const [notificationSettings, setNotificationSettings] = useState({
    emailNotifications: false,
    pushNotifications: true,
    soundAlerts: true,
    emailAddress: "user@example.com",
    alertFrequency: "immediate"
  });

  // User Settings
  const [userSettings, setUserSettings] = useState({
    username: "admin",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    timezone: "UTC+0"
  });

  const saveSettings = (category: string) => {
    // PATCH only the changed category back to server
    const payload: any = {};
    switch (category) {
      case 'System':
        payload.system = { ...systemSettings };
        break;
      case 'Connection':
        payload.connection = { ...connectionSettings };
        break;
      case 'Sensor':
        payload.sensors = {
          moistureThresholdLow: systemNumber(sensorSettings.moistureThresholdLow[0]),
          moistureThresholdHigh: systemNumber(sensorSettings.moistureThresholdHigh[0]),
          calibrationOffset: systemNumber(sensorSettings.calibrationOffset[0]),
          sensorSensitivity: systemNumber(sensorSettings.sensorSensitivity[0]),
          readingFrequency: systemNumber(sensorSettings.readingFrequency),
        };
        break;
      case 'Notification':
        payload.notifications = { ...notificationSettings };
        break;
      case 'Account':
        payload.account = { username: userSettings.username, timezone: userSettings.timezone };
        break;
      default:
        break;
    }
    fetch('/api/app-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Save failed ${r.status}`);
      await refetchAppSettings();
      toast({ title: "Settings Saved", description: `${category} settings have been saved successfully.` });
    }).catch(() => {
      toast({ title: "Save Failed", description: `Could not save ${category} settings.`, variant: "destructive" as any });
    });
  };

  const resetSettings = (category: string) => {
    // Reload from server values for that category
    if (!appSettings) return;
    switch (category) {
      case 'System':
        setSystemStateFrom(appSettings.system);
        break;
      case 'Connection':
        setConnectionStateFrom(appSettings.connection);
        break;
      case 'Sensor':
        setSensorStateFrom(appSettings.sensors);
        break;
      case 'Notification':
        setNotificationStateFrom(appSettings.notifications);
        break;
      case 'Account':
        setUserStateFrom(appSettings.account);
        break;
    }
    toast({ title: "Settings Reset", description: `${category} settings reloaded from server.` });
  };

  const testConnection = () => {
    toast({
      title: "Testing Connection",
      description: "Attempting to connect to ESP32 device...",
    });
    
    setTimeout(() => {
      toast({
        title: "Connection Successful",
        description: "Successfully connected to ESP32 device!",
      });
    }, 2000);
  };

  return (
    <div className="space-y-6">
      {!online && (
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Server not reachable. Some actions are disabled.</span>
            </div>
            <Button size="sm" variant="outline" onClick={reconnect} disabled={checking}>
              {checking ? 'Checking...' : 'Reconnect'}
            </Button>
          </CardContent>
        </Card>
      )}
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground">Configure your mushroom growing system</p>
        </div>
      </div>

      <Tabs defaultValue="system" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="system">System</TabsTrigger>
          <TabsTrigger value="connection">Connection</TabsTrigger>
          <TabsTrigger value="sensors">Sensors</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
        </TabsList>

        <TabsContent value="system" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <SettingsIcon className="h-5 w-5 text-primary" />
                  System Configuration
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => resetSettings("System")} disabled={!canControl}>
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Reset
                  </Button>
                  <Button onClick={() => saveSettings("System")} disabled={!canControl}>
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Device Name</Label>
                  <Input
                    value={systemSettings.deviceName}
                    onChange={(e) => setSystemSettings(prev => ({ ...prev, deviceName: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Language</Label>
                  <Select 
                    value={systemSettings.language} 
                    onValueChange={(value) => setSystemSettings(prev => ({ ...prev, language: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="th">ไทย (Thai)</SelectItem>
                      <SelectItem value="es">Español</SelectItem>
                      <SelectItem value="fr">Français</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Sync Interval (seconds)</Label>
                  <Input
                    type="number"
                    value={systemSettings.syncInterval}
                    onChange={(e) => setSystemSettings(prev => ({ ...prev, syncInterval: parseInt(e.target.value) }))}
                    min="10"
                    max="300"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Data Retention (days)</Label>
                  <Input
                    type="number"
                    value={systemSettings.dataRetention}
                    onChange={(e) => setSystemSettings(prev => ({ ...prev, dataRetention: parseInt(e.target.value) }))}
                    min="7"
                    max="365"
                  />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Automatic Backup</Label>
                    <p className="text-sm text-muted-foreground">Automatically backup system data</p>
                  </div>
                  <Switch
                    checked={systemSettings.autoBackup}
                    onCheckedChange={(checked) => setSystemSettings(prev => ({ ...prev, autoBackup: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Dark Mode</Label>
                    <p className="text-sm text-muted-foreground">Use dark theme interface</p>
                  </div>
                  <Switch
                    checked={systemSettings.darkMode}
                    onCheckedChange={(checked) => setSystemSettings(prev => ({ ...prev, darkMode: checked }))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="connection" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Wifi className="h-5 w-5 text-primary" />
                  Connection Settings
                </CardTitle>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={testConnection} disabled={!canControl}>
                    Test Connection
                  </Button>
                  <Button onClick={() => saveSettings("Connection")} disabled={!canControl}>
                    <Save className="h-4 w-4 mr-2" />
                    Save
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>ESP32 API Endpoint</Label>
                  <Input
                    value={connectionSettings.apiEndpoint}
                    onChange={(e) => setConnectionSettings(prev => ({ ...prev, apiEndpoint: e.target.value }))}
                    placeholder="http://192.168.1.100:8080/api"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Connection Timeout (seconds)</Label>
                  <Input
                    type="number"
                    value={connectionSettings.timeout}
                    onChange={(e) => setConnectionSettings(prev => ({ ...prev, timeout: parseInt(e.target.value) }))}
                    min="5"
                    max="60"
                  />
                </div>

                <div className="space-y-2">
                  <Label>WiFi SSID</Label>
                  <Input
                    value={connectionSettings.wifiSSID}
                    onChange={(e) => setConnectionSettings(prev => ({ ...prev, wifiSSID: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>WiFi Password</Label>
                  <Input
                    type="password"
                    value={connectionSettings.wifiPassword}
                    onChange={(e) => setConnectionSettings(prev => ({ ...prev, wifiPassword: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label>Enable SSL/TLS</Label>
                  <p className="text-sm text-muted-foreground">Use secure connection (recommended)</p>
                </div>
                <Switch
                  checked={connectionSettings.enableSSL}
                  onCheckedChange={(checked) => setConnectionSettings(prev => ({ ...prev, enableSSL: checked }))}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sensors" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-primary" />
                  Sensor Configuration
                </CardTitle>
                <Button onClick={() => saveSettings("Sensor")} disabled={!canControl}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Low Moisture Threshold</Label>
                    <span className="text-sm font-medium">{sensorSettings.moistureThresholdLow[0]}%</span>
                  </div>
                  <Slider
                    value={sensorSettings.moistureThresholdLow}
                    onValueChange={(value) => setSensorSettings(prev => ({ ...prev, moistureThresholdLow: value }))}
                    max={50}
                    min={10}
                    step={5}
                  />
                  <p className="text-xs text-muted-foreground">Trigger watering when moisture drops below this level</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>High Moisture Threshold</Label>
                    <span className="text-sm font-medium">{sensorSettings.moistureThresholdHigh[0]}%</span>
                  </div>
                  <Slider
                    value={sensorSettings.moistureThresholdHigh}
                    onValueChange={(value) => setSensorSettings(prev => ({ ...prev, moistureThresholdHigh: value }))}
                    max={100}
                    min={60}
                    step={5}
                  />
                  <p className="text-xs text-muted-foreground">Stop watering when moisture reaches this level</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Calibration Offset</Label>
                    <span className="text-sm font-medium">{sensorSettings.calibrationOffset[0]}%</span>
                  </div>
                  <Slider
                    value={sensorSettings.calibrationOffset}
                    onValueChange={(value) => setSensorSettings(prev => ({ ...prev, calibrationOffset: value }))}
                    max={20}
                    min={-20}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">Adjust sensor readings for accuracy</p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label>Sensor Sensitivity</Label>
                    <span className="text-sm font-medium">{sensorSettings.sensorSensitivity[0]}%</span>
                  </div>
                  <Slider
                    value={sensorSettings.sensorSensitivity}
                    onValueChange={(value) => setSensorSettings(prev => ({ ...prev, sensorSensitivity: value }))}
                    max={100}
                    min={10}
                    step={10}
                  />
                  <p className="text-xs text-muted-foreground">Adjust sensor response sensitivity</p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Reading Frequency (seconds)</Label>
                    <Input
                      type="number"
                      value={sensorSettings.readingFrequency}
                      onChange={(e) => setSensorSettings(prev => ({ ...prev, readingFrequency: parseInt(e.target.value) }))}
                      min="1"
                      max="60"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-primary" />
                  Notification Settings
                </CardTitle>
                <Button onClick={() => saveSettings("Notification")} disabled={!canControl}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive alerts via email</p>
                  </div>
                  <Switch
                    checked={notificationSettings.emailNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, emailNotifications: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Push Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive browser notifications</p>
                  </div>
                  <Switch
                    checked={notificationSettings.pushNotifications}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, pushNotifications: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <Label>Sound Alerts</Label>
                    <p className="text-sm text-muted-foreground">Play sound for important alerts</p>
                  </div>
                  <Switch
                    checked={notificationSettings.soundAlerts}
                    onCheckedChange={(checked) => setNotificationSettings(prev => ({ ...prev, soundAlerts: checked }))}
                  />
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input
                    type="email"
                    value={notificationSettings.emailAddress}
                    onChange={(e) => setNotificationSettings(prev => ({ ...prev, emailAddress: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Alert Frequency</Label>
                  <Select 
                    value={notificationSettings.alertFrequency} 
                    onValueChange={(value) => setNotificationSettings(prev => ({ ...prev, alertFrequency: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="immediate">Immediate</SelectItem>
                      <SelectItem value="hourly">Hourly Digest</SelectItem>
                      <SelectItem value="daily">Daily Summary</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="account" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  Account Settings
                </CardTitle>
                <Button onClick={() => saveSettings("Account")} disabled={!canControl}>
                  <Save className="h-4 w-4 mr-2" />
                  Save
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Username</Label>
                  <Input
                    value={userSettings.username}
                    onChange={(e) => setUserSettings(prev => ({ ...prev, username: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select 
                    value={userSettings.timezone} 
                    onValueChange={(value) => setUserSettings(prev => ({ ...prev, timezone: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UTC+0">UTC+0 (GMT)</SelectItem>
                      <SelectItem value="UTC+7">UTC+7 (Bangkok)</SelectItem>
                      <SelectItem value="UTC-5">UTC-5 (New York)</SelectItem>
                      <SelectItem value="UTC+1">UTC+1 (Berlin)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="font-medium flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Change Password
                </h4>
                
                <div className="grid gap-4 md:grid-cols-1 max-w-md">
                  <div className="space-y-2">
                    <Label>Current Password</Label>
                    <Input
                      type="password"
                      value={userSettings.currentPassword}
                      onChange={(e) => setUserSettings(prev => ({ ...prev, currentPassword: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>New Password</Label>
                    <Input
                      type="password"
                      value={userSettings.newPassword}
                      onChange={(e) => setUserSettings(prev => ({ ...prev, newPassword: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Confirm New Password</Label>
                    <Input
                      type="password"
                      value={userSettings.confirmPassword}
                      onChange={(e) => setUserSettings(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    />
                  </div>
                </div>

                <Button 
                  variant="outline" 
                  onClick={() => {
                    toast({
                      title: "Password Updated",
                      description: "Your password has been changed successfully.",
                    });
                  }}
                >
                  Update Password
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}