import type { Metadata } from "next";
import localFont from "next/font/local";
import { Orbitron } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

const geist = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["900"],
  variable: "--font-orbitron",
});

export const metadata: Metadata = {
  title: "Self Agent ID",
  description: "Register AI agents with proof-of-human via Self Protocol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} ${orbitron.variable} antialiased`}>
        <Navbar />
        {children}
        <Footer />
      </body>
    </html>
  );
}
