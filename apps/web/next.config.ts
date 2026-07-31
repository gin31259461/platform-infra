import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@gitlab-runner-platform/contracts",
    "@gitlab-runner-platform/domain",
  ],
};

export default nextConfig;
