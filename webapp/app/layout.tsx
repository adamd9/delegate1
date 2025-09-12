import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { TranscriptProvider } from "@/contexts/TranscriptContext";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Delegate (HK-47)",
  description:
    "A smart AI assistant accessible via phone, text, and chat, a delegate for you.",
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
