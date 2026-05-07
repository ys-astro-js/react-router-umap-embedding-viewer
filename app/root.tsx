import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import { Toaster } from "~/components/ui/sonner";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=JetBrains+Mono:wght@500&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <>
      <Outlet />
      <Toaster position="top-center" richColors />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "예상하지 못한 오류가 발생했습니다.";
  let details = "페이지를 다시 불러오거나 잠시 후 다시 시도하세요.";

  if (isRouteErrorResponse(error)) {
    message = `${error.status} ${error.statusText}`;
    details =
      typeof error.data === "string" ? error.data : JSON.stringify(error.data);
  } else if (error instanceof Error) {
    message = error.message;
    details = error.stack ?? details;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <section className="max-w-xl rounded-lg border bg-card p-6">
        <h1 className="text-xl font-semibold">{message}</h1>
        <pre className="mt-4 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 text-sm text-muted-foreground">
          {details}
        </pre>
      </section>
    </main>
  );
}
