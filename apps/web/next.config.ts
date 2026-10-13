import type { NextConfig } from "next";
// Windows developer accounts may not have symlink permission. Docker/VPS builds opt into standalone output.
const config:NextConfig={output:process.env.BUILD_STANDALONE==="true"?"standalone":undefined};export default config;
