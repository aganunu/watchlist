const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type TmdbRequest =
  | { operation: "search/multi"; query: string }
  | { operation: "movie/details"; id: number }
  | { operation: "tv/details"; id: number }
  | { operation: "tv/season/details"; id: number; season_number: number }

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}

async function isAuthenticatedUser(request: Request) {
  const authorization = request.headers.get("Authorization")
  const apiKey = request.headers.get("apikey")
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  if (!authorization?.startsWith("Bearer ") || !apiKey || !supabaseUrl) return false

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: authorization, apikey: apiKey, accept: "application/json" },
  })
  return response.ok
}

function tmdbPath(payload: TmdbRequest) {
  if (payload.operation === "search/multi") {
    const query = payload.query.trim()
    if (!query || query.length > 200) return null
    const params = new URLSearchParams({ query, language: "ru-RU", include_adult: "false" })
    return `/3/search/multi?${params}`
  }

  if (!Number.isSafeInteger(payload.id) || payload.id <= 0) return null
  if (payload.operation === "tv/season/details") {
    if (!Number.isSafeInteger(payload.season_number) || payload.season_number <= 0) return null
    return `/3/tv/${payload.id}/season/${payload.season_number}?language=ru-RU`
  }
  return `/3/${payload.operation === "tv/details" ? "tv" : "movie"}/${payload.id}?language=ru-RU`
}

function parseRequest(value: unknown): TmdbRequest | null {
  if (!value || typeof value !== "object") return null
  const payload = value as Record<string, unknown>
  if (payload.operation === "search/multi" && typeof payload.query === "string") {
    return { operation: payload.operation, query: payload.query }
  }
  if ((payload.operation === "movie/details" || payload.operation === "tv/details") && typeof payload.id === "number") {
    return { operation: payload.operation, id: payload.id }
  }
  if (payload.operation === "tv/season/details" && typeof payload.id === "number" && typeof payload.season_number === "number") {
    return { operation: payload.operation, id: payload.id, season_number: payload.season_number }
  }
  return null
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, { Allow: "POST, OPTIONS" })

  try {
    if (!(await isAuthenticatedUser(request))) return jsonResponse({ error: "Unauthorized" }, 401)

    let rawPayload: unknown
    try {
      rawPayload = await request.json()
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400)
    }

    const payload = parseRequest(rawPayload)
    const path = payload && tmdbPath(payload)
    if (!payload || !path) return jsonResponse({ error: "Unsupported TMDB operation" }, 400)

    const tmdbToken = Deno.env.get("TMDB_READ_ACCESS_TOKEN")
    if (!tmdbToken) {
      console.error("TMDB_READ_ACCESS_TOKEN is not configured")
      return jsonResponse({ error: "TMDB service is not configured" }, 503)
    }

    const upstream = await fetch(`https://api.themoviedb.org${path}`, {
      headers: { Authorization: `Bearer ${tmdbToken}`, accept: "application/json" },
    })
    if (!upstream.ok) {
      console.error("TMDB request failed", upstream.status)
      return jsonResponse({ error: "TMDB request failed", status: upstream.status }, 502)
    }

    return jsonResponse(await upstream.json())
  } catch (error) {
    console.error("TMDB Edge Function error", error)
    return jsonResponse({ error: "TMDB service unavailable" }, 503)
  }
})
