import { NavLink } from "react-router-dom";
import { 
  LayoutDashboard, 
  Settings, 
  AlertTriangle, 
  History, 
  MessageCircle, 
  Sliders,
  ChevronLeft,
  Shield
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Control Panel", href: "/control", icon: Sliders },
  { name: "Alerts", href: "/alerts", icon: AlertTriangle },
  { name: "History", href: "/history", icon: History },
  { name: "AI Chat", href: "/chat", icon: MessageCircle },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar({ isOpen, onToggle }: SidebarProps) {
  const { user } = useAuth();
  return (
    <aside className={cn(
      "fixed left-0 top-0 z-50 h-full bg-card border-r border-border transition-all duration-300 shadow-medium",
      isOpen ? "w-sidebar" : "w-16"
    )}>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border h-header">
          {isOpen && (
            <div className="flex items-center gap-3">
              <span className="text-2xl font-extrabold tracking-wide text-foreground select-none">MushIoT</span>
            </div>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggle}
            className={cn(
              "h-8 w-8 rounded-lg",
              !isOpen && "mx-auto"
            )}
          >
            <ChevronLeft className={cn(
              "h-4 w-4 transition-transform duration-200",
              !isOpen && "rotate-180"
            )} />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {navigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.href}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  !isOpen && "justify-center"
                )
              }
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {isOpen && (
                <span className="font-medium">{item.name}</span>
              )}
              
              {/* Tooltip for collapsed state */}
              {!isOpen && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-sm rounded-md shadow-medium opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                  {item.name}
                </div>
              )}
            </NavLink>
          ))}
          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group relative",
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent",
                  !isOpen && "justify-center"
                )
              }
            >
              <Shield className="h-5 w-5 flex-shrink-0" />
              {isOpen && (
                <span className="font-medium">Admin</span>
              )}
              {!isOpen && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-sm rounded-md shadow-medium opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-50">
                  Admin
                </div>
              )}
            </NavLink>
          )}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border h-[72px] flex items-center justify-center">
          {isOpen ? (
            <div className="text-xs text-muted-foreground text-center">
              <div>MushIoT v1.0</div>
              <div>ESP32 Connected</div>
            </div>
          ) : (
            <div className="w-2 h-2 rounded-full bg-success mx-auto" title="ESP32 Connected" />
          )}
        </div>
      </div>
    </aside>
  );
}