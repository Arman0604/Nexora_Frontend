/**
 * Breach App – PostgreSQL Seed Script
 * Runs schema migrations then inserts rich dummy data.
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const pool = require('./db')
const bcrypt = require('bcryptjs')

async function run() {
  const client = await pool.connect()
  try {
    console.log('📦  Running schema migrations…')
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    await client.query(schema)
    console.log('✅  Schema ready')

    // ── Clear existing data (for idempotent re-runs) ──────────────────────
    await client.query('TRUNCATE settlements, expense_splits, expenses, group_members, groups, users CASCADE')

    // ── Users ─────────────────────────────────────────────────────────────
    const hash = (pw) => bcrypt.hashSync(pw, 10)
    const users = [
      { name: 'Priya Sharma',  email: 'priya@breach.app',   password: hash('Priya@123'),   upi_id: 'priya@upi'  },
      { name: 'Aarav Mehta',   email: 'aarav@breach.app',   password: hash('Aarav@123'),   upi_id: 'aarav@upi'  },
      { name: 'Meera Kapoor',  email: 'meera@breach.app',   password: hash('Meera@123'),   upi_id: 'meera@upi'  },
      { name: 'Rishi Verma',   email: 'rishi@breach.app',   password: hash('Rishi@123'),   upi_id: 'rishi@upi'  },
      { name: 'Ananya Singh',  email: 'ananya@breach.app',  password: hash('Ananya@123'),  upi_id: 'ananya@upi' },
    ]

    const insertedUsers = []
    for (const u of users) {
      const res = await client.query(
        `INSERT INTO users (name, email, password, upi_id) VALUES ($1,$2,$3,$4) RETURNING *`,
        [u.name, u.email, u.password, u.upi_id],
      )
      insertedUsers.push(res.rows[0])
    }
    console.log(`✅  Inserted ${insertedUsers.length} users`)

    const [priya, aarav, meera, rishi, ananya] = insertedUsers

    // ── Groups ────────────────────────────────────────────────────────────
    const groups = [
      { name: 'Goa Trip',        description: '4-day beach trip – March 2026', currency: 'INR', created_by: priya.id },
      { name: 'Flat Expenses',   description: 'Monthly utilities & groceries',  currency: 'INR', created_by: aarav.id },
      { name: 'Hackathon Team',  description: 'Food + travel + hosting costs',  currency: 'INR', created_by: meera.id },
    ]

    const insertedGroups = []
    for (const g of groups) {
      const res = await client.query(
        `INSERT INTO groups (name, description, currency, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [g.name, g.description, g.currency, g.created_by],
      )
      insertedGroups.push(res.rows[0])
    }
    console.log(`✅  Inserted ${insertedGroups.length} groups`)

    const [goaGroup, flatGroup, hackGroup] = insertedGroups

    // ── Group members ─────────────────────────────────────────────────────
    const memberships = [
      // Goa Trip: all 5 users
      { group_id: goaGroup.id,  user_id: priya.id,  role: 'admin' },
      { group_id: goaGroup.id,  user_id: aarav.id,  role: 'member' },
      { group_id: goaGroup.id,  user_id: meera.id,  role: 'member' },
      { group_id: goaGroup.id,  user_id: rishi.id,  role: 'member' },
      { group_id: goaGroup.id,  user_id: ananya.id, role: 'member' },
      // Flat Expenses: 3 users
      { group_id: flatGroup.id, user_id: aarav.id,  role: 'admin' },
      { group_id: flatGroup.id, user_id: priya.id,  role: 'member' },
      { group_id: flatGroup.id, user_id: meera.id,  role: 'member' },
      // Hackathon: 4 users
      { group_id: hackGroup.id, user_id: meera.id,  role: 'admin' },
      { group_id: hackGroup.id, user_id: priya.id,  role: 'member' },
      { group_id: hackGroup.id, user_id: aarav.id,  role: 'member' },
      { group_id: hackGroup.id, user_id: rishi.id,  role: 'member' },
    ]

    for (const m of memberships) {
      await client.query(
        `INSERT INTO group_members (group_id, user_id, role) VALUES ($1,$2,$3)`,
        [m.group_id, m.user_id, m.role],
      )
    }
    console.log(`✅  Inserted ${memberships.length} group memberships`)

    // ── Expenses & Splits ─────────────────────────────────────────────────
    /**
     * SPLIT CALCULATION LOGIC (used in seed and in the API):
     *
     * 1. EQUAL SPLIT
     *    share = totalAmount / numberOfParticipants
     *    Every selected participant owes the same amount.
     *    Rounding: integer division can leave a 1-paisa remainder on one person.
     *
     * 2. PERCENTAGE SPLIT
     *    share[i] = (totalAmount * percentage[i]) / 100
     *    All percentages MUST sum to exactly 100; the API validates this.
     *    Rounding: compute all shares then add any rounding residue to the
     *    first participant so the total always equals the expense amount.
     *
     * 3. CUSTOM SPLIT
     *    The caller specifies an explicit rupee amount for each participant.
     *    Sum of custom amounts MUST equal the expense total; the API validates.
     *    share[i] = customAmount[i]
     *
     * PRIORITY when only one method is chosen:
     *    The front-end lets the user pick exactly one method at Step 3.
     *    There is no "both at once" – percentage and custom are mutually exclusive.
     *    If neither is specified the split falls back to equal.
     */
    async function insertExpense({ groupId, title, amount, category, paidById, method, date, splits }) {
      const expRes = await client.query(
        `INSERT INTO expenses (group_id, title, amount, category, paid_by, split_method, date)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [groupId, title, amount, category, paidById, method, date],
      )
      const expense = expRes.rows[0]
      for (const s of splits) {
        await client.query(
          `INSERT INTO expense_splits (expense_id, user_id, share, percentage)
           VALUES ($1,$2,$3,$4)`,
          [expense.id, s.userId, s.share, s.percentage ?? null],
        )
      }
      return expense
    }

    // Helper: equal split
    function equalSplits(amount, userIds) {
      const n = userIds.length
      const base = Math.floor((amount * 100) / n) / 100
      const remainder = Math.round((amount - base * n) * 100) / 100
      return userIds.map((id, i) => ({
        userId: id,
        share: i === 0 ? +(base + remainder).toFixed(2) : base,
      }))
    }

    // Helper: percentage split
    function percentageSplits(amount, userIds, pcts) {
      let shares = userIds.map((id, i) => ({
        userId: id,
        share: Math.floor((amount * pcts[i]) / 100 * 100) / 100,
        percentage: pcts[i],
      }))
      const assigned = shares.reduce((s, x) => s + x.share, 0)
      const residue = Math.round((amount - assigned) * 100) / 100
      shares[0].share = +(shares[0].share + residue).toFixed(2)
      return shares
    }

    // ── Goa Trip expenses ─────────────────────────────────────────────────
    await insertExpense({
      groupId: goaGroup.id, title: 'Beach shack dinner', amount: 3200,
      category: 'Food', paidById: aarav.id, method: 'equal', date: '2026-03-10',
      splits: equalSplits(3200, [priya.id, aarav.id, meera.id, rishi.id, ananya.id]),
    })

    await insertExpense({
      groupId: goaGroup.id, title: 'Scooter rental', amount: 1800,
      category: 'Transport', paidById: priya.id, method: 'percentage', date: '2026-03-09',
      // Priya 30%, Aarav 25%, Meera 20%, Rishi 15%, Ananya 10%
      splits: percentageSplits(1800, [priya.id, aarav.id, meera.id, rishi.id, ananya.id], [30, 25, 20, 15, 10]),
    })

    await insertExpense({
      groupId: goaGroup.id, title: 'Hostel booking', amount: 5200,
      category: 'Stay', paidById: meera.id, method: 'custom', date: '2026-03-07',
      splits: [
        { userId: priya.id,  share: 1200 },
        { userId: aarav.id,  share: 1000 },
        { userId: meera.id,  share: 1000 },
        { userId: rishi.id,  share: 1000 },
        { userId: ananya.id, share: 1000 },
      ],
    })

    await insertExpense({
      groupId: goaGroup.id, title: 'Flight tickets', amount: 22000,
      category: 'Travel', paidById: rishi.id, method: 'equal', date: '2026-02-20',
      splits: equalSplits(22000, [priya.id, aarav.id, meera.id, rishi.id, ananya.id]),
    })

    // ── Flat Expenses ─────────────────────────────────────────────────────
    await insertExpense({
      groupId: flatGroup.id, title: 'Electricity bill', amount: 2400,
      category: 'Utilities', paidById: aarav.id, method: 'equal', date: '2026-03-01',
      splits: equalSplits(2400, [aarav.id, priya.id, meera.id]),
    })

    await insertExpense({
      groupId: flatGroup.id, title: 'Groceries', amount: 3600,
      category: 'Food', paidById: priya.id, method: 'percentage', date: '2026-03-05',
      // Priya 40%, Aarav 35%, Meera 25%
      splits: percentageSplits(3600, [priya.id, aarav.id, meera.id], [40, 35, 25]),
    })

    await insertExpense({
      groupId: flatGroup.id, title: 'WiFi recharge', amount: 1200,
      category: 'Utilities', paidById: meera.id, method: 'equal', date: '2026-03-02',
      splits: equalSplits(1200, [aarav.id, priya.id, meera.id]),
    })

    // ── Hackathon expenses ────────────────────────────────────────────────
    await insertExpense({
      groupId: hackGroup.id, title: 'Team lunch', amount: 1800,
      category: 'Food', paidById: meera.id, method: 'equal', date: '2026-03-08',
      splits: equalSplits(1800, [meera.id, priya.id, aarav.id, rishi.id]),
    })

    await insertExpense({
      groupId: hackGroup.id, title: 'VPS hosting', amount: 4200,
      category: 'Tech', paidById: priya.id, method: 'custom', date: '2026-03-06',
      splits: [
        { userId: priya.id,  share: 1500 },
        { userId: aarav.id,  share: 1200 },
        { userId: meera.id,  share: 900  },
        { userId: rishi.id,  share: 600  },
      ],
    })

    console.log('✅  Inserted all expenses and splits')

    // ── Settlements ───────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, method, status, settled_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [goaGroup.id, priya.id, aarav.id, 500, 'upi', 'completed', new Date()],
    )
    await client.query(
      `INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, method, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [goaGroup.id, priya.id, meera.id, 280, 'cash', 'pending'],
    )
    await client.query(
      `INSERT INTO settlements (group_id, from_user_id, to_user_id, amount, method, status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [flatGroup.id, meera.id, priya.id, 400, 'upi', 'pending'],
    )
    console.log('✅  Inserted settlements')

    console.log('\n🎉  Seed complete! Demo credentials:')
    console.log('   priya@breach.app  /  Priya@123')
    console.log('   aarav@breach.app  /  Aarav@123')
    console.log('   meera@breach.app  /  Meera@123')
    console.log('   rishi@breach.app  /  Rishi@123')
    console.log('   ananya@breach.app /  Ananya@123')
  } catch (err) {
    console.error('Seed error:', err)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()
