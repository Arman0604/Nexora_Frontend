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
import { useGoogleLogin } from '@react-oauth/google'

// ── API helper ────────────────────────────────────────────────────────────────
const API_BASE_URL = import.meta.env?.VITE_API_URL || 'http://localhost:3000'

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  
  // If the server returns HTML (e.g. 404 page) instead of JSON, catch it cleanly to avoid React crash
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
    throw new Error('Received non-JSON response from server')
  }

  if (!res.ok) throw new Error(json.message || json.error || 'Request failed')
  return json.status === 'success' ? json.data : json
}

async function apiUploadBinary(path, { file, token } = {}) {
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (file?.type) headers['Content-Type'] = file.type

  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: file,
  })

  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`)
    throw new Error('Received non-JSON response from server')
  }

  if (!res.ok) throw new Error(json.message || json.error || 'Request failed')
  return json.status === 'success' ? json.data : json
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
    if (mode === 'signup' && !form.name.trim()) { setError('Full Name is required'); return }
    if (!form.email.trim()) { setError('Email is required'); return }
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return }

    setLoading(true)
    try {
      if (mode === 'signup') {
        // Register the user first
        await api('/api/v1/auth/register', {
          method: 'POST',
          body: { email: form.email, password: form.password, name: form.name, displayName: form.name }
        })
        // Then immediately auto-login to get the token and redirect to dashboard
        const loginData = await api('/api/v1/auth/login', {
          method: 'POST',
          body: { email: form.email, password: form.password }
        })
        localStorage.setItem('breach_token', loginData.accessToken)
        if (loginData.refreshToken) localStorage.setItem('breach_refresh', loginData.refreshToken)
        onAuth(loginData.accessToken, loginData.user)
      } else {
        const data = await api('/api/v1/auth/login', {
          method: 'POST',
          body: { email: form.email, password: form.password }
        })
        localStorage.setItem('breach_token', data.accessToken)
        if (data.refreshToken) localStorage.setItem('breach_refresh', data.refreshToken)
        onAuth(data.accessToken, data.user)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      // Note: useGoogleLogin by default returns an access_token. To get an id_token,
      // it should ideally be configured for implicit flow or standard flow.
      // For this boilerplate integration matching the new backend expects idToken:
      setLoading(true)
      try {
        const data = await api('/api/v1/auth/oauth/google', {
          method: 'POST',
          body: { idToken: tokenResponse.access_token } // backend might need tweaking if expecting true JWT idToken vs access_token, but this passes the token payload.
        })
        localStorage.setItem('breach_token', data.accessToken)
        if (data.refreshToken) localStorage.setItem('breach_refresh', data.refreshToken)
        onAuth(data.accessToken, data.user)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    },
    onError: () => setError('Google Login Failed')
  })

  function handleGoogleLogin() {
    googleLogin()
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
              <input type="password" value={form.password} onChange={set('password')} placeholder="At least 8 characters"
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
      const data = await api('/api/v1/groups', { method: 'POST', body: form, token })
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
// JOIN GROUP MODAL
// ─────────────────────────────────────────────────────────────────────────────
function JoinGroupModal({ token, user, onClose, onJoined }) {
  const [form, setForm] = useState({ link: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.link.trim()) { setError('Invite link is required'); return }
    
    // Extract ID from the link (e.g. https://breach.app/invite/1 -> 1)
    const parts = form.link.trim().split('/')
    let groupId = parts[parts.length - 1]
    if (groupId === '') groupId = parts[parts.length - 2]
    if (!groupId) { setError('Invalid link format'); return }

    setLoading(true)
    setError('')
    try {
      await api(`/api/v1/groups/${groupId}/members/join`, { method: 'POST', token })
      const data = await api(`/api/v1/groups/${groupId}`, { token })
      onJoined(data.group)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Join Group" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1">Invite Link *</label>
          <input value={form.link} onChange={set('link')} placeholder="Paste link e.g. https://breach.app/invite/1"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 outline-none" />
        </div>
        {error && <p className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={loading} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60">
            {loading ? 'Joining…' : 'Join Group'}
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
  const [step, setStep]                 = useState(1)
  const [entryMode, setEntryMode]       = useState('original') // original | image
  const [splitScope, setSplitScope]     = useState('overall') // overall | itemwise
  const [splitMethod, setSplitMethod]   = useState('equal')
  const [participants, setParticipants] = useState(members.map((m) => m.id))
  const [pctMap, setPctMap]             = useState(() => {
    const n = members.length || 1
    const base = +(100 / n).toFixed(2)
    return Object.fromEntries(members.map((m, i) => [m.id, i === 0 ? +(100 - base * (n - 1)).toFixed(2) : base]))
  })
  const [customMap, setCustomMap]       = useState(Object.fromEntries(members.map((m) => [m.id, 0])))
  const [form, setForm]                 = useState({
    amount: '', title: '', category: 'Food', date: new Date().toISOString().slice(0, 10),
    paid_by: currentUser.id,
  })
  const [receiptFile, setReceiptFile]   = useState(null)
  const [isScanning, setIsScanning]     = useState(false)
  const [scannedReceipt, setScannedReceipt] = useState(null)
  const [itemAssignments, setItemAssignments] = useState([])
  const [voiceInput, setVoiceInput] = useState('')
  const [isVoiceParsing, setIsVoiceParsing] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [loading, setLoading]           = useState(false)
  const [error, setError]               = useState('')
  const recognitionRef = useRef(null)
  const latestTranscriptRef = useRef('')

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

  const participantMembers = useMemo(
    () => members.filter((m) => participants.includes(m.id)),
    [members, participants],
  )

  const itemWiseTotal = useMemo(
    () => itemAssignments.reduce((sum, item) => sum + (Number(item.totalPrice) || 0), 0),
    [itemAssignments],
  )

  const hasItemWiseValidationError = useMemo(
    () => itemAssignments.some((item) => !item.owedTo || !item.owedBy || item.owedBy.length === 0),
    [itemAssignments],
  )

  const speechSupported = typeof window !== 'undefined'
    && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  function mapNlpCategory(rawCategory) {
    const normalized = String(rawCategory || '').toLowerCase()
    if (normalized === 'food') return 'Food'
    if (normalized === 'travel') return 'Travel'
    if (normalized === 'household') return 'Utilities'
    if (normalized === 'entertainment') return 'Entertainment'
    if (normalized === 'rent') return 'Stay'
    return 'General'
  }

  function applyParsedExpense(parsed) {
    if (!parsed || typeof parsed !== 'object') return

    const splitType = ['equal', 'percentage', 'custom'].includes(parsed.split_type)
      ? parsed.split_type
      : 'equal'

    const parsedSplits = Array.isArray(parsed.splits) ? parsed.splits : []
    const splitParticipants = Array.from(
      new Set(parsedSplits.map((s) => s.user_id).filter((id) => members.some((m) => m.id === id)))
    )
    const nextParticipants = splitParticipants.length > 0 ? splitParticipants : members.map((m) => m.id)

    const paidBy = members.some((m) => m.id === parsed.paid_by)
      ? parsed.paid_by
      : currentUser.id

    setForm((prev) => ({
      ...prev,
      title: parsed.description || prev.title,
      amount: typeof parsed.amount === 'number' && parsed.amount > 0 ? String(parsed.amount) : prev.amount,
      category: mapNlpCategory(parsed.category),
      paid_by: paidBy,
    }))

    setParticipants(nextParticipants)
    setSplitScope('overall')
    setSplitMethod(splitType)

    if (splitType === 'percentage') {
      const nextPct = Object.fromEntries(nextParticipants.map((id) => [id, 0]))
      parsedSplits.forEach((s) => {
        if (nextPct[s.user_id] !== undefined) nextPct[s.user_id] = Number(s.percentage || 0)
      })
      setPctMap((prev) => ({ ...prev, ...nextPct }))
    }

    if (splitType === 'custom') {
      const nextCustom = Object.fromEntries(nextParticipants.map((id) => [id, 0]))
      parsedSplits.forEach((s) => {
        if (nextCustom[s.user_id] !== undefined) nextCustom[s.user_id] = Number(s.amount || 0)
      })
      setCustomMap((prev) => ({ ...prev, ...nextCustom }))
    }
  }

  async function parseExpenseFromText(text) {
    const input = String(text || '').trim()
    if (!input) {
      setError('Please enter expense details in text or use the mic first')
      return
    }

    setIsVoiceParsing(true)
    setError('')
    try {
      const result = await api(`/api/v1/groups/${group.id}/nlp/parse`, {
        method: 'POST',
        body: { text: input },
        token,
      })
      const parsed = result?.data || result
      applyParsedExpense(parsed)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to parse text'
      setError(message)
    } finally {
      setIsVoiceParsing(false)
    }
  }

  async function parseVoiceInput() {
    await parseExpenseFromText(voiceInput)
  }

  function startVoiceCapture() {
    if (!speechSupported || isListening) return

    const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!RecognitionCtor) {
      setError('Voice input is not supported in this browser')
      return
    }

    setError('')
    const recognition = new RecognitionCtor()
    recognition.lang = 'en-IN'
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let transcript = ''
      for (let i = 0; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript
      }
      const cleaned = transcript.trim()
      latestTranscriptRef.current = cleaned
      setVoiceInput(cleaned)
    }

    recognition.onerror = () => {
      setError('Voice capture failed. Please try again.')
    }

    recognition.onend = async () => {
      setIsListening(false)
      recognitionRef.current = null
      const transcript = latestTranscriptRef.current.trim()
      if (transcript.length > 0) {
        await parseExpenseFromText(transcript)
      }
    }

    recognitionRef.current = recognition
    latestTranscriptRef.current = ''
    setIsListening(true)
    recognition.start()
  }

  function stopVoiceCapture() {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }

  function inferCategory(parsed) {
    const source = `${parsed?.merchant || ''} ${(parsed?.items || []).map((i) => i.name || '').join(' ')}`.toLowerCase()
    if (/(uber|ola|taxi|metro|bus|fuel|petrol|diesel|airport)/.test(source)) return 'Transport'
    if (/(hotel|hostel|resort|stay|room)/.test(source)) return 'Stay'
    if (/(movie|cinema|netflix|games|bowling|party)/.test(source)) return 'Entertainment'
    if (/(wifi|electric|water|gas|bill)/.test(source)) return 'Utilities'
    if (/(laptop|phone|charger|electronics|tech)/.test(source)) return 'Tech'
    if (/(flight|train|trip|travel)/.test(source)) return 'Travel'
    return 'Food'
  }

  function normalizeReceiptItems(items = [], defaultPaidBy) {
    return (items || []).map((item, index) => {
      const quantity = Number(item.quantity) > 0 ? Number(item.quantity) : 1
      const unitPrice = Number(item.price) > 0 ? Number(item.price) : 0
      const totalPrice = Number(item.totalPrice) > 0
        ? Number(item.totalPrice)
        : Number((quantity * unitPrice).toFixed(2))
      const defaultDebtor = participants.includes(defaultPaidBy) ? defaultPaidBy : (participants[0] || '')

      return {
        id: `${index}-${item.name || 'item'}`,
        name: item.name || `Item ${index + 1}`,
        quantity,
        price: unitPrice,
        totalPrice,
        owedBy: defaultDebtor ? [defaultDebtor] : [],
        owedTo: defaultPaidBy,
      }
    })
  }

  function changeItemPayer(itemId, userId) {
    setItemAssignments((prev) => prev.map((item) => (
      item.id === itemId ? { ...item, owedBy: userId ? [userId] : [] } : item
    )))
  }

  function changeItemReceiver(itemId, userId) {
    setItemAssignments((prev) => prev.map((item) => (item.id === itemId ? { ...item, owedTo: userId } : item)))
  }

  async function scanReceiptImage() {
    if (!receiptFile) {
      setError('Please choose a bill image first')
      return
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
    if (!allowedTypes.includes(receiptFile.type)) {
      setError('Only JPEG, PNG, WebP, and HEIC images are supported')
      return
    }

    setIsScanning(true)
    setError('')
    try {
      const result = await apiUploadBinary('/api/v1/receipts/scan', { file: receiptFile, token })
      const parsed = result?.data || result
      if (!parsed || typeof parsed.total !== 'number') {
        throw new Error('Could not parse bill details from this image')
      }

      setScannedReceipt(parsed)

      const nextDate = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
        ? parsed.date
        : new Date().toISOString().slice(0, 10)

      setForm((prev) => ({
        ...prev,
        title: parsed.merchant || prev.title || 'Receipt expense',
        amount: String(parsed.total || prev.amount || ''),
        date: nextDate,
        category: inferCategory(parsed),
      }))

      const normalized = normalizeReceiptItems(parsed.items || [], form.paid_by)
      setItemAssignments(normalized)
      if (normalized.length > 0) {
        setSplitScope('itemwise')
      }
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : String(err || '')
      const normalizedMessage = rawMessage.toLowerCase()
      const invalidImageSignals = [
        'could not extract a valid total amount',
        'could not parse bill details',
        'blocked by safety filters',
      ]

      if (invalidImageSignals.some((signal) => normalizedMessage.includes(signal))) {
        setError('invalid image')
      } else {
        setError(rawMessage || 'Request failed')
      }
    } finally {
      setIsScanning(false)
    }
  }

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

  function handleParticipantsChange(userId, checked) {
    setParticipants((prev) => {
      if (checked) {
        if (prev.includes(userId)) return prev
        return [...prev, userId]
      }
      return prev.filter((id) => id !== userId)
    })

    if (splitScope === 'itemwise') {
      setItemAssignments((prev) => prev.map((item) => {
        if (checked) return item
        return {
          ...item,
          owedBy: item.owedBy.filter((id) => id !== userId),
        }
      }))
    }
  }

  useEffect(() => {
    setItemAssignments((prev) => prev.map((item) => {
      const filteredOwedBy = item.owedBy.filter((id) => participants.includes(id))
      const nextOwedBy = filteredOwedBy.length > 0 ? filteredOwedBy : (participants[0] ? [participants[0]] : [])
      const nextOwedTo = participants.includes(item.owedTo) ? item.owedTo : (participants[0] || '')
      return { ...item, owedBy: nextOwedBy, owedTo: nextOwedTo }
    }))
  }, [participants])

  // Validation before submit
  function canSubmit() {
    if (!form.title.trim()) return false
    if (participants.length === 0) return false
    if (splitScope === 'itemwise') {
      if (itemAssignments.length === 0) return false
      if (hasItemWiseValidationError) return false
      return true
    }
    if (!form.amount || totalAmount <= 0) return false
    if (splitMethod === 'percentage' && Math.abs(totalPct - 100) > 0.01) return false
    if (splitMethod === 'custom' && Math.abs(totalCustom - totalAmount) > 0.01) return false
    return true
  }

  function calculateItemWiseExpensePayloads() {
    const byReceiver = new Map()

    itemAssignments.forEach((item) => {
      const receiverId = item.owedTo
      const debtors = item.owedBy || []
      if (!receiverId || debtors.length === 0) return

      const itemPaisa = Math.round((Number(item.totalPrice) || 0) * 100)
      if (itemPaisa <= 0) return

      const base = Math.floor(itemPaisa / debtors.length)
      const remainder = itemPaisa - base * debtors.length

      if (!byReceiver.has(receiverId)) {
        byReceiver.set(receiverId, {
          totalPaisa: 0,
          userPaisa: new Map(),
          itemNames: [],
        })
      }

      const bucket = byReceiver.get(receiverId)
      bucket.totalPaisa += itemPaisa
      bucket.itemNames.push(item.name)

      debtors.forEach((userId, index) => {
        const share = base + (index < remainder ? 1 : 0)
        bucket.userPaisa.set(userId, (bucket.userPaisa.get(userId) || 0) + share)
      })
    })

    const receiverEntries = [...byReceiver.entries()]

    return receiverEntries.map(([receiverId, bucket]) => {
      const receiver = members.find((m) => m.id === receiverId)
      const receiverLabel = receiver?.displayName || receiver?.username || 'Member'
      const description = receiverEntries.length > 1
        ? `${form.title} - ${receiverLabel}`
        : form.title

      const splits = [...bucket.userPaisa.entries()]
        .filter(([, paisa]) => paisa > 0)
        .map(([userId, paisa]) => ({ userId, owedAmount: Number((paisa / 100).toFixed(2)) }))

      return {
        description,
        amount: Number((bucket.totalPaisa / 100).toFixed(2)),
        currency: group.currency || 'INR',
        category: form.category,
        expenseDate: form.date,
        paidBy: receiverId,
        splitType: 'custom',
        splits,
      }
    })
  }

  async function submit() {
    if (!canSubmit()) { setError('Please fix the errors before submitting'); return }
    setLoading(true)
    setError('')
    try {
      if (splitScope === 'itemwise') {
        const payloads = calculateItemWiseExpensePayloads()
        if (payloads.length === 0) {
          throw new Error('Could not build item-wise splits. Please check item assignments.')
        }

        let firstExpense = null
        for (const body of payloads) {
          const data = await api(`/api/v1/groups/${group.id}/expenses`, { method: 'POST', body, token })
          if (!firstExpense) firstExpense = data.expense
        }
        onAdded(firstExpense)
        return
      }

      // Build splits array in the format the backend expects
      let splits = []
      if (splitMethod === 'equal') {
        splits = participants.map((id) => ({ userId: id }))
      } else if (splitMethod === 'percentage') {
        splits = participants.map((id) => ({ userId: id, percentage: Number(pctMap[id] || 0) }))
      } else if (splitMethod === 'custom') {
        splits = participants
          .map((id) => ({ userId: id, owedAmount: Number(customMap[id] || 0) }))
          .filter((split) => Number.isFinite(split.owedAmount) && split.owedAmount > 0)
      }

      const body = {
        description: form.title,      // backend expects "description", form uses "title"
        amount: totalAmount,
        currency: group.currency || 'INR',
        category: form.category,
        expenseDate: form.date,       // backend expects "expenseDate"
        paidBy: form.paid_by,         // backend expects "paidBy"
        splitType: splitMethod,       // backend expects "splitType"
        splits,
      }
      const data = await api(`/api/v1/groups/${group.id}/expenses`, { method: 'POST', body, token })
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
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Add Expense Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setEntryMode('original'); setSplitScope('overall'); setError('') }}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${entryMode === 'original' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                Original
              </button>
              <button type="button" onClick={() => { setEntryMode('image'); setError('') }}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${entryMode === 'image' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                Add Image
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="block text-sm font-semibold text-slate-700 mb-2">Voice / Text Assistant</label>
            <p className="text-xs text-slate-600 mb-2">
              Type expense details or hold the mic and speak. We will parse and auto-fill amount, description, payer, and split.
            </p>
            <div className="flex gap-2 items-start">
              <textarea
                value={voiceInput}
                onChange={(e) => setVoiceInput(e.target.value)}
                placeholder="Example: I paid 1200 for dinner, split equally with kejrival and mamta"
                rows={3}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
              <button
                type="button"
                onMouseDown={startVoiceCapture}
                onMouseUp={stopVoiceCapture}
                onMouseLeave={stopVoiceCapture}
                onTouchStart={(e) => { e.preventDefault(); startVoiceCapture() }}
                onTouchEnd={(e) => { e.preventDefault(); stopVoiceCapture() }}
                disabled={!speechSupported}
                className={`rounded-xl px-3 py-2 text-sm font-bold text-white ${isListening ? 'bg-rose-600' : 'bg-slate-900'} disabled:opacity-40`}
              >
                {isListening ? 'Recording...' : 'Hold Mic'}
              </button>
            </div>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={parseVoiceInput}
                disabled={isVoiceParsing || !voiceInput.trim()}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-40"
              >
                {isVoiceParsing ? 'Parsing…' : 'Use this text'}
              </button>
            </div>
            {!speechSupported && (
              <p className="mt-2 text-xs text-amber-700">Voice input is not supported in this browser. You can still type text.</p>
            )}
          </div>

          {entryMode === 'image' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs text-slate-600 mb-2">Upload bill image (JPEG, PNG, WebP, HEIC), then scan to auto-fill details.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                  className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                />
                <button
                  type="button"
                  onClick={scanReceiptImage}
                  disabled={!receiptFile || isScanning}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-40"
                >
                  {isScanning ? 'Scanning…' : 'Scan Bill'}
                </button>
              </div>
              {scannedReceipt && (
                <p className="mt-2 text-xs text-emerald-700">
                  Scanned: {scannedReceipt.merchant || 'Unknown merchant'} · Confidence {Math.round(Number(scannedReceipt.confidence || 0))}%
                </p>
              )}
            </div>
          )}

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
                {members.map((m) => <option key={m.id} value={m.id}>{m.displayName || m.username}</option>)}
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
                    handleParticipantsChange(m.id, e.target.checked)
                  }} />
                <div>
                  <p className="text-sm font-semibold text-slate-900">{m.displayName || m.username || m.email}</p>
                  {m.email && <p className="text-xs text-slate-500">{m.email}</p>}
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
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Split Options</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setSplitScope('overall')}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors ${splitScope === 'overall' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
                Overall Split
              </button>
              <button
                type="button"
                onClick={() => setSplitScope('itemwise')}
                disabled={itemAssignments.length === 0}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${splitScope === 'itemwise' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                Item-wise Split
              </button>
            </div>
            {itemAssignments.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">Scan a bill image in Step 1 to unlock item-wise split.</p>
            )}
          </div>

          {/* Method selector */}
          {splitScope === 'overall' && (
            <div className="flex gap-2">
            {['equal', 'percentage', 'custom'].map((m) => (
              <button key={m} onClick={() => handleMethodChange(m)}
                className={`flex-1 rounded-xl py-2 text-xs font-bold capitalize transition-colors
                  ${splitMethod === m ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
                {m === 'equal' ? '⚖️ Equal' : m === 'percentage' ? '% Percent' : '✏️ Custom'}
              </button>
            ))}
            </div>
          )}

          {splitScope === 'itemwise' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Item-wise total: <span className="font-bold">{fmt(itemWiseTotal)}</span>
              </div>
              {itemAssignments.map((item) => (
                <div key={item.id} className="rounded-xl border border-slate-200 p-3 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                    <p className="text-xs text-slate-600">
                      Qty {item.quantity} × {fmt(item.price)} = <span className="font-bold text-slate-800">{fmt(item.totalPrice)}</span>
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Whom to Pay ?</label>
                    <select
                      value={item.owedBy[0] || ''}
                      onChange={(e) => changeItemPayer(item.id, e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                    >
                      {participantMembers.map((m) => (
                        <option key={`${item.id}-payer-${m.id}`} value={m.id}>{m.displayName || m.username}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Whom to receive</label>
                    <select
                      value={item.owedTo}
                      onChange={(e) => changeItemReceiver(item.id, e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
                    >
                      {participantMembers.map((m) => (
                        <option key={`${item.id}-receiver-${m.id}`} value={m.id}>{m.displayName || m.username}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {hasItemWiseValidationError && (
                <p className="text-xs text-rose-600">Each item must have at least one owing member and one receiver.</p>
              )}
            </div>
          )}

          {/* EQUAL split */}
          {splitScope === 'overall' && splitMethod === 'equal' && (
            <div className="space-y-2">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800">
                <span className="font-semibold">{fmt(equalShare)}</span> each
                &nbsp;(Total {fmt(totalAmount)} ÷ {participants.length} people)
              </div>
              {participantMembers.map((m, i) => (
                <div key={m.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={m.displayName || m.username} size={7} colorIndex={i} />
                    <span className="text-sm font-semibold text-slate-800">{m.displayName || m.username}</span>
                  </div>
                  <span className="text-sm font-bold text-slate-700">{fmt(equalShare)}</span>
                </div>
              ))}
            </div>
          )}

          {/* PERCENTAGE split */}
          {splitScope === 'overall' && splitMethod === 'percentage' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Each participant's % of the total. Must add up to exactly 100%.
              </p>
              {participantMembers.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <Avatar name={m.displayName || m.username} size={7} colorIndex={i} />
                  <span className="text-sm font-semibold text-slate-800 flex-1">{m.displayName || m.username}</span>
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
          {splitScope === 'overall' && splitMethod === 'custom' && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Enter the exact rupee amount each person owes. Must sum to {fmt(totalAmount)}.
              </p>
              {participantMembers.map((m, i) => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <Avatar name={m.displayName || m.username} size={7} colorIndex={i} />
                  <span className="text-sm font-semibold text-slate-800 flex-1">{m.displayName || m.username}</span>
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
function SettleUpModal({ token, group, simplifiedDebts = [], members, currentUser, onClose, onSettled }) {
  const [marking, setMarking]       = useState(null)
  const [error, setError]           = useState('')
  const [qrTarget, setQrTarget]     = useState(null) // { upiLink, name, amount, upi, s }
  const [upiConfirm, setUpiConfirm] = useState(null) // debt s – "did you pay?"

  const mine       = simplifiedDebts.filter((s) => s.from?.id === currentUser.id)
  const fromOthers = simplifiedDebts.filter((s) => s.to?.id === currentUser.id)
  const isMobile   = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)

  // Step 1: Create pending settlement record → returns settlement id
  async function createSettlement(s, method) {
    const data = await api(`/api/v1/groups/${group.id}/settlements`, {
      method: 'POST',
      body: { toUser: s.to?.id, amount: s.amount, currency: group.currency || 'INR', paymentMethod: method },
      token,
    })
    return data.settlement?.id
  }

  // Step 2: Mark settlement as completed (writes to ledger)
  async function completeCash(settlementId) {
    await api(`/api/v1/groups/${group.id}/payments/mark-cash`, {
      method: 'POST',
      body: { settlementId },
      token,
    })
  }

  // Full cash/upi settle: create + complete
  async function settle(s, method) {
    const key = `${s.from?.id}-${s.to?.id}`
    setMarking(key)
    setError('')
    try {
      const settlementId = await createSettlement(s, method)
      await completeCash(settlementId)
      onSettled()
    } catch (err) {
      setError(err.message)
    } finally {
      setMarking(null)
    }
  }

  // UPI: mobile → deep link + confirm dialog; desktop → QR
  function payViaUpi(s) {
    const upi = s.to?.upiId
    if (!upi) { setError('Recipient has no UPI ID linked.'); return }
    const name     = encodeURIComponent(s.to?.displayName || s.to?.username || 'Payee')
    const amt      = s.amount.toFixed(2)
    const note     = encodeURIComponent(`Nexora - ${group.name}`)
    const deepLink = `upi://pay?pa=${upi}&pn=${name}&am=${amt}&cu=INR&tn=${note}`
    if (isMobile) {
      window.location.href = deepLink
      setUpiConfirm(s)
    } else {
      setQrTarget({ upiLink: deepLink, name: s.to?.displayName || s.to?.username, amount: s.amount, upi, s })
    }
  }

  // Card: create settlement first then redirect to Stripe Checkout
  async function payViaCard(s) {
    const key = `${s.from?.id}-${s.to?.id}`
    setMarking(key)
    setError('')
    try {
      const settlementId = await createSettlement(s, 'card')
      const data = await api(`/api/v1/groups/${group.id}/payments/checkout-session`, {
        method: 'POST',
        body: { settlementId },
        token,
      })
      if (data.url) window.location.href = data.url
    } catch (err) {
      setError(err.message || 'Card checkout unavailable. Try another payment method.')
      setMarking(null)
    }
  }

  function buildQr(s) {
    const upi = s.to?.upiId
    if (!upi) { setError('Recipient has no UPI ID linked.'); return }
    const name     = encodeURIComponent(s.to?.displayName || s.to?.username || 'Payee')
    const amt      = s.amount.toFixed(2)
    const note     = encodeURIComponent(`Nexora - ${group.name}`)
    const deepLink = `upi://pay?pa=${upi}&pn=${name}&am=${amt}&cu=INR&tn=${note}`
    setQrTarget({ upiLink: deepLink, name: s.to?.displayName || s.to?.username, amount: s.amount, upi, s })
  }

  // ── QR overlay ────────────────────────────────────────────────────────────
  if (qrTarget) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrTarget.upiLink)}&size=220x220&margin=10`
    return (
      <Modal title="Scan to Pay" onClose={() => setQrTarget(null)}>
        <div className="flex flex-col items-center gap-4 py-4">
          <p className="text-sm text-slate-600">Pay <span className="font-bold">{qrTarget.name}</span></p>
          <p className="text-2xl font-extrabold text-slate-900">{fmt(qrTarget.amount)}</p>
          <div className="rounded-2xl border border-slate-200 p-3 bg-white">
            <img src={qrUrl} alt="UPI QR Code" className="w-56 h-56" />
          </div>
          <p className="text-xs text-slate-500">UPI: <span className="font-mono">{qrTarget.upi}</span></p>
          <p className="text-xs text-slate-400">Open any UPI app and scan this code</p>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-3 w-full">
            <button onClick={() => setQrTarget(null)}
              className="flex-1 rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              disabled={!!marking}
              onClick={async () => {
                const s = qrTarget.s
                setQrTarget(null)
                await settle(s, 'upi')
              }}
              className="flex-1 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-60">
              ✓ I've Paid
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── UPI confirm overlay (mobile – after deep link) ─────────────────────────
  if (upiConfirm) {
    return (
      <Modal title="Confirm Payment" onClose={() => setUpiConfirm(null)}>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <div className="text-5xl">📲</div>
          <p className="font-semibold text-slate-800">Did you complete the UPI payment?</p>
          <p className="text-sm text-slate-500">
            Pay <span className="font-bold">{upiConfirm.to?.displayName || upiConfirm.to?.username}</span> · {fmt(upiConfirm.amount)}
          </p>
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex gap-3 w-full">
            <button onClick={() => setUpiConfirm(null)}
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600">
              Not Yet
            </button>
            <button
              disabled={!!marking}
              onClick={async () => {
                const s = upiConfirm
                setUpiConfirm(null)
                await settle(s, 'upi')
              }}
              className="flex-1 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-60">
              ✓ Yes, Paid!
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── Main modal ─────────────────────────────────────────────────────────────
  return (
    <Modal title="Settle Up" onClose={onClose}>
      <div className="space-y-5">

        {/* ── Debts you owe ── */}
        {mine.length > 0 && (
          <section>
            <p className="text-sm font-bold text-slate-700 mb-3">You owe</p>
            <div className="space-y-4">
              {mine.map((s) => {
                const key    = `${s.from?.id}-${s.to?.id}`
                const isBusy = marking === key
                return (
                  <div key={key} className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-slate-900">Pay {s.to?.displayName || s.to?.username}</p>
                        {s.to?.upiId
                          ? <p className="text-xs text-slate-500">UPI: {s.to.upiId}</p>
                          : <p className="text-xs text-rose-400">No UPI linked — use cash or card</p>}
                      </div>
                      <span className="text-xl font-extrabold text-rose-600">{fmt(s.amount)}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={() => payViaUpi(s)} disabled={isBusy || !s.to?.upiId}
                        className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50 transition-colors">
                        📲 Pay via UPI
                      </button>
                      <button onClick={() => settle(s, 'cash')} disabled={isBusy}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                        {isBusy ? '…' : '💵 Mark as Cash'}
                      </button>
                      <button onClick={() => payViaCard(s)} disabled={isBusy}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                        {isBusy ? '…' : '💳 Card Checkout'}
                      </button>
                      <button onClick={() => buildQr(s)} disabled={!s.to?.upiId}
                        className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors">
                        📷 Show QR Code
                      </button>
                    </div>
                    {isBusy && <p className="text-xs text-slate-400 mt-2 text-center">Processing…</p>}
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── Amounts owed to you ── */}
        {fromOthers.length > 0 && (
          <section>
            <p className="text-sm font-bold text-slate-700 mb-3">Owed to you</p>
            <div className="space-y-2">
              {fromOthers.map((s) => {
                const key = `${s.from?.id}-${s.to?.id}`
                return (
                  <div key={key} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-semibold text-slate-900">{s.from?.displayName || s.from?.username} owes you</p>
                        {s.from?.upiId
                          ? <p className="text-xs text-slate-500">Their UPI: {s.from.upiId}</p>
                          : <p className="text-xs text-slate-400">No UPI linked</p>}
                      </div>
                      <span className="text-lg font-bold text-emerald-600">{fmt(s.amount)}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-2">
                      They need to initiate payment from their account.
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {mine.length === 0 && fromOthers.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="text-5xl mb-3">🎉</span>
            <p className="font-bold text-slate-800">All settled up!</p>
            <p className="text-sm text-slate-500 mt-1">No pending settlements in this group.</p>
          </div>
        )}

        {error && <p className="rounded-xl bg-rose-50 border border-rose-200 px-4 py-2 text-sm text-rose-700">{error}</p>}
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
  const [showJoinGroup, setShowJoinGroup]     = useState(false)
  const [showExpense, setShowExpense]         = useState(false)
  const [showSettle, setShowSettle]           = useState(false)

  const [loading, setLoading]       = useState(true)
  const [toast, setToast]           = useState(null)  // { message, type }

  const showToast = (message, type = 'success') => setToast({ message, type })

  // ── Load groups on mount ────────────────────────────────────────────────
  useEffect(() => {
    api('/api/v1/groups', { token }).then((d) => {
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
      api(`/api/v1/groups/${activeGroupId}`, { token }),
      api(`/api/v1/groups/${activeGroupId}/expenses`, { token }),
      api(`/api/v1/groups/${activeGroupId}/balances`, { token }),
      api(`/api/v1/groups/${activeGroupId}/settlements`, { token }),
    ]).then(([gd, ed, bd, sd]) => {
      setGroupDetail({ group: gd.group, members: gd.group.members })
      setExpenses(ed.expenses || [])
      // Map new backend response shape to what the UI expects
      const members = (bd.balances || []).map(m => ({
        ...m, id: m.userId, net: Number(m.netBalance || 0)
      }))
      const settlements = (bd.simplifiedDebts || []).map(d => ({
        from: { ...d.from, displayName: d.from?.displayName || d.from?.username },
        to:   { ...d.to,   displayName: d.to?.displayName   || d.to?.username, upiId: d.to?.upiId },
        amount: d.amount
      }))
      setBalances({ members, settlements })
      setSettlements(sd.settlements || [])
    }).catch(console.error).finally(() => setLoading(false))
  }, [activeGroupId, token])

  function refreshExpenses() {
    Promise.all([
      api(`/api/v1/groups/${activeGroupId}/expenses`, { token }),
      api(`/api/v1/groups/${activeGroupId}/balances`, { token }),
      api(`/api/v1/groups/${activeGroupId}/settlements`, { token }),
    ]).then(([ed, bd, sd]) => {
      setExpenses(ed.expenses || [])
      const members = (bd.balances || []).map(m => ({
        ...m, id: m.userId, net: Number(m.netBalance || 0)
      }))
      const settlements = (bd.simplifiedDebts || []).map(d => ({
        from: { ...d.from, displayName: d.from?.displayName || d.from?.username },
        to:   { ...d.to,   displayName: d.to?.displayName   || d.to?.username, upiId: d.to?.upiId },
        amount: d.amount
      }))
      setBalances({ members, settlements })
      setSettlements(sd.settlements || [])
    })
  }

  const activeGroup = groupDetail?.group
  const members     = groupDetail?.members || []

  // Summary totals from balances
  const myNet   = balances?.members?.find((m) => m.id === user.id)?.net || 0
  const totalOwed  = balances?.members?.reduce((s, m) => m.id !== user.id && m.net < -0.005 ? s + Math.abs(m.net) : s, 0) || 0
  const totalOwing = balances?.members?.reduce((s, m) => m.id !== user.id && m.net > 0.005 ? s + m.net : s, 0) || 0
  const settlementDirectionByUser = (balances?.settlements || []).reduce((acc, s) => {
    const fromId = s.from?.id
    const toId = s.to?.id
    const fromName = s.from?.displayName || s.from?.username || 'Member'
    const toName = s.to?.displayName || s.to?.username || 'Member'

    if (fromId && toId) {
      if (!acc[fromId]) acc[fromId] = { payTo: new Set(), receiveFrom: new Set(), selfName: fromName }
      if (!acc[toId]) acc[toId] = { payTo: new Set(), receiveFrom: new Set(), selfName: toName }

      acc[fromId].payTo.add(toName)
      acc[toId].receiveFrom.add(fromName)
    }

    return acc
  }, {})

  const nonZeroOptimizationMembers = (balances?.members || []).filter((m) => Math.abs(Number(m.net || 0)) > 0.005)

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-100 font-sans">

      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="flex w-64 flex-shrink-0 flex-col bg-slate-900 text-white overflow-hidden">

        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-slate-800">
          <div className="h-8 w-8 rounded-xl bg-emerald-500 flex items-center justify-center font-black text-sm text-white">N</div>
          <span className="font-bold text-lg tracking-tight">Nexora</span>
        </div>

        {/* User info */}
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="rounded-xl bg-slate-800 p-3 flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-500/20 flex items-center justify-center text-sm font-bold text-emerald-400 flex-shrink-0">
              {(user.displayName || user.username || 'U')[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate text-white">{user.displayName || user.username}</p>
              <p className="text-xs text-slate-400 truncate">{user.email}</p>
            </div>
          </div>
        </div>

        {/* Create / Join */}
        <div className="px-4 py-3 flex gap-2 border-b border-slate-800">
          <button onClick={() => setShowCreateGroup(true)}
            className="flex-1 rounded-xl bg-emerald-500 py-2 text-sm font-bold text-white hover:bg-emerald-400 transition-colors">
            + New
          </button>
          <button onClick={() => setShowJoinGroup(true)}
            className="flex-1 rounded-xl bg-slate-700 py-2 text-sm font-bold text-slate-200 hover:bg-slate-600 transition-colors">
            Join
          </button>
        </div>

        {/* Group list */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-2 mb-2">Your Groups</p>
          {groups.length === 0 && !loading && (
            <p className="text-xs text-slate-500 px-2 py-3">No groups yet. Create one!</p>
          )}
          {groups.map((g) => (
            <button key={g.id} onClick={() => setActiveGroupId(g.id)}
              className={`w-full rounded-xl px-3 py-3 text-left transition-all
                ${activeGroupId === g.id
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                  : 'hover:bg-slate-800 border border-transparent text-slate-300'}`}>
              <p className="text-sm font-bold truncate">{g.name}</p>
              <p className="text-xs text-slate-500 mt-0.5">{g.memberCount} member{g.memberCount !== 1 ? 's' : ''} · {g.currency}</p>
            </button>
          ))}
        </div>

        {/* Sign out */}
        <div className="px-4 py-4 border-t border-slate-800">
          <button onClick={onLogout}
            className="w-full rounded-xl border border-slate-700 py-2 text-sm font-semibold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors">
            Sign Out
          </button>
        </div>
      </aside>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Top header bar */}
        <header className="flex items-center justify-between gap-4 bg-white border-b border-slate-200 px-6 py-4 flex-shrink-0">
          <div>
            <h1 className="text-xl font-extrabold text-slate-900">
              {activeGroup ? activeGroup.name : `Hello, ${(user.displayName || user.username || 'User').split(' ')[0]} 👋`}
            </h1>
            {activeGroup && (
              <p className="text-xs text-slate-500 mt-0.5">
                {members.length} member{members.length !== 1 ? 's' : ''} · {activeGroup.currency} · {activeGroup.description || 'No description'}
              </p>
            )}
          </div>
          {activeGroup && (
            <div className="flex gap-2">
              <button onClick={() => setShowExpense(true)}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 transition-colors">
                + Add Expense
              </button>
              <button onClick={() => setShowSettle(true)}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 transition-colors">
                Settle Up
              </button>
            </div>
          )}
        </header>

        {/* Stat cards */}
        {activeGroup && (
          <div className="grid grid-cols-3 gap-4 px-6 py-4 flex-shrink-0 bg-white border-b border-slate-200">
            <div className="rounded-2xl bg-rose-50 border border-rose-100 p-4">
              <p className="text-xs font-semibold text-rose-400 uppercase tracking-wider">To Pay</p>
              <p className="mt-1 text-2xl font-extrabold text-rose-600">{fmt(Math.max(0, -myNet))}</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 p-4">
              <p className="text-xs font-semibold text-emerald-500 uppercase tracking-wider">To Receive</p>
              <p className="mt-1 text-2xl font-extrabold text-emerald-600">{fmt(Math.max(0, myNet))}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Net Balance</p>
              <p className={`mt-1 text-2xl font-extrabold ${myNet >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{fmt(myNet)}</p>
            </div>
          </div>
        )}

        {/* Tabs */}
        {activeGroup && (
          <div className="flex gap-1 px-6 pt-4 flex-shrink-0 bg-slate-50 border-b border-slate-200">
            {['expenses', 'balances', 'members', 'profile'].map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-sm font-semibold capitalize transition-all border-b-2 -mb-px
                  ${activeTab === tab
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
                {tab}
              </button>
            ))}
          </div>
        )}

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto bg-slate-50">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <Spinner />
            </div>
          )}

          {!activeGroup && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-center p-10">
              <div className="text-6xl mb-4">💸</div>
              <h2 className="text-2xl font-extrabold text-slate-800 mb-2">Welcome to Nexora</h2>
              <p className="text-slate-500 max-w-sm">Create a group or join one using an invite link to start splitting expenses.</p>
              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowCreateGroup(true)}
                  className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-700">
                  + Create Group
                </button>
                <button onClick={() => setShowJoinGroup(true)}
                  className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-white">
                  Join via Link
                </button>
              </div>
            </div>
          )}

          {!loading && activeGroup && (
            <div className="px-6 py-5">

              {/* EXPENSES tab */}
              {activeTab === 'expenses' && (
                <div className="space-y-2">
                  {expenses.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <p className="text-5xl mb-3">🧾</p>
                      <p className="font-bold text-slate-700 text-lg">No expenses yet</p>
                      <p className="text-sm text-slate-400 mt-1">Add your first expense to start tracking.</p>
                      <button onClick={() => setShowExpense(true)}
                        className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-700">
                        + Add Expense
                      </button>
                    </div>
                  )}
                  {expenses.map((exp) => {
                    const paidByMe = exp.paidBy === user.id
                    const share = Number(exp.your_share) || 0
                    const youOweAmt = paidByMe ? -(exp.amount - share) : share
                    return (
                      <article key={exp.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 hover:border-slate-300 hover:shadow-sm transition-all">
                        <div className="flex items-center gap-4">
                          <span className="text-2xl">{CATEGORY_ICONS[exp.category] || '📦'}</span>
                          <div>
                            <p className="font-bold text-slate-900">{exp.description || exp.title || 'Expense'}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {exp.category} · Paid by {exp.paidByUser?.displayName || exp.paidByUser?.username || 'Someone'}
                              {paidByMe ? ' (you)' : ''}
                            </p>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {new Date(exp.expenseDate || exp.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                              &nbsp;· <span className="capitalize">{exp.splitType} split</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-extrabold text-slate-900">{fmt(exp.amount)}</p>
                          <p className={`text-xs font-bold mt-0.5 ${youOweAmt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {youOweAmt > 0.005
                              ? `you owe ${fmt(youOweAmt)}`
                              : youOweAmt < -0.005
                                ? `you're owed ${fmt(Math.abs(youOweAmt))}`
                                : 'settled'}
                          </p>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}

              {/* BALANCES tab */}
              {activeTab === 'balances' && (
                <div className="space-y-4">
                  {balances && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {balances.members.map((m, i) => (
                          <article key={m.id} className={`rounded-2xl border p-4 bg-white ${m.net >= 0 ? 'border-emerald-200' : 'border-rose-200'}`}>
                            <div className="flex items-center gap-3">
                              <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0
                                ${m.net >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {(m.displayName || m.username || '?')[0].toUpperCase()}
                              </div>
                              <div>
                                <p className="text-sm font-bold text-slate-900">{m.displayName || m.username}{m.id === user.id ? ' (you)' : ''}</p>
                                <p className={`text-xs font-semibold ${m.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {m.net >= 0 ? `to recieve ${fmt(m.net)}` : `to pay ${fmt(Math.abs(m.net))}`}
                                </p>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>

                      {balances.settlements.length > 0 && (
                        <div>
                          <p className="text-sm font-bold text-slate-700 mb-3">Optimized Settlement Plan</p>
                          <div className="space-y-2">
                            {nonZeroOptimizationMembers.map((m) => {
                              const selfName = m.displayName || m.username || 'Member'
                              const direction = settlementDirectionByUser[m.id]
                              const payTargets = direction ? [...direction.payTo] : []
                              const receiveSources = direction ? [...direction.receiveFrom] : []

                              if (m.net < -0.005 && payTargets.length > 0) {
                                return (
                                  <div key={`opt-${m.id}-pay`} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
                                    <p className="text-sm text-slate-700">
                                      <span className="font-bold">{selfName}</span>
                                      <span className="text-rose-600 font-bold mx-2">-&gt;</span>
                                      <span className="font-bold">{payTargets.join(', ')}</span>
                                    </p>
                                  </div>
                                )
                              }

                              if (m.net > 0.005 && receiveSources.length > 0) {
                                return (
                                  <div key={`opt-${m.id}-receive`} className="rounded-xl border border-slate-200 bg-white px-5 py-3">
                                    <p className="text-sm text-slate-700">
                                      <span className="font-bold">{selfName}</span>
                                      <span className="text-emerald-600 font-bold mx-2">&lt;-</span>
                                      <span className="font-bold">{receiveSources.join(', ')}</span>
                                    </p>
                                  </div>
                                )
                              }

                              return null
                            })}
                          </div>
                        </div>
                      )}

                      {balances.settlements.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <p className="text-4xl mb-2">🎉</p>
                          <p className="font-bold text-slate-700">All balanced!</p>
                          <p className="text-sm text-slate-400 mt-1">No settlements needed in this group.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* MEMBERS tab */}
              {activeTab === 'members' && (
                <div className="space-y-3">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Invite Link</p>
                    <div className="flex gap-2">
                      <input readOnly value={`${window.location.origin}/invite/${activeGroup?.id || ''}`}
                        className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600" />
                      <button onClick={() => {
                        navigator.clipboard?.writeText(`${window.location.origin}/invite/${activeGroup?.id || ''}`)
                        showToast('Invite link copied!')
                      }} className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white hover:bg-slate-700">
                        Copy
                      </button>
                    </div>
                  </div>
                  {members.map((m, i) => (
                    <article key={m.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-700 flex-shrink-0">
                          {(m.displayName || m.username || '?')[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{m.displayName || m.username}{m.id === user.id ? ' (you)' : ''}</p>
                          {m.upiId && <p className="text-xs text-slate-400">UPI: {m.upiId}</p>}
                        </div>
                      </div>
                      <span className={`text-xs rounded-full px-3 py-1 font-semibold
                        ${m.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                        {m.role}
                      </span>
                    </article>
                  ))}
                </div>
              )}

              {/* PROFILE tab */}
              {activeTab === 'profile' && (
                <div className="max-w-md">
                  <ProfileTab token={token} user={user} showToast={showToast} />
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {showCreateGroup && (
        <CreateGroupModal token={token} onClose={() => setShowCreateGroup(false)}
          onCreated={(g) => {
            setGroups((prev) => [{ ...g, memberCount: 1 }, ...prev])
            setActiveGroupId(g.id)
            setShowCreateGroup(false)
            showToast('Group created!')
          }} />
      )}

      {showJoinGroup && (
        <JoinGroupModal token={token} user={user} onClose={() => setShowJoinGroup(false)}
          onJoined={(g) => {
            setGroups((prev) => {
              const exists = prev.find(x => x.id === g.id)
              if (exists) return prev
              return [{ ...g, memberCount: (g.memberCount || 1) }, ...prev]
            })
            setActiveGroupId(g.id)
            setShowJoinGroup(false)
            showToast('Joined group successfully!')
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
          token={token} group={activeGroup}
          simplifiedDebts={balances?.settlements || []}
          members={members} currentUser={user}
          onClose={() => setShowSettle(false)}
          onSettled={() => { refreshExpenses(); showToast('Settlement recorded!') }} />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  )
}



// ─────────────────────────────────────────────────────────────────────────────
// PROFILE TAB (separated to keep AppShell lean)
// ─────────────────────────────────────────────────────────────────────────────
function ProfileTab({ token, user, showToast }) {
  const [form, setForm]     = useState({
    name: user.displayName || user.username || '',
    upi_id: user.upiId || '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await api('/api/v1/users/me', { method: 'PUT', body: { displayName: form.name, upiId: form.upi_id }, token })
      showToast('Profile updated!')
    } catch {
      showToast('Failed to update profile', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-4 max-w-md">
      <div className="mb-2">
        <p className="font-bold text-slate-900 text-lg">{user.email}</p>
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
    api('/api/v1/users/me', { token })
      .then((d) => setUser(d.user))
      .catch(() => {
        localStorage.removeItem('breach_token')
        localStorage.removeItem('breach_refresh')
        setToken(null)
      })
      .finally(() => setBooting(false))
  }, [token])

  function handleAuth(t, u) {
    setToken(t)
    setUser(u)
  }

  function handleLogout() {
    api('/api/v1/auth/logout', { method: 'POST', token }).catch(() => {})
    localStorage.removeItem('breach_token')
    localStorage.removeItem('breach_refresh')
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
