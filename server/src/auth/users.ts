import { Timestamp } from "firebase-admin/firestore";
import db from "../db.js";

export interface UserDoc {
  email: string; // stored lowercased/trimmed
  passwordHash: string;
  createdAt: Timestamp;
}

export const usersCol = db.collection("users");

export async function findUserByEmail(email: string): Promise<{ id: string; data: UserDoc } | null> {
  const snap = await usersCol.where("email", "==", email.toLowerCase().trim()).limit(1).get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, data: snap.docs[0].data() as UserDoc };
}
