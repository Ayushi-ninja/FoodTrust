import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FoodTrust Backend",
  description: "AI + IoT Smart Food Waste Monitoring & Redistribution System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "sans-serif" }}>{children}</body>
    </html>
  );
}
