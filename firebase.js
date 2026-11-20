import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";
export * from "https://www.gstatic.com/firebasejs/10.14.0/firebase-auth.js";
export * from "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.14.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIZPv2R6N2XfTPepTPSHk3WKVLqjkpy6g",
  authDomain: "kaza-bf0dc.firebaseapp.com",
  projectId: "kaza-bf0dc",
  storageBucket: "kaza-bf0dc.firebasestorage.app",
  messagingSenderId: "785266371417",
  appId: "1:785266371417:web:9dc8df1cfef4e12ec63a48",
  measurementId: "G-MTDDTVT839"
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
