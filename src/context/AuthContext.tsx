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
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { auth, db, validateFirebaseConnection } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { UserProfile, Restaurant, RestaurantUser, UserRole } from '../types';

interface AuthContextType {
  user: FirebaseUser | null;
  userProfile: UserProfile | null;
  activeRestaurant: Restaurant | null;
  activeRestaurantId: string | null;
  activeRole: UserRole | null;
  userRestaurants: Restaurant[];
  loading: boolean;
  error: string | null;
  isFirebaseOffline: boolean;
  loginWithGoogle: () => Promise<void>;
  setUpPhoneRecaptcha: (containerId: string) => RecaptchaVerifier;
  sendPhoneOtp: (phoneNumber: string, appVerifier: RecaptchaVerifier) => Promise<ConfirmationResult>;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  switchRestaurant: (restaurantId: string) => void;
  refreshRestaurants: () => Promise<void>;
  hasRole: (allowedRoles: UserRole[]) => boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [isFirebaseOffline, setIsFirebaseOffline] = useState<boolean>(false);

  // 1. Initial connection verification
  useEffect(() => {
    validateFirebaseConnection().then((res) => {
      if (!res.ok) {
        setIsFirebaseOffline(true);
        setError(res.message || 'Firebase is offline');
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
        setLoading(false);
        return;
      }

      try {
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

        // Fetch restaurants for this user
        await loadUserRestaurants(currentUser.uid, profileData.restaurantIds || []);
      } catch (err) {
        console.error('Error fetching user profile:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Fetch restaurants where user is owner or member
  const loadUserRestaurants = async (uid: string, assignedRestaurantIds: string[]) => {
    try {
      // 1. Query restaurants owned by user
      const ownedQuery = query(collection(db, 'restaurants'), where('ownerUid', '==', uid));
      const ownedSnap = await getDocs(ownedQuery);
      const ownedList = ownedSnap.docs.map((d) => d.data() as Restaurant);

      // 2. Query any explicitly assigned restaurants
      const memberList: Restaurant[] = [];
      for (const rId of assignedRestaurantIds) {
        if (!ownedList.some((r) => r.id === rId)) {
          const rDoc = await getDoc(doc(db, 'restaurants', rId));
          if (rDoc.exists()) {
            memberList.push(rDoc.data() as Restaurant);
          }
        }
      }

      const all = [...ownedList, ...memberList];
      setUserRestaurants(all);

      if (all.length > 0) {
        const defaultRest = all[0];
        setActiveRestaurant(defaultRest);
        setActiveRestaurantId(defaultRest.id);
        await resolveUserRole(uid, defaultRest);
      } else {
        setActiveRestaurant(null);
        setActiveRestaurantId(null);
        setActiveRole(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'restaurants');
    }
  };

  // Resolve user role in active restaurant
  const resolveUserRole = async (uid: string, restaurant: Restaurant) => {
    if (restaurant.ownerUid === uid) {
      setActiveRole('OWNER');
      return;
    }
    try {
      const userMemberDoc = await getDoc(doc(db, 'restaurants', restaurant.id, 'users', uid));
      if (userMemberDoc.exists()) {
        const uData = userMemberDoc.data() as RestaurantUser;
        setActiveRole(uData.role);
      } else {
        setActiveRole('DEPARTMENT_STAFF');
      }
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
      await loadUserRestaurants(user.uid, userProfile.restaurantIds || []);
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

  const setUpPhoneRecaptcha = (containerId: string): RecaptchaVerifier => {
    return new RecaptchaVerifier(auth, containerId, {
      size: 'invisible',
      callback: () => {
        // reCAPTCHA solved
      },
    });
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
        error,
        isFirebaseOffline,
        loginWithGoogle,
        setUpPhoneRecaptcha,
        sendPhoneOtp,
        logout,
        deleteAccount,
        switchRestaurant,
        refreshRestaurants,
        hasRole,
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
