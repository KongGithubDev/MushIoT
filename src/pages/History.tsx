 

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  History as HistoryIcon, 
  Download,
  Calendar,
  Droplets,
  Clock,
  Filter
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from "recharts";
import { useConnection } from "@/contexts/ConnectionContext";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

// Real history data will be fetched from API

export default function History() {
  const { online, checking, reconnect, canControl } = useConnection();
  const [searchParams] = useSearchParams();
  const deviceId = searchParams.get('deviceId') || undefined;
  const [dateFilter, setDateFilter] = useState({
    from: "2024-01-10",
    to: "2024-01-16"
  });

  // Compute days range for aggregation endpoints
  const daysRange = (() => {
    const from = Date.parse(dateFilter.from);
    const to = Date.parse(dateFilter.to);
    if (isNaN(from) || isNaN(to) || to <= from) return 7; // default
    const diffDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.min(diffDays, 60)); // cap 1..60 days
  })();

  // Moisture aggregation: [{date, avg, min, max}]
  const { data: moistureAgg } = useQuery<Array<{ date: string; avg: number; min: number; max: number }>>({
    queryKey: ["history-moisture", deviceId, daysRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      params.set('days', String(daysRange));
      const res = await fetch(`/api/history/moisture?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch moisture history: ${res.status}`);
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 30000,
  });

  // Watering summary aggregation: [{date, count, minutes}]
  const { data: wateringSummary } = useQuery<Array<{ date: string; count: number; minutes: number }>>({
    queryKey: ["history-watering-summary", deviceId, daysRange],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      params.set('days', String(daysRange));
      const res = await fetch(`/api/history/watering-summary?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch watering summary: ${res.status}`);
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 30000,
  });

  const exportToCSV = (data: any[], filename: string) => {
    const headers = Object.keys(data[0]).join(',');
    const csv = [headers, ...data.map(row => Object.values(row).join(','))].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  type WateringEvent = { _id: string; deviceId: string; startedAt?: string; endedAt?: string; triggeredBy: 'auto'|'manual'; createdAt: string };
  const { data: events, isFetching: fetchingEvents } = useQuery<WateringEvent[]>({
    queryKey: ["watering", deviceId, dateFilter.from, dateFilter.to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (deviceId) params.set('deviceId', deviceId);
      if (dateFilter.from) params.set('from', dateFilter.from);
      if (dateFilter.to) params.set('to', dateFilter.to);
      const res = await fetch(`/api/watering?${params.toString()}`);
      if (!res.ok) throw new Error(`Failed to fetch watering events: ${res.status}`);
      return res.json();
    },
    enabled: online === true,
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">History</h1>
          <p className="text-muted-foreground">View historical data and watering logs</p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Label>From:</Label>
            <Input
              type="date"
              value={dateFilter.from}
              onChange={(e) => setDateFilter(prev => ({ ...prev, from: e.target.value }))}
              className="w-40"
            />
          </div>
          <div className="flex items-center gap-2">
            <Label>To:</Label>
            <Input
              type="date"
              value={dateFilter.to}
              onChange={(e) => setDateFilter(prev => ({ ...prev, to: e.target.value }))}
              className="w-40"
            />
          </div>
        </div>
      </div>

      <Tabs defaultValue="watering" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="watering">Watering Events</TabsTrigger>
          <TabsTrigger value="moisture">Moisture History</TabsTrigger>
          <TabsTrigger value="summary">Daily Summary</TabsTrigger>
        </TabsList>

        <TabsContent value="watering" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-primary" />
                  Watering Events
                </CardTitle>
                <Button
                  onClick={() => exportToCSV((events ?? []).map(ev => ({
                    started: new Date(ev.startedAt ?? ev.createdAt).toISOString(),
                    ended: ev.endedAt ? new Date(ev.endedAt).toISOString() : '',
                    triggeredBy: (ev as any).triggeredBy,
                  })), 'watering-events.csv')}
                  variant="outline"
                  disabled={!canControl}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Started</TableHead>
                    <TableHead>Ended</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Trigger</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(events && events.length > 0 ? events : []).map((ev) => {
                    const started = ev.startedAt ? new Date(ev.startedAt) : new Date(ev.createdAt);
                    const ended = ev.endedAt ? new Date(ev.endedAt) : undefined;
                    const durationMin = ended ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60000)) : undefined;
                    return (
                      <TableRow key={ev._id}>
                        <TableCell>
                          <div>
                            <div className="font-medium">{started.toLocaleDateString()}</div>
                            <div className="text-sm text-muted-foreground">{started.toLocaleTimeString()}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {ended ? (
                            <>
                              <div className="font-medium">{ended.toLocaleDateString()}</div>
                              <div className="text-sm text-muted-foreground">{ended.toLocaleTimeString()}</div>
                            </>
                          ) : (
                            <Badge variant="secondary">Running</Badge>
                          )}
                        </TableCell>
                        <TableCell>{durationMin !== undefined ? `${durationMin} min` : '-'}</TableCell>
                        <TableCell>
                          <Badge variant={ev.triggeredBy === 'manual' ? 'secondary' : 'default'}>
                            {ev.triggeredBy}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* No mock fallback; show empty if no events */}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="moisture" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <HistoryIcon className="h-5 w-5 text-primary" />
                  Moisture History (7 days)
                </CardTitle>
                <Button
                  onClick={() => exportToCSV((moistureAgg ?? []), 'moisture-history.csv')}
                  variant="outline"
                  disabled={!canControl}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={moistureAgg ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="date" 
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
                      dataKey="avg" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={3}
                      dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 4 }}
                      name="Average Moisture"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="min" 
                      stroke="hsl(var(--destructive))" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Minimum"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="max" 
                      stroke="hsl(var(--success))" 
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      dot={false}
                      name="Maximum"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-primary" />
                  Daily Watering Count
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={wateringSummary ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis 
                        dataKey="date" 
                        className="text-muted-foreground"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis 
                        className="text-muted-foreground"
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Bar 
                        dataKey="count" 
                        fill="hsl(var(--primary))" 
                        radius={[4, 4, 0, 0]}
                        name="Watering Sessions"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Droplets className="h-5 w-5 text-primary" />
                  Daily Watering Minutes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={wateringSummary ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis 
                        dataKey="date" 
                        className="text-muted-foreground"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis 
                        className="text-muted-foreground"
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip 
                        contentStyle={{
                          backgroundColor: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Bar 
                        dataKey="minutes" 
                        fill="hsl(var(--success))" 
                        radius={[4, 4, 0, 0]}
                        name="Watering Minutes"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Weekly Summary</CardTitle>
            </CardHeader>
            <CardContent>
              {(() => {
                const ws = wateringSummary ?? [];
                const mh = moistureAgg ?? [];
                const totalSessions = ws.reduce((acc, r) => acc + (r.count || 0), 0);
                const totalMinutes = ws.reduce((acc, r) => acc + (r.minutes || 0), 0);
                const avgDuration = totalSessions > 0 ? (totalMinutes / totalSessions) : 0;
                const avgMoisture = mh.length > 0 ? Math.round(mh.reduce((acc, r) => acc + (r.avg || 0), 0) / mh.length) : 0;
                return (
              <div className="grid gap-6 md:grid-cols-4">
                <div className="text-center p-4 rounded-lg bg-primary/5">
                  <div className="text-2xl font-bold text-primary">{totalSessions}</div>
                  <div className="text-sm text-muted-foreground">Total Sessions</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-success/5">
                  <div className="text-2xl font-bold text-success">{totalMinutes} min</div>
                  <div className="text-sm text-muted-foreground">Total Watering Time</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-warning/5">
                  <div className="text-2xl font-bold text-warning">{avgDuration.toFixed(1)} min</div>
                  <div className="text-sm text-muted-foreground">Avg Duration</div>
                </div>
                <div className="text-center p-4 rounded-lg bg-muted">
                  <div className="text-2xl font-bold text-foreground">{avgMoisture}%</div>
                  <div className="text-sm text-muted-foreground">Avg Moisture</div>
                </div>
              </div>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}