// Vercel serverless entry (Node runtime). Static files are served by Vercel;
// every /api/* request lands here and runs the same Hono app as the Worker.
import { handle } from 'hono/vercel'
import { createNodeApp } from '../src/server/handler'

const app = createNodeApp()

export default handle(app as never)
