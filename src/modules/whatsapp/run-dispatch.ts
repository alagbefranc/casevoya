import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { dispatchWhatsApp } from "./dispatch";
import { zernio } from "./env";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Drains WhatsApp outbox events with the service role (mirrors runEmailDispatch). */
export async function runWhatsAppDispatch(limit = 20) {
  const supabase = createServiceClient();
  return dispatchWhatsApp(
    {
      async claim(worker, count) {
        const { data, error } = await supabase.rpc("claim_whatsapp_events", { p_worker: worker, p_limit: count });
        if (error) throw new Error(error.message);
        return (Array.isArray(data) ? data : []).flatMap((row) => {
          const record = asRecord(row);
          return typeof record.id === "string" ? [{ id: record.id }] : [];
        });
      },
      async prepare(eventId, worker) {
        const { data, error } = await supabase.rpc("prepare_whatsapp_delivery", { p_event_id: eventId, p_worker: worker });
        if (error) throw new Error(error.message);
        return asRecord(data);
      },
      async finish(deliveryId, worker, outcome, messageId, conversationId, errorText) {
        const { error } = await supabase.rpc("finish_whatsapp_delivery", {
          p_delivery_id: deliveryId,
          p_worker: worker,
          p_outcome: outcome,
          p_provider_message_id: messageId ?? "",
          p_conversation_id: conversationId ?? "",
          p_error: errorText ?? "",
        });
        if (error) throw new Error(error.message);
      },
      zernio: zernio(),
    },
    { worker: "casevoya-whatsapp-dispatch", limit },
  );
}
