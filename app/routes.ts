import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("embed", "routes/embed.ts"),
  route("jina-embed", "routes/jina-embed.ts"),
  route("multimodal", "routes/multimodal.tsx"),
  route("faces", "routes/faces.tsx"),
  route("faces/manage", "routes/faces.manage.tsx"),
] satisfies RouteConfig;
