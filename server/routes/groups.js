/**
 * Group routes (all require JWT auth)
 *  GET    /groups             – List groups for logged-in user
 *  POST   /groups             – Create a new group
 *  GET    /groups/:id         – Get group details + members
 *  POST   /groups/:id/members – Add a member by email
 */

const router = require('express').Router()
const pool = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

// GET /groups
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, g.description, g.currency, g.cover_url, g.created_at,
              COUNT(DISTINCT gm.user_id)::int AS member_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1
       GROUP BY g.id
       ORDER BY g.created_at DESC`,
      [req.user.id],
    )
    return res.json({ groups: result.rows })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /groups
router.post('/', async (req, res) => {
  const { name, description, currency = 'INR', cover_url } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const gRes = await client.query(
      `INSERT INTO groups (name, description, currency, cover_url, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [name, description || null, currency, cover_url || null, req.user.id],
    )
    const group = gRes.rows[0]
    await client.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'admin')`,
      [group.id, req.user.id],
    )
    await client.query('COMMIT')
    return res.status(201).json({ group })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  } finally {
    client.release()
  }
})

// GET /groups/:id
router.get('/:id', async (req, res) => {
  try {
    // Verify membership
    const mem = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [req.params.id, req.user.id],
    )
    if (mem.rows.length === 0) return res.status(403).json({ error: 'Not a member of this group' })

    const [gRes, mRes] = await Promise.all([
      pool.query(`SELECT * FROM groups WHERE id=$1`, [req.params.id]),
      pool.query(
        `SELECT u.id, u.name, u.email, u.avatar_url, u.upi_id, gm.role
         FROM group_members gm JOIN users u ON u.id=gm.user_id
         WHERE gm.group_id=$1 ORDER BY gm.joined_at`,
        [req.params.id],
      ),
    ])

    if (gRes.rows.length === 0) return res.status(404).json({ error: 'Group not found' })

    return res.json({ group: gRes.rows[0], members: mRes.rows })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /groups/:id/members
router.post('/:id/members', async (req, res) => {
  const { email } = req.body
  if (!email) return res.status(400).json({ error: 'email is required' })

  try {
    const userRes = await pool.query(`SELECT id, name, email FROM users WHERE email=$1`, [email.toLowerCase()])
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User not found' })

    const newMember = userRes.rows[0]
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING`,
      [req.params.id, newMember.id],
    )
    return res.json({ member: newMember })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
