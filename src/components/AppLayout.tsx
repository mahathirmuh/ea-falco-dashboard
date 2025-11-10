import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { FileImage, Shield, PenSquare } from "lucide-react";

type AppLayoutProps = {
  title?: string;
  children: React.ReactNode;
};

export const AppLayout: React.FC<AppLayoutProps> = ({ title, children }) => {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path;

  return (
    <SidebarProvider>
      <Sidebar variant="inset" collapsible="offcanvas" side="left">
        <SidebarHeader>
          <div className="px-2 py-1">
            <span className="text-sm font-semibold">Data Interpret Kit</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <Link to="/" className="contents">
                <SidebarMenuButton isActive={isActive("/")}> 
                  <FileImage />
                  <span>ID Card Processor</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link to="/register-vault" className="contents">
                <SidebarMenuButton isActive={isActive("/register-vault")}> 
                  <Shield />
                  <span>Register Vault</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <Link to="/update-vault" className="contents">
                <SidebarMenuButton isActive={isActive("/update-vault")}> 
                  <PenSquare />
                  <span>Update Vault Card</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className={cn("flex items-center gap-2 px-4 py-3 border-b")}> 
          <SidebarTrigger />
          <h1 className="text-lg font-semibold">{title}</h1>
        </header>
        <div className="container mx-auto px-4 py-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
};

export default AppLayout;