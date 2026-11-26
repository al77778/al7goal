// Vercel serverless entry (Node runtime). Static files are served by Vercel;
// every /api/* request lands here and runs the same Hono app as the Worker.
//
// `hono/vercel` is deprecated and passes the raw Node request straight to
// app.fetch, which loses the "/api" prefix and the body. @hono/node-server's
// listener builds a real Fetch Request (and writes the Response) instead.
//
// Vercel runs this file unbundled as Node ESM, so relative specifiers keep
// their emitted extension.
import { getRequestListener } from '@hono/node-server'
import { createNodeApp } from '../src/server/handler.js'

const app = createNodeApp()

export default getRequestListener(app.fetch)
