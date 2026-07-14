import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";
import "../styles/dashboard.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Dashboard Sanus · Live",
  description: "Dashboard de indicadores Sanus",
  icons: { icon: "/assets/logo_sanus.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <head>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css"
        />
      </head>
      <body className={`${inter.className} auth-locked`}>
        {children}
        <Script
          src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
