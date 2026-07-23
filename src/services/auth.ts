import { auth, googleProvider } from '../firebase';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';

const ALLOWED_DOMAIN = 'tiptoe.fr';

export const signInWithGoogle = async (): Promise<void> => {
  const result = await signInWithPopup(auth, googleProvider);
  const email = result.user.email ?? '';
  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    await signOut(auth);
    throw new Error(`Accès réservé aux adresses @${ALLOWED_DOMAIN}`);
  }
};

export const signOutUser = () => signOut(auth);
export const onAuthChange = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb);
export const getCurrentUser = () => auth.currentUser;
