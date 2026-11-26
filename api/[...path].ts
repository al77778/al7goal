// Catch-all so /api/auth/login, /api/balance, ... all reach the same handler.
// Vercel only maps [...path] to one segment, so vercel.json rewrites every
// /api/:path* request here. The specifier keeps its emitted .js extension
// because the function runs unbundled as Node ESM.
export { default } from './index.js'
