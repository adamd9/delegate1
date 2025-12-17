import React from "react";
import { Button } from "@/components/ui/button";
import { PhoneCall, Bot, Settings as SettingsIcon, Mic } from "lucide-react";
import Link from "next/link";

interface TopBarProps {
  children?: React.ReactNode;
}

const TopBar = ({ children }: TopBarProps) => {
  return (
    <div className="flex justify-between items-center px-6 py-4 border-b">
      <div className="flex items-center gap-4">
      <Bot className="w-10 h-10" />
        <h1 className="text-xl font-semibold">HK</h1>
      </div>
      <div className="flex gap-3 items-center">
        {children}
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
      </div>
    </div>
  );
};

export default TopBar;
