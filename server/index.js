/**
 * Breach App – Express API Server
 *
 * Endpoints:
 *   POST   /auth/signup
 *   POST   /auth/login
 *   GET    /auth/google
 *   GET    /auth/google/callback
 *   GET    /auth/me                         (JWT required)
 *
 *   GET    /groups                          (JWT)
 *   POST   /groups                          (JWT)
 *   GET    /groups/:gid                     (JWT)
 *   POST   /groups/:gid/members             (JWT)
 *
 *   GET    /groups/:gid/expenses            (JWT)
 *   POST   /groups/:gid/expenses            (JWT)
 *   GET    /groups/:gid/expenses/balances   (JWT)
 *
 *   GET    /groups/:gid/settlements         (JWT)
 *   POST   /groups/:gid/settlements         (JWT)
 *   PUT    /groups/:gid/settlements/:sid/complete (JWT)
 */

require('dotenv').config()
const express        = require('express')
const cors           = require('cors')
const session        = require('express-session')
const passport       = require('./passport')

const authRoutes        = require('./routes/auth')
const groupRoutes       = require('./routes/groups')
const expenseRoutes     = require('./routes/expenses')
const settlementRoutes  = require('./routes/settlements')

const app  = express()
const PORT = process.env.PORT || 4000

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    process.env.FRONTEND_URL || 'http://localhost:5173',
    // Allow Orchids cloud preview URLs
    /https:\/\/.*\.orchids\.cloud$/,
  ],
  credentials: true,
}))

app.use(express.json())

// Session is used only for Passport OAuth handshake; actual auth uses JWT
app.use(session({
  secret: process.env.SESSION_SECRET || 'breach_session_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 5 * 60 * 1000 }, // 5-min ephemeral session
}))

app.use(passport.initialize())
app.use(passport.session())

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/auth',                           authRoutes)
app.use('/groups',                         groupRoutes)
app.use('/groups/:gid/expenses',           expenseRoutes)
app.use('/groups/:gid/settlements',        settlementRoutes)

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }))

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }))

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Internal server error' })
})

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  Breach API running on http://localhost:${PORT}`)
})
