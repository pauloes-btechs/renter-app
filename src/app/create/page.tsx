import { PageHeader } from "@/components/ui";
import { getViewer } from "@/lib/server/session";
import { CreateGroupForm } from "./form";

export const metadata = { title: "Start a group" };
export default async function CreatePage() {
  const viewer = await getViewer();
  return (
    <div className="mx-auto max-w-3xl fade-in">
      <PageHeader eyebrow="New group" title="Start a rental-sharing group" subtitle="You'll be the organizer. Start from the rental listing and we'll set up the house, price and bedrooms for you to review." />
      <CreateGroupForm defaultName={viewer?.display_name ?? ""} signedIn={!!viewer} />
    </div>
  );
}
