"use client";
import { useEffect } from "react";

export default function RecruiterRoot() {
  useEffect(() => { window.location.replace("/recruiter/add"); }, []);
  return null;
}
