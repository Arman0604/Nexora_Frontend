/**
 * Auth routes
 *  POST /auth/signup   – Register with email + password
 *  POST /auth/login    – Login with email + password
 *  GET  /auth/google   – Initiate Google OAuth
 *  GET  /auth/google/callback – Google OAuth callback
 *  GET  /auth/me       – Return current user (JWT required)
 */

const router = require('express').Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const passport = require('passport')
const pool = require('../db')

const SALT_ROUNDS = 10

// ── JWT helper ────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' },
  )
}

// ── POST /auth/signup ─────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
  const { name, email, password } = req.body

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' })
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' })
  }

  try {
    // Check duplicate email
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()])
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' })
    }

    // Hash password with bcryptjs
    const hashed = await bcrypt.hash(password, SALT_ROUNDS)

    const result = await pool.query(
      `INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, avatar_url, upi_id, created_at`,
      [name.trim(), email.toLowerCase(), hashed],
    )

    const user = result.rows[0]
    const token = signToken(user)

    return res.status(201).json({ token, user })
  } catch (err) {
    console.error('Signup error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /auth/login ──────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' })
  }

  try {
    const result = await pool.query(
      `SELECT id, name, email, password, avatar_url, upi_id FROM users WHERE email = $1`,
      [email.toLowerCase()],
    )

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const user = result.rows[0]

    // OAuth-only account (no password set)
    if (!user.password) {
      return res.status(401).json({ error: 'This account uses Google login. Please sign in with Google.' })
    }

    // Compare password with bcryptjs
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = signToken(user)
    const { password: _pw, ...safeUser } = user

    return res.json({ token, user: safeUser })
  } catch (err) {
    console.error('Login error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /auth/google ──────────────────────────────────────────────────────────
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }))

// ── GET /auth/google/callback ─────────────────────────────────────────────────
router.get(
  '/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.FRONTEND_URL}/login?error=oauth_failed` }),
  (req, res) => {
    const token = signToken(req.user)
    // Redirect to frontend with JWT in query param (frontend stores it in localStorage)
    res.redirect(`${process.env.FRONTEND_URL}?token=${token}`)
  },
)

// ── GET /auth/me ──────────────────────────────────────────────────────────────
const { requireAuth } = require('../middleware/auth')

router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, avatar_url, upi_id, created_at FROM users WHERE id = $1`,
      [req.user.id],
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' })
    return res.json({ user: result.rows[0] })
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PATCH /auth/me – Update profile ──────────────────────────────────────────
router.patch('/me', requireAuth, async (req, res) => {
  const { name, upi_id, avatar_url } = req.body
  try {
    const result = await pool.query(
      `UPDATE users
       SET name       = COALESCE(NULLIF($1,''), name),
           upi_id     = COALESCE(NULLIF($2,''), upi_id),
           avatar_url = COALESCE(NULLIF($3,''), avatar_url),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, email, avatar_url, upi_id`,
      [name, upi_id, avatar_url, req.user.id],
    )
    return res.json({ user: result.rows[0] })
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
