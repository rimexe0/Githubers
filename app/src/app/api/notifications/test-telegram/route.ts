import { ok, serverError } from "@/lib/json";
import { sendTestTelegram } from "@/server/notifications";

export async function POST() {
  try {
    await sendTestTelegram();
    return ok({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
