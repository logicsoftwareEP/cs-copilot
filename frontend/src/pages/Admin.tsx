import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getUsers, upsertUser, deleteUser } from '../services/api';
import { User, UserRole } from '../types';

const ROLES: UserRole[] = ['admin', 'supervisor', 'csm'];

const ROLE_COLORS: Record<UserRole, string> = {
  admin: 'bg-obs-accent/20 text-obs-accent border-obs-accent/30',
  supervisor: 'bg-tier-watch-bg text-tier-watch border-tier-watch/30',
  csm: 'bg-tier-healthy-bg text-tier-healthy border-tier-healthy/30',
};

export default function Admin() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Add form
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('csm');
  const [saving, setSaving] = useState(false);

  // Inline edit
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('csm');

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  async function loadUsers() {
    try {
      setLoading(true);
      setError(null);
      const data = await getUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadUsers(); }, []);

  // Clear success after 3s
  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(t);
  }, [success]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await upsertUser(newEmail.trim(), newName.trim(), newRole);
      setSuccess(`Added ${newEmail.trim()}`);
      setNewEmail('');
      setNewName('');
      setNewRole('csm');
      await loadUsers();
    } catch (err: any) {
      setError(err.message ?? 'Failed to add user');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(email: string) {
    setError(null);
    try {
      await upsertUser(email, editName, editRole);
      setSuccess(`Updated ${email}`);
      setEditingEmail(null);
      await loadUsers();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update user');
    }
  }

  async function handleDelete(email: string) {
    setError(null);
    try {
      await deleteUser(email);
      setSuccess(`Deleted ${email}`);
      setConfirmDelete(null);
      await loadUsers();
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete user');
    }
  }

  function startEdit(user: User) {
    setEditingEmail(user.email);
    setEditName(user.displayName);
    setEditRole(user.role);
  }

  return (
    <div className="min-h-screen bg-obs-void text-obs-text">
      {/* Header */}
      <header className="bg-obs-raised/80 backdrop-blur-xl border-b border-obs-edge h-14 flex items-center px-6 justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-obs-bright text-[15px] tracking-tight">CS Copilot</span>
          <span className="text-obs-ghost text-[14px] ml-1 font-mono uppercase tracking-wider">Admin</span>
        </div>
        <Link to="/" className="text-[14px] text-obs-accent hover:text-obs-glow transition-colors">
          Back to Portfolio
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8">
        <h1 className="text-xl font-semibold text-obs-bright mb-6">User Management</h1>

        {/* Feedback */}
        {error && (
          <div className="mb-4 bg-tier-critical-bg border border-tier-critical/20 rounded-lg px-4 py-3 text-[14px] text-tier-critical">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 bg-tier-healthy-bg border border-tier-healthy/20 rounded-lg px-4 py-3 text-[14px] text-tier-healthy">
            {success}
          </div>
        )}

        {/* Add user form */}
        <form onSubmit={handleAdd} className="bg-obs-raised border border-obs-edge rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[12px] text-obs-dim mb-1 uppercase tracking-wider">Email</label>
            <input
              type="email"
              required
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-bright placeholder-obs-ghost focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[12px] text-obs-dim mb-1 uppercase tracking-wider">Display Name</label>
            <input
              type="text"
              required
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-bright placeholder-obs-ghost focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
            />
          </div>
          <div className="w-32">
            <label className="block text-[12px] text-obs-dim mb-1 uppercase tracking-wider">Role</label>
            <select
              value={newRole}
              onChange={e => setNewRole(e.target.value as UserRole)}
              className="w-full text-[14px] bg-obs-card border border-obs-edge rounded-lg px-3 py-2 text-obs-text focus:outline-none focus:ring-1 focus:ring-obs-accent focus:border-obs-accent"
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-obs-accent hover:bg-obs-glow disabled:opacity-50 text-white text-[14px] font-medium rounded-lg transition-all"
          >
            {saving ? 'Saving...' : 'Add User'}
          </button>
        </form>

        {/* Users table */}
        {loading ? (
          <p className="text-obs-dim text-[14px]">Loading users...</p>
        ) : users.length === 0 ? (
          <p className="text-obs-dim text-[14px]">No users found. Add one above.</p>
        ) : (
          <div className="bg-obs-raised border border-obs-edge rounded-xl overflow-hidden">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="bg-obs-card/50 border-b border-obs-edge text-obs-dim text-left">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Display Name</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.email} className="border-b border-obs-edge/50 hover:bg-obs-card/30 transition-colors">
                    <td className="px-4 py-3 text-obs-bright font-mono text-[13px]">{u.email}</td>
                    <td className="px-4 py-3">
                      {editingEmail === u.email ? (
                        <input
                          type="text"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          className="w-full text-[14px] bg-obs-card border border-obs-accent rounded px-2 py-0.5 text-obs-bright focus:outline-none"
                        />
                      ) : (
                        <span className="text-obs-text">{u.displayName}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {editingEmail === u.email ? (
                        <select
                          value={editRole}
                          onChange={e => setEditRole(e.target.value as UserRole)}
                          className="text-[14px] bg-obs-card border border-obs-accent rounded px-2 py-0.5 text-obs-text focus:outline-none"
                        >
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      ) : (
                        <span className={`inline-block px-2 py-0.5 rounded text-[13px] font-medium border ${ROLE_COLORS[u.role]}`}>
                          {u.role}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingEmail === u.email ? (
                        <span className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSaveEdit(u.email)}
                            className="text-tier-healthy hover:text-tier-healthy/80 text-[13px] font-medium"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingEmail(null)}
                            className="text-obs-dim hover:text-obs-text text-[13px]"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : confirmDelete === u.email ? (
                        <span className="flex items-center justify-end gap-2">
                          <span className="text-tier-critical text-[13px]">Delete?</span>
                          <button
                            onClick={() => handleDelete(u.email)}
                            className="text-tier-critical hover:text-tier-critical/80 text-[13px] font-medium"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="text-obs-dim hover:text-obs-text text-[13px]"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startEdit(u)}
                            className="text-obs-accent hover:text-obs-glow text-[13px] font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setConfirmDelete(u.email)}
                            className="text-obs-dim hover:text-tier-critical text-[13px]"
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
