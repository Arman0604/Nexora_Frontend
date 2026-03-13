/**
 * Expense routes (all require JWT auth)
 *
 * GET  /groups/:gid/expenses        – List expenses for a group
 * POST /groups/:gid/expenses        – Add an expense
 * GET  /groups/:gid/balances        – Compute per-member balances & settlement plan
 *
 * ─── SPLIT CALCULATION LOGIC ────────────────────────────────────────────────
 *
 * The API accepts THREE mutually-exclusive split methods:
 *
 *   1. "equal" (default)
 *      ┌──────────────────────────────────────────────────────────────┐
 *      │  share[i] = totalAmount / N  for every participant i         │
 *      │  Rounding residue (due to integer cents) is added to the     │
 *      │  first participant so the sum always equals totalAmount.      │
 *      └──────────────────────────────────────────────────────────────┘
 *
 *   2. "percentage"
 *      ┌──────────────────────────────────────────────────────────────┐
 *      │  share[i] = totalAmount × (pct[i] / 100)                     │
 *      │  VALIDATION: sum of all pct[i] must equal 100.               │
 *      │  Rounding residue added to first participant.                │
 *      └──────────────────────────────────────────────────────────────┘
 *
 *   3. "custom"
 *      ┌──────────────────────────────────────────────────────────────┐
 *      │  Caller provides an explicit rupee amount per participant.    │
 *      │  VALIDATION: sum of custom shares must equal totalAmount.    │
 *      └──────────────────────────────────────────────────────────────┘
 *
 *  PRIORITY RULE
 *  If the client sends split_method = "percentage" AND percentage values,
 *  those take full priority.  "custom" also takes full priority when chosen.
 *  "equal" is the fallback when no explicit splits are provided.
 *  You CANNOT mix methods in a single expense — only one method per expense.
 *
 *  The payer's share is recorded like everyone else's.
 *  "youOwe" for the logged-in user = their own share (if they didn't pay)
 *                                    minus what others owe them (if they paid).
 */

const router = require('express').Router({ mergeParams: true })
const pool = require('../db')
const { requireAuth } = require('../middleware/auth')

router.use(requireAuth)

// ── Split calculation helpers ─────────────────────────────────────────────────

/**
 * Distribute `amount` equally among `userIds`.
 * Returns array of { userId, share }.
 */
function equalSplits(amount, userIds) {
  const n = userIds.length
  if (n === 0) return []
  // Work in integer paise to avoid floating-point drift
  const totalPaise = Math.round(amount * 100)
  const basePaise = Math.floor(totalPaise / n)
  const residuePaise = totalPaise - basePaise * n
  return userIds.map((userId, i) => ({
    userId,
    share: (basePaise + (i === 0 ? residuePaise : 0)) / 100,
    percentage: null,
  }))
}

/**
 * Distribute `amount` by percentage.
 * `pcts` is an array of numbers (must sum to 100).
 * Returns array of { userId, share, percentage }.
 */
function percentageSplits(amount, userIds, pcts) {
  const totalPaise = Math.round(amount * 100)
  let assigned = 0
  const splits = userIds.map((userId, i) => {
    // Floor to nearest paisa, residue goes to first user
    const sharePaise = Math.floor((totalPaise * pcts[i]) / 100)
    assigned += sharePaise
    return { userId, sharePaise, percentage: pcts[i] }
  })
  const residuePaise = totalPaise - assigned
  splits[0].sharePaise += residuePaise          // add residue to first user
  return splits.map((s) => ({
    userId: s.userId,
    share: s.sharePaise / 100,
    percentage: s.percentage,
  }))
}

// ── GET /groups/:gid/expenses ─────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { gid } = req.params
  try {
    const mem = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [gid, req.user.id],
    )
    if (mem.rows.length === 0) return res.status(403).json({ error: 'Not a member' })

    const result = await pool.query(
      `SELECT e.id, e.title, e.amount, e.category, e.split_method, e.date, e.created_at,
              u.name AS paid_by_name, u.id AS paid_by_id,
              es.share AS your_share
       FROM expenses e
       JOIN users u ON u.id = e.paid_by
       LEFT JOIN expense_splits es ON es.expense_id = e.id AND es.user_id = $2
       WHERE e.group_id = $1
       ORDER BY e.date DESC, e.created_at DESC`,
      [gid, req.user.id],
    )
    return res.json({ expenses: result.rows })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

// ── POST /groups/:gid/expenses ────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { gid } = req.params
  const {
    title, amount, category = 'General', date,
    paid_by,           // user id of payer
    split_method = 'equal',
    participant_ids,   // array of user ids
    percentages,       // map { userId: pct } – required for 'percentage'
    custom_shares,     // map { userId: amount } – required for 'custom'
  } = req.body

  if (!title || !amount || !paid_by || !participant_ids || participant_ids.length === 0) {
    return res.status(400).json({ error: 'title, amount, paid_by and participant_ids are required' })
  }
  if (isNaN(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'amount must be a positive number' })
  }

  const totalAmount = Math.round(Number(amount) * 100) / 100

  // Build splits based on method
  let splits = []

  if (split_method === 'equal') {
    splits = equalSplits(totalAmount, participant_ids)

  } else if (split_method === 'percentage') {
    // Validate percentages exist and sum to 100
    if (!percentages) return res.status(400).json({ error: 'percentages map required for percentage split' })
    const pcts = participant_ids.map((id) => Number(percentages[id] || 0))
    const pctSum = pcts.reduce((a, b) => a + b, 0)
    if (Math.abs(pctSum - 100) > 0.01) {
      return res.status(400).json({ error: `Percentages must sum to 100 (got ${pctSum.toFixed(2)})` })
    }
    splits = percentageSplits(totalAmount, participant_ids, pcts)

  } else if (split_method === 'custom') {
    if (!custom_shares) return res.status(400).json({ error: 'custom_shares map required for custom split' })
    const shares = participant_ids.map((id) => Math.round(Number(custom_shares[id] || 0) * 100) / 100)
    const shareSum = Math.round(shares.reduce((a, b) => a + b, 0) * 100) / 100
    if (Math.abs(shareSum - totalAmount) > 0.01) {
      return res.status(400).json({ error: `Custom shares must sum to ${totalAmount} (got ${shareSum})` })
    }
    splits = participant_ids.map((id, i) => ({ userId: id, share: shares[i], percentage: null }))

  } else {
    return res.status(400).json({ error: "split_method must be 'equal', 'percentage', or 'custom'" })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const expRes = await client.query(
      `INSERT INTO expenses (group_id, title, amount, category, paid_by, split_method, date)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [gid, title, totalAmount, category, paid_by, split_method, date || new Date()],
    )
    const expense = expRes.rows[0]

    for (const s of splits) {
      await client.query(
        `INSERT INTO expense_splits (expense_id, user_id, share, percentage) VALUES ($1,$2,$3,$4)`,
        [expense.id, s.userId, s.share, s.percentage],
      )
    }

    await client.query('COMMIT')
    return res.status(201).json({ expense })
  } catch (err) {
    await client.query('ROLLBACK')
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  } finally {
    client.release()
  }
})

// ── GET /groups/:gid/balances ─────────────────────────────────────────────────
// Computes net balance per user; returns optimized settlement plan.
router.get('/balances', async (req, res) => {
  const { gid } = req.params
  try {
    const mem = await pool.query(
      `SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2`,
      [gid, req.user.id],
    )
    if (mem.rows.length === 0) return res.status(403).json({ error: 'Not a member' })

    // For each user: total_paid - total_owed = net (positive = owed money, negative = owes money)
    const result = await pool.query(
      `SELECT u.id, u.name, u.upi_id,
              COALESCE(paid.total, 0)        AS total_paid,
              COALESCE(owes.total, 0)        AS total_owed,
              COALESCE(paid.total, 0) - COALESCE(owes.total, 0) AS net
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       LEFT JOIN (
         SELECT paid_by AS uid, SUM(amount) AS total FROM expenses WHERE group_id=$1 GROUP BY paid_by
       ) paid ON paid.uid = u.id
       LEFT JOIN (
         SELECT es.user_id AS uid, SUM(es.share) AS total
         FROM expense_splits es JOIN expenses e ON e.id=es.expense_id
         WHERE e.group_id=$1 GROUP BY es.user_id
       ) owes ON owes.uid = u.id
       WHERE gm.group_id=$1
       ORDER BY net DESC`,
      [gid],
    )

    const members = result.rows

    // ── Greedy debt-minimization (optimized settlement) ───────────────────
    // Sort creditors (net > 0) and debtors (net < 0).
    // Greedily match largest debtor with largest creditor.
    const creditors = members.filter((m) => m.net > 0.005).map((m) => ({ ...m, net: +m.net }))
    const debtors   = members.filter((m) => m.net < -0.005).map((m) => ({ ...m, net: +m.net }))

    const settlements = []
    let ci = 0, di = 0
    while (ci < creditors.length && di < debtors.length) {
      const credit = creditors[ci]
      const debt   = debtors[di]
      const transferAmt = Math.min(credit.net, Math.abs(debt.net))
      settlements.push({
        from: { id: debt.id, name: debt.name, upi_id: debt.upi_id },
        to:   { id: credit.id, name: credit.name, upi_id: credit.upi_id },
        amount: Math.round(transferAmt * 100) / 100,
      })
      credit.net   -= transferAmt
      debt.net     += transferAmt
      if (credit.net < 0.005) ci++
      if (Math.abs(debt.net) < 0.005) di++
    }

    return res.json({ members, settlements })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Internal server error' })
  }
})

module.exports = router
