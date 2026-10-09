/**
 * Forwards every /api/* call from the browser to the FastAPI backend.
 *
 * The backend address is read when the request arrives (BACKEND_URL), not when the
 * image is built, so one frontend image runs in any environment. The browser only
 * ever talks to the frontend's own origin. Streaming answers (the AI tutor) and file
 * uploads pass through without being buffered.
 */
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Hop-by-hop headers, plus ones fetch recomputes for the forwarded request.
const REQUEST_HEADERS_TO_DROP = new Set(["host", "connection", "keep-alive", "transfer-encoding", "upgrade", "content-length"]);
// fetch already decoded the body, so the original encoding and length no longer apply.
const RESPONSE_HEADERS_TO_DROP = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "set-cookie"]);

function backendBase(): string {
  return (process.env.BACKEND_URL || "http://localhost:8000").replace(/\/+$/, "");
}

type Context = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: Context): Promise<Response> {
  const { path } = await context.params;
  const target = `${backendBase()}/api/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!REQUEST_HEADERS_TO_DROP.has(key.toLowerCase())) headers.set(key, value);
  });
  // Let the backend see the public host and scheme the browser used.
  headers.set("x-forwarded-host", request.headers.get("host") ?? request.nextUrl.host);
  headers.set("x-forwarded-proto", request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", ""));

  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: "manual",
      cache: "no-store",
      // Required by Node's fetch to stream a request body (file uploads).
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch (error) {
    console.error(`Failed to reach the backend at ${backendBase()} (set BACKEND_URL):`, error);
    return Response.json({ detail: "The backend is unreachable." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!RESPONSE_HEADERS_TO_DROP.has(key.toLowerCase())) responseHeaders.set(key, value);
  });
  // Headers.forEach merges multiple cookies into one line; forward each separately.
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE, proxy as OPTIONS, proxy as HEAD };
