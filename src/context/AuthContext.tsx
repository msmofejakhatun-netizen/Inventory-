import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  ConfirmationResult,
  deleteUser,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  collection,
  getDocs,
  query,
  where,
  limit,
  collectionGroup,
} from 'firebase/firestore';
import { auth, db, validateFirebaseConnection } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { UserProfile, Restaurant, RestaurantUser, StaffAuthorization, UserRole, AuditLog } from '../types';
import { syncUserAuthorizations } from '../services/restaurantService';
import { validateDisplayName } from '../utils/profileValidation';

export type LoadingStage = 'connecting' | 'authenticating' | 'fetching_data' | 'syncing_inventory' | 'ready';

interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: UserProfile | null;
  activeRestaurant: Restaurant | null;
  activeRestaurantId: string | null;
  activeRole: UserRole | null;
  userRestaurants: Restaurant[];
  loading: boolean;
  loadingStage: LoadingStage;
  loadingProgress: number;
  error: string | null;
  clearError: () => void;
  isFirebaseOffline: boolean;
  retryInitialization: () => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  setUpPhoneRecaptcha: (containerId: string) => RecaptchaVerifier;
  sendPhoneOtp: (phoneNumber: string, appVerifier: RecaptchaVerifier) => Promise<ConfirmationResult>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  switchRestaurant: (restaurantId: string) => void;
  refreshRestaurants: () => Promise<void>;
  hasRole: (allowedRoles: UserRole[]) => boolean;
  updateOwnProfileName: (newName: string) => Promise<{ success: boolean; normalizedName?: string; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [activeRestaurant, setActiveRestaurant] = useState<Restaurant | null>(null);
  const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole | null>(null);
  const [userRestaurants, setUserRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingStage, setLoadingStage] = useState<LoadingStage>('connecting');
  const [loadingProgress, setLoadingProgress] = useState<number>(25);
  const [error, setError] = useState<string | null>(null);
  const [isFirebaseOffline, setIsFirebaseOffline] = useState<boolean>(false);

  // 1. Initial connection verification
  useEffect(() => {
    validateFirebaseConnection().then((res) => {
      if (!res.ok) {
        setIsFirebaseOffline(true);
        setError(res.message || 'Firebase is offline');
        setLoading(false);
      } else {
        setLoadingStage('authenticating');
        setLoadingProgress(50);
      }
    });
  }, []);

  // 2. Auth state observer
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setUserProfile(null);
        setActiveRestaurant(null);
        setActiveRestaurantId(null);
        setActiveRole(null);
        setUserRestaurants([]);
        setLoadingStage('ready');
        setLoadingProgress(100);
        setLoading(false);
        return;
      }

      try {
        setLoadingStage('fetching_data');
        setLoadingProgress(70);

        const userDocRef = doc(db, 'users', currentUser.uid);
        const userSnap = await getDoc(userDocRef);
        const now = new Date().toISOString();

        let profileData: UserProfile;

        if (userSnap.exists()) {
          profileData = userSnap.data() as UserProfile;
          // Update last login
          await setDoc(userDocRef, { lastLoginAt: now }, { merge: true });
        } else {
          // First time login -> Create profile
          profileData = {
            uid: currentUser.uid,
            name: currentUser.displayName || 'Staff User',
            email: currentUser.email || '',
            phone: currentUser.phoneNumber || '',
            photoURL: currentUser.photoURL || '',
            createdAt: now,
            lastLoginAt: now,
            accountStatus: 'active',
            restaurantIds: [],
          };
          await setDoc(userDocRef, profileData);
        }

        setUserProfile(profileData);

        // Check and sync any authorized restaurant memberships for this user's verified identity
        let effectiveRestaurantIds = profileData.restaurantIds || [];
        if (currentUser.email) {
          try {
            const newlyLinked = await syncUserAuthorizations({
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName || profileData.name,
            });
            if (newlyLinked.length > 0) {
              effectiveRestaurantIds = Array.from(new Set([...effectiveRestaurantIds, ...newlyLinked]));
              setUserProfile((prev) => (prev ? { ...prev, restaurantIds: effectiveRestaurantIds } : prev));
            }
          } catch (syncErr) {
            console.error('Error during authorization sync:', syncErr);
          }
        }

        // Fetch restaurants for this user
        setLoadingStage('syncing_inventory');
        setLoadingProgress(90);
        await loadUserRestaurants(currentUser.uid, effectiveRestaurantIds, profileData);

        setLoadingStage('ready');
        setLoadingProgress(100);
      } catch (err) {
        console.error('Error fetching user profile:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Retry initialization on user action
  const retryInitialization = async () => {
    setError(null);
    setIsFirebaseOffline(false);
    setLoading(true);
    setLoadingStage('connecting');
    setLoadingProgress(25);

    try {
      const connRes = await validateFirebaseConnection();
      if (!connRes.ok) {
        setIsFirebaseOffline(true);
        setError(connRes.message || 'Firebase is offline');
        setLoading(false);
        return;
      }

      setLoadingStage('authenticating');
      setLoadingProgress(50);

      const currentUser = auth.currentUser;
      if (!currentUser) {
        setLoadingStage('ready');
        setLoadingProgress(100);
        setLoading(false);
        return;
      }

      setLoadingStage('fetching_data');
      setLoadingProgress(70);

      const userDocRef = doc(db, 'users', currentUser.uid);
      const userSnap = await getDoc(userDocRef);
      if (userSnap.exists()) {
        const profile = userSnap.data() as UserProfile;
        setUserProfile(profile);

        if (currentUser.email) {
          try {
            await syncUserAuthorizations({
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName || profile.name,
            });
          } catch (syncErr) {
            console.error('Error during authorization sync in retry:', syncErr);
          }
        }

        setLoadingStage('syncing_inventory');
        setLoadingProgress(90);
        await loadUserRestaurants(currentUser.uid, profile.restaurantIds || [], profile);
      }

      setLoadingStage('ready');
      setLoadingProgress(100);
      setLoading(false);
    } catch (err) {
      console.error('Retry initialization failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to Firebase database');
      setLoading(false);
    }
  };

  // Fetch restaurants where user is owner or member
  const loadUserRestaurants = async (
    uid: string,
    assignedRestaurantIds: string[],
    currentProfile?: UserProfile
  ) => {
    try {
      // 1. Query restaurants owned by user
      const ownedQuery = query(collection(db, 'restaurants'), where('ownerUid', '==', uid));
      const ownedSnap = await getDocs(ownedQuery);
      const ownedList = ownedSnap.docs.map((d) => d.data() as Restaurant);

      // 2. Query any explicitly assigned restaurants
      const memberList: Restaurant[] = [];
      const checkedIds = new Set<string>(ownedList.map((r) => r.id));

      for (const rId of assignedRestaurantIds) {
        if (!checkedIds.has(rId)) {
          checkedIds.add(rId);
          const rDoc = await getDoc(doc(db, 'restaurants', rId));
          if (rDoc.exists()) {
            memberList.push(rDoc.data() as Restaurant);
          }
        }
      }

      // 3. Query active authorizations by email to catch any restaurants
      const currentUser = auth.currentUser;
      if (currentUser?.email) {
        try {
          const authGroupQuery = query(
            collectionGroup(db, 'authorizations'),
            where('email', '==', currentUser.email.trim().toLowerCase()),
            where('status', '==', 'ACTIVE')
          );
          const authGroupSnap = await getDocs(authGroupQuery);
          for (const d of authGroupSnap.docs) {
            const authData = d.data() as StaffAuthorization;
            if (authData.restaurantId && !checkedIds.has(authData.restaurantId)) {
              checkedIds.add(authData.restaurantId);
              const rDoc = await getDoc(doc(db, 'restaurants', authData.restaurantId));
              if (rDoc.exists()) {
                memberList.push(rDoc.data() as Restaurant);
              }
            }
          }
        } catch (authErr) {
          console.error('Error querying authorizations collection group in loadUserRestaurants:', authErr);
        }
      }

      const all = [...ownedList, ...memberList];
      setUserRestaurants(all);

      if (all.length > 0) {
        const defaultRest = all[0];
        setActiveRestaurant(defaultRest);
        setActiveRestaurantId(defaultRest.id);
        await resolveUserRole(uid, defaultRest, currentProfile);
      } else {
        setActiveRestaurant(null);
        setActiveRestaurantId(null);
        setActiveRole(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'restaurants');
    }
  };

  // Resolve user role in active restaurant and reconcile display name if updated by an admin
  const resolveUserRole = async (uid: string, restaurant: Restaurant, currentProfile?: UserProfile) => {
    const syncMemberDisplayNameIfNewer = async (memberName?: string, memberNameUpdatedAt?: string) => {
      if (!memberName || !memberNameUpdatedAt) return;
      const knownProfile = currentProfile || userProfile;
      const rootUpdatedAt = knownProfile?.nameUpdatedAt || '';
      if (!rootUpdatedAt || memberNameUpdatedAt > rootUpdatedAt) {
        if (knownProfile?.name !== memberName) {
          try {
            if (auth.currentUser) {
              await updateProfile(auth.currentUser, { displayName: memberName });
            }
            await updateDoc(doc(db, 'users', uid), {
              name: memberName,
              nameUpdatedAt: memberNameUpdatedAt,
            });
            setUserProfile((prev) =>
              prev ? { ...prev, name: memberName, nameUpdatedAt: memberNameUpdatedAt } : prev
            );
          } catch (syncNameErr) {
            console.error('Failed to reconcile updated member display name:', syncNameErr);
          }
        }
      }
    };

    if (restaurant.ownerUid === uid) {
      setActiveRole('OWNER');
      try {
        const ownerMemberDoc = await getDoc(doc(db, 'restaurants', restaurant.id, 'users', uid));
        if (ownerMemberDoc.exists()) {
          const uData = ownerMemberDoc.data() as RestaurantUser;
          await syncMemberDisplayNameIfNewer(uData.name, uData.nameUpdatedAt);
        }
      } catch {
        // Ignore non-fatal sync error for owner
      }
      return;
    }

    try {
      const userMemberDoc = await getDoc(doc(db, 'restaurants', restaurant.id, 'users', uid));
      if (userMemberDoc.exists()) {
        const uData = userMemberDoc.data() as RestaurantUser;
        setActiveRole(uData.role);
        await syncMemberDisplayNameIfNewer(uData.name, uData.nameUpdatedAt);
        return;
      }

      // Fallback check in authorizations subcollection
      const currentUser = auth.currentUser;
      if (currentUser?.email) {
        const authQuery = query(
          collection(db, 'restaurants', restaurant.id, 'authorizations'),
          where('email', '==', currentUser.email.trim().toLowerCase()),
          where('status', '==', 'ACTIVE')
        );
        const authSnap = await getDocs(authQuery);
        if (!authSnap.empty) {
          const authData = authSnap.docs[0].data() as StaffAuthorization;
          setActiveRole(authData.role);
          await syncMemberDisplayNameIfNewer(authData.fullName, authData.nameUpdatedAt);
          return;
        }
      }

      setActiveRole('DEPARTMENT_STAFF');
    } catch (e) {
      console.error('Error resolving role:', e);
      setActiveRole('DEPARTMENT_STAFF');
    }
  };

  const switchRestaurant = async (restaurantId: string) => {
    const found = userRestaurants.find((r) => r.id === restaurantId);
    if (found && user) {
      setActiveRestaurant(found);
      setActiveRestaurantId(found.id);
      await resolveUserRole(user.uid, found);
    }
  };

  const refreshRestaurants = async () => {
    if (user && userProfile) {
      await loadUserRestaurants(user.uid, userProfile.restaurantIds || [], userProfile);
    }
  };

  const loginWithGoogle = async () => {
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error('Google Sign-In Error:', err);
      setError(err instanceof Error ? err.message : 'Google Sign-In failed');
      throw err;
    }
  };

  const clearError = () => setError(null);

  const setUpPhoneRecaptcha = (containerId: string): RecaptchaVerifier => {
    const win = window as unknown as { stoqoRecaptchaVerifier?: RecaptchaVerifier };
    if (win.stoqoRecaptchaVerifier) {
      try {
        win.stoqoRecaptchaVerifier.clear();
      } catch {
        // Ignore if already cleared
      }
      win.stoqoRecaptchaVerifier = undefined;
    }

    const containerEl = document.getElementById(containerId);
    if (containerEl) {
      containerEl.innerHTML = '';
    }

    const verifier = new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
      callback: () => {
        // reCAPTCHA solved
      },
    });
    win.stoqoRecaptchaVerifier = verifier;
    return verifier;
  };

  const sendPhoneOtp = async (
    phoneNumber: string,
    appVerifier: RecaptchaVerifier
  ): Promise<ConfirmationResult> => {
    setError(null);
    try {
      return await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
    } catch (err) {
      console.error('Phone Sign-In Error:', err);
      setError(err instanceof Error ? err.message : 'Phone authentication failed');
      throw err;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Sign-Out Error:', err);
    }
  };

  const deleteAccount = async () => {
    if (!auth.currentUser) return;
    try {
      const uid = auth.currentUser.uid;
      // Mark suspended in profile
      await setDoc(doc(db, 'users', uid), { accountStatus: 'suspended' }, { merge: true });
      await deleteUser(auth.currentUser);
    } catch (err) {
      console.error('Delete Account Error:', err);
      throw err;
    }
  };

  const hasRole = (allowedRoles: UserRole[]): boolean => {
    if (!activeRole) return false;
    if (activeRole === 'OWNER') return true; // Owner has full access
    return allowedRoles.includes(activeRole);
  };

  const updateOwnProfileName = async (
    newName: string
  ): Promise<{ success: boolean; normalizedName?: string; error?: string }> => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      return { success: false, error: 'You must be signed in to update your profile name.' };
    }

    const validation = validateDisplayName(newName);
    if (!validation.valid) {
      return { success: false, error: validation.error || 'Please enter a valid display name.' };
    }

    const normalizedName = validation.normalized;
    const previousName = userProfile?.name || currentUser.displayName || 'User';
    if (previousName === normalizedName) {
      return { success: true, normalizedName };
    }

    const now = new Date().toISOString();

    try {
      // 1. Update Firebase Auth display name
      await updateProfile(currentUser, { displayName: normalizedName });

      // 2. Update root /users/{uid} document (only name and nameUpdatedAt)
      const rootUserRef = doc(db, 'users', currentUser.uid);
      try {
        await updateDoc(rootUserRef, {
          name: normalizedName,
          nameUpdatedAt: now,
        });
      } catch (rootErr) {
        handleFirestoreError(rootErr, OperationType.UPDATE, `users/${currentUser.uid}`);
      }

      // 3. Propagate updated display name to all linked restaurant memberships & authorizations
      const restaurantIdsToUpdate = Array.from(
        new Set([
          ...userRestaurants.map((r) => r.id),
          ...(activeRestaurantId ? [activeRestaurantId] : []),
          ...(userProfile?.restaurantIds || []),
        ].filter(Boolean))
      );

      for (const rId of restaurantIdsToUpdate) {
        try {
          const memberRef = doc(db, 'restaurants', rId, 'users', currentUser.uid);
          const memberSnap = await getDoc(memberRef);
          if (memberSnap.exists()) {
            await updateDoc(memberRef, {
              name: normalizedName,
              nameUpdatedAt: now,
            });
          }

          // Also sync linked authorization record if present
          const authByUidQuery = query(
            collection(db, 'restaurants', rId, 'authorizations'),
            where('attachedUid', '==', currentUser.uid),
            limit(1)
          );
          const authByUidSnap = await getDocs(authByUidQuery);
          if (!authByUidSnap.empty) {
            await updateDoc(authByUidSnap.docs[0].ref, {
              fullName: normalizedName,
              nameUpdatedAt: now,
            });
          } else if (currentUser.email) {
            const authByEmailQuery = query(
              collection(db, 'restaurants', rId, 'authorizations'),
              where('email', '==', currentUser.email.trim().toLowerCase()),
              limit(1)
            );
            const authByEmailSnap = await getDocs(authByEmailQuery);
            if (!authByEmailSnap.empty) {
              await updateDoc(authByEmailSnap.docs[0].ref, {
                fullName: normalizedName,
                nameUpdatedAt: now,
              });
            }
          }
        } catch (tenantErr) {
          console.error(`Failed updating member display name in restaurant ${rId}:`, tenantErr);
        }
      }

      // 4. Write immutable audit log entry on the active restaurant
      if (activeRestaurantId) {
        try {
          const auditRef = doc(collection(db, 'restaurants', activeRestaurantId, 'auditLogs'));
          const auditEntry: AuditLog = {
            id: auditRef.id,
            actorUid: currentUser.uid,
            actorName: normalizedName,
            actorRole: activeRole || 'OWNER',
            action: 'PROFILE_NAME_UPDATED',
            entity: 'UserProfile',
            entityId: currentUser.uid,
            details: `User updated own display name from "${previousName}" to "${normalizedName}"`,
            targetEmail: userProfile?.email || currentUser.email || '',
            targetRole: activeRole || 'OWNER',
            restaurantId: activeRestaurantId,
            createdAt: now,
          };
          await setDoc(auditRef, auditEntry);
        } catch (auditErr) {
          console.error('Non-fatal audit log write failure during self profile update:', auditErr);
        }
      }

      // 5. Update in-memory userProfile state immediately across Header, Profile, and Team views
      setUserProfile((prev) =>
        prev
          ? {
              ...prev,
              name: normalizedName,
              nameUpdatedAt: now,
            }
          : {
              uid: currentUser.uid,
              name: normalizedName,
              nameUpdatedAt: now,
              email: currentUser.email || '',
              phone: currentUser.phoneNumber || '',
              photoURL: currentUser.photoURL || '',
              createdAt: now,
              lastLoginAt: now,
              accountStatus: 'active',
              restaurantIds: restaurantIdsToUpdate,
            }
      );

      return { success: true, normalizedName };
    } catch (err) {
      console.error('[updateOwnProfileName] Failed to update profile name:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unable to save display name. Please try again.',
      };
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        activeRestaurant,
        activeRestaurantId,
        activeRole,
        userRestaurants,
        loading,
        loadingStage,
        loadingProgress,
        error,
        clearError,
        isFirebaseOffline,
        retryInitialization,
        loginWithGoogle,
        setUpPhoneRecaptcha,
        sendPhoneOtp,
        logout,
        deleteAccount,
        switchRestaurant,
        refreshRestaurants,
        hasRole,
        updateOwnProfileName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
