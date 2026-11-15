import React, { useEffect, useState } from 'react';
import { User, Mail, Phone, Shield, CheckCircle2, AlertCircle, Loader2, Save } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useAuth } from '../../context/AuthContext';
import {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_NAME_MIN_LENGTH,
  validateDisplayName,
} from '../../utils/profileValidation';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newName: string) => void;
}

export const EditProfileModal: React.FC<EditProfileModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const { user, userProfile, activeRole, activeRestaurant, updateOwnProfileName } = useAuth();

  const currentName = userProfile?.name || user?.displayName || '';
  const [nameInput, setNameInput] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNameInput(userProfile?.name || user?.displayName || '');
      setError(null);
      setSuccessMessage(null);
    }
  }, [isOpen, userProfile?.name, user?.displayName]);

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const validation = validateDisplayName(nameInput);
    if (!validation.valid) {
      setError(validation.error || 'Please enter a valid display name.');
      return;
    }

    setSaving(true);
    try {
      const res = await updateOwnProfileName(validation.normalized);
      if (!res.success) {
        setError(res.error || 'Unable to update display name. Please try again.');
        return;
      }

      const finalName = res.normalizedName || validation.normalized;
      setNameInput(finalName);
      setSuccessMessage('Your display name has been updated.');
      if (onSuccess) onSuccess(finalName);

      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      console.error('[EditProfileModal] Unexpected error updating name:', err);
      setError('Unable to update display name. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const trimmedLength = nameInput.trim().replace(/\s+/g, ' ').length;

  return (
    <Modal
      id="edit-own-profile-modal"
      isOpen={isOpen}
      onClose={handleClose}
      title="Edit Profile Name"
      subtitle="Update your display name across STOQO without altering your login identity or role"
      maxWidth="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            <p className="font-semibold">{error}</p>
          </div>
        )}

        {successMessage && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <p className="font-semibold">{successMessage}</p>
          </div>
        )}

        {/* Editable Display Name */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label
              htmlFor="edit-profile-name-input"
              className="block text-xs font-bold text-[#0D2149] uppercase tracking-wider"
            >
              Display Name *
            </label>
            <span className="text-[11px] font-mono text-stone-400">
              {trimmedLength}/{PROFILE_NAME_MAX_LENGTH}
            </span>
          </div>
          <div className="relative">
            <User className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
            <input
              id="edit-profile-name-input"
              type="text"
              required
              autoFocus
              disabled={saving}
              maxLength={PROFILE_NAME_MAX_LENGTH + 10}
              placeholder="Enter your full name"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                if (error) setError(null);
              }}
              className="w-full pl-9 pr-3 py-2 text-xs font-medium text-stone-900 border border-stone-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5A1F]/25 focus:border-[#FF5A1F] disabled:bg-stone-100 disabled:text-stone-400"
            />
          </div>
          <p className="text-[11px] text-stone-500 mt-1">
            Must be {PROFILE_NAME_MIN_LENGTH}–{PROFILE_NAME_MAX_LENGTH} characters. Used in headers, audit logs, and team rosters.
          </p>
        </div>

        {/* Read-only Identity Summary */}
        <div className="rounded-lg border border-stone-200 bg-stone-50/70 p-3.5 space-y-2 text-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
            Account Identity (Read-Only)
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-stone-600 flex items-center gap-1.5">
              {user?.email ? <Mail className="w-3.5 h-3.5 text-stone-400" /> : <Phone className="w-3.5 h-3.5 text-stone-400" />}
              <span className="font-mono text-[11px] text-stone-800">
                {userProfile?.email || user?.email || userProfile?.phone || user?.phoneNumber || 'Authenticated User'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0D2149]/10 text-[#0D2149] font-bold text-[10px] uppercase">
              <Shield className="w-3 h-3" />
              {activeRole || 'STAFF'}
            </span>
          </div>
          {activeRestaurant && (
            <p className="text-[11px] text-stone-500">
              Active Store: <span className="font-semibold text-stone-700">{activeRestaurant.name}</span>
            </p>
          )}
        </div>

        {/* Footer Actions */}
        <div className="pt-3 flex items-center justify-end gap-2 border-t border-stone-100">
          <button
            id="edit-profile-cancel-btn"
            type="button"
            disabled={saving}
            onClick={handleClose}
            className="px-4 py-2 text-xs font-semibold text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            id="edit-profile-save-btn"
            type="submit"
            disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#FF5A1F] hover:bg-[#e54e17] text-white text-xs font-bold rounded-lg shadow-xs transition-colors disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save Name</span>
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
