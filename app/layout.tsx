import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Moments · KBC challenge PoC",
  description: "A bank that earns the right to speak: customer understanding, an attention gate and a silence log.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
