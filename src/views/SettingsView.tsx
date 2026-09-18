import React, { useEffect, useState } from 'react';
import {
  Settings,
  Building2,
  Users,
  Shield,
  Plus,
  Trash2,
  Save,
  CheckCircle,
  AlertTriangle,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  XCircle,
  Mail,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { useAuth } from '../context/AuthContext';
import { Department, RestaurantUser, UserRole, StaffInvitation } from '../types';
import { inviteTeamMember, revokeInvitation, removeTeamMember } from '../services/restaurantService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';
import { WhatsAppSettingsCard } from '../components/whatsapp/WhatsAppSettingsCard';

export const SettingsView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, hasRole, activeRole } = useAuth();

  // General Settings Form
  const [name, setName] = useState(activeRestaurant?.name || '');
  const [address, setAddress] = useState(activeRestaurant?.address || '');
  const [phone, setPhone] = useState(activeRestaurant?.phone || '');
  const [currencySymbol, setCurrencySymbol] = useState(activeRestaurant?.currencySymbol || '₹');
  const [priceHikeThreshold, setPriceHikeThreshold] = useState(
    activeRestaurant?.priceHikeThresholdPercent || 2.0
  );
  const [savingGeneral, setSavingGeneral] = useState(false);
  const [generalSuccess, setGeneralSuccess] = useState(false);

  // Departments
  const [departments, setDepartments] = useState<Department[]>([]);
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptDescription, setNewDeptDescription] = useState('');
  const [isDeptModalOpen, setIsDeptModalOpen] = useState(false);

  // Team members & Invitations
  const [teamMembers, setTeamMembers] = useState<RestaurantUser[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<StaffInvitation[]>([]);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState<UserRole>('DEPARTMENT_STAFF');
  const [memberDeptId, setMemberDeptId] = useState('');
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (activeRestaurant) {
      setName(activeRestaurant.name);
      setAddress(activeRestaurant.address || '');
      setPhone(activeRestaurant.phone || '');
      setCurrencySymbol(activeRestaurant.currencySymbol || '₹');
      setPriceHikeThreshold(activeRestaurant.priceHikeThresholdPercent || 2.0);
    }
  }, [activeRestaurant]);

  useEffect(() => {
    if (!activeRestaurantId) return;

    const unsubDepts = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'departments'), (snap) => {
      setDepartments(snap.docs.map((d) => d.data() as Department));
    });

    const unsubUsers = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'users'), (snap) => {
      setTeamMembers(snap.docs.map((d) => d.data() as RestaurantUser));
    });

    const unsubInvites = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'invitations'), (snap) => {
      setPendingInvitations(
        snap.docs
          .map((d) => d.data() as StaffInvitation)
          .filter((inv) => inv.status === 'PENDING')
      );
    });

    return () => {
      unsubDepts();
      unsubUsers();
      unsubInvites();
    };
  }, [activeRestaurantId]);

  const handleSaveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId) return;

    try {
      setSavingGeneral(true);
      const restRef = doc(db, 'restaurants', activeRestaurantId);
      await updateDoc(restRef, {
        name: name.trim(),
        address: address.trim(),
        phone: phone.trim(),
        currencySymbol: currencySymbol.trim(),
        priceHikeThresholdPercent: Number(priceHikeThreshold),
        updatedAt: new Date().toISOString(),
      });

      setGeneralSuccess(true);
      setTimeout(() => setGeneralSuccess(false), 3000);
    } catch (e) {
      console.error('Failed to update restaurant:', e);
    } finally {
      setSavingGeneral(false);
    }
  };

  const handleAddDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !newDeptName.trim()) return;

    const deptRef = doc(collection(db, 'restaurants', activeRestaurantId, 'departments'));
    const newDept: Department = {
      id: deptRef.id,
      name: newDeptName.trim(),
      description: newDeptDescription.trim(),
      restaurantId: activeRestaurantId,
      createdAt: new Date().toISOString(),
    };

    await setDoc(deptRef, newDept);
    setNewDeptName('');
    setNewDeptDescription('');
    setIsDeptModalOpen(false);
  };

  const handleDeleteDepartment = async (deptId: string) => {
    if (!activeRestaurantId) return;
    const deptRef = doc(db, 'restaurants', activeRestaurantId, 'departments', deptId);
    await deleteDoc(deptRef);
  };

  const handleAddTeamMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemberError(null);
    setMemberSuccess(null);

    if (!activeRestaurantId || !activeRestaurant) {
      setMemberError('No active restaurant selected.');
      return;
    }

    if (!memberName.trim()) {
      setMemberError('Please enter staff full name.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!memberEmail.trim() || !emailRegex.test(memberEmail.trim())) {
      setMemberError('Please enter a valid email address.');
      return;
    }

    if (!user) {
      setMemberError('You must be signed in to authorize team members.');
      return;
    }

    const callerRole = (activeRole as UserRole) || 'OWNER';
    if (callerRole !== 'OWNER' && callerRole !== 'MANAGER') {
      setMemberError('Only restaurant Owners or Managers can authorize team members.');
      return;
    }

    try {
      setMemberSaving(true);
      const selectedDept = departments.find((d) => d.id === memberDeptId);

      const res = await inviteTeamMember(
        activeRestaurantId,
        activeRestaurant.name,
        {
          uid: user.uid,
          name: user.displayName || userProfile?.name || 'Authorized Manager',
          role: callerRole,
        },
        {
          fullName: memberName.trim(),
          email: memberEmail.trim(),
          role: memberRole,
          departmentId: memberDeptId || null,
          departmentName: selectedDept?.name || null,
        }
      );

      if (!res.success) {
        setMemberError(res.error || 'Unable to add team member. Please try again.');
        return;
      }

      setMemberSuccess(`Team member authorized! An invitation has been created for ${memberEmail.trim()}.`);
      setMemberEmail('');
      setMemberName('');
      setMemberRole('DEPARTMENT_STAFF');
      setMemberDeptId('');

      setTimeout(() => {
        setIsMemberModalOpen(false);
        setMemberSuccess(null);
        setMemberError(null);
      }, 1800);
    } catch (err) {
      console.error('[handleAddTeamMember] Error authorizing team member:', err);
      setMemberError('Unable to add team member. Please try again.');
    } finally {
      setMemberSaving(false);
    }
  };

  const handleRevokeInvitation = async (invitationId: string, email: string) => {
    if (!activeRestaurantId || !user) return;
    if (!confirm(`Are you sure you want to revoke the pending authorization for ${email}?`)) return;
    setActionLoadingId(invitationId);
    try {
      const res = await revokeInvitation(activeRestaurantId, invitationId, {
        uid: user.uid,
        name: user.displayName || userProfile?.name || 'Authorized Manager',
        role: (activeRole as UserRole) || 'OWNER',
      });
      if (!res.success && res.error) {
        alert(res.error);
      }
    } catch (err) {
      console.error('Failed to revoke invitation:', err);
      alert('Unable to revoke invitation. Please try again.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRemoveMember = async (memberUid: string, memberName: string) => {
    if (!activeRestaurantId || !user) return;
    if (!confirm(`Are you sure you want to remove ${memberName} from this restaurant?`)) return;
    setActionLoadingId(memberUid);
    try {
      const res = await removeTeamMember(activeRestaurantId, memberUid, memberName, {
        uid: user.uid,
        name: user.displayName || userProfile?.name || 'Authorized Manager',
        role: (activeRole as UserRole) || 'OWNER',
      });
      if (!res.success && res.error) {
        alert(res.error);
      }
    } catch (err) {
      console.error('Failed to remove member:', err);
      alert('Unable to remove team member. Please try again.');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-stone-900 tracking-tight">System Settings & Controls</h1>
          <p className="text-xs text-stone-500 mt-1">
            Configure restaurant thresholds, kitchen departments, staff roles, and price hike guards.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* General Store Configuration */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-stone-100">
            <Building2 className="w-4 h-4 text-stone-600" />
            <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
              Store Profile & Rules
            </h2>
          </div>

          <form onSubmit={handleSaveGeneral} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                Restaurant Outlet Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Currency Symbol
                </label>
                <input
                  type="text"
                  value={currencySymbol}
                  onChange={(e) => setCurrencySymbol(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Price Hike Guard (%)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min={0.5}
                  max={20}
                  value={priceHikeThreshold}
                  onChange={(e) => setPriceHikeThreshold(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Contact Phone
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block font-bold text-stone-700 uppercase tracking-wider mb-1">
                  Address / City
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-stone-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="pt-3 flex justify-between items-center border-t border-stone-100">
              {generalSuccess ? (
                <span className="text-emerald-700 font-semibold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Saved successfully!
                </span>
              ) : (
                <span />
              )}

              <button
                type="submit"
                disabled={savingGeneral}
                className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold shadow-2xs transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" /> Save Changes
              </button>
            </div>
          </form>
        </div>

        {/* Kitchen Departments Section */}
        <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-stone-100">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-stone-600" />
              <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                Kitchen Departments ({departments.length})
              </h2>
            </div>
            <button
              onClick={() => setIsDeptModalOpen(true)}
              className="flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-900"
            >
              <Plus className="w-3.5 h-3.5" /> Add Department
            </button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto">
            {departments.length === 0 ? (
              <div className="text-center py-8 text-stone-400 text-xs">
                No departments configured. Add departments like Tandoor, Main Kitchen, Bakery, or Bar.
              </div>
            ) : (
              departments.map((dept) => (
                <div
                  key={dept.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-stone-200 bg-stone-50/50 text-xs"
                >
                  <div>
                    <p className="font-semibold text-stone-900">{dept.name}</p>
                    <p className="text-[11px] text-stone-500">{dept.description || 'Kitchen line department'}</p>
                  </div>
                  <button
                    onClick={() => handleDeleteDepartment(dept.id)}
                    className="p-1 text-stone-400 hover:text-rose-600 rounded"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Official WhatsApp Business Platform Integration */}
      <WhatsAppSettingsCard />

      {/* Team Members & Role Permissions */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-stone-600" />
            <div>
              <h2 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
                Authorized Store Users & Role Hierarchy
              </h2>
              <p className="text-[11px] text-stone-500">
                OWNER (Full control), MANAGER (Approvals), STOREKEEPER (Inward/Issue), DEPARTMENT_STAFF (Issue receiver)
              </p>
            </div>
          </div>

          {hasRole(['OWNER', 'MANAGER']) && (
            <button
              onClick={() => {
                setMemberError(null);
                setMemberSuccess(null);
                setIsMemberModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add Team Member
            </button>
          )}
        </div>

        {/* Active Team Members */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              Active Team Members ({teamMembers.length})
            </h3>
          </div>
          <div className="overflow-x-auto border border-stone-200 rounded-lg">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4">Email / ID</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Department Access</th>
                  {hasRole(['OWNER', 'MANAGER']) && (
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {teamMembers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-stone-400">
                      No active team members found.
                    </td>
                  </tr>
                ) : (
                  teamMembers.map((m) => (
                    <tr key={m.uid} className="hover:bg-stone-50/60">
                      <td className="py-2.5 px-4 font-semibold text-stone-900 flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center font-bold text-stone-700 text-[11px]">
                          {m.name.charAt(0).toUpperCase()}
                        </div>
                        {m.name}
                      </td>
                      <td className="py-2.5 px-4 text-stone-600 font-mono text-[11px]">{m.email || m.uid}</td>
                      <td className="py-2.5 px-4">
                        <Badge
                          variant={
                            m.role === 'OWNER'
                              ? 'success'
                              : m.role === 'MANAGER'
                              ? 'info'
                              : m.role === 'STOREKEEPER'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {m.role}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-stone-500">
                        {departments.find((d) => d.id === m.departmentId)?.name || 'All Departments'}
                      </td>
                      {hasRole(['OWNER', 'MANAGER']) && (
                        <td className="py-2.5 px-4 text-right">
                          {m.role !== 'OWNER' && user?.uid !== m.uid && (
                            <button
                              onClick={() => handleRemoveMember(m.uid, m.name)}
                              disabled={actionLoadingId === m.uid}
                              title="Remove team member"
                              className="p-1 text-stone-400 hover:text-rose-600 rounded transition-colors"
                            >
                              {actionLoadingId === m.uid ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending Invitations & Authorizations */}
        {pendingInvitations.length > 0 && (
          <div className="space-y-2 pt-3 border-t border-stone-100">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              <h3 className="text-xs font-bold text-stone-800 uppercase tracking-wider">
                Pending Staff Authorizations ({pendingInvitations.length})
              </h3>
            </div>
            <div className="overflow-x-auto border border-amber-200/70 bg-amber-50/20 rounded-lg">
              <table className="w-full text-left text-xs text-stone-600">
                <thead className="bg-amber-50/80 border-b border-amber-200/60 text-[10px] font-bold text-amber-900 uppercase tracking-wider">
                  <tr>
                    <th className="py-2.5 px-4">Authorized Staff</th>
                    <th className="py-2.5 px-4">Email Address</th>
                    <th className="py-2.5 px-4">Assigned Role</th>
                    <th className="py-2.5 px-4">Department Access</th>
                    <th className="py-2.5 px-4">Status</th>
                    {hasRole(['OWNER', 'MANAGER']) && (
                      <th className="py-2.5 px-4 text-right">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100/60">
                  {pendingInvitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-amber-50/50">
                      <td className="py-2.5 px-4 font-semibold text-stone-900">{inv.fullName}</td>
                      <td className="py-2.5 px-4 text-stone-700 font-mono text-[11px]">{inv.email}</td>
                      <td className="py-2.5 px-4">
                        <Badge
                          variant={
                            inv.requestedRole === 'OWNER'
                              ? 'success'
                              : inv.requestedRole === 'MANAGER'
                              ? 'info'
                              : inv.requestedRole === 'STOREKEEPER'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {inv.requestedRole}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-stone-600">
                        {inv.departmentName || 'All Departments'}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3 text-amber-700" />
                          Pending Activation
                        </span>
                      </td>
                      {hasRole(['OWNER', 'MANAGER']) && (
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={() => handleRevokeInvitation(inv.id, inv.email)}
                            disabled={actionLoadingId === inv.id}
                            className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 hover:underline px-2 py-1 rounded transition-colors"
                          >
                            {actionLoadingId === inv.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <XCircle className="w-3 h-3" />
                            )}
                            Revoke
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Add Department Modal */}
      <Modal
        isOpen={isDeptModalOpen}
        onClose={() => setIsDeptModalOpen(false)}
        title="Add Kitchen Department"
        subtitle="Organize stock consumption and requisitions by preparation station"
        maxWidth="md"
      >
        <form onSubmit={handleAddDepartment} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Department Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Tandoor / Main Gravy Section / Bar"
              value={newDeptName}
              onChange={(e) => setNewDeptName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Description
            </label>
            <input
              type="text"
              placeholder="e.g. Clay oven, naan, tikkas and kebabs"
              value={newDeptDescription}
              onChange={(e) => setNewDeptDescription(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              onClick={() => setIsDeptModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg"
            >
              Create Department
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Member Modal */}
      <Modal
        isOpen={isMemberModalOpen}
        onClose={() => {
          if (!memberSaving) {
            setIsMemberModalOpen(false);
            setMemberError(null);
            setMemberSuccess(null);
          }
        }}
        title="Authorize Team Member"
        subtitle="Assign store room roles and operational permissions"
        maxWidth="md"
      >
        <form onSubmit={handleAddTeamMember} className="space-y-4">
          {memberError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="flex-1">
                <p className="font-semibold">{memberError}</p>
              </div>
            </div>
          )}

          {memberSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <div className="flex-1">
                <p className="font-semibold">{memberSuccess}</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Staff Full Name *
            </label>
            <input
              type="text"
              required
              disabled={memberSaving}
              placeholder="e.g. Chef Rahul Verma"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 disabled:bg-stone-100 disabled:text-stone-400"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Email Address *
            </label>
            <input
              type="email"
              required
              disabled={memberSaving}
              placeholder="e.g. rahul@restaurant.com"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500 disabled:bg-stone-100 disabled:text-stone-400"
            />
            <p className="text-[11px] text-stone-400 mt-1">
              When this staff member logs in using Google or Phone OTP with this email, their account will securely activate with the role assigned below.
            </p>
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Role
            </label>
            <select
              disabled={memberSaving}
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white disabled:bg-stone-100 disabled:text-stone-400"
            >
              <option value="DEPARTMENT_STAFF">Department Staff (Requisitions)</option>
              <option value="STOREKEEPER">Storekeeper (Inward & Issues)</option>
              <option value="MANAGER">Manager (Audits & Reports)</option>
              <option value="OWNER">Owner (Full Admin)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Department Assigned
            </label>
            <select
              disabled={memberSaving}
              value={memberDeptId}
              onChange={(e) => setMemberDeptId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white disabled:bg-stone-100 disabled:text-stone-400"
            >
              <option value="">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-stone-100">
            <button
              type="button"
              disabled={memberSaving}
              onClick={() => {
                setIsMemberModalOpen(false);
                setMemberError(null);
                setMemberSuccess(null);
              }}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={memberSaving}
              className="flex items-center gap-1.5 px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >
              {memberSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Team Member</span>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
