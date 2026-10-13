import "./globals.css";import "./forms.css";import "./enhancements.css";import type { Metadata } from "next";
export const metadata:Metadata={title:"OceanBrown Agent",description:"WhatsApp customer operations for growing businesses"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
