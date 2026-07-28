/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Allow dynamic vendor / delivery asset images served from Supabase Storage.
    // Replace <your-project-ref> with the actual Supabase project ref once provisioned.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
