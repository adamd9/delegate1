"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { PhoneCall, Bot, Settings as SettingsIcon, Mic, Menu } from "lucide-react";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface TopBarProps {
  children?: React.ReactNode;
}

const TopBar = ({ children }: TopBarProps) => {
  const handleMobileNav = (value: string) => {
    if (typeof window === "undefined") return;

    if (value === "/settings") {
      window.location.href = value;
      return;
    }

    window.open(value, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex justify-between items-center px-6 py-4 border-b">
      <div className="flex items-center gap-4">
      <Bot className="w-10 h-10" />
        <h1 className="text-xl font-semibold">HK</h1>
      </div>
      <div className="flex gap-3 items-center">
        {children}

        {/* Mobile: collapse menu actions into a dropdown */}
        <div className="md:hidden">
          <Select onValueChange={handleMobileNav}>
            <SelectTrigger className="w-[150px]">
              <Menu className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Menu" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="/settings">Settings</SelectItem>
              <SelectItem value="/voice">Twilio Voice</SelectItem>
              <SelectItem value="/voice-direct">Direct Voice</SelectItem>
              <SelectItem value="/miniapps/client_side_wake_word/index.html">
                Wakeword Demo
              </SelectItem>
              <SelectItem value="/miniapps/wakeword_direct_voice/index.html">
                Wakeword Direct Voice
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Desktop: keep existing buttons */}
        <div className="hidden md:flex gap-3 items-center">
          <Button variant="ghost" size="sm">
            <Link href="/settings" className="flex items-center gap-2">
              <SettingsIcon className="w-4 h-4" />
              Settings
            </Link>
          </Button>
          <Button variant="ghost" size="sm">
            <Link
              href="/voice"
              className="flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <PhoneCall className="w-4 h-4" />
              Twilio Voice
            </Link>
          </Button>
          <Button variant="ghost" size="sm">
            <Link
              href="/voice-direct"
              className="flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <PhoneCall className="w-4 h-4" />
              Direct Voice
            </Link>
          </Button>
          <Button variant="ghost" size="sm">
            <Link
              href="/miniapps/client_side_wake_word/index.html"
              className="flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Mic className="w-4 h-4" />
              Wakeword Demo
            </Link>
          </Button>
          <Button variant="ghost" size="sm">
            <Link
              href="/miniapps/wakeword_direct_voice/index.html"
              className="flex items-center gap-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Mic className="w-4 h-4" />
              Wakeword Direct Voice
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default TopBar;
