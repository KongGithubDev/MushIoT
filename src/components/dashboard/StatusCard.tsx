import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface StatusCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: ReactNode;
  status: "success" | "warning" | "destructive" | "default";
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  description?: string;
}

const statusStyles = {
  success: "text-success border-success/20 bg-success/5",
  warning: "text-warning border-warning/20 bg-warning/5",
  destructive: "text-destructive border-destructive/20 bg-destructive/5",
  default: "text-muted-foreground border-border bg-muted/5"
};

export function StatusCard({ 
  title, 
  value, 
  unit, 
  icon, 
  status, 
  change, 
  changeType = "neutral",
  description 
}: StatusCardProps) {
  return (
    <Card className={cn(
      "transition-all duration-200 hover:shadow-medium border",
      statusStyles[status]
    )}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className={cn("p-2 rounded-lg", 
          status === "success" && "bg-success/10",
          status === "warning" && "bg-warning/10", 
          status === "destructive" && "bg-destructive/10",
          status === "default" && "bg-muted"
        )}>
          {icon}
        </div>
      </CardHeader>
      
      <CardContent>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-foreground">{value}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
        
        {change && (
          <div className="flex items-center gap-2 mt-2">
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs",
                changeType === "positive" && "bg-success/10 text-success",
                changeType === "negative" && "bg-destructive/10 text-destructive"
              )}
            >
              {change}
            </Badge>
            {description && (
              <span className="text-xs text-muted-foreground">{description}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}