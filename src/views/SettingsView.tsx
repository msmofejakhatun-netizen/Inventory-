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
import { Department, RestaurantUser, UserRole } from '../types';
import { Modal } from '../components/common/Modal';
import { Badge } from '../components/common/Badge';

export const SettingsView: React.FC = () => {
  const { activeRestaurant, activeRestaurantId, user, userProfile, hasRole } = useAuth();

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

  // Team members
  const [teamMembers, setTeamMembers] = useState<RestaurantUser[]>([]);
  const [isMemberModalOpen, setIsMemberModalOpen] = useState(false);
  const [memberEmail, setMemberEmail] = useState('');
  const [memberName, setMemberName] = useState('');
  const [memberRole, setMemberRole] = useState<UserRole>('DEPARTMENT_STAFF');
  const [memberDeptId, setMemberDeptId] = useState('');

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

    return () => {
      unsubDepts();
      unsubUsers();
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
    if (!activeRestaurantId || !memberEmail.trim() || !memberName.trim()) return;

    // Use email hash or generated doc ID
    const userMemberId = memberEmail.trim().replace(/[^a-zA-Z0-9]/g, '_');
    const userRef = doc(db, 'restaurants', activeRestaurantId, 'users', userMemberId);

    const newMember: RestaurantUser = {
      uid: userMemberId,
      email: memberEmail.trim(),
      name: memberName.trim(),
      role: memberRole,
      departmentId: memberDeptId || undefined,
      restaurantId: activeRestaurantId,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    await setDoc(userRef, newMember);
    setMemberEmail('');
    setMemberName('');
    setMemberRole('DEPARTMENT_STAFF');
    setIsMemberModalOpen(false);
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

      {/* Team Members & Role Permissions */}
      <div className="bg-white rounded-xl border border-stone-200 p-6 shadow-2xs space-y-4">
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
              onClick={() => setIsMemberModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-xs font-semibold"
            >
              <UserPlus className="w-3.5 h-3.5" /> Add Team Member
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-stone-600">
            <thead className="bg-stone-50 border-b border-stone-200 text-[10px] font-bold text-stone-700 uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-4">Name</th>
                <th className="py-2.5 px-4">Email / ID</th>
                <th className="py-2.5 px-4">Role</th>
                <th className="py-2.5 px-4">Department Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {teamMembers.map((m) => (
                <tr key={m.uid} className="hover:bg-stone-50/60">
                  <td className="py-2.5 px-4 font-semibold text-stone-900">{m.name}</td>
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
                    {departments.find((d) => d.id === m.departmentId)?.name || 'All Departments'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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

      {/* Add Member Modal */}
      <Modal
        isOpen={isMemberModalOpen}
        onClose={() => setIsMemberModalOpen(false)}
        title="Authorize Team Member"
        subtitle="Assign store room roles and operational permissions"
        maxWidth="md"
      >
        <form onSubmit={handleAddTeamMember} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Staff Full Name *
            </label>
            <input
              type="text"
              required
              placeholder="e.g. Chef Rahul Verma"
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Email Address *
            </label>
            <input
              type="email"
              required
              placeholder="e.g. rahul@restaurant.com"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
              Role
            </label>
            <select
              value={memberRole}
              onChange={(e) => setMemberRole(e.target.value as UserRole)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
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
              value={memberDeptId}
              onChange={(e) => setMemberDeptId(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-stone-300 rounded-lg bg-white"
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
              onClick={() => setIsMemberModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-stone-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-semibold rounded-lg"
            >
              Save Team Member
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
