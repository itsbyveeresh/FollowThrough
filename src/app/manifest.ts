import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/today",
    name: "FollowThrough",
    short_name: "FollowThrough",
    description: "Follow-ups, waiting-on items and next actions.",
    start_url: "/today",
    scope: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#1f5f7a",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
