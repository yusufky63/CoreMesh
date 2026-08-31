import type { Metadata } from 'next';
import { Inter, Space_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const spaceMono = Space_Mono({
  variable: '--font-space-mono',
  weight: ['400', '700'],
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'CoreMesh — Agent Operations Network',
  description: 'Connect agents. Coordinate work. Verify outcomes.',
  referrer: 'no-referrer',
  icons: { icon: '/icon.svg' },
  openGraph: {
    type: 'website',
    title: 'CORE/MESH',
    description: 'Connect agents. Coordinate work. Verify outcomes.',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'CORE/MESH protocol cartography',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'CORE/MESH',
    description: 'Connect agents. Coordinate work. Verify outcomes.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} ${spaceMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
