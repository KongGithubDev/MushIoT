import { Bot } from "lucide-react";
import { useSidebar } from "@/contexts/SidebarContext";

export default function ChatHeader() {
  const { sidebarOpen } = useSidebar();
  
  return (
    <div className={`fixed top-header right-0 z-40 border-b bg-background/95 backdrop-blur-sm shadow-sm transition-all duration-300 ${sidebarOpen ? 'left-sidebar' : 'left-16'}`}>
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">MushBot</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              Online • Ready to help
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}