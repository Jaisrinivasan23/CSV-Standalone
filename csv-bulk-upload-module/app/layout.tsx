import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSV Bulk Upload - Poster Generation",
  description: "Standalone CSV bulk upload module for poster generation with AWS Lambda parallel processing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
