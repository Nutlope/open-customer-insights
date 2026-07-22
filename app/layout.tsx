import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import { APP_NAME } from "@/lib/constants";
import { SourceDetailModalProvider } from "@/components/source-detail-renderer";
import ConvexClientProvider from "./ConvexClientProvider";
import { CmdkPalette } from "./components/CmdkPalette";
import { CmdkProvider } from "./components/CmdkProvider";
import RootAppShell from "./components/RootAppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: `${APP_NAME} — MCP`,
  description:
    "MCP server exposing search over call transcripts, support tickets, and Slack context. Ask questions about customer feedback directly from Claude Code or any MCP-compatible agent.",
  keywords: ["MCP", "Together AI", "customer insights", "vector search", "Slack", "Claude Code"],
  openGraph: {
    title: `${APP_NAME} — MCP`,
    description:
      "Search call transcripts, support tickets, and Slack context with natural language via MCP.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} data-theme="light" suppressHydrationWarning>
        <body className="antialiased">
          <ConvexClientProvider>
            <SourceDetailModalProvider>
              <CmdkProvider>
                <RootAppShell>{children}</RootAppShell>
                <CmdkPalette />
              </CmdkProvider>
            </SourceDetailModalProvider>
          </ConvexClientProvider>
          <Toaster />
        </body>
      </html>
    </ClerkProvider>
  );
}
