import "server-only";
import { notFound } from "next/navigation";
import { AppError } from "./errors";
import { requireViewer } from "./session";
import { getGroupView } from "./views";

/** Loads the viewer's authorized view of a group, or 404s (never reveals whether a group exists). */
export async function loadView(groupId: string, path: string) {
  const viewer = await requireViewer(path);
  try {
    return { viewer, view: getGroupView(groupId, viewer.id) };
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
}
