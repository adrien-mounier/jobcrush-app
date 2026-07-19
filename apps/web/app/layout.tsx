import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JobCrush — see your CV tailored to a real job in 2 minutes",
  description:
    "Upload your CV and instantly see it tailored to a live job posting that matches your target roles.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="brandbar">
          <div>
            <a href="/">JobCrush</a>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
