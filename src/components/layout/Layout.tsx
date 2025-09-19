import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { useSidebar } from "@/contexts/SidebarContext";
import { useConnection } from "@/contexts/ConnectionContext";

export function Layout() {
  const { sidebarOpen, toggleSidebar } = useSidebar();
  const { online, checking, reconnect } = useConnection();

  return (
    <div className="flex min-h-screen w-full bg-background">
      <Sidebar isOpen={sidebarOpen} onToggle={toggleSidebar} />
      
      <div className={`flex-1 transition-all duration-300 ${sidebarOpen ? 'ml-sidebar' : 'ml-16'}`}>
        <Header onMenuClick={toggleSidebar} />
        <main className="p-6 pt-[calc(var(--header-height)+16px)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}