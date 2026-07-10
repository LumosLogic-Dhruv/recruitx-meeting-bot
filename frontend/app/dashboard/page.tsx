"use client";
import { useEffect } from "react";
import { getUser } from "@/lib/api";

export default function DashboardRedirect() {
  useEffect(() => {
    const user = getUser();
    window.location.replace(user?.role === "admin" ? "/admin" : "/recruiter");
  }, []);
  return null;
}
