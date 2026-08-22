import type { Metadata } from "next";
import "./globals.css";

// #272: the product no longer builds a tailored draft before sign-up, so the title and link
// preview stop selling one. What the front door actually does: reads the CV into facts the person
// confirms, then finds live jobs that match the target role.
export const metadata: Metadata = {
  title: "JobCrush — your CV, read into facts and matched to real jobs",
  description:
    "Upload or paste your CV. JobCrush reads it into facts you confirm, then finds live job postings that match your target role.",
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
