import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/app")({
  component: () => (<><AppLayout /><Toaster theme="dark" position="top-right" /></>),
});
