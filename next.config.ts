import type { NextConfig } from "next";

// AX렌즈 웹 편입 시 BASE_PATH=/map 으로 빌드·실행 (로컬 설치판은 미설정 → 기존 그대로)
const basePath = process.env.BASE_PATH || "";

const nextConfig: NextConfig = {
  basePath,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
