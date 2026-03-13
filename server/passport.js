/**
 * Passport.js configuration
 *
 * Strategy: Google OAuth 2.0 (passport-google-oauth20)
 * Session: DISABLED – we use stateless JWT instead.
 *
 * Flow:
 *  1. User visits GET /auth/google  → redirected to Google consent screen
 *  2. Google redirects to GET /auth/google/callback with a code
 *  3. Passport exchanges code for profile
 *  4. We upsert the user in PostgreSQL (by google_id or email)
 *  5. The callback route signs a JWT and redirects to the frontend with ?token=...
 */

require('dotenv').config()
const passport       = require('passport')
const GoogleStrategy = require('passport-google-oauth20').Strategy
const pool           = require('./db')

passport.use(
  new GoogleStrategy(
    {
      clientID:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL:  process.env.GOOGLE_CALLBACK_URL,
    },
    async (_accessToken, _refreshToken, profile, done) => {
      try {
        const email      = profile.emails?.[0]?.value?.toLowerCase()
        const name       = profile.displayName
        const avatar_url = profile.photos?.[0]?.value
        const google_id  = profile.id

        if (!email) return done(new Error('Google account has no email'), null)

        // Upsert: find by google_id first, then by email, else create
        let user = (
          await pool.query(`SELECT * FROM users WHERE google_id=$1`, [google_id])
        ).rows[0]

        if (!user) {
          // Check if email already registered (password account)
          user = (await pool.query(`SELECT * FROM users WHERE email=$1`, [email])).rows[0]

          if (user) {
            // Link google_id to existing account
            user = (
              await pool.query(
                `UPDATE users SET google_id=$1, avatar_url=COALESCE(avatar_url,$2) WHERE id=$3 RETURNING *`,
                [google_id, avatar_url, user.id],
              )
            ).rows[0]
          } else {
            // Brand-new user via Google
            user = (
              await pool.query(
                `INSERT INTO users (name, email, google_id, avatar_url)
                 VALUES ($1,$2,$3,$4) RETURNING *`,
                [name, email, google_id, avatar_url],
              )
            ).rows[0]
          }
        }

        return done(null, user)
      } catch (err) {
        return done(err, null)
      }
    },
  ),
)

// No session serialization needed (JWT only)
passport.serializeUser((user, done) => done(null, user.id))
passport.deserializeUser(async (id, done) => {
  try {
    const res = await pool.query(`SELECT * FROM users WHERE id=$1`, [id])
    done(null, res.rows[0] || null)
  } catch (err) {
    done(err, null)
  }
})

module.exports = passport
