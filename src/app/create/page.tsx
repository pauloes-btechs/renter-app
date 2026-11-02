import { PageHeader } from "@/components/ui";
import { getViewer } from "@/lib/server/session";
import { CreateGroupForm } from "./form";

export const metadata = { title: "Start a group" };
export default async function CreatePage() {
  const viewer = await getViewer();
  return (
    <div className="mx-auto max-w-2xl fade-in">
      <PageHeader eyebrow="New group" title="Start a rental-sharing group" subtitle="You'll be the organizer. Next you'll review the house, its bedrooms and pricing, then invite each party." />
      <CreateGroupForm defaultName={viewer?.display_name ?? ""} signedIn={!!viewer} />
    </div>
  );
}
