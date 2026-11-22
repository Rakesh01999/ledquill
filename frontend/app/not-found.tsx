import Link from "next/link";
import { EmptyState } from "@/components/shared/states";

export default function NotFound() {
  return <EmptyState title="That page does not exist." action={<Link href="/documents">Go to documents</Link>} />;
}
