import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TranscriptProvider } from "@/contexts/TranscriptContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "OpenAI Realtime + Twilio",
  description:
    "Sample phone call assistant app for OpenAI Realtime API and Twilio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <TranscriptProvider>
          {children}
        </TranscriptProvider>
      </body>
    </html>
  );
}
