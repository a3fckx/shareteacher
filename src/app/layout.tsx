import type { Metadata } from "next";
import "./globals.css";
import "@runwayml/avatars-react/styles.css";

export const metadata: Metadata = {
  title: "ShareTeacher",
  description: "Runway-first AI meeting teacher",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-ink text-[#e7ecf3] antialiased">
        {children}
      </body>
    </html>
  );
}
