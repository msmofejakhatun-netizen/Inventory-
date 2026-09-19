import React, { useEffect, useState, useMemo } from 'react';
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
  Edit2,
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
import { Department, RestaurantUser, UserRole, StaffAuthorization } from '../types';
import {
  addActiveTeamMember,
  updateTeamMember,
  removeTeamMember,
} from '../services/restaurantService';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';
import { WhatsAppSettingsCard } from '../components/whatsapp/WhatsAppSettingsCard';
import { PWAInstallCard } from '../components/pwa/PWAInstallCard';

export interface DisplayMember {
  id: string;
  uid?: string;
  authorizationId?: string;
  name: string;
  email: string;
  role: UserRole;
  departmentId: string | null;
  departmentName: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  isOwner: boolean;
}

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

  // Direct-Active Team members & Authorizations
  const [teamUsers, setTeamUsers] = useState<RestaurantUser[]>([]);
  const [authorizations, setAuthorizations] = useState<StaffAuthorization[]>([]);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState<UserRole>('DEPARTMENT_STAFF');
  const [memberDeptId, setMemberDeptId] = useState('');
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberSuccess, setMemberSuccess] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Edit Member Modal
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<DisplayMember | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('DEPARTMENT_STAFF');
  const [editDeptId, setEditDeptId] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
      setTeamUsers(snap.docs.map((d) => d.data() as RestaurantUser));
    });

    const unsubAuths = onSnapshot(collection(db, 'restaurants', activeRestaurantId, 'authorizations'), (snap) => {
      setAuthorizations(snap.docs.map((d) => d.data() as StaffAuthorization));
    });

    return () => {
      unsubDepts();
      unsubUsers();
      unsubAuths();
    };
  }, [activeRestaurantId]);

  // Combine users and authorizations into a unified direct-active team list
  const activeTeamMembers: DisplayMember[] = useMemo(() => {
    const map = new Map<string, DisplayMember>();

    teamUsers.forEach((u) => {
      const emailKey = (u.email || u.uid).trim().toLowerCase();
      map.set(emailKey, {
        id: u.uid,
        uid: u.uid,
        authorizationId: u.authorizationId,
        name: u.name || 'Staff Member',
        email: u.email || u.uid,
        role: u.role,
        departmentId: u.departmentId || null,
        departmentName: u.departmentName || null,
        status:
          u.status === 'inactive' || u.status === 'INACTIVE' || u.accountStatus === 'SUSPENDED'
            ? 'INACTIVE'
            : 'ACTIVE',
        isOwner: u.role === 'OWNER',
      });
    });

    authorizations.forEach((a) => {
      const emailKey = a.email.trim().toLowerCase();
      const existing = map.get(emailKey);
      const isAuthActive = a.status === 'ACTIVE' && a.accountStatus !== 'SUSPENDED';
      if (!existing) {
        map.set(emailKey, {
          id: a.id,
          uid: a.attachedUid,
          authorizationId: a.id,
          name: a.fullName,
          email: a.email,
          role: a.role,
          departmentId: a.departmentId || null,
          departmentName: a.departmentName || null,
          status: isAuthActive ? 'ACTIVE' : 'INACTIVE',
          isOwner: a.role === 'OWNER',
        });
      } else {
        if (!existing.authorizationId) {
          existing.authorizationId = a.id;
        }
        if (isAuthActive) {
          existing.status = 'ACTIVE';
          existing.role = a.role;
          if (a.departmentId !== undefined) existing.departmentId = a.departmentId;
          if (a.departmentName !== undefined) existing.departmentName = a.departmentName;
        }
      }
    });

    return Array.from(map.values());
  }, [teamUsers, authorizations]);

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

    if (!memberName.trim() || memberName.trim().length < 2) {
      setMemberError('Please enter a valid staff full name.');
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

      const res = await addActiveTeamMember(
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

      setMemberEmail('');
      setMemberName('');
      setMemberRole('DEPARTMENT_STAFF');
      setMemberDeptId('');
      setIsMemberModalOpen(false);
      setMemberSuccess(null);
      setMemberError(null);
    } catch (err: any) {
      console.error('[handleAddTeamMember] Error authorizing team member:', {
        code: err?.code,
        message: err?.message,
        operation: 'addActiveTeamMember',
        path: `restaurants/${activeRestaurantId}/authorizations`,
        error: err,
      });
      setMemberError(err?.message || 'Unable to add team member. Please try again.');
    } finally {
      setMemberSaving(false);
    }
  };

  const handleOpenEdit = (m: DisplayMember) => {
    setEditingMember(m);
    setEditRole(m.role);
    setEditDeptId(m.departmentId || '');
    setEditError(null);
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRestaurantId || !user || !editingMember) return;
    setEditError(null);
    setEditSaving(true);
    try {
      const selectedDept = departments.find((d) => d.id === editDeptId);
      const res = await updateTeamMember(
        activeRestaurantId,
        editingMember.id,
        {
          role: editRole,
          departmentId: editDeptId || null,
          departmentName: selectedDept?.name || null,
        },
        {
          uid: user.uid,
          name: user.displayName || userProfile?.name || 'Authorized Manager',
          role: (activeRole as UserRole) || 'OWNER',
        }
      );
      if (!res.success) {
        setEditError(res.error || 'Failed to update member.');
        return;
      }
      setIsEditModalOpen(false);
      setEditingMember(null);
    } catch (err) {
      console.error('Error updating member:', err);
      setEditError('Unable to update team member.');
    } finally {
      setEditSaving(false);
    }
  };

  const handleToggleStatus = async (m: DisplayMember) => {
    if (!activeRestaurantId || !user) return;
    const newStatus = m.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setActionLoadingId(m.id);
    try {
      const res = await updateTeamMember(
        activeRestaurantId,
        m.id,
        { status: newStatus },
        {
          uid: user.uid,
          name: user.displayName || userProfile?.name || 'Authorized Manager',
          role: (activeRole as UserRole) || 'OWNER',
        }
      );
      if (!res.success && res.error) {
        alert(res.error);
      }
    } catch (err) {
      console.error('Failed to toggle member status:', err);
      alert('Unable to update member status. Please try again.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    if (!activeRestaurantId || !user) return;
    if (!confirm(`Are you sure you want to remove ${memberName} from this restaurant?`)) return;
    setActionLoadingId(memberId);
    try {
      const res = await removeTeamMember(activeRestaurantId, memberId, memberName, {
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

      {/* Progressive Web App & Device Installation */}
      <PWAInstallCard />

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
              Active Team Members ({activeTeamMembers.length})
            </h3>
          </div>
          <div className="overflow-x-auto border border-stone-200 rounded-lg">
            <table className="w-full text-left text-xs text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold text-stone-700 uppercase tracking-wider">
                <tr>
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-4">Email / ID</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-4">Status</th>
                  {hasRole(['OWNER', 'MANAGER']) && (
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {activeTeamMembers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-stone-400">
                      No active team members found.
                    </td>
                  </tr>
                ) : (
                  activeTeamMembers.map((m) => (
                    <tr key={m.id} className="hover:bg-stone-50/60">
                      <td className="py-2.5 px-4 font-semibold text-stone-900">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-stone-200 flex items-center justify-center font-bold text-stone-700 text-[11px]">
                            {m.name.charAt(0).toUpperCase()}
                          </div>
                          <span>{m.name}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-stone-600 font-mono text-[11px]">{m.email}</td>
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
                        {departments.find((d) => d.id === m.departmentId)?.name || m.departmentName || 'All Departments'}
                      </td>
                      <td className="py-2.5 px-4">
                        {m.status === 'ACTIVE' ? (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                            ACTIVE
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-800 bg-rose-50 border border-rose-200/80 px-2.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                            INACTIVE
                          </span>
                        )}
                      </td>
                      {hasRole(['OWNER', 'MANAGER']) && (
                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {!m.isOwner && (
                              <>
                                <button
                                  onClick={() => handleOpenEdit(m)}
                                  disabled={actionLoadingId === m.id}
                                  title="Edit Role & Department"
                                  className="p-1 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded transition-colors"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleToggleStatus(m)}
                                  disabled={actionLoadingId === m.id}
                                  title={m.status === 'ACTIVE' ? 'Deactivate team member' : 'Activate team member'}
                                  className={`px-2 py-0.5 text-[11px] font-semibold rounded border transition-colors ${
                                    m.status === 'ACTIVE'
                                      ? 'text-amber-700 bg-amber-50/50 border-amber-200 hover:bg-amber-100/60'
                                      : 'text-emerald-700 bg-emerald-50/50 border-emerald-200 hover:bg-emerald-100/60'
                                  }`}
                                >
                                  {m.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                                </button>
                              </>
                            )}
                            {!m.isOwner && user?.uid !== m.id && user?.uid !== m.uid && (
                              <button
                                onClick={() => handleRemoveMember(m.id, m.name)}
                                disabled={actionLoadingId === m.id}
                                title="Remove team member"
                                className="p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                              >
                                {actionLoadingId === m.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-600" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
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

      {/* Authorize Team Member Modal */}
      <Modal
        isOpen={isMemberModalOpen}
        onClose={() => {
          if (!memberSaving) {
            setIsMemberModalOpen(false);
            setMemberError(null);
            setMemberSuccess(null);
          }
        }}
        title="Add Team Member"
        subtitle="Authorize staff member with immediate active access to the restaurant store"
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
            <p className="text-[11px] text-stone-500 mt-1">
              Direct authorization will be granted immediately. The member is immediately active.
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
              {activeRole === 'OWNER' && (
                <>
                  <option value="MANAGER">Manager (Audits & Reports)</option>
                  <option value="OWNER">Owner (Full Admin)</option>
                </>
              )}
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

      {/* Edit Team Member Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          if (!editSaving) {
            setIsEditModalOpen(false);
            setEditingMember(null);
            setEditError(null);
          }
        }}
        title="Edit Team Member"
        subtitle={editingMember ? `${editingMember.name} (${editingMember.email})` : 'Update role and department access'}
        maxWidth="md"
      >
        <form onSubmit={handleSaveEdit} className="space-y-4">
          {editError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
              <div className="flex-1">
                <p className="font-semibold">{editError}</p>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Role
            </label>
            <select
              disabled={editSaving}
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white disabled:bg-stone-100 disabled:text-stone-400"
            >
              <option value="DEPARTMENT_STAFF">Department Staff (Requisitions)</option>
              <option value="STOREKEEPER">Storekeeper (Inward & Issues)</option>
              {activeRole === 'OWNER' && (
                <>
                  <option value="MANAGER">Manager (Audits & Reports)</option>
                  <option value="OWNER">Owner (Full Admin)</option>
                </>
              )}
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Department Assigned
            </label>
            <select
              disabled={editSaving}
              value={editDeptId}
              onChange={(e) => setEditDeptId(e.target.value)}
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
              disabled={editSaving}
              onClick={() => {
                setIsEditModalOpen(false);
                setEditingMember(null);
                setEditError(null);
              }}
              className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="flex items-center gap-1.5 px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-lg disabled:opacity-50 transition-colors"
            >
              {editSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Update Member</span>
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
