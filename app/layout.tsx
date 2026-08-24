import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pothos · מערכת ניהול ניסוי",
  description: "ניהול תחרות הדיוק, תיעוד תוצאות והקרנה למשתתפים",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
