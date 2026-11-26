// Local Node run of the Vercel target: npm run dev:node
import { serve } from '@hono/node-server'
import { createNodeApp } from '../src/server/handler'

const app = createNodeApp()
const port = Number(process.env.PORT || 3100)

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`ApryadiGoal (Node/Postgres) on http://localhost:${info.port}`)
})
