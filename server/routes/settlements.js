/**
 * Settlement routes (all require JWT auth)
 *
 * GET  /groups/:gid/settlements  – List settlements for a group
 * POST /groups/:gid/settlements  – Record a new settlement
 * PUT  /groups/:gid/settlements/:sid/complete – Mark settlement as completed
 */

const router = require('express').Router({ mergeParams: true })
const pool   = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

// GET /groups/:gid/settlements
router.get('/', async (req, res) => {
  const { gid } = req.params
  try {
    const mem = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [gid, req.user.id],
    )
    if (mem.rows.length === 0) return res.status(403).json({ error: 'Not a member' })

    const result = await pool.query(
      `SELECT s.*,
              fu.name AS from_name, fu.upi_id AS from_upi,
              tu.name AS to_name,   tu.upi_id AS to_upi
       FROM settlements s
       JOIN users fu ON fu.id = s.from_user_id
       JOIN users tu ON tu.id = s.to_user_id
       WHERE s.group_id = $1
       ORDER BY s.created_at DESC`,
      [gid],
    )
    return res.json({ settlements: result.rows })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /groups/:gid/settlements
router.post('/', async (req, res) => {
  const { gid } = req.params
  const { to_user_id, amount, method = 'cash' } = req.body

  if (!to_user_id || !amount) {
    return res.status(400).json({ error: 'to_user_id and amount are required' })
  }

  try {
    const result = await pool.query(
      `INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, method)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [gid, req.user.id, to_user_id, +amount, method],
    )
    return res.status(201).json({ settlement: result.rows[0] })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// PUT /groups/:gid/settlements/:sid/complete
router.put('/:sid/complete', async (req, res) => {
  const { gid, sid } = req.params
  try {
    const result = await pool.query(
      `UPDATE settlements
       SET status='completed', settled_at=NOW()
       WHERE id=$1 AND group_id=$2
         AND (from_user_id=$3 OR to_user_id=$3)
       RETURNING *`,
      [sid, gid, req.user.id],
    )
    if (result.rows.length === 0) return res.status(404).json({ error: 'Settlement not found or unauthorized' })
    return res.json({ settlement: result.rows[0] })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
