import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// Projet Firebase "tiptoe-masterdata-hub" (app Web). Auth Google restreinte @tiptoe.fr.
const firebaseConfig = {
  apiKey: 'AIzaSyCECJNPUcQRWY4niuyHFLWZrUxQ-UubVcA',
  authDomain: 'tiptoe-masterdata-hub.firebaseapp.com',
  projectId: 'tiptoe-masterdata-hub',
  storageBucket: 'tiptoe-masterdata-hub.firebasestorage.app',
  messagingSenderId: '500862466865',
  appId: '1:500862466865:web:5ab226291eabc6cb8e0e10',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
// Functions en europe-west1 (aligné sur les autres apps TIPTOE).
export const functions = getFunctions(app, 'europe-west1');
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ hd: 'tiptoe.fr' });
