import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://coremesh-mu.vercel.app'),
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
  // Fonts are self-hosted through app/fonts.css and exposed as CSS variables
  // in globals.css, so no runtime font loader is involved.
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
