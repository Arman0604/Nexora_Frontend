/**
 * Breach App – Full Frontend
 *
 * Auth flow  : JWT stored in localStorage, read on mount.
 * Google OAuth: backend redirects to /?token=xxx → frontend captures token.
 *
 * ─── SPLIT CALCULATION LOGIC (frontend preview & validation) ──────────────
 *
 * The Add-Expense wizard (Step 3) supports three split methods. Only ONE
 * method can be active at a time – it is a radio-style toggle, never mixed.
 *
 * 1. EQUAL SPLIT  (default)
 *    ┌─────────────────────────────────────────────────────────────────┐
 *    │  preview_share = totalAmount / numberOfParticipants             │
 *    │  Every participant owes the same amount.                        │
 *    │  Server applies integer-paise rounding so SUM == totalAmount.  │
 *    └─────────────────────────────────────────────────────────────────┘
 *
 * 2. PERCENTAGE SPLIT
 *    ┌─────────────────────────────────────────────────────────────────┐
 *    │  preview_share[i] = totalAmount × (pct[i] / 100)               │
 *    │  Validation: SUM of all pct[i] must equal 100 before submit.   │
 *    │  If SUM ≠ 100 the Submit button is disabled and an error shown.│
 *    │  Server repeats the same formula + adds rounding residue to    │
 *    │  participant[0] so the db total is exact.                       │
 *    └─────────────────────────────────────────────────────────────────┘
 *
 * 3. CUSTOM SPLIT
 *    ┌─────────────────────────────────────────────────────────────────┐
 *    │  User types an explicit INR amount for each participant.        │
 *    │  Validation: SUM of custom amounts must equal totalAmount.     │
 *    │  Submit is disabled until the totals match (within ±0.01).     │
 *    └─────────────────────────────────────────────────────────────────┘
 *
 * PRIORITY  – only ONE method is ever active (mutually exclusive radio).
 *   • Switching method resets the inputs for the other methods.
 *   • Percentage data is only sent to the API when method === 'percentage'.
 *   • Custom data is only sent when method === 'custom'.
 *   • The API enforces the same constraint and rejects mixed payloads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ── API helper ────────────────────────────────────────────────────────────────
async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 2,
  }).format(value)
}

function initials(name = '') {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2)
}

const CATEGORY_ICONS = {
  Food: '🍽️', Travel: '✈️', Stay: '🏠', Utilities: '⚡',
  Transport: '🚗', Tech: '💻', Entertainment: '🎉', General: '📦',
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name, url, size = 10, colorIndex = 0 }) {
  const colors = [
    'bg-violet-200 text-violet-800', 'bg-sky-200 text-sky-800',
    'bg-emerald-200 text-emerald-800', 'bg-amber-200 text-amber-800',
    'bg-rose-200 text-rose-800',
  ]
  if (url) return <img src={url} className={`h-${size} w-${size} rounded-full object-cover`} alt={name} />
  return (
    <span className={`inline-flex h-${size} w-${size} items-center justify-center rounded-full text-sm font-bold ${colors[colorIndex % colors.length]}`}>
      {initials(name)}
    </span>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, size = 'max-w-2xl' }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 backdrop-blur-sm sm:items-center">
      <div className={`w-full ${size} rounded-3xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, type = 'success', onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 rounded-2xl px-5 py-3 shadow-lg text-sm font-semibold animate-slide-up
      ${type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'}`}>
      <span>{type === 'error' ? '✖' : '✔'}</span>
      <span>{message}</span>
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-slateald-200 border-t-emerald-500" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode]         = useState('login') // 'login' | 'signup'
  const [form, setForm]         = useState({ name: '', email: '', password: '' })
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (mode === 'signup' && !form.name.trim()) { setError('Name is required'); return }
    if (!form.email.trim()) { setError('Email is required'); return }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return }

    setLoading(true)
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/signup'
      const body = mode === 'login'
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password }

      const data = await api(path, { method: 'POST', body })
      localStorage.setItem('breach_token', data.token)
      onAuth(data.token, data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function handleGoogleLogin() {
    window.location.href = '/auth/google'
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid md:grid-cols-2 gap-0 rounded-3xl overflow-hidden shadow-2xl border border-slate-200 bg-white">
        {/* Left panel */}
        <div className="flex flex-col justify-between bg-gradient-to-br from-emerald-500 via-emerald-600 to-cyan-700 p-8 text-white md:p-10">
          <div>
            <div className="flex items-center gap-2 mb-8">
              <div className="h-9 w-9 rounded-xl bg-white/25 flex items-center justify-center text-white font-bold text-sm">B</div>
              <span className="text-xl font-bold tracking-tight">Breach</span>
            </div>
            <h1 className="text-4xl font-extrabold leading-tight">Smart expense splitting for every group</h1>
            <p className="mt-4 text-emerald-100 text-base leading-relaxed">
              Track bills, run transparent ledgers, and settle debts in the fewest possible transactions.
            </p>
            <div className="mt-8 space-y-3">
              {['Equal, percentage & custom splits', 'Optimized debt settlement', 'Real-time group ledger'].map((f) => (
                <div key={f} className="flex items-center gap-2 text-sm">
                  <span className="h-5 w-5 rounded-full bg-white/25 flex items-center justify-center text-xs">✓</span>
                  {f}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 rounded-2xl bg-white/15 border border-white/20 p-4 text-sm space-y-1">
            <p className="font-semibold text-white/90">Demo Credentials</p>
            <p className="text-emerald-100">📧 priya@breach.app</p>
            <p className="text-emerald-100">🔑 Priya@123</p>
          </div>
        </div>

        {/* Right panel */}
        <div className="p-8 md:p-10 flex flex-col justify-center">
          {/* Tab toggle */}
          <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
            {['login', 'signup'].map((m) => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${mode === m ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Full Name</label>
                <input value={form.name} onChange={set('name')} placeholder="Priya Sharma"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Email Address</label>
              <input type="email" value={form.email} onChange={set('email')} placeholder="priya@breach.app"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Password</label>
              <input type="password" value={form.password} onChange={set('password')} placeholder="At least 6 characters"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none transition" />
            </div>

            {error && (
              <p className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700">{error}</p>
            )}

            <button type="submit" disabled={loading}
              className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3">
            <hr className="flex-1 border-slate-200" />
            <span className="text-xs text-slate-400">or</span>
            <hr className="flex-1 border-slate-200" />
          </div>

          <button onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 rounded-xl border border-slate-300 bg-white py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <p className="mt-4 text-center text-xs text-slate-400">
            By continuing you agree to our Terms of Service & Privacy Policy.
          </p>
        </div>
      </div>
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE GROUP MODAL
// ─────────────────────────────────────────────────────────────────────────────
function CreateGroupModal({ token, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', description: '', currency: 'INR', cover_url: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Group name is required'); return }
    setLoading(true)
    try {
      const data = await api('/groups', { method: 'POST', body: form, token })
      onCreated(data.group)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Create New Group" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Group Name *</label>
          <input value={form.name} onChange={set('name')} placeholder="e.g. Goa Trip 2026"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
          <textarea value={form.description} onChange={set('description')} rows={2} placeholder="What is this group for?"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none resize-none" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Currency</label>
            <select value={form.currency} onChange={set('currency')}
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none">
              {['INR', 'USD', 'EUR', 'GBP', 'SGD'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1">Cover Image URL</label>
            <input value={form.cover_url} onChange={set('cover_url')} placeholder="https://…"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
          </div>
        </div>
        {error && <p className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={loading} className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-60">
            {loading ? 'Creating…' : 'Create Group'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD EXPENSE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AddExpenseModal({ token, group, members, currentUser, onClose, onAdded }) {
  const [step, setStep]               = useState(1)
  const [splitMethod, setSplitMethod] = useState('equal')
  const [participants, setParticipants] = useState(members.map((m) => m.id))
  const [pctMap, setPctMap]           = useState(() => {
    const n = members.length || 1
    const base = +(100 / n).toFixed(2)
    return Object.fromEntries(members.map((m, i) => [m.id, i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base]))
  })
  const [customMap, setCustomMap]     = useState(Object.fromEntries(members.map((m) => [m.id, 0])))
  const [form, setForm]               = useState({
    amount: '', title: '', category: 'Food', date: new Date().toISOString().slice(0, 10),
    paid_by: currentUser.id,
  })
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))
  const totalAmount = Number(form.amount) || 0

  // ── Split preview calculations ──────────────────────────────────────────
  // EQUAL: each person owes totalAmount / n
  const equalShare = participants.length > 0 ? totalAmount / participants.length : 0

  // PERCENTAGE: each person's share = totalAmount * pct[i] / 100
  // Validate: sum of active percentages must equal 100
  const totalPct = useMemo(
    () => participants.reduce((s, id) => s + Number(pctMap[id] || 0), 0),
    [participants, pctMap],
  )
  const pctPreview = useCallback(
    (id) => totalAmount * (Number(pctMap[id] || 0) / 100),
    [totalAmount, pctMap],
  )

  // CUSTOM: validate sum of custom amounts equals totalAmount
  const totalCustom = useMemo(
    () => participants.reduce((s, id) => s + Number(customMap[id] || 0), 0),
    [participants, customMap],
  )

  // When switching methods reset the other method's values
  function handleMethodChange(m) {
    setSplitMethod(m)
    setError('')
    if (m === 'percentage') {
      // Distribute 100% equally across current participants
      const n = participants.length || 1
      const base = +(100 / n).toFixed(2)
      const newMap = Object.fromEntries(
        participants.map((id, i) => [id, i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base])
      )
      setPctMap((prev) => ({ ...prev, ...newMap }))
    }
    if (m === 'custom') {
      // Reset custom amounts to 0
      setCustomMap((prev) => {
        const next = { ...prev }
        participants.forEach((id) => { next[id] = 0 })
        return next
      })
    }
  }

  // Validation before submit
  function canSubmit() {
    if (!form.title.trim() || !form.amount || totalAmount <= 0) return false
    if (participants.length === 0) return false
    if (splitMethod === 'percentage' && Math.abs(totalPct - 100) > 0.01) return false
    if (splitMethod === 'custom' && Math.abs(totalCustom - totalAmount) > 0.01) return false
    return true
  }

  async function submit() {
    if (!canSubmit()) { setError('Please fix the errors before submitting'); return }
    setLoading(true)
    setError('')
    try {
      const body = {
        title: form.title,
        amount: totalAmount,
        category: form.category,
        date: form.date,
        paid_by: form.paid_by,
        split_method: splitMethod,
        participant_ids: participants,
        ...(splitMethod === 'percentage' && { percentages: pctMap }),
        ...(splitMethod === 'custom' && { custom_shares: customMap }),
      }
      const data = await api(`/groups/${group.id}/expenses`, { method: 'POST', body, token })
      onAdded(data.expense)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const stepLabels = ['Details', 'Participants', 'Split']

  return (
    <Modal title="Add Expense" onClose={onClose}>
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {stepLabels.map((label, idx) => {
          const s = idx + 1
          const active = step === s
          const done = step > s
          return (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold flex-shrink-0
                ${done ? 'bg-emerald-500 text-white' : active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {done ? '✓' : s}
              </div>
              <span className={`text-xs font-semibold hidden sm:block ${active ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
              {idx < stepLabels.length - 1 && <div className="flex-1 h-px bg-slate-200" />}
            </div>
          )
        })}
      </div>

      {/* Step 1 – Expense details */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-semibold text-slate-700 mb-1">Description *</label>
              <input value={form.title} onChange={set('title')} placeholder="e.g. Beach shack dinner"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Amount (₹) *</label>
              <input type="number" min="0.01" step="0.01" value={form.amount} onChange={set('amount')}
                placeholder="0.00"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Category</label>
              <select value={form.category} onChange={set('category')}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none">
                {Object.keys(CATEGORY_ICONS).map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={set('date')}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">Paid By</label>
              <select value={form.paid_by} onChange={set('paid_by')}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none">
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 – Participants */}
      {step === 2 && (
        <div className="space-y-2">
          <p className="text-sm text-slate-500 mb-3">Select who is part of this expense.</p>
          {members.map((m, i) => {
            const checked = participants.includes(m.id)
            return (
              <label key={m.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors
                ${checked ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="checkbox" checked={checked} className="h-4 w-4 accent-emerald-500"
                  onChange={(e) => {
                    if (e.target.checked) setParticipants((p) => [...p, m.id])
                    else setParticipants((p) => p.filter((id) => id !== m.id))
                  }} />
                <Avatar name={m.name} url={m.avatar_url} size={8} colorIndex={i} />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{m.name}</p>
                  <p className="text-xs text-slate-500">{m.email}</p>
                </div>
                {m.id === currentUser.id && (
                  <span className="ml-auto text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">You</span>
                )}
              </label>
            )
          })}
          {participants.length === 0 && (
            <p className="text-sm text-rose-600 bg-rose-50 rounded-xl px-3 py-2">Select at least one participant.</p>
          )}
        </div>
      )}

      {/* Step 3 – Split method */}
      {step === 3 && (
        <div className="space-y-4">
          {/* Method selector */}
          <div className="flex gap-2">
            {['equal', 'percentage', 'custom'].map((m) => (
              <button key={m} onClick={() => handleMethodChange(m)}
                className={`flex-1 rounded-xl py-2 text-xs font-bold capitalize transition-colors
                  ${splitMethod === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {m === 'equal' ? '⚖️ Equal' : m === 'percentage' ? '% Percent' : '✏️ Custom'}
              </button>
            ))}
          </div>

          {/* EQUAL split */}
          {splitMethod === 'equal' && (
            <div className="space-y-2">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                <span className="font-semibold">{fmt(equalShare)}</span> each
                &nbsp;(Total {fmt(totalAmount)} ÷ {participants.length} people)
              </div>
              {members.filter((m) => participants.includes(m.id)).map((m, i) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.name} size={7} colorIndex={i} />
                    <span className="text-sm font-semibold text-slate-800">{m.name}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-700">{fmt(equalShare)}</span>
                </div>
              ))}
            </div>
          )}

          {/* PERCENTAGE split */}
          {splitMethod === 'percentage' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Each participant's % of the total. Must add up to exactly 100%.
              </p>
              {members.filter((m) => participants.includes(m.id)).map((m, i) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <Avatar name={m.name} size={7} colorIndex={i} />
                  <span className="text-sm font-semibold text-slate-800 flex-1">{m.name}</span>
                  <div className="flex items-center gap-1">
                    <input type="number" min="0" max="100" step="0.01"
                      value={pctMap[m.id] ?? 0}
                      onChange={(e) => setPctMap((p) => ({ ...p, [m.id]: Number(e.target.value) }))}
                      className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right outline-none focus:border-emerald-400" />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                  <span className="w-20 text-right text-sm font-bold text-slate-700">{fmt(pctPreview(m.id))}</span>
                </div>
              ))}
              <div className={`flex justify-between rounded-xl px-4 py-2.5 text-sm font-bold
                ${Math.abs(totalPct - 100) < 0.01 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                <span>Total percentage</span>
                <span>{totalPct.toFixed(2)}%</span>
              </div>
              {Math.abs(totalPct - 100) > 0.01 && (
                <p className="text-xs text-rose-600">
                  {totalPct < 100
                    ? `Remaining ${(100 - totalPct).toFixed(2)}% unassigned`
                    : `Over by ${(totalPct - 100).toFixed(2)}%`}
                </p>
              )}
            </div>
          )}

          {/* CUSTOM split */}
          {splitMethod === 'custom' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Enter the exact rupee amount each person owes. Must sum to {fmt(totalAmount)}.
              </p>
              {members.filter((m) => participants.includes(m.id)).map((m, i) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <Avatar name={m.name} size={7} colorIndex={i} />
                  <span className="text-sm font-semibold text-slate-800 flex-1">{m.name}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-slate-500">₹</span>
                    <input type="number" min="0" step="0.01"
                      value={customMap[m.id] ?? 0}
                      onChange={(e) => setCustomMap((p) => ({ ...p, [m.id]: Number(e.target.value) }))}
                      className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-right outline-none focus:border-emerald-400" />
                  </div>
                </div>
              ))}
              <div className={`flex justify-between rounded-xl px-4 py-2.5 text-sm font-bold
                ${Math.abs(totalCustom - totalAmount) < 0.01 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
                <span>Assigned</span>
                <span>{fmt(totalCustom)} / {fmt(totalAmount)}</span>
              </div>
              {Math.abs(totalCustom - totalAmount) > 0.01 && (
                <p className="text-xs text-rose-600">
                  {totalCustom < totalAmount
                    ? `Still need to assign ${fmt(totalAmount - totalCustom)}`
                    : `Over by ${fmt(totalCustom - totalAmount)}`}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-3 rounded-xl bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700">{error}</p>}

      {/* Navigation */}
      <div className="mt-6 flex justify-between">
        <button onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
          className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          {step === 1 ? 'Cancel' : '← Back'}
        </button>
        {step < 3 ? (
          <button
            disabled={step === 2 && participants.length === 0}
            onClick={() => setStep(s => s + 1)}
            className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-40">
            Next →
          </button>
        ) : (
          <button onClick={submit} disabled={loading || !canSubmit()}
            className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-40">
            {loading ? 'Saving…' : 'Save Expense'}
          </button>
        )}
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLE UP MODAL
// ─────────────────────────────────────────────────────────────────────────────
function SettleUpModal({ token, group, settlements, members, currentUser, onClose, onSettled }) {
  const [marking, setMarking] = useState(null)
  const [error, setError]     = useState('')

  const mine = settlements.filter(
    (s) => s.status === 'pending' && s.from_user_id === currentUser.id,
  )
  const fromOthers = settlements.filter(
    (s) => s.status === 'pending' && s.to_user_id === currentUser.id,
  )

  async function complete(sid, method) {
    setMarking(sid)
    try {
      await api(`/groups/${group.id}/settlements/${sid}/complete`, { method: 'PUT', token })
      onSettled()
      if (mine.length + fromOthers.length <= 1) onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setMarking(null)
    }
  }

  return (
    <Modal title="Settle Up" onClose={onClose}>
      <div className="space-y-5">
        {mine.length > 0 && (
          <section>
            <p className="text-sm font-bold text-slate-700 mb-2">You owe</p>
            <div className="space-y-2">
              {mine.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">Pay {s.to_name}</p>
                    <p className="text-xs text-slate-500">{s.to_upi ? `UPI: ${s.to_upi}` : 'No UPI linked'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-rose-600">{fmt(s.amount)}</span>
                    <button onClick={() => complete(s.id, 'upi')} disabled={marking === s.id}
                      className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-60">
                      {marking === s.id ? '…' : 'Mark Paid'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {fromOthers.length > 0 && (
          <section>
            <p className="text-sm font-bold text-slate-700 mb-2">Owed to you</p>
            <div className="space-y-2">
              {fromOthers.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div>
                    <p className="font-semibold text-slate-900">{s.from_name} pays you</p>
                    <p className="text-xs text-slate-500">{s.from_upi ? `UPI: ${s.from_upi}` : 'No UPI linked'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-emerald-600">{fmt(s.amount)}</span>
                    <button onClick={() => complete(s.id, 'cash')} disabled={marking === s.id}
                      className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-60">
                      {marking === s.id ? '…' : 'Confirm'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {mine.length === 0 && fromOthers.length === 0 && (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="text-5xl mb-3">🎉</span>
            <p className="font-bold text-slate-800">All settled up!</p>
            <p className="text-sm text-slate-500 mt-1">No pending settlements in this group.</p>
          </div>
        )}

        {error && <p className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700">{error}</p>}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800">Pay via UPI</button>
          <button className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Mark as Cash</button>
          <button className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Card Checkout</button>
          <button className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">Show QR Code</button>
        </div>
      </div>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP (authenticated)
// ─────────────────────────────────────────────────────────────────────────────
function AppShell({ token, user, onLogout }) {
  const [groups, setGroups]         = useState([])
  const [activeGroupId, setActiveGroupId] = useState(null)
  const [groupDetail, setGroupDetail] = useState(null)   // { group, members }
  const [expenses, setExpenses]     = useState([])
  const [balances, setBalances]     = useState(null)     // { members, settlements }
  const [settlements, setSettlements] = useState([])
  const [activeTab, setActiveTab]   = useState('expenses')

  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showExpense, setShowExpense]         = useState(false)
  const [showSettle, setShowSettle]           = useState(false)

  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState(null)  // { message, type }

  const showToast = (message, type = 'success') => setToast({ message, type })

  // ── Load groups on mount ────────────────────────────────────────────────
  useEffect(() => {
    api('/groups', { token }).then((d) => {
      setGroups(d.groups)
      if (d.groups.length > 0) setActiveGroupId(d.groups[0].id)
      else setLoading(false)
    }).catch(() => setLoading(false))
  }, [token])

  // ── Load group detail + expenses + balances + settlements when group changes ──
  useEffect(() => {
    if (!activeGroupId) return
    setLoading(true)
    setExpenses([])
    setBalances(null)
    setSettlements([])

    Promise.all([
      api(`/groups/${activeGroupId}`, { token }),
      api(`/groups/${activeGroupId}/expenses`, { token }),
      api(`/groups/${activeGroupId}/expenses/balances`, { token }),
      api(`/groups/${activeGroupId}/settlements`, { token }),
    ]).then(([gd, ed, bd, sd]) => {
      setGroupDetail({ group: gd.group, members: gd.members })
      setExpenses(ed.expenses)
      setBalances(bd)
      setSettlements(sd.settlements)
    }).catch(console.error).finally(() => setLoading(false))
  }, [activeGroupId, token])

  function refreshExpenses() {
    Promise.all([
      api(`/groups/${activeGroupId}/expenses`, { token }),
      api(`/groups/${activeGroupId}/expenses/balances`, { token }),
      api(`/groups/${activeGroupId}/settlements`, { token }),
    ]).then(([ed, bd, sd]) => {
      setExpenses(ed.expenses)
      setBalances(bd)
      setSettlements(sd.settlements)
    })
  }

  const activeGroup = groupDetail?.group
  const members     = groupDetail?.members || []

  // Summary totals from balances
  const myNet   = balances?.members?.find((m) => m.id === user.id)?.net || 0
  const totalOwed  = balances?.members?.reduce((s, m) => m.id !== user.id && m.net < -0.005 ? s + Math.abs(m.net) : s, 0) || 0
  const totalOwing = balances?.members?.reduce((s, m) => m.id !== user.id && m.net > 0.005 ? s + m.net : s, 0) || 0

  return (
    <main className="min-h-screen p-3 md:p-5">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 md:flex-row">

        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside className="w-full rounded-3xl border border-slate-200 bg-white shadow-sm md:w-64 md:flex-shrink-0">
          {/* Brand */}
          <div className="m-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-4 text-white">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-8 w-8 rounded-xl bg-white/20 flex items-center justify-center font-bold text-sm">B</div>
              <span className="font-bold tracking-tight">Breach</span>
            </div>
            <div className="flex items-center gap-2">
              <Avatar name={user.name} url={user.avatar_url} size={8} colorIndex={0} />
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{user.name}</p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
          </div>

          {/* Create group button */}
          <div className="px-3 pb-2">
            <button onClick={() => setShowCreateGroup(true)}
              className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 transition-colors">
              + New Group
            </button>
          </div>

          {/* Group list */}
          <div className="px-3 pb-3 space-y-1.5 overflow-y-auto max-h-[50vh] md:max-h-[calc(100vh-260px)]">
            {groups.length === 0 && !loading && (
              <p className="text-xs text-slate-400 px-2 py-3">No groups yet. Create one!</p>
            )}
            {groups.map((g) => (
              <button key={g.id} onClick={() => setActiveGroupId(g.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-colors
                  ${activeGroupId === g.id ? 'border-emerald-200 bg-emerald-50' : 'border-slate-100 hover:bg-slate-50'}`}>
                <p className={`text-sm font-bold truncate ${activeGroupId === g.id ? 'text-emerald-800' : 'text-slate-900'}`}>{g.name}</p>
                <p className="text-xs text-slate-400 truncate mt-0.5">{g.description || 'No description'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{g.member_count} member{g.member_count !== 1 ? 's' : ''}</p>
              </button>
            ))}
          </div>

          {/* Logout */}
          <div className="border-t border-slate-100 px-3 py-3">
            <button onClick={onLogout}
              className="w-full rounded-xl border border-slate-200 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors">
              Sign Out
            </button>
          </div>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────── */}
        <section className="flex-1 min-w-0 space-y-4">

          {/* Header */}
          <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-extrabold text-slate-900">
                  Hello, {user.name.split(' ')[0]} 👋
                </h1>
                {activeGroup && (
                  <p className="text-sm text-slate-500 mt-0.5">
                    {activeGroup.name} · {members.length} member{members.length !== 1 ? 's' : ''} · {activeGroup.currency}
                  </p>
                )}
              </div>
              {activeGroup && (
                <div className="flex gap-2">
                  <button onClick={() => setShowExpense(true)}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 transition-colors">
                    + Add Expense
                  </button>
                  <button onClick={() => setShowSettle(true)}
                    className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 transition-colors">
                    Settle Up
                  </button>
                </div>
              )}
            </div>

            {/* Summary cards */}
            <div className="mt-4 grid gap-3 grid-cols-3">
              <article className="rounded-2xl bg-rose-50 p-4">
                <p className="text-xs text-slate-500">You owe</p>
                <p className="mt-1 text-xl font-extrabold text-rose-600">{fmt(Math.max(0, -myNet))}</p>
              </article>
              <article className="rounded-2xl bg-emerald-50 p-4">
                <p className="text-xs text-slate-500">You're owed</p>
                <p className="mt-1 text-xl font-extrabold text-emerald-600">{fmt(Math.max(0, myNet))}</p>
              </article>
              <article className="rounded-2xl bg-cyan-50 p-4">
                <p className="text-xs text-slate-500">Net balance</p>
                <p className={`mt-1 text-xl font-extrabold ${myNet >= 0 ? 'text-cyan-700' : 'text-rose-600'}`}>{fmt(myNet)}</p>
              </article>
            </div>
          </header>

          {/* Tabs */}
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex gap-2 mb-5 flex-wrap">
              {['expenses', 'balances', 'members', 'profile'].map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-bold transition-colors capitalize
                    ${activeTab === tab ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                  {tab}
                </button>
              ))}
            </div>

            {loading && <Spinner />}

            {/* EXPENSES tab */}
            {!loading && activeTab === 'expenses' && (
              <div className="space-y-3">
                {expenses.length === 0 && (
                  <div className="py-12 text-center">
                    <p className="text-4xl mb-3">🧾</p>
                    <p className="font-semibold text-slate-700">No expenses yet</p>
                    <p className="text-sm text-slate-400 mt-1">Add your first expense to start tracking.</p>
                  </div>
                )}
                {expenses.map((exp) => {
                  const paidByMe = exp.paid_by_id === user.id || exp.paid_by === user.id
                  const share = Number(exp.your_share) || 0
                  // youOwe: if paid by me → I paid; others owe me so net positive for me
                  // if not paid by me → I owe my share
                  const youOweAmt = paidByMe ? -(exp.amount - share) : share
                  return (
                    <article key={exp.id} className="rounded-2xl border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="text-2xl mt-0.5">{CATEGORY_ICONS[exp.category] || '📦'}</span>
                          <div>
                            <p className="font-bold text-slate-900">{exp.title}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {exp.category} · Paid by {exp.paid_by_name}
                              {paidByMe ? ' (you)' : ''}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {new Date(exp.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              &nbsp;· <span className="capitalize">{exp.split_method} split</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-lg font-extrabold text-slate-900">{fmt(exp.amount)}</p>
                          <p className={`text-xs font-bold mt-0.5 ${youOweAmt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {youOweAmt > 0.005
                              ? `you owe ${fmt(youOweAmt)}`
                              : youOweAmt < -0.005
                                ? `you're owed ${fmt(Math.abs(youOweAmt))}`
                                : 'settled'}
                          </p>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            {/* BALANCES tab */}
            {!loading && activeTab === 'balances' && (
              <div className="space-y-4">
                {balances && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {balances.members.map((m, i) => (
                        <article key={m.id} className={`rounded-2xl border p-4 ${m.net >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                          <div className="flex items-center gap-2">
                            <Avatar name={m.name} size={8} colorIndex={i} />
                            <div>
                              <p className="text-sm font-bold text-slate-900">{m.name}{m.id === user.id ? ' (you)' : ''}</p>
                              <p className={`text-xs font-semibold ${m.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {m.net >= 0 ? `is owed ${fmt(m.net)}` : `owes ${fmt(Math.abs(m.net))}`}
                              </p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>

                    {balances.settlements.length > 0 && (
                      <>
                        <p className="text-sm font-bold text-slate-700 mt-2">Optimized Settlement Plan</p>
                        <div className="space-y-2">
                          {balances.settlements.map((s, i) => (
                            <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 bg-slate-50">
                              <p className="text-sm text-slate-700">
                                <span className="font-bold">{s.from.name}</span>
                                <span className="text-slate-400 mx-2">→</span>
                                <span className="font-bold">{s.to.name}</span>
                                {s.to.upi_id && <span className="text-xs text-slate-400 ml-1">({s.to.upi_id})</span>}
                              </p>
                              <span className="font-extrabold text-slate-900">{fmt(s.amount)}</span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {balances.settlements.length === 0 && (
                      <div className="text-center py-8">
                        <p className="text-3xl mb-2">🎉</p>
                        <p className="font-semibold text-slate-700">All balanced!</p>
                        <p className="text-sm text-slate-400">No settlements needed in this group.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* MEMBERS tab */}
            {!loading && activeTab === 'members' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Invite Link</p>
                  <div className="flex gap-2">
                    <input readOnly value={`https://breach.app/invite/${activeGroup?.id || ''}`}
                      className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" />
                    <button onClick={() => {
                      navigator.clipboard?.writeText(`https://breach.app/invite/${activeGroup?.id || ''}`)
                      showToast('Invite link copied!')
                    }} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white">
                      Copy
                    </button>
                  </div>
                </div>
                {members.map((m, i) => (
                  <article key={m.id} className="flex items-center justify-between rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={m.name} url={m.avatar_url} size={10} colorIndex={i} />
                      <div>
                        <p className="font-bold text-slate-900">{m.name}{m.id === user.id ? ' (you)' : ''}</p>
                        <p className="text-xs text-slate-500">{m.email}</p>
                        {m.upi_id && <p className="text-xs text-slate-400">UPI: {m.upi_id}</p>}
                      </div>
                    </div>
                    <span className={`text-xs rounded-full px-2.5 py-1 font-semibold
                      ${m.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      {m.role}
                    </span>
                  </article>
                ))}
              </div>
            )}

            {/* PROFILE tab */}
            {!loading && activeTab === 'profile' && (
              <ProfileTab token={token} user={user} showToast={showToast} />
            )}
          </section>
        </section>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreateGroup && (
        <CreateGroupModal token={token} onClose={() => setShowCreateGroup(false)}
          onCreated={(g) => {
            setGroups((prev) => [{ ...g, member_count: 1 }, ...prev])
            setActiveGroupId(g.id)
            setShowCreateGroup(false)
            showToast('Group created!')
          }} />
      )}

      {showExpense && activeGroup && (
        <AddExpenseModal
          token={token} group={activeGroup} members={members} currentUser={user}
          onClose={() => setShowExpense(false)}
          onAdded={() => {
            setShowExpense(false)
            refreshExpenses()
            showToast('Expense added!')
          }} />
      )}

      {showSettle && activeGroup && (
        <SettleUpModal
          token={token} group={activeGroup} settlements={settlements}
          members={members} currentUser={user}
          onClose={() => setShowSettle(false)}
          onSettled={() => { refreshExpenses(); showToast('Settlement recorded!') }} />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </main>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE TAB (separated to keep AppShell lean)
// ─────────────────────────────────────────────────────────────────────────────
function ProfileTab({ token, user, showToast }) {
  const [form, setForm]     = useState({ name: user.name, upi_id: user.upi_id || '', avatar_url: user.avatar_url || '' })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      // Profile update endpoint: PUT /auth/me (simple implementation using /auth/me PATCH)
      await api('/auth/me', { method: 'PATCH', body: form, token })
      showToast('Profile updated!')
    } catch {
      showToast('Failed to update profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-md">
      <div className="flex items-center gap-4 mb-2">
        <div className="h-16 w-16 rounded-2xl bg-emerald-100 flex items-center justify-center text-2xl font-bold text-emerald-700">
          {initials(user.name)}
        </div>
        <div>
          <p className="font-bold text-slate-900 text-lg">{user.name}</p>
          <p className="text-sm text-slate-500">{user.email}</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1">Display Name</label>
        <input value={form.name} onChange={set('name')}
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1">UPI ID</label>
        <input value={form.upi_id} onChange={set('upi_id')} placeholder="yourname@upi"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
      </div>
      <div>
        <label className="block text-sm font-semibold text-slate-700 mb-1">Avatar URL</label>
        <input value={form.avatar_url} onChange={set('avatar_url')} placeholder="https://…"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-emerald-500" />
      </div>
      <button type="submit" disabled={saving}
        className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
        {saving ? 'Saving…' : 'Update Profile'}
      </button>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT (handles OAuth token capture from URL)
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('breach_token'))
  const [user, setUser]   = useState(null)
  const [booting, setBooting] = useState(true)

  // Capture OAuth token from URL (?token=xxx)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('token')
    if (urlToken) {
      localStorage.setItem('breach_token', urlToken)
      setToken(urlToken)
      window.history.replaceState({}, '', '/')
    }
  }, [])

  // Validate stored token and fetch current user
  useEffect(() => {
    if (!token) { setBooting(false); return }
    api('/auth/me', { token })
      .then((d) => setUser(d.user))
      .catch(() => {
        localStorage.removeItem('breach_token')
        setToken(null)
      })
      .finally(() => setBooting(false))
  }, [token])

  function handleAuth(t, u) {
    setToken(t)
    setUser(u)
  }

  function handleLogout() {
    localStorage.removeItem('breach_token')
    setToken(null)
    setUser(null)
  }

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="h-12 w-12 mx-auto animate-spin rounded-full border-4 border-slate-200 border-t-emerald-500 mb-4" />
          <p className="text-sm text-slate-500">Loading Breach…</p>
        </div>
      </div>
    )
  }

  if (!token || !user) {
    return <AuthScreen onAuth={handleAuth} />
  }

  return <AppShell token={token} user={user} onLogout={handleLogout} />
}
