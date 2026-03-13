import { useMemo, useState } from 'react'

const demoUsers = [
  { id: 'u1', name: 'You', email: 'you@breach.app', avatar: 'Y' },
  { id: 'u2', name: 'Aarav', email: 'aarav@mail.com', avatar: 'A' },
  { id: 'u3', name: 'Meera', email: 'meera@mail.com', avatar: 'M' },
  { id: 'u4', name: 'Rishi', email: 'rishi@mail.com', avatar: 'R' },
]

const initialGroups = [
  { id: 'g1', name: 'Goa Trip', description: '4 days trip planning', currency: 'INR', members: 4, net: -780 },
  { id: 'g2', name: 'Flat Expenses', description: 'Monthly utilities and groceries', currency: 'INR', members: 3, net: 1480 },
  { id: 'g3', name: 'Hackathon Team', description: 'Food + travel + hosting', currency: 'INR', members: 5, net: 230 },
]

const initialExpenses = [
  { id: 'e1', groupId: 'g1', title: 'Beach shack dinner', amount: 3200, paidBy: 'Aarav', youOwe: 800, date: '2026-03-10', category: 'Food' },
  { id: 'e2', groupId: 'g1', title: 'Scooter rental', amount: 1800, paidBy: 'You', youOwe: -900, date: '2026-03-09', category: 'Transport' },
  { id: 'e3', groupId: 'g1', title: 'Hostel booking', amount: 5200, paidBy: 'Meera', youOwe: 1300, date: '2026-03-07', category: 'Stay' },
]

const summaryCards = [
  { key: 'owe', title: 'You owe', amount: 2580, accent: 'text-rose-600', bg: 'bg-rose-50' },
  { key: 'owed', title: 'You are owed', amount: 4120, accent: 'text-emerald-600', bg: 'bg-emerald-50' },
  { key: 'net', title: 'Net balance', amount: 1540, accent: 'text-cyan-700', bg: 'bg-cyan-50' },
]

function formatInr(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value)
}

function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-3 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [activeTab, setActiveTab] = useState('expenses')
  const [groups, setGroups] = useState(initialGroups)
  const [activeGroupId, setActiveGroupId] = useState(initialGroups[0].id)
  const [expenses, setExpenses] = useState(initialExpenses)

  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [showExpenseFlow, setShowExpenseFlow] = useState(false)
  const [showSettle, setShowSettle] = useState(false)

  const [expenseStep, setExpenseStep] = useState(1)
  const [splitMethod, setSplitMethod] = useState('equal')
  const [participants, setParticipants] = useState(demoUsers.map((u) => u.id))
  const [percentageMap, setPercentageMap] = useState({ u1: 25, u2: 25, u3: 25, u4: 25 })
  const [customMap, setCustomMap] = useState({ u1: 0, u2: 0, u3: 0, u4: 0 })
  const [expenseForm, setExpenseForm] = useState({
    amount: 0,
    title: '',
    category: 'Food',
    date: new Date().toISOString().slice(0, 10),
    paidBy: 'You',
  })

  const [groupForm, setGroupForm] = useState({ name: '', description: '', currency: 'INR', cover: '' })

  const activeGroup = groups.find((group) => group.id === activeGroupId)
  const groupExpenses = expenses.filter((item) => item.groupId === activeGroupId)

  const totalPercent = useMemo(
    () => participants.reduce((sum, id) => sum + Number(percentageMap[id] || 0), 0),
    [participants, percentageMap],
  )

  const totalCustom = useMemo(
    () => participants.reduce((sum, id) => sum + Number(customMap[id] || 0), 0),
    [participants, customMap],
  )

  const settlementPlan = [
    { from: 'You', to: 'Aarav', amount: 500, mode: 'UPI' },
    { from: 'You', to: 'Meera', amount: 280, mode: 'Cash' },
  ]

  function resetExpenseFlow() {
    setExpenseStep(1)
    setSplitMethod('equal')
    setParticipants(demoUsers.map((u) => u.id))
    setPercentageMap({ u1: 25, u2: 25, u3: 25, u4: 25 })
    setCustomMap({ u1: 0, u2: 0, u3: 0, u4: 0 })
    setExpenseForm({ amount: 0, title: '', category: 'Food', date: new Date().toISOString().slice(0, 10), paidBy: 'You' })
  }

  function submitExpense() {
    const value = Number(expenseForm.amount || 0)
    const count = participants.length || 1
    const equalShare = value / count

    const youOwe = expenseForm.paidBy === 'You' ? -equalShare : equalShare

    const next = {
      id: `e${Date.now()}`,
      groupId: activeGroupId,
      title: expenseForm.title || 'Untitled expense',
      amount: value,
      paidBy: expenseForm.paidBy,
      youOwe,
      category: expenseForm.category,
      date: expenseForm.date,
    }

    setExpenses((prev) => [next, ...prev])
    setShowExpenseFlow(false)
    resetExpenseFlow()
  }

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen p-6 md:p-10">
        <div className="mx-auto grid w-full max-w-6xl gap-8 rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-soft backdrop-blur md:grid-cols-2 md:p-10">
          <div className="flex flex-col justify-between gap-6 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 p-6 text-white">
            <div>
              <p className="text-sm uppercase tracking-[0.18em] text-emerald-100">Breach</p>
              <h1 className="mt-4 text-4xl font-bold">Smart expense splitting for every group</h1>
              <p className="mt-4 text-emerald-50">Track bills, run transparent ledgers, and settle in the fewest possible transactions.</p>
            </div>
            <div className="rounded-2xl border border-white/30 bg-white/15 p-4 text-sm">
              <p>Active groups: 12</p>
              <p>Settlement completion rate: 96%</p>
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
            <h2 className="text-2xl font-bold text-slate-900">Login / Signup</h2>
            <p className="mt-1 text-sm text-slate-500">Use your email or continue with Google.</p>
            <div className="mt-6 space-y-4">
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3" placeholder="Email address" />
              <input className="w-full rounded-xl border border-slate-300 px-4 py-3" type="password" placeholder="Password" />
              <button onClick={() => setIsAuthenticated(true)} className="w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white">
                Continue
              </button>
              <button className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-700">Continue with Google</button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 md:flex-row">
        <aside className="w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-soft md:w-72">
          <div className="rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 p-4 text-white">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Breach</p>
            <h2 className="mt-2 text-2xl font-bold">Group Wallet</h2>
            <p className="text-sm text-slate-300">Simple, transparent, clean</p>
          </div>
          <button onClick={() => setShowCreateGroup(true)} className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-white hover:bg-emerald-600">
            + Create Group
          </button>
          <div className="mt-4 space-y-2">
            {groups.map((group) => (
              <button
                key={group.id}
                onClick={() => setActiveGroupId(group.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left ${
                  activeGroupId === group.id ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'
                }`}
              >
                <p className="font-semibold text-slate-900">{group.name}</p>
                <p className="text-xs text-slate-500">{group.description}</p>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex-1 space-y-5">
          <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-slate-900">Hello, Priya</h1>
                <p className="text-sm text-slate-500">{activeGroup?.name} . {activeGroup?.members} members</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowExpenseFlow(true)} className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Add Expense</button>
                <button onClick={() => setShowSettle(true)} className="rounded-xl bg-emerald-500 px-4 py-2 font-semibold text-white">Settle Up</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {summaryCards.map((card) => (
                <article key={card.key} className={`rounded-2xl p-4 ${card.bg}`}>
                  <p className="text-sm text-slate-500">{card.title}</p>
                  <p className={`mt-1 text-xl font-bold ${card.accent}`}>{formatInr(card.amount)}</p>
                </article>
              ))}
            </div>
          </header>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
            <div className="mb-4 flex gap-2">
              {['expenses', 'balances', 'members', 'profile'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                    activeTab === tab ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {activeTab === 'expenses' && (
              <div className="space-y-3">
                {groupExpenses.map((expense) => (
                  <article key={expense.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-slate-900">{expense.title}</p>
                        <p className="text-xs text-slate-500">{expense.category} . Paid by {expense.paidBy}</p>
                      </div>
                      <p className="text-lg font-bold text-slate-900">{formatInr(expense.amount)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <p className="text-slate-500">{new Date(expense.date).toLocaleDateString('en-IN')}</p>
                      <p className={expense.youOwe > 0 ? 'font-semibold text-rose-600' : 'font-semibold text-emerald-600'}>
                        {expense.youOwe > 0 ? `You owe ${formatInr(expense.youOwe)}` : `You are owed ${formatInr(Math.abs(expense.youOwe))}`}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {activeTab === 'balances' && (
              <div className="grid gap-3 md:grid-cols-2">
                <article className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-sm text-rose-700">You owe in this group</p>
                  <p className="mt-1 text-2xl font-bold text-rose-700">{formatInr(780)}</p>
                  <p className="mt-2 text-sm text-rose-600">Pay Aarav {formatInr(500)}, Meera {formatInr(280)}</p>
                </article>
                <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-sm text-emerald-700">You are owed</p>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">{formatInr(1240)}</p>
                  <p className="mt-2 text-sm text-emerald-600">From Rishi {formatInr(740)}, Aarav {formatInr(500)}</p>
                </article>
              </div>
            )}

            {activeTab === 'members' && (
              <div className="space-y-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-600">Invite link</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input readOnly value="https://breach.app/invite/goa-trip-ak1d" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
                    <button className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Copy</button>
                  </div>
                </div>
                {demoUsers.map((member) => (
                  <article key={member.id} className="flex items-center justify-between rounded-2xl border border-slate-200 p-3">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-700">{member.avatar}</span>
                      <div>
                        <p className="font-semibold text-slate-900">{member.name}</p>
                        <p className="text-xs text-slate-500">{member.email}</p>
                      </div>
                    </div>
                    <button className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-semibold text-slate-600">View</button>
                  </article>
                ))}
              </div>
            )}

            {activeTab === 'profile' && (
              <form className="grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">
                  Display Name
                  <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" defaultValue="Priya Sharma" />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  UPI ID
                  <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" defaultValue="priya@upi" />
                </label>
                <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                  Avatar URL
                  <input className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="https://..." />
                </label>
                <button className="w-fit rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Update Profile</button>
              </form>
            )}
          </section>
        </section>
      </div>

      {showCreateGroup && (
        <Modal title="Create Group" onClose={() => setShowCreateGroup(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!groupForm.name.trim()) return
              const nextGroup = {
                id: `g${Date.now()}`,
                name: groupForm.name,
                description: groupForm.description || 'No description',
                currency: groupForm.currency,
                members: 1,
                net: 0,
              }
              setGroups((prev) => [nextGroup, ...prev])
              setActiveGroupId(nextGroup.id)
              setShowCreateGroup(false)
              setGroupForm({ name: '', description: '', currency: 'INR', cover: '' })
            }}
            className="grid gap-3"
          >
            <input value={groupForm.name} onChange={(e) => setGroupForm((prev) => ({ ...prev, name: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2" placeholder="Group name" />
            <textarea value={groupForm.description} onChange={(e) => setGroupForm((prev) => ({ ...prev, description: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2" placeholder="Description" />
            <select value={groupForm.currency} onChange={(e) => setGroupForm((prev) => ({ ...prev, currency: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2">
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
            <input value={groupForm.cover} onChange={(e) => setGroupForm((prev) => ({ ...prev, cover: e.target.value }))} className="rounded-xl border border-slate-300 px-3 py-2" placeholder="Cover image URL" />
            <button className="w-fit rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Create</button>
          </form>
        </Modal>
      )}

      {showExpenseFlow && (
        <Modal
          title={`Add Expense - Step ${expenseStep} of 3`}
          onClose={() => {
            setShowExpenseFlow(false)
            resetExpenseFlow()
          }}
        >
          {expenseStep === 1 && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">
                Amount
                <input type="number" value={expenseForm.amount} onChange={(e) => setExpenseForm((prev) => ({ ...prev, amount: Number(e.target.value) }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Category
                <select value={expenseForm.category} onChange={(e) => setExpenseForm((prev) => ({ ...prev, category: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2">
                  <option>Food</option>
                  <option>Travel</option>
                  <option>Stay</option>
                  <option>Utilities</option>
                </select>
              </label>
              <label className="text-sm font-semibold text-slate-700 md:col-span-2">
                Description
                <input value={expenseForm.title} onChange={(e) => setExpenseForm((prev) => ({ ...prev, title: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" placeholder="Dinner at beach shack" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Date
                <input type="date" value={expenseForm.date} onChange={(e) => setExpenseForm((prev) => ({ ...prev, date: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
              </label>
              <label className="text-sm font-semibold text-slate-700">
                Paid By
                <select value={expenseForm.paidBy} onChange={(e) => setExpenseForm((prev) => ({ ...prev, paidBy: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2">
                  {demoUsers.map((u) => (
                    <option key={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {expenseStep === 2 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {demoUsers.map((user) => (
                <label key={user.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                  <input
                    type="checkbox"
                    checked={participants.includes(user.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setParticipants((prev) => [...prev, user.id])
                      } else {
                        setParticipants((prev) => prev.filter((id) => id !== user.id))
                      }
                    }}
                  />
                  <span className="text-sm font-semibold text-slate-700">{user.name}</span>
                </label>
              ))}
            </div>
          )}

          {expenseStep === 3 && (
            <div className="space-y-3">
              <div className="flex gap-2">
                {['equal', 'percentage', 'custom'].map((method) => (
                  <button
                    key={method}
                    onClick={() => setSplitMethod(method)}
                    className={`rounded-lg px-3 py-1 text-sm font-semibold ${
                      splitMethod === method ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>

              {splitMethod === 'equal' && (
                <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {participants.length > 0
                    ? `Each selected member pays ${formatInr(Number(expenseForm.amount || 0) / participants.length)}.`
                    : 'Select at least one participant.'}
                </article>
              )}

              {splitMethod === 'percentage' && (
                <div className="space-y-2">
                  {participants.map((id) => {
                    const user = demoUsers.find((item) => item.id === id)
                    return (
                      <label key={id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                        <span className="text-sm font-semibold text-slate-700">{user?.name}</span>
                        <input
                          type="number"
                          value={percentageMap[id] ?? 0}
                          onChange={(e) => setPercentageMap((prev) => ({ ...prev, [id]: Number(e.target.value) }))}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1"
                        />
                      </label>
                    )
                  })}
                  <p className={`text-sm font-semibold ${totalPercent === 100 ? 'text-emerald-600' : 'text-rose-600'}`}>Total: {totalPercent}%</p>
                </div>
              )}

              {splitMethod === 'custom' && (
                <div className="space-y-2">
                  {participants.map((id) => {
                    const user = demoUsers.find((item) => item.id === id)
                    return (
                      <label key={id} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                        <span className="text-sm font-semibold text-slate-700">{user?.name}</span>
                        <input
                          type="number"
                          value={customMap[id] ?? 0}
                          onChange={(e) => setCustomMap((prev) => ({ ...prev, [id]: Number(e.target.value) }))}
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1"
                        />
                      </label>
                    )
                  })}
                  <p className={`text-sm font-semibold ${totalCustom === Number(expenseForm.amount) ? 'text-emerald-600' : 'text-rose-600'}`}>
                    Total: {formatInr(totalCustom)} / {formatInr(Number(expenseForm.amount || 0))}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-5 flex justify-between">
            <button
              onClick={() => setExpenseStep((prev) => Math.max(1, prev - 1))}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              Back
            </button>
            {expenseStep < 3 ? (
              <button onClick={() => setExpenseStep((prev) => Math.min(3, prev + 1))} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
                Next
              </button>
            ) : (
              <button onClick={submitExpense} className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white">
                Submit Expense
              </button>
            )}
          </div>
        </Modal>
      )}

      {showSettle && (
        <Modal title="Optimized Settlement Plan" onClose={() => setShowSettle(false)}>
          <div className="space-y-3">
            {settlementPlan.map((item) => (
              <article key={`${item.to}-${item.amount}`} className="flex items-center justify-between rounded-xl border border-slate-200 p-3">
                <div>
                  <p className="font-semibold text-slate-900">Pay {item.to}</p>
                  <p className="text-xs text-slate-500">Method: {item.mode}</p>
                </div>
                <p className="text-lg font-bold text-rose-600">{formatInr(item.amount)}</p>
              </article>
            ))}
            <div className="grid gap-2 sm:grid-cols-2">
              <button className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white">Pay via UPI</button>
              <button className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Mark as Cash</button>
              <button className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Open Card Checkout</button>
              <button className="rounded-xl border border-slate-300 px-4 py-2 font-semibold text-slate-700">Show QR</button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  )
}

export default App
