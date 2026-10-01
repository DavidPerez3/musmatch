import { getSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function callInternalRpc<T>(
  fn: string,
  params?: Record<string, unknown>
): Promise<T> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await (supabase as any).rpc(fn, params ?? {});
  if (error) {
    throw new Error(error.message);
  }
  return data as T;
}
