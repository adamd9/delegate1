import React from "react";
import { Button } from "@/components/ui/button";
import { PhoneCall, Bot } from "lucide-react";
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
  <Link
    href="/voice"
    className="flex items-center gap-2"
    target="_blank"
    rel="noopener noreferrer"
  >
    <PhoneCall className="w-4 h-4" />
    Voice
  </Link>
</Button>
      </div>
    </div>
  );
};

export default TopBar;
