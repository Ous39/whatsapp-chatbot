import "./globals.css";import "./forms.css";import "./enhancements.css";import "./onboarding.css";import type { Metadata } from "next";
export const metadata:Metadata={title:"OceanBrown Connect",description:"Customer messaging operations for growing businesses"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
