import { ok, serverError } from "@/lib/json";
import { sendTestEmail } from "@/server/notifications";

export async function POST() {
  try {
    await sendTestEmail();
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
